# Day 1 — sandbox and model setup

Goal: prove every PayPal call and the LLM features we depend on work, **before** building the app.
Steps marked **(you)** need your accounts or keys. Everything else is a script you run.

## 1. PayPal sandbox accounts (you)

1. Sign in at <https://developer.paypal.com> with your PayPal account.
2. **Testing Tools → Sandbox Accounts.** You should already have one **Business** and one **Personal** account.
   Create **two more Personal** accounts (country: United States, PayPal balance e.g. $5,000). These are your test buyers.
3. For each Personal account, open **⋯ → View/Edit account** and note its email + password. You'll log in as these buyers on the sandbox checkout page and on sandbox.paypal.com.

## 2. Sandbox REST app (you)

1. **Apps & Credentials → Sandbox → Create App.** Name: `FirstReply`. Type: Merchant. Sandbox account: the Business account.
2. Copy the **Client ID** and **Secret**.
3. In the app's **Features** list, make sure these are ticked, then save:
   - Accept payments
   - Customer disputes (sometimes listed as "Disputes")
   - Transaction search
   - Shipment tracking (if listed)

## 3. `.env` (you)

```bash
cp .env.example .env
```

Fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and the `LLM_*` values. Don't paste keys into chat or commit them.

## 4. Check the LLM (script)

```bash
npm run llm:check
```

Runs five tests against your gateway: plain text, tool calling, streaming, structured JSON, image input.
Try both formats to pick the best one:

```bash
npm run llm:check -- --protocol=both
```

**Tool calling must pass.** The others have fallbacks (see PLAN.md §6).

## 5. PayPal spike (script + browser)

Run these in order. Each prints the IDs you need for the next one.

```bash
# 1. Can we get a token, and which scopes does it have? (look for disputes + reporting scopes)
npm run paypal:spike -- token

# 2. Create a $25 order with the statement text set. Open the printed approve link,
#    log in as a sandbox *buyer*, and approve. (The page it returns to may 404 — that's fine.)
npm run paypal:spike -- create-order 25

# 3. Capture the approved order → prints the capture ID
npm run paypal:spike -- capture <ORDER_ID>

# 4. Read the order back through the PayPal Agent Toolkit
npm run paypal:spike -- get-order <ORDER_ID>

# 5. Add tracking (toolkit), read it back, then change its status (toolkit)
npm run paypal:spike -- track <ORDER_ID> <CAPTURE_ID>
npm run paypal:spike -- track-get <ORDER_ID> <CAPTURE_ID>
npm run paypal:spike -- track-update <CAPTURE_ID> <TRACKING_NUMBER> ON_HOLD

# 6. Partial refund of $5 (toolkit)
npm run paypal:spike -- refund <CAPTURE_ID> 5.00

# 7. Transaction search (may lag in sandbox — note how long)
npm run paypal:spike -- transactions
```

### Dispute test

1. Make a **second** order (steps 2–3 above, ideally with the other buyer account).
2. In a private browser window, log in to <https://www.sandbox.paypal.com> as that buyer → **Activity** → the payment → **Report a problem** → "I didn't receive my item".
3. Start the watcher **right after filing** — it prints the time each new dispute appears, so we learn the delay:

   ```bash
   npm run paypal:spike -- disputes --watch
   ```

4. Once it shows up:

   ```bash
   npm run paypal:spike -- dispute <DISPUTE_ID>
   # Submits a test note as evidence. Sandbox only — fine to run.
   npm run paypal:spike -- evidence <DISPUTE_ID>
   ```

## 6. Record the results

Fill in the table below (or just paste me the script output). This decides any plan changes.

| Check | Result | Notes |
|---|---|---|
| Token + scopes | Pass | Disputes read/update, reporting search, and shipment tracker scopes present. |
| Create order with soft descriptor | Pass | Two $25 Sandbox orders created; descriptor `FIRSTREPLY DEMO`. |
| Capture | Pass | Both orders captured successfully. |
| Toolkit `get_order` | Pass | Returned completed order, capture, and shipping details. |
| Toolkit tracking create / get / update | Pass | Created, read back, and updated tracker to `ON_HOLD`. |
| Toolkit partial refund | Pass | $5 partial refund completed. |
| Transaction search (delay?) | Partial | Endpoint responds, but repeated query showed only the buyer's initial $5,000 balance; the two test payments/refund were not yet indexed. |
| Buyer-filed item-not-received case | Pass (inquiry) | PayPal created case `PP-R-SNX-10194622`; buyer page shows “Item not received” and “under review.” It is an inquiry, not yet a seller dispute record. |
| Dispute watcher / API visibility | Not yet | Watcher ran for about one minute and found 0 disputes. The inquiry did not appear in `/v1/customer/disputes`. |
| `get_dispute` | Not run | No seller dispute ID is available yet. |
| `provide-evidence` | Not run | Requires a seller dispute ID; do not submit example evidence until the case reaches that stage and the evidence matches the test. |
| LLM: tool calling | Pass | Tool call returned the expected order. |
| LLM: streaming | Pass | Streaming response completed. |
| LLM: structured JSON | Pass | Valid structured JSON returned. |
| LLM: image input | Pass | Image input was interpreted successfully. |
| Best LLM format | OpenAI-compatible | Tool calling, streaming, structured JSON, and image input all passed against the configured gateway. |

