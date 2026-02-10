#!/usr/bin/env node

/**
 * Kanban Server with PostgreSQL + Real-Time Updates
 * Fornece API para o dashboard em tempo real com persistência
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// PostgreSQL configuration
const { Client } = require('pg');

const PORT = process.env.PORT || 3001;

// PostgreSQL client ( Railway provides DATABASE_URL)
let pgClient = null;

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
        if (task.id && task.id > 0) {
            // Update existing
            await pgClient.query(`
                UPDATE tasks SET 
                    title = $1, description = $2, column_name = $3, tag = $4,
                    assignee = $5, priority = $6, emoji = $7, due_date = $8,
                    updated_at = $9
                WHERE id = $10
            `, [
                task.title, task.description, task.column, task.tag,
                task.assignee, task.priority, task.emoji, task.dueDate,
                task.updatedAt || Date.now(), task.id
            ]);
        } else {
            // Insert new
            await pgClient.query(`
                INSERT INTO tasks (title, description, column_name, tag, assignee, priority, emoji, due_date, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [
                task.title, task.description, task.column || 'backlog', task.tag,
                task.assignee, task.priority, task.emoji, task.dueDate,
                Date.now(), Date.now()
            ]);
        }
        return true;
    } catch (e) {
        console.error('Erro saveTask:', e.message);
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
    return [
        {
            id: 1,
            title: 'Finalizar Deploy BTC Monitor',
            description: 'Conectar Netlify e fazer deploy do painel de monitoramento BTC',
            column: 'progress',
            tag: 'purple',
            assignee: 'Clawd',
            priority: 'high',
            emoji: '🚀',
            dueDate: '2026-02-05',
            updatedAt: Date.now()
        },
        {
            id: 2,
            title: 'Configurar PostgreSQL',
            description: 'Integrar banco de dados Railway para persistência real',
            column: 'progress',
            tag: 'blue',
            assignee: 'Clawd',
            priority: 'high',
            emoji: '🗄️',
            dueDate: '2026-02-10',
            updatedAt: Date.now()
        },
        {
            id: 3,
            title: 'Configurar Notificações Email',
            description: 'Terminar configuração do msmtp para alertas automáticos',
            column: 'done',
            tag: 'green',
            assignee: 'Clawd',
            priority: 'medium',
            emoji: '✅',
            dueDate: '2026-02-05',
            updatedAt: Date.now()
        }
    ];
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
    '.json': 'application/json'
};

// HTTP Server
const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
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
                
                if (data.action === 'update' && data.task) {
                    if (usePostgres) {
                        success = await saveTaskPG({ ...data.task, updatedAt: Date.now() });
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

// Initialize and start server
async function start() {
    // Try PostgreSQL first
    usePostgres = await initDatabase();
    
    server.listen(PORT, () => {
        console.log(`
🚀 Kanban Server ${usePostgres ? 'with PostgreSQL' : '(Local Mode)'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 URL: http://localhost:${PORT}
📊 API: http://localhost:${PORT}/api/tasks
📈 Status: http://localhost:${PORT}/api/status
💚 Health: http://localhost:${PORT}/api/health
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);
    });
}

start().catch(e => {
    console.error('Failed to start:', e);
    process.exit(1);
});
