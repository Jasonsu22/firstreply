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

1. Hand-file or sync a PayPal sandbox dispute (`npm run disputes:sync` / “Check PayPal now”).
2. Disputes tab → Draft with agent → preview evidence PDF → Submit (guarded).

## Close

1. Impact dashboard numbers ($ saved ×5.13, prevented, avg time).
2. Pitch line from `docs/devpost.md`.

## Submit

1. Paste Devpost fields from `docs/devpost.md`.
2. Attach video (< 3 min) and repo / local run notes.
3. Submit ~24h before Nov 12, 2026 12:00pm PT.
