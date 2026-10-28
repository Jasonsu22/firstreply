# FirstReply demo narration — Day 16

**Audience:** PayPal AI Hackathon 2026 judges (English VO).  
**Hard limit:** under 3:00 on YouTube; no copyrighted music.  
**Word count (spoken VO only):** ~352 words.  
**Estimated speaking time:** ~2:21 at ~150 wpm (leaves breathing room inside a ≤2:55 cut; total video target 2:45–2:55).

Pitch line (exact close):

> Most tools help merchants win disputes. FirstReply makes sure the dispute never happens — and if it does, the winning case is already built.

---

## Recorder URL order (match cues below)

Localhost soft-check (this turn): `http://localhost:3000` → **200**; `/api/health` → PayPal + LLM + DB ok.

| # | When | URL | What to show |
|---|------|-----|--------------|
| 1 | Open / title | `/` | Home framing (optional 2s title) |
| 2 | Problem | title cards *or* `/` + overlays | `$5.13`, then `58%` |
| 3 | Scene 1 setup | `/demo` | Add stuck parcel / set ON_HOLD, then open help |
| 4 | Scene 1 buyer | `/s/trailhead` (or help widget on `/store`) | Verify → “never came” → refund |
| 5 | Optional door | `/demo/email/<orderNumber>` | Signed email link (1–2s cut) |
| 6 | Merchant case | `/console` → `/console/cases/[id]` | Timeline + policy checks |
| 7 | Approvals | `/console/approvals` | Watch-tier claim + reasons |
| 8 | Scene 2 | `/console/disputes` → `/console/disputes/[id]` | Draft → PDF → Submit |
| 9 | Close | `/console/impact` → architecture (`docs/screenshots/day15-architecture.png`) → pitch card | Numbers + tech + pitch |

Other live routes (available, not all on camera): `/store`, `/store/cart`, `/store/orders`, `/store/products/[id]`, `/console/login`, `/console/policies`, `/demo`, `/s/[shop]`.

---

## VO script

### Block A — Problem · 0:00–0:25
**Target spoken:** ~22s · ~55 words

**[on screen: title “FirstReply — the merchant answers before the bank does”]**  
**[on screen: big number `$5.13` (LexisNexis)]**  
**[on screen: big number `58%` never contact merchant first]**

Merchants lose five dollars thirteen for every dollar of fraud — once fees, goods, and labor are counted. Fifty-eight percent of cardholders never contact the merchant before they dispute. Most chargebacks are a response-time problem, not pure fraud. FirstReply puts an always-on agent — one that can actually act — in that gap.

**中文摘要：** 开场用 $5.13 和 58% 两个硬数字；点明根因是响应慢。FirstReply = 永远在线、能动手的 Agent。

---

### Block B — Scene 1 prevention · 0:25–1:15
**Target spoken:** ~48s · ~120 words

**[on screen: `/demo` — add stuck parcel / set tracker ON_HOLD]**  
**[on screen: `/s/trailhead` (or `/store` widget) — verify order number + email]**  
**[on screen: buyer: “My package never came.”]**  
**[on screen: agent checks tracking → ON_HOLD; offers reship or refund within policy]**  
**[on screen: buyer chooses refund → confirmation; optional PayPal sandbox refund flash]**

Watch prevention. From the demo store’s help page, a buyer verifies her order and says the package never came. The agent doesn’t guess — it pulls live PayPal order and shipment data. Tracking shows the parcel stuck on hold. Inside the merchant’s written policy limits, it offers a reship or a full refund. She takes the refund. PayPal moves the money in sandbox. No bank dispute is filed. That is the whole point: fix the buyer before they ever open a case. Under a minute from complaint to done.

**中文摘要：** 场景一完整链路：Demo 面板卡住包裹 → 帮助页校验 →「没到」→ 查跟踪 → 政策内退款/重发 → 买家退款成功 → 强调「没有开争议」。

---

### Block C — Merchant view · 1:15–1:40
**Target spoken:** ~22s · ~55 words

**[on screen: `/console` → open the case → scroll append-only timeline]**  
**[on screen: `/console/approvals` — Watch-tier row; reasons e.g. “3 claims in 60 days”]**

Same moment on the merchant side. The console shows the full case timeline — every tool call, every policy check, append-only. AI judgment, hard-coded money limits. When a Watch-tier buyer claims again, the refund waits in Approvals with the reasons shown — three claims in sixty days. The merchant decides. The agent never freelances with cash.

**中文摘要：** 切控制台时间线（审计日志）+ Watch 层级审批队列；强调金额上限在代码里，不在 prompt 里。

---

### Block D — Scene 2 dispute · 1:40–2:30
**Target spoken:** ~45s · ~115 words

**[on screen: optional 2–3s sandbox.paypal.com Resolution Center, or cut straight after sync]**  
**[on screen: `/console/disputes` — dispute appears]**  
**[on screen: `/console/disputes/[id]` — Draft evidence; PDF: “seller offered reship on day 1, buyer declined” + tracking]**  
**[on screen: merchant clicks Submit → submitted / accepted state]**

Prevention isn’t always enough. A different buyer refuses the fix and files a dispute in PayPal’s Resolution Center. FirstReply’s watcher picks it up and matches it to the order. Because we already tried to help, the Dispute Agent holds the conversation, the declined reship, and the tracking proof — and drafts a ready evidence package. The merchant reviews the PDF and clicks Submit. Humans stay in the loop for the fight. The winning case was built while we were still trying to stop the dispute.

**中文摘要：** 场景二：拒绝方案 → PayPal 开争议 → 控制台起草证据（引用第一天的重发提议 + 物流）→ 商家点 Submit。点题：预防记录 = 胜诉材料。

---

### Block E — Impact + tech + close · 2:30–2:55
**Target spoken:** ~24s · ~60 words

**[on screen: `/console/impact` — prevented count, $ saved ×5.13, avg resolution time]**  
**[on screen: architecture slide — LLM agent + PayPal Agent Toolkit + policy engine]**  
**[on screen: closing card with the pitch line below]**

Here’s the impact dashboard: disputes prevented, dollars saved at the true five-thirteen cost of fraud, minutes instead of days. Under the hood — an LLM agent, the PayPal Agent Toolkit, and a code policy engine — so money never moves because the model said so.

Most tools help merchants win disputes. FirstReply makes sure the dispute never happens — and if it does, the winning case is already built.

**中文摘要：** Impact 看板 + 架构三件套收束；最后一句 pitch **原文照读、卡片原文照贴，不要改写**。

---

## Delivery notes for VO / editor

- Pace ~150 wpm; leave ~0.5s pauses between blocks for cuts.
- Do **not** rush Block B — judges need tracking → offer → refund on screen.
- Sandbox dispute filing = jump-cut; spend time on draft + Submit.
- Soft bed or silence only — no copyrighted music.
- Total cut target: **2:45–2:55**. If over: trim Block D sandbox B-roll, then shorten Block A’s third sentence.

## Exact closing pitch (do not paraphrase on the card)

Most tools help merchants win disputes. FirstReply makes sure the dispute never happens — and if it does, the winning case is already built.