### Follow-up checks (Oct 26, after the table above)

- **The case is in the Disputes API.** `PP-R-SNX-10194622` *is* the dispute ID. `get_dispute` returns it in full right away: reason `MERCHANDISE_OR_SERVICE_NOT_RECEIVED`, stage `INQUIRY`, state `UNDER_PAYPAL_REVIEW`, plus the buyer's message, buyer/seller and the disputed capture.
- **The list endpoint lags a few minutes.** Filed 11:16 UTC; the unfiltered list was empty at about 11:19 and showed it at about 11:20. Filtering by `disputed_transaction_id` finds it too. → Polling every 60s works; the app should also look a dispute up by ID as soon as a webhook names it.
- **Seller actions open up within minutes.** At first PayPal allowed only viewing (`UNDER_PAYPAL_REVIEW`). A few minutes later (by about 11:25 UTC) it moved to `REQUIRED_ACTION` and the seller can `send_message`, `make_offer`, `provide_evidence`, `accept_claim`, `escalate` — all while still in the `INQUIRY` stage. That means door 5 (replying inside a PayPal inquiry) is possible in sandbox.
  Re-check any case with `npm run paypal:spike -- dispute <ID>` — the last line says what the seller can do.
- **Seller submit calls, run on `PP-R-SNX-10194622`** (facts checked first: $25.00 not refunded, **no tracking** on this payment, buyer asked for $25.00):

  | Call | Result | What we learned |
  |---|---|---|
  | `send-message` (offer of free reship or full refund) | ✅ Accepted, shows in the case as a SELLER message | Case went `UNDER_PAYPAL_REVIEW` (view only) for ~1 min, then `REQUIRED_OTHER_PARTY_ACTION` — **the buyer's turn** |
  | `make-offer` REFUND $25.00 | ❌ 422 `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE` | `make_offer` disappears once it's the buyer's turn. It **was** available before the message |
  | `provide-evidence` type `OTHER` | ❌ 400 `EVIDENCE_TYPE_IS_NOT_ALLOWED` | Not-received cases don't take free-text `OTHER`. They expect **proof of shipment** (tracking) or **proof of refund** — this order has neither |
  | `accept_claim` | Not run (as asked) | Allowed type is `REFUND` only |

- **Second case, with tracking — `PP-R-NZI-10194628`.** Order `7TK3456102654981S`, capture `4MR82598PY9428623`, $25.00. UPS tracking `1Z1793014314562` (SHIPPED) was added and read back **before** the buyer filed "not received".

  | Time (local) | Stage · state | Seller allowed |
  |---|---|---|
  | 07:40 | `INQUIRY` · `UNDER_PAYPAL_REVIEW` | view only |
  | 07:42 | `CHARGEBACK` · `UNDER_PAYPAL_REVIEW` | view only |
  | 07:42:38 → | `CHARGEBACK` · `UNDER_PAYPAL_REVIEW` | `provide_supporting_info` only |

  The case went from inquiry to **claim** (`CHARGEBACK` stage, PayPal's name for an escalated claim) within about a minute, **without the seller-response window** the first case had. We don't know why (buyer flow choice, sandbox behavior, or the tracking). With it under PayPal review, both calls were refused:

  | Call | Result |
  |---|---|
  | `make-offer` REFUND $25.00 | ❌ 422 `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE` |
  | `provide-evidence` `PROOF_OF_FULFILLMENT` (UPS 1Z1793014314562) | ❌ 422 `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE` |

  So the evidence *format* is still unproven, and sandbox cases don't reliably give the seller a response window.

  **Design lessons for the agent:**
  1. **Offer first, then message.** Making the offer hands the turn to the buyer, and so does a message. Send the formal `make-offer` first with the explanation in its note (or check `links` for `make_offer` before messaging).
  2. **Evidence must be real data, not prose.** For "not received" the agent should only fight with a tracking number (`PROOF_OF_FULFILLMENT`) or a refund ID (`PROOF_OF_REFUND`). No tracking → recommend refunding, not fighting. That's also the honest default.
  3. **Always read `links` before acting.** Allowed actions change after every move; the agent's tools should check them first.
  4. **The window can be minutes — or zero.** A case can escalate to a claim before the seller can respond at all. That is the strongest argument for the product: **prevention has to happen before the buyer opens a PayPal case**, because once they do, the seller may already be locked out. Inside-PayPal replies (door 5) are a bonus, not the core.
  5. **Every dispute path needs a "PayPal is reviewing" state** in the console: show the drafted package and say it will be submitted when PayPal allows, or use `provide-supporting-info` when that's the only action.
- **Transaction search still lags.** Expected in sandbox; the plan already searches our own order DB first.
