# Demo checklist (Day 16)

Video script outline: see PLAN.md §11. Devpost copy: [devpost.md](./devpost.md). Setup: [setup.md](./setup.md).

## Before recording

1. `npm run db:up && npm run db:migrate && npm run db:seed` (or demo reset if enabled).
2. `npm run dev` → http://localhost:3000
3. Confirm PayPal sandbox + LLM keys in `.env` / `.env.local`.
4. Sign in to console as `owner@trailhead.test` (`DEMO_OWNER_PASSWORD` in `.env.local`).
5. Optional: `DEMO_CONSOLE_OPEN=true` for one-click console entry.

## Scene 1 — Prevention (~60s on screen)

1. Store → buy (or use a seeded order) → help widget / signed email link.
2. Buyer: package never came / damaged with photo.
3. Agent checks tracking / photo, offers refund or reship within policy.
4. Buyer accepts → refund/reship confirmation.
5. Console → Cases → open the case: conversation + timeline.

## Scene 2 — Approvals + trust

1. Watch-tier / over-limit claim lands in Approvals.
2. Show reasons → Approve or Reject → buyer gets the outcome.

## Scene 3 — Dispute

FirstReply links a dispute to an order by PayPal **capture ID** only, so the dispute has to be on a payment made through this store's checkout, on the same database the console reads. Disputes on Day 1 `paypal:spike` payments, on checkouts from another deployment (local vs Render share the sandbox account), or on orders wiped by a demo reset show as “Not a store order”.

1. Do any demo reset **before** this scene — a reset deletes sandbox-captured orders, and their disputes can't re-link.
2. Store → buy with the sandbox personal buyer (John Doe). This creates the order with a real capture ID; `/demo` scenario orders use simulated captures and can't be disputed in PayPal.
3. Private window → <https://www.sandbox.paypal.com> as that buyer → Activity → that payment → Report a problem → “I didn't receive my item”.
4. Console → Disputes → “Add by ID” with the `PP-R-…` ID (the list endpoint lags a few minutes) or “Check PayPal now”. The row shows the order number.
5. Open it → Draft with agent → preview evidence PDF → Submit (guarded).

## Close

1. Impact dashboard numbers ($ saved ×5.13, prevented, avg time).
2. Pitch line from `docs/devpost.md`.

## Submit

1. Paste Devpost fields from `docs/devpost.md`.
2. Attach video (< 3 min) and repo / local run notes.
3. Submit ~24h before Nov 12, 2026 12:00pm PT.
