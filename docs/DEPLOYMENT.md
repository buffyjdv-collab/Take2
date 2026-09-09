# Deploying Take2 to Production

This guide covers the recommended split deployment:

| Piece | Where | Why |
|---|---|---|
| Next.js app (web + API) | **Vercel** | Serverless hosting, zero-config Next.js, auto-deploys from GitHub |
| PostgreSQL | **Neon** | Serverless Postgres, already provisioned and seeded |
| Realtime socket gateway (`mini-services/realtime-service`) | **Any always-on host** (Railway / Render / Fly.io / a VPS behind Caddy) | socket.io needs a long-lived process — it cannot run on Vercel serverless functions |

The app is designed to degrade gracefully: if the realtime gateway is
unreachable, every socket publish is best-effort and never breaks order
placement. Admin/kitchen/customer screens simply won't live-update until the
gateway is reachable (a page refresh always shows current state).

---

## 1. Prerequisites

- A GitHub repo with this project (already pushed to `main`).
- The Neon connection string (Project → Dashboard → Connection string).
  **Important:** remove `channel_binding=require` from the string — Prisma's
  URL parser rejects that parameter (`P1012`). Keep `sslmode=require`.
- Node 20+ locally if you want to test the production build first.

## 2. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**
(values below; see `.env.example` for the annotated list):

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://…@ep-….aws.neon.tech/neondb?sslmode=require` (no `channel_binding`) |
| `NEXTAUTH_SECRET` | ✅ | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ | `https://<your-vercel-domain>` (or custom domain, no trailing slash) |
| `NEXT_PUBLIC_APP_URL` | optional | Public base URL used when generating QR scan links; set it **before printing QR cards** |
| `REALTIME_URL` | optional | `wss://<realtime-host>` — server→gateway publish endpoint |
| `NEXT_PUBLIC_REALTIME_URL` | optional | `wss://<realtime-host>` — browser→gateway endpoint |

> `NEXT_PUBLIC_*` variables are inlined into the client bundle at **build
> time**. Add them before the first deployment (or trigger a redeploy after
> changing them).

## 3. Deploy the Next.js app to Vercel

1. **Import** the repo in Vercel (New Project → Import Git Repository).
2. Framework preset is auto-detected (`vercel.json` pins `nextjs`).
3. Add the environment variables from the table above.
4. Deploy. `postinstall` runs `prisma generate`, so the Prisma client is
   available at build time. No migrate/seed step is needed — the Neon
   database is already in sync with `prisma/schema.prisma` (33 tables).
5. After the first deploy, verify the schema is current:
   ```bash
   export DATABASE_URL="<neon-url?sslmode=require>"
   bunx prisma db push   # should report "already in sync"
   ```

### First-run checklist (per environment)

- [ ] Visit `https://<domain>` → landing page renders.
- [ ] Sign in with an owner account → dashboard loads, sidebar shows modules.
- [ ] Open Menu → item images render (uploads are served from `/uploads/*`).
- [ ] Scan/visit a QR link `https://<domain>/t/<table-token>` → menu opens.
- [ ] Place a cash order from the table view → order appears in Admin → Orders as **NEW**.
- [ ] Accept → Prepare → Ready → Serve the order → client screen follows each step.
- [ ] Admin → Tables → Download QR → returns a 512×512 PNG.

## 4. Host the realtime gateway

`mini-services/realtime-service` is a tiny socket.io server bound to a
hard-coded port **3003** (path `/`). Any always-on host works:

**Option A — Railway / Render / Fly.io (simplest)**

1. Create a service from the same GitHub repo.
2. Root directory: `mini-services/realtime-service`, start command: `bun index.ts` (or `npx tsx index.ts`).
3. Expose the platform-assigned public port — Railway/Render inject `PORT`;
   if your platform provides one, set it via a 5-line patch or a TCP proxy to 3003.
4. Note the public URL, e.g. `https://realtime-xxx.up.railway.app`.

**Option B — VPS with Caddy (matches the current dev setup)**

```
realtime.yourdomain.com {
    reverse_proxy / 127.0.0.1:3003
}
```

**Wire it up** — set on the **Vercel** project and redeploy:

- `REALTIME_URL=https://realtime-xxx.up.railway.app` (server-side publishes)
- `NEXT_PUBLIC_REALTIME_URL=https://realtime-xxx.up.railway.app` (browsers)

Without these variables the app still works end-to-end; only live updates
fall back to manual page refreshes.

**Verify the gateway:**

```bash
curl https://<realtime-host>/          # {"ok":true,"service":"realtime","port":3003}
```

## 5. QR codes & domains

- QR scan links are short URLs of the form `<base>/t/<table-token>`.
- `publicBaseURL()` resolution order: `NEXT_PUBLIC_APP_URL` → request headers
  (`x-forwarded-proto`/`host`) → localhost fallback.
- **Set `NEXT_PUBLIC_APP_URL` to your production domain before printing QR
  cards**, and use Admin → Tables → Download QR to regenerate artwork after
  any domain change. Existing printed codes keep working as long as the
  domain and tokens are unchanged (the legacy `/?table=<token>` format also
  still redirects to `/t/<token>`).

## 6. Operational notes

- **Never** commit `.env`; rotate `NEXTAUTH_SECRET` if it ever leaks
  (all sessions invalidate on rotation).
- DB operations against Neon from scripts require the explicit
  `DATABASE_URL` export — shell defaults may point elsewhere.
- Test data hygiene: E2E runs create orders; clean them up so live dashboards
  and reports stay accurate.
- `NEXTAUTH_URL` must match the actual origin users browse to, otherwise
  sign-in redirects loop.
