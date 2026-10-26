# Deploying (no credit card)

The app runs on a **Render free web service**; the database is **Neon's free Postgres** (no card, doesn't expire).
On every start the app runs migrations and seeds the demo store if the database is empty — so there's no manual database setup.

> `render.yaml` is a Render *Blueprint* that would create both pieces in one click, but Blueprints require adding a credit card. This guide skips it.

## 1. Database on Neon (about 3 minutes)

1. Go to <https://neon.tech> → **Sign up** (GitHub sign-in is easiest). No card is asked for.
2. Create a project:
   - Name: `firstreply`
   - Postgres version: **17**
   - Region: **AWS US West (Oregon)** — same region as the Render app, so queries are fast
3. On the project dashboard, click **Connect**. Keep **Connection pooling** on and copy the connection string.
   It looks like `postgresql://…@ep-…-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require`.
   Keep it private — it contains the database password.

## 2. Encryption key (30 seconds)

Run this on your machine and keep the output for step 3 (it encrypts merchant PayPal secrets in the database):

```bash
openssl rand -base64 32
```

## 3. Web service on Render (about 5 minutes)

1. <https://dashboard.render.com> → **New → Web Service**.
2. **Connect GitHub** → *Only select repositories* → `Jasonsu22/firstreply` → Install. Then pick `firstreply`.
3. Settings:

   | Field | Value |
   |---|---|
   | Name | `firstreply` |
   | Region | **Oregon (US West)** |
   | Branch | `main` |
   | Runtime | Node |
   | Build Command | `npm ci && npm run build` |
   | Start Command | `npm run db:migrate && npm run db:seed -- --if-empty && npm run start` |
   | Instance Type | **Free** |

4. **Environment Variables** — add each (or use *Add from .env* and paste them in one go):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from step 1 |
   | `ENCRYPTION_KEY` | the value from step 2 |
   | `PAYPAL_CLIENT_ID` | sandbox app Client ID (from your `.env`) |
   | `PAYPAL_CLIENT_SECRET` | sandbox app Secret |
   | `LLM_PROTOCOL` | `openai` |
   | `LLM_BASE_URL` | your gateway URL |
   | `LLM_API_KEY` | your gateway key |
   | `LLM_MODEL` | model ID |
   | `DEMO_OWNER_PASSWORD` | console password for `owner@trailhead.test` (reuse the one in `.env.local` or pick a new one) |

5. **Advanced → Health Check Path:** `/api/health`
6. **Create Web Service.** The first build takes ~3–5 minutes.

## 4. Check it

Open `https://<your-service>.onrender.com/api/health` (the URL is at the top of the service page). You want:

```json
{"ok":true,"paypalConfigured":true,"llmConfigured":true,"encryptionKeySet":true,
 "database":{"ok":true,"migrations":2,"merchants":1}}
```

Then the home page should say *Demo store Trailhead Supply Co. is connected*.

## After that

- **Every push to `main` deploys automatically.**
- **Logs:** Render → `firstreply` → Logs. Startup prints "Migrations applied" and "Seeded" (first time) or "skipping seed".
- **Free plan:** the app sleeps after ~15 min idle; the first request then takes ~1 min. Neon's free database also pauses when idle and wakes in under a second. For judging, consider a paid Render instance so judges don't wait.
- **Webhooks (day 10):** `https://<your-service>.onrender.com/api/webhooks/paypal`.

## If something fails

| Symptom | Fix |
|---|---|
| Logs: "Set DEMO_OWNER_PASSWORD" | Add it under Environment → *Manual Deploy → Deploy latest commit* |
| Logs: `ENCRYPTION_KEY must be 32 bytes` | Regenerate with `openssl rand -base64 32` and paste the whole line |
| `/api/health` → `database.ok: false` | Check `DATABASE_URL` is the full Neon string including `?sslmode=require` |
| `paypalConfigured` / `llmConfigured` false | A key is missing under Environment |
| Build fails | Send me the build log |
