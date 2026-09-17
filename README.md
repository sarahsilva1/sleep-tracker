# SweetSpot

A fast, ad-free PWA for tracking baby/toddler sleep and predicting the next
wind-down time. Local-first, private, and built for up to four caregivers
sharing up to four children's data — no accounts, no ads, no clutter.

## Stack

- Svelte 5 + TypeScript + Vite
- IndexedDB (via Dexie) as the local source of truth — works fully offline
- Supabase (Postgres + anonymous auth) for optional cross-device sync
- `vite-plugin-pwa` for the installable app shell + service worker

## Running locally

```sh
npm install
npm run dev
```

The app works with zero configuration — data stays on-device in IndexedDB.

## Sync between caregivers

Sync is backed by a Supabase project with `supabase/schema.sql` applied and
anonymous sign-ins enabled. The project URL and anon key are checked into
`src/lib/supabaseClient.ts` as defaults — this is safe because the anon key
is designed to be public; Row Level Security in `schema.sql` is what
actually restricts access, not secrecy of that key.

In **Settings** in the app, tap **Create sync code** on the first device,
and enter that code on the second device to join the same family. The code
is a one-time secret used only to link a device to a family — it's never
embedded in a shareable link and is never stored in plaintext.

To point the app at a different Supabase project (e.g. for local dev
against your own instance), copy `.env.example` to `.env.local` and set
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — these override the
checked-in defaults.

## Build

```sh
npm run build   # type-checked production build to dist/
npm run check   # svelte-check + tsc only
```

## Deployment

Deployed as a Cloudflare Worker with static assets (`wrangler.jsonc` points
it at the `dist/` build output), connected to this repo via Cloudflare's
Git integration — pushes to the tracked branch rebuild and redeploy
automatically.

A GitHub Pages workflow (`.github/workflows/deploy.yml`) is also available
as an alternate/backup deploy target; it needs **Settings → Pages → Source:
GitHub Actions** enabled on the repo, and serves from
`https://<owner>.github.io/sleep-tracker/`.

## Data model

- **Child**: id, name, date of birth, avatar, typical bedtime/wake time,
  typical nap count, hidden flag (children are hidden, never deleted)
- **Caregiver**: id, first name, avatar — identity by convention (which
  device is acting as whom), not authentication
- **SleepSession**: id, child id, start time, end time (nullable while
  running), excluded flag, logged-by caregiver, soft-delete timestamp
- **DayNote**: child id, date, free-text note, author caregiver

All timestamps are stored in UTC; local timezone is used only for display
and for classifying sessions as night sleep vs. naps (via each child's own
bedtime/wake window) and grouping them into calendar days.

## Sync pairing hardening

Setup codes expire after 30 minutes and can only be redeemed once; an
already-joined device can mint additional codes (Settings → "Invite another
device") to pair a 3rd/4th caregiver without creating a second family.
Redemption is rate-limited server-side (10 attempts / 15 min per device).
If every device ever loses its local session simultaneously, the family
becomes unreachable — there's no recovery code — so treat regular CSV/JSON
export as your backup path, not just a nice-to-have.
