# FirstReply

**The merchant answers before the bank does.** An AI agent that resolves order problems through PayPal in minutes — refund, reship or a clear explanation, within rules the merchant sets — and builds the evidence package if a dispute is filed anyway.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/).

**Docs:** [Setup guide](docs/setup.md) · [Architecture](docs/architecture.md) · [Devpost copy](docs/devpost.md) · [Database](docs/DATABASE.md) · [Deploy (Render + Neon)](docs/deploy-render.md) · [PLAN.md](PLAN.md)

**Pitch:** *Most tools help merchants win disputes. FirstReply makes sure the dispute never happens — and if it does, the winning case is already built.*

> Status: **ready for video / Devpost** (day 15). Prevention, disputes, impact, demo reset and scenario eval (22/22) are in. Setup guide, architecture and Devpost copy are under `docs/`.

## Run it locally

Full walkthrough: **[docs/setup.md](docs/setup.md)**. Requirements: Node 24, Docker, a PayPal **sandbox** app (developer.paypal.com), and an LLM API that supports tool calling (OpenAI- or Anthropic-format).

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
- **Approvals** — fixes the policy held back (Watch buyers, over the auto limit). Approve runs the refund or reship through PayPal right away; reject with an optional note. Either way the buyer gets a message in their chat. Also available as Approve / Reject buttons in the cases grid.
- **Policies** — auto-refund limits (normal and Trusted buyers), replacements, the "not received" wait, trust-tier thresholds (changing them re-scores every buyer) and the reply time the agent promises. Hard limits (nothing left to refund, reship limit) still apply after an approval.
- **Disputes** — every PayPal dispute on the store, matched to its order and FirstReply case by capture ID: stage, status, the response deadline, what PayPal lets you do now, and whether the buyer talked to the agent first. Checked every minute (`DISPUTE_POLL_SECONDS`), on PayPal webhooks (`/api/webhooks/paypal`, signature-checked when `PAYPAL_WEBHOOK_ID` is set), or on demand with "Check PayPal now" / "Add by ID".
- **Dispute page** — "Draft a response with the agent": it reads the case record (tracking, chat, offers, policy decisions) and recommends fight / offer / accept with its reasoning, the text for PayPal and the evidence it relies on. Code checks the draft (allowed actions only, no claimed delivery without tracking, offers capped at what's refundable). You edit, preview the case-record PDF, and send — PayPal's allowed actions are re-checked right before sending.
- **Case page** — the conversation next to a plain-language timeline from the append-only audit log: each check, policy decision (with reasons), and PayPal call (with refund IDs). The raw call is one click away.
- **Impact** — disputes prevented, money saved (order value × 5.13), average time to resolve, and breakdowns by route (auto / approved / escalated), door, issue type and trust tier.
- **Demo panel** — `/demo`: set sandbox tracker status, add a local stuck-parcel or delivered scenario order (no checkout), one-click reset (`npm run db:reset` or the Reset button). Local / `DEMO_CONSOLE_OPEN` also unlock `/api/demo/enter-console` for a one-click console sign-in.


## Useful scripts

| Command | What it does |
|---|---|
| `npm run llm:check` | Tests your LLM for tool calling, streaming, JSON output and images (`-- --protocol=both` to compare formats) |
| `npm run disputes:draft -- PP-R-…` | Ask the dispute agent for a draft (prints recommendation, reasoning and text) |
| `npm run disputes:sync` | One dispute-watcher pass (`-- PP-R-…` to pull one dispute by ID) |
| `npm run paypal:spike` | Exercises each PayPal sandbox call we use (run with no arguments for the list) |
| `npm run agent:chat -- FR-20002` | Chat with the resolution agent in the terminal as the buyer of an order (add `--say "…"` to script it) |
| `npm run eval:scenarios` | Scenario eval (~20 scripted buyers; add `-- --live` for LLM end-to-end) |
| `npm test` | Unit tests (policy engine, trust tiers, buyer guidance, scenario catalog) |
| `npm run db:generate` | Creates a migration after changing `src/db/schema.ts` |
| `npm run db:studio` | Browse the database |
| `npm run db:down` | Stop the local database |

## Scenario eval

`npm run eval:scenarios` runs the Day 14 catalog: prevention, trust tiers, unrecognized-charge, statement matching, prompt-injection hardening and buyer-guidance leak checks. Live LLM scripts are opt-in (`-- --live`) because they call the gateway and PayPal-shaped tools.

**Pass rate (deterministic): 22/22 (100%).** Live LLM scripts: `npm run eval:scenarios -- --live` (optional; needs the gateway).

## Production note

Connecting a real merchant would use PayPal **partner onboarding** ("Connect with PayPal"). That flow is blocked for hackathon sandbox apps, so this demo pastes sandbox Client ID / Secret (see `.env.example`). The product path is Connect-with-PayPal once partner access is available.

## Stack

Next.js · TypeScript · Tailwind · PostgreSQL + Drizzle · Vercel AI SDK (any OpenAI/Anthropic-compatible model) · PayPal Agent Toolkit + REST APIs · hosted on Render (`render.yaml`).

## License

[MIT](LICENSE)
