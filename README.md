# FirstReply

**The merchant answers before the bank does.** An AI agent that resolves order problems through PayPal in minutes — refund, reship or a clear explanation, within rules the merchant sets — and builds the evidence package if a dispute is filed anyway.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/). Project plan: [PLAN.md](PLAN.md) · Database design: [docs/DATABASE.md](docs/DATABASE.md).

> Status: early build (day 2). Store, agent and merchant console are in progress.

## Run it locally

Requirements: Node 24, Docker, a PayPal **sandbox** app (developer.paypal.com), and an LLM API that supports tool calling (OpenAI- or Anthropic-format).

```bash
npm install
cp .env.example .env        # fill in PayPal sandbox + LLM settings
npm run db:up               # Postgres in Docker
npm run db:migrate
npm run db:seed             # demo store "Trailhead Supply Co."
npm run dev                 # http://localhost:3000
```

Check everything is wired up: <http://localhost:3000/api/health>

## Useful scripts

| Command | What it does |
|---|---|
| `npm run llm:check` | Tests your LLM for tool calling, streaming, JSON output and images (`-- --protocol=both` to compare formats) |
| `npm run paypal:spike` | Exercises each PayPal sandbox call we use (run with no arguments for the list) |
| `npm run db:generate` | Creates a migration after changing `src/db/schema.ts` |
| `npm run db:studio` | Browse the database |
| `npm run db:down` | Stop the local database |

## Stack

Next.js · TypeScript · Tailwind · PostgreSQL + Drizzle · Vercel AI SDK (any OpenAI/Anthropic-compatible model) · PayPal Agent Toolkit + REST APIs · hosted on Render (`render.yaml`).

## License

MIT
