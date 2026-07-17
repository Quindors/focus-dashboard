# focus-dashboard

React + Vite dashboard for the [project-cft](https://github.com/Quindors/project-cft)
productivity monitor. Shows today's productive/off-task split, a category donut
with total running time, a 7-day trend, and a **Review** tab for correcting the
AI's classifications (corrections feed back into the classifier).

## How it gets data

The monitor stores everything in a **local SQLite database on your PC** and
exposes a small read/write API on a fixed localhost port. Nothing is uploaded.

```
  Vercel (this UI)  ──fetch──►  http://127.0.0.1:47113/api   ──►  focus.db
   (static page)                (cft monitor on your PC)          (local)
```

Because the data source is local, the hosted page only works **on the PC running
the monitor, while it's running**. It is not viewable from another device — that
is the trade for keeping your window titles private.

The monitor allows the hosted origin via a CORS allowlist (`DASHBOARD_URL` /
`CFT_ALLOWED_ORIGINS` in its `.env`) — never `*`, since that would let any site
you visit read your activity.

## Environment variables

| Var | Purpose |
|-----|---------|
| `VITE_DATA_SOURCE` | `local` (monitor API) or `supabase` (legacy hosted DB) |
| `VITE_API_BASE` | Local mode: monitor API base, e.g. `http://127.0.0.1:47113`. Leave empty when bundled in the exe (same origin). |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Only for `supabase` mode |

## Deploy to Vercel

1. Import this repo at [vercel.com/new](https://vercel.com/new) (Vite is auto-detected).
2. Add **Environment Variables**:
   - `VITE_DATA_SOURCE` = `local`
   - `VITE_API_BASE` = `http://127.0.0.1:47113`
3. Deploy. Then, in the monitor's `.env` next to `cft.exe`, point it at the site
   so the tray opens it and CORS allows it:
   ```
   DASHBOARD_URL=https://<your-app>.vercel.app
   CFT_API_PORT=47113
   ```
4. Restart the monitor. Tray → **Open Dashboard** now opens the hosted site,
   which reads from your machine.

Redeploys update the UI with no exe rebuild.

## Local development

```bash
npm install
cp .env.example .env.local     # defaults point at the local monitor API
npm run dev
```

Run the cft monitor alongside it so there's an API to read. Add your dev origin
(e.g. `http://localhost:5173`) to the monitor's `CFT_ALLOWED_ORIGINS`.

## Build

```bash
npm run build     # -> dist/
```
