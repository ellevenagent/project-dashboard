# 🚀 Deploy Script - Project Dashboard

## Deploy no Netlify

### Opção 1: Manual (Rápido)
```bash
1. Acesse: https://app.netlify.com/start
2. "Add new site" → "Import existing project"
3. Selecione: ellevenagent/project-dashboard
4. Publish directory: public
5. Deploy!
```

### Opção 2: Via CLI (se tiver token)
```bash
export NETLIFY_AUTH_TOKEN=seu-token-aqui
netlify create --name project-dashboard --repo ellevenagent/project-dashboard
```

## URLs
- **GitHub**: https://github.com/ellevenagent/project-dashboard
- **Netlify**: https://project-dashboard.netlify.app (após deploy)

## Comandos Úteis
```bash
# Verificar status
cd /home/ubuntu/project-dashboard
git status

# Atualizar código
git add .
git commit -m "Update"
git push origin master
```

## Funcionalidades do Dashboard
- ✅ Painel Kanban (Backlog, Em Andamento, Concluído, Pausado)
- ✅ Drag & Drop
- ✅ Comandos rápidos no sidebar
- ✅ Relatórios
- ✅ Persistência local (localStorage)
- ✅ Dark theme

---
Gerado automaticamente em 2026-02-04
