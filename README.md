# Automation Products Quantity Update

Next.js app that scrapes **exact inventory** from a target Shopify store and sets the same quantities on your connected Shopify store, matched by SKU, on a schedule you choose.

## How it works

1. **Scrape (target, domain only – no token)** – reads the target store's public storefront (`/products.json` + product pages) politely (about 2.5 requests/second, retries on 429). Exact numbers exist only where the store publishes them:
   - variant sold out → **0**
   - single-variant product whose page shows a count (`Only 3 left`, or `inventory_quantity` in embedded JSON) → that **count**
   - any other in-stock item → the number is **hidden**; it is *skipped*, never guessed.
2. **Match** – target SKU ↔ your store's *Vendor SKU* metafield (default `custom.vendor_sku`, single-line text; on the product or the variant). Ignores case and surrounding spaces.
3. **Update** – only after the scrape finishes, sets `available` for matched items at the location you pick (Admin API, batched, idempotent). Unchanged quantities are skipped.

Be aware: Shopify never publishes exact stock to the public, so most healthy in-stock items on a target will be "hidden" and left unchanged on your store. What you reliably get is sold-out (→ 0) and low-stock counts the theme displays. Each run's table shows exactly which SKUs were skipped and why.

Safety rules: a scrape with no out-of-stock items and no published counts aborts; SKUs missing in the target are reported, never zeroed; untracked inventory on your store is skipped; a multi-variant product with a *product-level* metafield is skipped as ambiguous (use a variant-level metafield). Target hosts that resolve to private/local addresses are refused.

## Setup

```bash
npm install
npm run dev        # or: npm run build && npm start
```

Open http://localhost:3000.

Create a custom app in **your** store with scopes `read_products`, `read_inventory`, `write_inventory`, `read_locations`.

In the dashboard: enter the target domain (e.g. `bhunes.com`), then your `*.myshopify.com` domain + Admin API token → **Test connection** → choose the location → set the schedule → **Save changes**. Use **Dry run** first to preview.

## Scheduling

- **Every day**, or **Pick dates** on a calendar (browse any month ahead; "Select rest of this month" in one click).
- Any number of run times per day (Morning / Noon / Evening / Night presets or custom), in a chosen time zone.
- Each run = scrape target → update connected. A run missed by < 5 minutes still fires; overlapping runs are skipped.

The scheduler lives inside the Node server (`src/instrumentation.ts`), so it needs a **long-running process** (`npm start`, PM2, a VPS/Docker) – not serverless hosting. Keep the app running at the scheduled times.

## Config

| Env var | Purpose |
|---|---|
| `APP_PASSWORD` | Enables HTTP Basic auth for the dashboard + API (any username). **Set this if the app is reachable beyond your machine.** |
| `DATA_DIR` | Where settings/run history are stored (default `./data`) |
| `DEFAULT_TIMEZONE` | Default schedule zone (default `Asia/Kolkata`) |
| `SHOPIFY_API_VERSION` | Admin API version (default `2026-04`) |

Store tokens are saved in `data/settings.json` (git-ignored) and never sent back to the browser.

## Tests

```bash
npm test
```

## Deploying on Render

`render.yaml` is included (New + > Blueprint). Or create a **Web Service** by hand: build `npm install && npm run build`, start `npm start`, health check path `/api/health`.

1. **Set `APP_PASSWORD`.** Without it the app refuses every request that is not from localhost.
2. **Keep-alive.** Set `APP_URL` to your app's address (for example `my-app.onrender.com`, with or without `https://`). The app then requests its own `/api/health` every 10 minutes (`KEEP_ALIVE_MINUTES`) so the free plan does not put it to sleep. If `APP_URL` is empty it falls back to `KEEP_ALIVE_URL`, then to the `RENDER_EXTERNAL_URL` that Render sets itself. `/api/health` is open (no password) and returns only `{ ok, time }`. Locally nothing is set, so it stays off.
3. **Back it up with an outside pinger** (UptimeRobot or cron-job.org, every 5 minutes, GET `https://<your-app>.onrender.com/api/health`). A self-ping cannot wake an app that is already asleep, for example after a deploy or restart.
4. **Storage.** Settings, store tokens, schedule and run history live in `data/`. Render's free plan has a temporary disk, so they reset on every deploy/restart. On a paid plan, attach a disk and set `DATA_DIR` to its mount path (see the commented block in `render.yaml`).
