# Hydra Consultoria

> Plataforma OSINT brasileira — consultas inteligentes, comunidade em tempo real e dossiê forense.

---

## O que é

**Hydra Consultoria** é uma plataforma web completa para consultas OSINT (inteligência de fontes abertas) com foco no mercado brasileiro. Permite pesquisar dados de pessoas, veículos, empresas e muito mais a partir de um painel moderno, seguro e com branding sky/cyan.

---

## Funcionalidades principais

### Consultas OSINT
- **24 módulos** divididos em 5 categorias: Pessoa, Veículo, Empresa, Saúde e Outros
- Fontes: Hydra API + Skylers API (com fallback automático)
- Visualizador de resultados com campos estruturados, cards de destaque e exportação `.txt`
- Suporte a CPF completo com painel expandido (telefones, endereços, parentes, score)

### Dossiê Forense
- Salve resultados de consultas como evidências
- Múltiplos dossiês com notas por evidência
- Pesquisa e exportação em `.txt`

### Comunidade & Chat
- Chat em tempo real via WebSocket
- Reações com emoji, GIFs via Tenor, preview de imagens inline
- Mensagens Diretas (DMs) entre usuários

### Notificações Pessoais
- Bell de notificações com badge de não-lidas
- Alertas de pedidos de amizade, DMs e reações em tempo real

### Perfil & Planos
- Foto de perfil, bio, redes sociais
- 9 temas de card (3 grátis + 6 exclusivos PRO)
- Plano PRO: R$2,99 debitado da carteira, válido por 30 dias

### Carteira
- Saldo em créditos para consultas e planos
- Histórico de transações

### Bots
- **Telegram**: interface de consulta e notificações via bot
- **Discord**: comandos slash para consultas e monitoramento

---

## Stack técnica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js 24 + Express 5 + TypeScript |
| Banco de dados | PostgreSQL + Drizzle ORM |
| Validação | Zod v4 + drizzle-zod |
| Tempo real | WebSocket (`ws`) |
| IA | Groq API |
| Bots | Telegraf (Telegram) + discord.js (Discord) |
| Monorepo | pnpm workspaces |

---

## Estrutura do projeto

```
hydra-consultoria/
├── artifacts/
│   ├── infinity-search/   # Frontend React — painel Hydra Consultoria
│   ├── api-server/        # Backend Express + WebSocket
│   ├── telegram-bot/      # Bot Telegram
│   └── discord-bot/       # Bot Discord
├── lib/                   # Bibliotecas compartilhadas
└── scripts/               # Scripts utilitários
```

---

## Contato & Suporte

- Canal oficial: [@hydraconsultoria](https://t.me/hydraconsultoria)
- Canal free: [t.me/+7sBxmhOFPhJlYzcx](https://t.me/+7sBxmhOFPhJlYzcx)
- Suporte direto: [@Blxckxyz](https://t.me/Blxckxyz)
