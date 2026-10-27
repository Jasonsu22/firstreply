# FirstReply

**The merchant answers before the bank does.** An AI agent that resolves order problems through PayPal in minutes — refund, reship or a clear explanation, within rules the merchant sets — and builds the evidence package if a dispute is filed anyway.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/). Project plan: [PLAN.md](PLAN.md) · Database design: [docs/DATABASE.md](docs/DATABASE.md) · Deploy (Render + Neon, no card): [docs/deploy-render.md](docs/deploy-render.md).

> Status: in progress (day 7). Store, checkout, policy engine, the resolution agent, the buyer help chat and the merchant console (AG Grid cases list + case timeline) work; approvals and policies next.

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

## Try the buyer side

- **Help widget** — the "Problem with an order?" button on every store page (`/store`). It's the one line a merchant pastes:
  `<script src="https://<firstreply-host>/widget.js" data-shop="trailhead" async></script>`
- **Hosted help page** — `/s/trailhead`: order number + the email used at checkout.
- **Signed links** — "Get help with this order" in *My orders*, and the sample order emails linked from `/demo`, open the chat already verified for that one order.

## Try the merchant side

- **Console** — `/console`. Sign in as `owner@trailhead.test` with the `DEMO_OWNER_PASSWORD` from `.env.local` (created by `npm run db:seed`).
  Set `DEMO_CONSOLE_OPEN=true` to add a one-click "Open the demo store's console" button for judges (sandbox only).
- **Cases** — AG Grid list of every buyer problem: status, trust tier, the agent's last policy decision, outcome. Filters, search, and rows update live while the agent works.
- **Case page** — the conversation next to a plain-language timeline from the append-only audit log: each check, policy decision (with reasons), and PayPal call (with refund IDs). The raw call is one click away.

## Useful scripts

| Command | What it does |
|---|---|
| `npm run llm:check` | Tests your LLM for tool calling, streaming, JSON output and images (`-- --protocol=both` to compare formats) |
| `npm run paypal:spike` | Exercises each PayPal sandbox call we use (run with no arguments for the list) |
| `npm run agent:chat -- FR-20002` | Chat with the resolution agent in the terminal as the buyer of an order (add `--say "…"` to script it) |
| `npm test` | Unit tests (policy engine, trust tiers, buyer guidance) |
| `npm run db:generate` | Creates a migration after changing `src/db/schema.ts` |
| `npm run db:studio` | Browse the database |
| `npm run db:down` | Stop the local database |

## Stack

Next.js · TypeScript · Tailwind · PostgreSQL + Drizzle · Vercel AI SDK (any OpenAI/Anthropic-compatible model) · PayPal Agent Toolkit + REST APIs · hosted on Render (`render.yaml`).

## License

MIT
