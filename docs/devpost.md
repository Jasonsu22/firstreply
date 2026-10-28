# Devpost submission text (copy/paste)

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/). Edit lightly for character limits; keep the pitch line.

---

## Project name

**FirstReply**

## Tagline / elevator (≤ short)

The merchant answers before the bank does — AI that resolves PayPal order problems in minutes, and builds the evidence if a dispute is filed anyway.

## Elevator pitch (video narration / short blurb)

Most tools help merchants *win* disputes. FirstReply makes sure the dispute never happens — and if it does, the winning case is already built.

## Inspiration

Merchants lose about **$5.13 for every $1** of fraud once fees, goods and labor are counted (LexisNexis). Most chargebacks are "not received" or "not as described" — fixable — and many buyers never contact the seller before they hit the bank. Response time is the gap. We put an always-on agent that can *act* (refund, reship, explain) through PayPal in every place a buyer looks right before disputing: the store widget, order emails, the card statement soft descriptor, and a hosted help page.

## What it does

- **Prevention:** buyer describes a problem on a verified, order-scoped chat. The Resolution Agent checks live PayPal order + tracking, runs a **code policy engine** (limits, trust tiers, delivery window), and refunds, reships or explains — or queues merchant approval.
- **Unrecognized charges:** soft-descriptor statement matching so "I don't recognize this PayPal charge" often ends in recognition, not a dispute.
- **Photos:** optional damage vision assessment (multimodal) before proposing a partial refund.
- **Disputes:** watcher (poll + webhooks) matches PayPal disputes to orders/cases; Dispute Agent drafts fight / offer / accept + evidence PDF; **merchant clicks Submit**.
- **Console:** cases (AG Grid), timeline from the append-only audit log, approvals, policies, **impact** (disputes prevented, $ saved × 5.13).
- **Demo panel:** play the carrier, add scenario orders, one-click reset.

## How we built it

Next.js app router + Postgres/Drizzle. Vercel AI SDK for the tool loop (OpenAI- or Anthropic-format gateway). PayPal Agent Toolkit wrapped behind our tools so every money move hits the policy engine first; Customer Disputes REST for evidence/offers. Vitest + a **22-scenario eval** (100% deterministic pass rate) covering prevention, trust, injection and statement matching.

## Challenges

PayPal sandbox partner onboarding is blocked for hackathon apps, so merchants paste sandbox API keys (production path: Connect with PayPal). Dispute list lag and inquiry-stage action windows meant prevention had to stay the lead story. Keeping the LLM away from money limits meant relentless "propose vs decide" separation and session-bound tools.

## Accomplishments

End-to-end prevention on a demo store, merchant console with impact, dispute draft → PDF → submit, photo + unrecognized-charge flows, demo reset, and a green scenario eval.

## What we learned

Hard-coded money limits beat prompt promises. An append-only audit log is both the product (timeline) and the dispute file. Soft descriptors are an underused "door" for unrecognized-charge prevention.

## What's next

Real PayPal partner onboarding, order sync via transaction search for non-demo checkouts, inquiry-stage make-offer before claim, and email notifications when approvals land.

## Built with

Next.js, TypeScript, React, Tailwind, PostgreSQL, Drizzle, Vercel AI SDK, PayPal Agent Toolkit, PayPal REST (Orders, Tracking, Customer Disputes), pdf-lib, AG Grid, Vitest, Render.

## Try it

1. Follow [docs/setup.md](./setup.md) (Node 24, Docker, sandbox app, LLM key).
2. `npm run db:up && npm run db:migrate && npm run db:seed && npm run dev`
3. Open `/demo` → Add stuck parcel → `/s/trailhead` as Maya → then `/console` (password in `.env.local`).

## Architecture

See [docs/architecture.md](./architecture.md).

## Pitch line (closing slide)

**Most tools help merchants win disputes. FirstReply makes sure the dispute never happens — and if it does, the winning case is already built.**
