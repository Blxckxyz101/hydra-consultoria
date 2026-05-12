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

## Segurança & Credenciais

O repositório é **público**. Nunca commite chaves de API, tokens ou senhas reais.

### Regras gerais

- Copie `.env.example` para `.env` e preencha com seus valores — o `.env` nunca sobe para o git
- Todos os arquivos `*.env`, `secrets.*`, `*.pem` e `*.key` estão no `.gitignore`

### Pre-commit hook (detecção de tokens)

Um hook de pre-commit bloqueia automaticamente qualquer commit que contenha padrões de credenciais conhecidas, incluindo:

| Tipo | Exemplos de padrão detectado |
|------|------------------------------|
| GitHub PAT / Fine-Grained / OAuth / Actions | `ghp_…`, `github_pat_…`, `gho_…`, `ghs_…` |
| Telegram Bot Token | `123456789:AAF…` |
| AWS Access / Secret Key | `AKIA…`, `aws_secret_access_key = …` |
| Slack token | `xoxb-…`, `xoxp-…` |
| Stripe secret / restricted key | `sk_live_…`, `rk_test_…` |
| Groq API key | `gsk_…` |
| Discord bot token | formato `<id>.<timestamp>.<hmac>` |
| Database URL com senha | `postgres://user:senha@host` |
| Atribuição genérica de API key | `api_key = "abc123"`, `auth_token: "xyz"` |
| Bearer token hardcoded | `Authorization: Bearer <token>` |
| Chave privada PEM | `-----BEGIN PRIVATE KEY-----` |

### Ativar o hook após clonar

```bash
bash scripts/src/install-hooks.sh
```

Isso configura o git para usar os hooks de `.githooks/` neste repositório. O `post-merge.sh` já faz isso automaticamente no ambiente Replit.

Para ignorar pontualmente (não recomendado):

```bash
git commit --no-verify
```

---

## Contato & Suporte

- Canal oficial: [@hydraconsultoria](https://t.me/hydraconsultoria)
- Canal free: [t.me/+7sBxmhOFPhJlYzcx](https://t.me/+7sBxmhOFPhJlYzcx)
- Suporte direto: [@Blxckxyz](https://t.me/Blxckxyz)
