#!/usr/bin/env node

/**
 * Kanban Server with Real-Time Updates
 * Fornece API para o dashboard em tempo real
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const TASKS_FILE = path.join(__dirname, '..', 'tasks.json');

// Arquivo de tarefas compartilhado
function getTasks() {
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
            title: 'Configurar Notificações Email',
            description: 'Terminar configuração do msmtp para alertas automáticos',
            column: 'done',
            tag: 'green',
            assignee: 'Clawd',
            priority: 'medium',
            emoji: '✅',
            updatedAt: Date.now()
        }
    ];
}

function saveTasks(tasks) {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

// MIME types
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json'
};

// HTTP Server
const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // API endpoints
    if (req.url === '/api/tasks' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            tasks: getTasks(),
            timestamp: Date.now()
        }));
        return;
    }
    
    if (req.url === '/api/tasks' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                let tasks = getTasks();
                
                if (data.action === 'update') {
                    const idx = tasks.findIndex(t => t.id === data.task.id);
                    if (idx !== -1) {
                        tasks[idx] = { ...tasks[idx], ...data.task, updatedAt: Date.now() };
                    }
                } else if (data.action === 'add') {
                    tasks.push({ ...data.task, id: Date.now(), createdAt: Date.now(), updatedAt: Date.now() });
                } else if (data.action === 'delete') {
                    tasks = tasks.filter(t => t.id !== data.taskId);
                }
                
                saveTasks(tasks);
                res.end(JSON.stringify({ success: true, tasks }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }
    
    if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const tasks = getTasks();
        res.end(JSON.stringify({
            status: 'running',
            timestamp: Date.now(),
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

server.listen(PORT, () => {
    console.log(`
🚀 Kanban Server with Real-Time Updates
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 URL: http://localhost:${PORT}
📊 API: http://localhost:${PORT}/api/tasks
📈 Status: http://localhost:${PORT}/api/status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
});

// Salvar tarefas iniciais
const initialTasks = getTasks();
if (!fs.existsSync(TASKS_FILE)) {
    saveTasks(initialTasks);
}
