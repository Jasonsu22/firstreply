# Setup guide — run FirstReply locally

A stranger with Node 24, Docker, a PayPal **sandbox** app and an LLM gateway should be able to follow this and open the demo store in under 15 minutes.

## 1. Prerequisites

| Need | Notes |
|---|---|
| **Node.js 24** | `node -v` → v24.x. (nvm: `nvm install 24 && nvm use 24`) |
| **Docker** | For local Postgres (`npm run db:up`) |
| **PayPal sandbox app** | [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → Sandbox → Create app. Copy Client ID + Secret. |
| **LLM with tool calling** | Any OpenAI- or Anthropic-format gateway. Must support tools; streaming and images are nice-to-have. |

Optional: a PayPal sandbox **webhook** pointing at your public URL `/api/webhooks/paypal` (for dispute pushes). Locally the 60s poller is enough.

## 2. Install and configure

```bash
git clone <this-repo> firstreply && cd firstreply
npm install
cp .env.example .env
```

Edit `.env` (never commit it):

1. `ENCRYPTION_KEY` — `openssl rand -base64 32`
2. `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` — sandbox app
3. `LLM_PROTOCOL` — `openai` or `anthropic`
4. `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` — your gateway

Optional judges' helpers:

```bash
DEMO_CONSOLE_OPEN=true   # one-click console sign-in on /console/login
DEMO_RESET_ENABLED=true  # allow demo reset in production-like deploys
```

## 3. Database

```bash
npm run db:up        # Postgres in Docker (credentials match .env.example)
npm run db:migrate   # apply Drizzle migrations
npm run db:seed      # Trailhead Supply Co. + owner@trailhead.test
```

`db:seed` writes `DEMO_OWNER_PASSWORD` into `.env.local` if you left it blank. Re-run anytime (`npm run db:reset` is the same) — it wipes only the Trailhead merchant and recreates it.

## 4. Start the app

```bash
npm run dev          # http://localhost:3000
```

Smoke checks:

| URL | Expect |
|---|---|
| [/api/health](http://localhost:3000/api/health) | `{ ok: true, … }` |
| [/store](http://localhost:3000/store) | Trailhead catalog |
| [/s/trailhead](http://localhost:3000/s/trailhead) | Order help verify form |
| [/console](http://localhost:3000/console) | Sign in as `owner@trailhead.test` |
| [/demo](http://localhost:3000/demo) | Carrier controls + reset |

## 5. A five-minute walkthrough

1. **Demo panel** → *Add stuck parcel* (creates an order for Maya with a simulated `DEMO-` payment and a tracker `on_hold`; refunds on it are recorded as `SIMULATED-…`, never sent to PayPal).
2. **Help page** `/s/trailhead` → order number + `maya.chen@example.com` → chat.
3. Say the parcel never arrived. The agent checks tracking and offers a refund or reship within policy.
4. **Console → Cases** → open the case → timeline shows every tool call and policy decision.
5. **Console → Impact** → disputes prevented and $ saved (order value × 5.13).

Sandbox PayPal checkout: buy something on `/store` with a sandbox personal account, then use *Ship with UPS* on `/demo` and flip the tracker to *Stuck*.

## 6. Tests and eval

```bash
npm test                 # unit tests (policy, trust, guidance, scenario catalog)
npm run eval:scenarios   # 22/22 deterministic buyer scenarios
npm run llm:check        # prove your gateway supports tools / stream / JSON / images
```

## 7. Deploy (optional)

See [deploy-render.md](./deploy-render.md) for Render + Neon without a credit card. Production PayPal merchant onboarding would use partner referrals; sandbox blocks that, so the hackathon demo pastes sandbox API keys (called out in the README).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing ENCRYPTION_KEY` | Set it in `.env`, restart `npm run dev` |
| Seed fails on `approvals_decided_by` | You're on an old seed — pull latest; seed nulls those FKs before delete |
| Help page stuck on spinner | Open `http://localhost:3000/...` (not `127.0.0.1`) so Next.js HMR isn't blocked |
| LLM tool calls fail | `npm run llm:check`; confirm `LLM_PROTOCOL` matches the gateway |
| PayPal 401 | Sandbox Client ID/Secret for the **same** app; no live credentials |
