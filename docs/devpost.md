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
- **Console:** cases (AG Grid), timeline from the append-only audit log, approvals, policies, **impact** (disputes prevented, estimated dispute cost avoided at 5.13× order value).
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

**Live demo:** https://firstreply-0jro.onrender.com (PayPal sandbox — no real money; the free instance may take ~50 s to wake up).

1. Open `/demo` → **Add stuck parcel**. It creates an order for Maya (a Trusted buyer) with a *simulated* payment, so no checkout is needed.
2. Open the help page (`/s/trailhead`) with that order number and `maya.chen@example.com`, say the parcel never came, and ask for a refund. The agent checks tracking (stuck on hold), offers a fix, and — because $129 is over Maya's automatic limit — sends it to the store for approval.
3. **Merchant console** → *Open the demo store's console* → **Approvals** → Approve. The buyer's chat updates; the case timeline shows every check and policy decision. (Refunds on scenario orders are recorded as `SIMULATED-…`; buy something in the store with a PayPal sandbox buyer to see a real sandbox refund.)
4. **Disputes** → open a dispute → *Draft a response with the agent* → preview the evidence PDF.

Run it yourself: follow [docs/setup.md](./setup.md) (Node 24, Docker, sandbox app, LLM key), then `npm run db:up && npm run db:migrate && npm run db:seed && npm run dev`.

## Architecture

See [docs/architecture.md](./architecture.md).

## Pitch line (closing slide)

**Most tools help merchants win disputes. FirstReply makes sure the dispute never happens — and if it does, the winning case is already built.**
