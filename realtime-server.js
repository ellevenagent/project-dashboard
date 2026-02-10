#!/usr/bin/env node

/**
 * Kanban Server with PostgreSQL + Real-Time WebSocket (Socket.io)
 * Fornece API para o dashboard em tempo real com persistência
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Socket.io for real-time updates
const { Server } = require('socket.io');

// PostgreSQL configuration
const { Client } = require('pg');

const PORT = process.env.PORT || 3001;

// PostgreSQL client ( Railway provides DATABASE_URL)
let pgClient = null;

// Socket.io instance
let io = null;

// Connected clients
const clients = new Set();

async function initDatabase() {
    try {
        // Railway provides DATABASE_URL or DATABASE_PUBLIC_URL
        const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
        
        if (databaseUrl) {
            console.log('🔄 Conectando ao PostgreSQL...');
            pgClient = new Client({
                connectionString: databaseUrl,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });
            
            await pgClient.connect();
            console.log('✅ Conectado ao PostgreSQL');
            
            // Create tasks table if not exists
            await pgClient.query(`
                CREATE TABLE IF NOT EXISTS tasks (
                    id SERIAL PRIMARY KEY,
                    title VARCHAR(500) NOT NULL,
                    description TEXT,
                    column_name VARCHAR(50) DEFAULT 'backlog',
                    tag VARCHAR(50),
                    assignee VARCHAR(100),
                    priority VARCHAR(20),
                    emoji VARCHAR(10),
                    due_date VARCHAR(20),
                    created_at BIGINT,
                    updated_at BIGINT
                )
            `);
            
            console.log('✅ Tabela tasks criada/verificada');
            return true;
        } else {
            console.log('⚠️ DATABASE_URL não encontrada - usando modo local');
            return false;
        }
    } catch (e) {
        console.error('❌ Erro PostgreSQL:', e.message);
        return false;
    }
}

// PostgreSQL functions
async function getTasksPG() {
    try {
        const result = await pgClient.query('SELECT * FROM tasks ORDER BY id DESC');
        return result.rows.map(row => ({
            id: row.id,
            title: row.title,
            description: row.description,
            column: row.column_name,
            tag: row.tag,
            assignee: row.assignee,
            priority: row.priority,
            emoji: row.emoji,
            dueDate: row.due_date,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    } catch (e) {
        console.error('Erro getTasks:', e.message);
        return [];
    }
}

async function saveTaskPG(task) {
    try {
        if (!pgClient) {
            console.error('pgClient is null - reconnecting...');
            return false;
        }
        
        if (task.id && task.id > 0) {
            // Update - only update what's provided
            const updates = [];
            const values = [];
            let paramNum = 1;
            
            if (task.column !== undefined) {
                updates.push(`column_name = $${paramNum++}`);
                values.push(task.column);
            }
            if (task.title !== undefined) {
                updates.push(`title = $${paramNum++}`);
                values.push(task.title);
            }
            if (task.description !== undefined) {
                updates.push(`description = $${paramNum++}`);
                values.push(task.description);
            }
            if (task.updatedAt !== undefined) {
                updates.push(`updated_at = $${paramNum++}`);
                values.push(task.updatedAt);
            }
            
            // Add updated_at timestamp
            const timestamp = Date.now();
            updates.push(`updated_at = $${paramNum++}`);
            values.push(timestamp);
            
            values.push(task.id);
            
            if (updates.length > 0) {
                const query = `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramNum}`;
                console.log(`Executing: ${query} with values: ${values}`);
                const result = await pgClient.query(query, values);
                console.log(`UPDATE task ${task.id}: ${result.rowCount} rows affected`);
                return true; // Return true if no error, even if rowCount is 0
            }
            return true;
        } else {
            // Insert new
            await pgClient.query(`
                INSERT INTO tasks (title, description, column_name, tag, assignee, priority, emoji, due_date, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [
                task.title || '', task.description || '', task.column || 'backlog', task.tag || '',
                task.assignee || '', task.priority || 'medium', task.emoji || '', task.dueDate || '',
                Date.now(), Date.now()
            ]);
            
            // Notify if this is a Clawd task
            const assignee = (task.assignee || '').toLowerCase();
            if (assignee.includes('clawd') || assignee.includes('jarvis')) {
                const newTask = { ...task, id: Date.now() };
                broadcastClawdNotification(newTask);
            }
            return true;
        }
    } catch (e) {
        console.error('Erro saveTask:', e.message, e.stack);
        return false;
    }
}

async function deleteTaskPG(taskId) {
    try {
        await pgClient.query('DELETE FROM tasks WHERE id = $1', [taskId]);
        return true;
    } catch (e) {
        console.error('Erro deleteTask:', e.message);
        return false;
    }
}

// Broadcast to all connected clients
function broadcastTasks() {
    if (io && usePostgres) {
        getTasksPG().then(tasks => {
            console.log(`📡 Broadcasting ${tasks.length} tasks to ${io.engine.clientsCount} clients`);
            io.emit('tasks:update', { tasks, timestamp: Date.now() });
        }).catch(err => {
            console.error('Error broadcasting tasks:', err.message);
        });
    }
}

// Force broadcast function (for debugging)
global.forceBroadcast = function() {
    console.log('🔄 Force broadcast triggered');
    broadcastTasks();
    return 'Broadcast triggered';
};

// Broadcast notification for Clawd tasks
function broadcastClawdNotification(task) {
    if (io && usePostgres) {
        const assignee = (task.assignee || '').toLowerCase();
        if (assignee.includes('clawd') || assignee.includes('jarvis')) {
            io.emit('clawd:task', {
                task: task,
                message: `📋 Nova task para Clawd: ${task.title}`,
                timestamp: Date.now()
            });
            console.log(`🔔 Notificação Clawd: ${task.title}`);
        }
    }
}

// Broadcast activity
function broadcastActivity(message) {
    if (io) {
        io.emit('activity:broadcast', {
            message: message,
            timestamp: Date.now()
        });
    }
}

// Local file fallback
const TASKS_FILE = path.join(__dirname, '..', 'tasks.json');

function getTasksLocal() {
    try {
        if (fs.existsSync(TASKS_FILE)) {
            return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('Usando tasks em memória');
    }
    return [];
}

function saveTasksLocal(tasks) {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

// Check if using PostgreSQL
let usePostgres = false;

// MIME types
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.ico': 'image/x-icon'
};

// HTTP Server with Socket.io
const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle Socket.io CORS
    if (req.url.startsWith('/socket.io')) {
        return;
    }
    
    // API endpoints
    if (req.url === '/api/tasks' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        
        if (usePostgres) {
            const tasks = await getTasksPG();
            res.end(JSON.stringify({ tasks, timestamp: Date.now(), source: 'postgresql' }));
        } else {
            const tasks = getTasksLocal();
            res.end(JSON.stringify({ tasks, timestamp: Date.now(), source: 'local' }));
        }
        return;
    }
    
    if (req.url === '/api/tasks' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                let success = false;
                
                console.log(`POST /api/tasks action=${data.action} taskId=${data.task?.id || 'new'}`);
                
                if (data.action === 'update' && data.task) {
                    if (usePostgres) {
                        success = await saveTaskPG({ ...data.task, updatedAt: Date.now() });
                        console.log(`saveTaskPG result: ${success}`);
                        if (success) {
                            console.log('Calling broadcastTasks...');
                            broadcastTasks();
                        }
                    } else {
                        let tasks = getTasksLocal();
                        const idx = tasks.findIndex(t => t.id === data.task.id);
                        if (idx !== -1) {
                            tasks[idx] = { ...tasks[idx], ...data.task, updatedAt: Date.now() };
                            saveTasksLocal(tasks);
                            success = true;
                        }
                    }
                } else if (data.action === 'add' && data.task) {
                    if (usePostgres) {
                        success = await saveTaskPG({ ...data.task, createdAt: Date.now(), updatedAt: Date.now() });
                        if (success) broadcastTasks();
                    } else {
                        let tasks = getTasksLocal();
                        const newTask = { 
                            ...data.task, 
                            id: Date.now(), 
                            createdAt: Date.now(), 
                            updatedAt: Date.now() 
                        };
                        tasks.push(newTask);
                        saveTasksLocal(tasks);
                        success = true;
                    }
                } else if (data.action === 'delete' && data.taskId) {
                    if (usePostgres) {
                        success = await deleteTaskPG(data.taskId);
                        if (success) broadcastTasks();
                    } else {
                        let tasks = getTasksLocal();
                        tasks = tasks.filter(t => t.id !== data.taskId);
                        saveTasksLocal(tasks);
                        success = true;
                    }
                }
                
                res.end(JSON.stringify({ success, timestamp: Date.now() }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }
    
    if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        
        let tasks = [];
        if (usePostgres) {
            tasks = await getTasksPG();
        } else {
            tasks = getTasksLocal();
        }
        
        res.end(JSON.stringify({
            status: 'running',
            timestamp: Date.now(),
            source: usePostgres ? 'postgresql' : 'local',
            clients: clients.size,
            total: tasks.length,
            byColumn: {
                backlog: tasks.filter(t => t.column === 'backlog').length,
                progress: tasks.filter(t => t.column === 'progress').length,
                done: tasks.filter(t => t.column === 'done').length,
                paused: tasks.filter(t => t.column === 'paused').length
            }
        }));
        return;
    }
    
    if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            postgres: usePostgres,
            websocket: !!io,
            clients: clients.size,
            timestamp: Date.now() 
        }));
        return;
    }
    
    // Serve static files
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, 'public', filePath);
    
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'text/plain';
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('404 Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

// Initialize Socket.io
function initWebSocket() {
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        path: '/socket.io'
    });
    
    io.on('connection', (socket) => {
        console.log(`🔌 Client connected: ${socket.id}`);
        clients.add(socket.id);
        
        // Send current tasks on connection
        if (usePostgres) {
            getTasksPG().then(tasks => {
                socket.emit('tasks:update', { tasks, timestamp: Date.now() });
            });
        }
        
        // Handle disconnect
        socket.on('disconnect', () => {
            console.log(`🔌 Client disconnected: ${socket.id}`);
            clients.delete(socket.id);
        });
        
        // Handle task updates from clients
        socket.on('task:update', async (data) => {
            if (usePostgres && data.task) {
                await saveTaskPG({ ...data.task, updatedAt: Date.now() });
                broadcastTasks();
            }
        });
        
        socket.on('task:add', async (data) => {
            if (usePostgres && data.task) {
                await saveTaskPG({ ...data.task, createdAt: Date.now(), updatedAt: Date.now() });
                broadcastTasks();
            }
        });
        
        socket.on('task:delete', async (data) => {
            if (usePostgres && data.taskId) {
                await deleteTaskPG(data.taskId);
                broadcastTasks();
            }
        });
        
        // Handle development status updates
        socket.on('dev:status', (data) => {
            // Broadcast dev status to all clients
            io.emit('dev:status', {
                ...data,
                clientId: socket.id,
                timestamp: Date.now()
            });
            console.log(`📡 Dev status: ${data.status} - ${data.message}`);
        });
        
        // Handle activity broadcasts
        socket.on('activity:broadcast', (data) => {
            io.emit('activity:broadcast', {
                ...data,
                clientId: socket.id,
                timestamp: Date.now()
            });
        });
    });
    
    console.log('✅ WebSocket (Socket.io) inicializado');
}

// Initialize and start server
async function start() {
    // Try PostgreSQL first
    usePostgres = await initDatabase();
    
    // Initialize WebSocket
    initWebSocket();
    
    server.listen(PORT, () => {
        console.log(`
🚀 Kanban Server ${usePostgres ? 'with PostgreSQL' : '(Local Mode)'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 URL: http://localhost:${PORT}
📊 API: http://localhost:${PORT}/api/tasks
📈 Status: http://localhost:${PORT}/api/status
💚 Health: http://localhost:${PORT}/api/health
🔌 WebSocket: ws://localhost:${PORT}/socket.io
👥 Clients: ${clients.size} connected
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);
    });
}

start().catch(e => {
    console.error('Failed to start:', e);
    process.exit(1);
});
