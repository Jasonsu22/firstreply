# Deploying to Render

The repo has a [Render Blueprint](../render.yaml): one click creates the web app **and** its Postgres database.
On every deploy the app runs migrations, seeds the demo store if the database is empty, then starts.

## First deploy (about 10 minutes)

1. **Sign in** at <https://dashboard.render.com> — "Sign in with GitHub" is easiest.
2. **New → Blueprint.**
3. **Connect the repo.** The repo is private, so Render asks for GitHub access:
   choose *Only select repositories* → `Jasonsu22/firstreply` → Install.
4. Pick `firstreply`, branch `main`. Render reads `render.yaml` and shows two resources:
   - `firstreply` — web service (free)
   - `firstreply-db` — PostgreSQL (free)
5. **Fill in the secrets** Render asks for (copy the values from your local `.env` / `.env.local`; never paste them anywhere else):

   | Key | Value |
   |---|---|
   | `PAYPAL_CLIENT_ID` | sandbox app Client ID |
   | `PAYPAL_CLIENT_SECRET` | sandbox app Secret |
   | `LLM_BASE_URL` | your gateway URL |
   | `LLM_API_KEY` | your gateway key |
   | `LLM_MODEL` | model ID |
   | `DEMO_OWNER_PASSWORD` | console password for `owner@trailhead.test` — reuse the one in `.env.local` or pick a new one |

   `DATABASE_URL`, `ENCRYPTION_KEY` and `LLM_PROTOCOL` are filled in automatically.
6. **Apply.** Render creates the database, builds (`npm ci && npm run build`, ~3–5 min) and starts the app.
7. **Check it:** open `https://<your-service>.onrender.com/api/health`. You want
   `"ok": true`, `paypalConfigured`, `llmConfigured`, `encryptionKeySet` all `true`, and `"merchants": 1`.
   Then open the home page — it should say the demo store is connected.

## After that

- **Every push to `main` deploys automatically.**
- **Logs:** dashboard → `firstreply` → Logs. Startup prints "Migrations applied" and either "Seeded" or "skipping seed".
- **Free plan limits:** the web service sleeps after ~15 min idle (first request then takes ~1 min), and **free Postgres expires after 30 days**. Before judging (December), switch the web service to *Starter* and the database to a paid plan — or use the Render sponsor credits.
- **Webhooks (day 10):** once deployed, the public URL is `https://<your-service>.onrender.com/api/webhooks/paypal` — add it in the PayPal developer dashboard then.

## If something fails

| Symptom | Fix |
|---|---|
| Deploy fails with "Set DEMO_OWNER_PASSWORD" | Add `DEMO_OWNER_PASSWORD` under Environment, then *Manual Deploy → Deploy latest commit* |
| `/api/health` shows `database.ok: false` | Wait until `firstreply-db` shows *Available*, then redeploy |
| `paypalConfigured` / `llmConfigured` false | A secret is missing under Environment |
| Build fails | Open the build log and send it to me |
