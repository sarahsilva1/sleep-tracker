# SweetSpot

A fast, ad-free PWA for tracking baby/toddler sleep and predicting the next
ideal sleep time. Local-first, private, and built for two caregivers sharing
one or two children's data — no accounts, no ads, no clutter.

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

## Enabling sync between caregivers (optional)

1. Create a free [Supabase](https://supabase.com) project.
2. In the SQL editor, run `supabase/schema.sql`.
3. In **Authentication → Settings**, enable **Allow anonymous sign-ins**.
4. Copy `.env.example` to `.env.local` and fill in your project's URL and anon key.
5. Restart the dev server. In **Settings** in the app, tap **Create sync
   code** on the first device, and enter that code on the second device to
   join the same family.

The setup code is a one-time secret used only to link a device to a family —
it's never embedded in a shareable link and is never stored in plaintext.

## Build

```sh
npm run build   # type-checked production build to dist/
npm run check   # svelte-check + tsc only
```

## Data model

- **Child**: id, name, date of birth
- **SleepSession**: id, child id, start time, end time (nullable while
  running), excluded flag
- **DayNote**: child id, date, free-text note

All timestamps are stored in UTC; local timezone is used only for display
and for grouping sessions into calendar days.
