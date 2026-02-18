# Deadly Sins Shockball Analytics

Coaching and analytics platform for the Deadly Sins Shockball team.
Built on the Galactic Shockball League public API.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router) |
| Database | Supabase (Postgres) |
| Deployment | Vercel |
| Dev Environment | GitHub Codespaces |
| Data Source | Shockball Public API v1 |

---

## First-Time Setup

### 1. Clone & open in Codespaces
Open this repo on GitHub and click **Code → Codespaces → Create codespace on main**.
The devcontainer will install all dependencies automatically.

### 2. Set up Supabase
1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Settings → API** and copy your project URL, anon key, and service role key
3. Run the migration:
   ```bash
   # In Codespace terminal
   npx supabase db push --db-url postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres
   ```
   Or paste the contents of `supabase/migrations/001_initial_schema.sql` directly into
   the Supabase SQL editor.

### 3. Configure environment variables
```bash
cp .env.example .env.local
# Edit .env.local with your actual keys
```

Required values:
- `SHOCKBALL_API_KEY` — contact swctholmeso@gmail.com to request
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET` — generate with: `openssl rand -base64 32`

### 4. Run initial data sync
```bash
npm run sync:manual
```
This fetches all current upcoming and recent matches involving Deadly Sins,
plus full replay data for any completed matches.

### 5. Start the dev server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

---

## Vercel Deployment

1. Connect your GitHub repo to Vercel
2. Add all environment variables from `.env.example` in Vercel project settings
3. Vercel will automatically pick up `vercel.json` and run the sync cron every 15 minutes
4. Set the same `CRON_SECRET` in Vercel — Vercel passes it as `Authorization: Bearer <secret>`

### Vercel + Supabase Integration
In your Vercel project dashboard: **Storage → Connect Database → Supabase**
This auto-injects the Supabase env vars.

---

## Project Structure

```
├── .devcontainer/          # Codespaces configuration
├── app/
│   ├── api/
│   │   ├── sync/           # Cron endpoint (POST = run sync)
│   │   └── matches/[id]/replay/  # Manual replay trigger
│   ├── dashboard/          # Pre-match energy dashboard (Phase 2)
│   ├── players/            # Player profiles & leaderboards (Phase 3)
│   ├── team/               # Team lineup tools (Phase 4)
│   └── scouting/           # Opposition scouting (Phase 5)
├── scripts/
│   └── manual-sync.ts      # CLI tool for manual/backfill syncs
├── src/
│   ├── lib/
│   │   ├── shockball/      # API client with conditional request support
│   │   └── supabase/       # DB client (browser + server)
│   ├── types/              # Shared TypeScript types
│   └── workers/
│       └── sync.ts         # Core sync logic
└── supabase/
    └── migrations/         # SQL schema migrations
```

---

## Data Architecture

### Why Supabase?
The Shockball API is rate-limited to 100 requests/hour. By caching all data in
Supabase, your dashboard users never touch the API directly — only the background
sync worker does, using `If-Modified-Since` headers to get free 304 responses
when nothing has changed.

### Energy Analysis
Every match replay contains turn-by-turn energy data in `TURN_UPDATE` events.
The sync worker extracts this into the `energy_snapshots` table with pre-computed
penalty tiers and magnitudes using the exact game formulas:

- `≥30%` energy: no penalty
- `10-29%` energy: penalty = `(30 - energy) × 0.5`  
- `<10%` energy: penalty = `(10 - energy) × 1.5 + 10`

This enables instant queries like "at what turn did each player drop below 30%?"

### Team ID
Deadly Sins team ID: `cmgbpfhey01c8s12xz26jkbga`

---

## Planned Features (Build Phases)

- [x] Phase 1 — Foundation (this PR)
- [ ] Phase 2 — Pre-match energy dashboard
- [ ] Phase 3 — Post-match performance reports
- [ ] Phase 4 — Player profiles & career stats
- [ ] Phase 5 — Opposition scouting reports
- [ ] Phase 6 — Lineup optimiser
