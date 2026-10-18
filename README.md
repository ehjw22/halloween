# SP Scream Fest

The night-of web app for Singapore Polytechnic's Scream Fest (24 October 2026): a campus haunt map with live scare-house wait times, a five-booth stamp card that unlocks a wheel ticket, walk-in alerts, mini games, feedback, and a staff desk.

Static HTML, CSS and ES modules in the browser; one Vercel function (`api/index.js`) in front of Supabase. No build step.

## Artwork switch (poster / classic)

The site ships with two complete art sets. Nothing old was deleted.

| Set | What it is |
| --- | --- |
| `poster` (default) | Hand-made poster redesign: paper grain, per-cluster palettes, the five hand-drawn station SVGs, and the paper "Caged spirit" ticket. |
| `classic` | Every original illustration, stamp mark and ticket design, exactly as before. |

Three ways to switch:

1. **For everyone:** change `ART_DEFAULT` at the top of `js/boot.js` to `"classic"` (or back to `"poster"`), then deploy.
2. **For one phone or laptop:** open the site with `?theme=classic` or `?theme=poster`. The choice is remembered on that device (local storage key `scream-art`) until another `?theme=` is used.
3. **To restore only the old files:** copies of the original stamp marks and ticket art are kept in `assets/archive/classic/`. The originals were also left at their old paths, so classic mode works with no copying.

How it works: `js/boot.js` sets `data-art="poster"` or `data-art="classic"` on `<html>` before first paint. `css/poster.css` is fully scoped to `html[data-art="poster"]`, and the markup renders both versions side by side (`.art-classic` / `.art-poster`), so switching never needs a reload of data.

## Running it locally

```bash
npm install
npm run dev:local     # throwaway Postgres (PGlite) + local server on http://127.0.0.1:3002
```

Open `http://127.0.0.1:3002/?dev=scream`. The terminal prints throwaway staff passwords, and the staff account (admin number `P2400001`, name "Local Staff"). Nothing touches the live Supabase project.

`server.js` (the local static server) is not committed. It serves the same security headers as `vercel.json`, so CSP problems show up locally first.

Before the gates open, `?dev=scream` skips the countdown gate (unchanged behaviour). On localhost only, `?countdown=30s` (or `5m`, `1h`) previews the countdown.

API smoke tests (27 checks, runs against the throwaway database):

```bash
npm run test:api
```

## Deploying

1. Run the SQL in `supabase/` in order (see the top of each file). On an existing project, run `supabase/scale-3000.sql` once (safe to re-run).
2. Set the environment variables listed in `.env.example` in Vercel (Production and Preview). Staff passwords should be bcrypt hashes: `npm run hash-passcode -- "three random words"`.
3. **Stamp the asset version: `npm run stamp`** (or `npm run predeploy`), then commit the result. `/js` and `/css` are cached for a year under `?v=<build>` URLs, so a deploy only reaches phones if the build id changed. `npm run stamp:check` exits 1 when anything is out of date.
4. Push. Use a Vercel preview deployment with Deployment Protection to check changes before production.

## Scaling for about 3000 phones

Principle: students never hold a Realtime connection and never poll full data.

- Phones poll `/api?path=versions` (`{ waits_v, announce_v, server_time }`, `Cache-Control: public, s-maxage=5, stale-while-revalidate=20`) every 17s +-3s, only while the tab is visible, and on focus / visibility / online. The shared poller is `js/live.js`.
- When `waits_v` moves they fetch `/api?path=wait-times-public&v=<waits_v>` (cached 10s; the version in the URL means every phone on one version shares one cached copy). When `announce_v` moves they fetch the announcements (cached 30s). A failed fetch keeps the last data on screen, shows the existing "last known waits" note, and backs off exponentially. Last known waits are also kept in localStorage.
- The stamp card polls `/api?path=stamps-version` (private, `no-store`) every 17s +-3s only while the stamps view is open and the tab visible, and loads the full card only when the number moved.
- Staff devices (a staff session exists) keep Realtime for `scare_houses` and a faster version poll (8s). The Supabase anon key is no longer used for reads by students.
- Static assets: `/js` and `/css` are `immutable` (stamped URLs), artwork is cached for a day with background refresh, `index.html`, `/` and `sw.js` are `no-store`. `sw.js` carries the build id in its cache name, so each deploy drops the old cache.

Rate limits (per 600s unless noted). Each can be raised in Vercel with the env var shown; the counters live in Supabase (`scream_rate_limits`, one atomic upsert per check, fail-open if the database is slow):

| Limit | Old | New | Env var |
| --- | --- | --- | --- |
| Sign-in per IP | 150 | 5000 | `LOGIN_RATE_MAX` |
| Sign-in per student number | 25 | 25 | `LOGIN_NUM_RATE_MAX` |
| Staff password tries per IP (900s) | 30 | 300 | `STAFF_IP_RATE_MAX` |
| Staff password failures per account (900s) | 5 | 5 | `STAFF_ACCOUNT_FAIL_MAX` |
| Feedback per IP | 60 | 3000 | `FEEDBACK_IP_RATE_MAX` |
| Feedback per student | 10 | 10 | `FEEDBACK_NUM_RATE_MAX` |
| Push subscribe/update per IP | 120 | 3000 | `PUSH_IP_RATE_MAX` |
| Game score saves per student | 60 | 60 | `SCORES_RATE_MAX` |
| Wait-time saves per staff | 400 | 400 | `WAIT_RATE_MAX` |
| Student lookups per staff | 600 | 600 | `LOOKUP_RATE_MAX` |
| Stamp awards per staff | 600 | 600 | `AWARD_RATE_MAX` |
| Stamp undos per staff | 40 | 40 | `UNAWARD_RATE_MAX` |
| Wheel redeems per staff | 300 | 300 | `REDEEM_RATE_MAX` |
| Wheel undos per staff | 40 | 40 | `UNREDEEM_RATE_MAX` |
| Announcements per staff | 30 | 30 | `ANNOUNCE_RATE_MAX` |
| stamps-version per student (in memory, per instance) | none | 240 | `STAMPS_VERSION_RATE_MAX` |

Checks:

```bash
npm run test:api          # API smoke tests against the throwaway database
npm run test:concurrency  # 20 parallel awards / redeems / undos / sign-ups, one winner each (CONCURRENCY=40 for more)
npm run load:test         # 3000 phones: sign-up burst, versions polling, stamp-card polls (built-in local stack only)
npm run stamp:check       # asset versions are stamped
```

`load:test` and `test:concurrency` run on a throwaway in-memory database. They only target something else when you set `BASE_URL` (loopback only for the concurrency test; the load test also needs `LOAD_CONFIRM=I_OWN_THIS_TARGET` for anything that is not localhost). Never aim them at the live site.

See `SECURITY.md` for the threat model, what to rotate, and the trade-offs.

## Staff passwords

Each password only opens its own part of the desk:

- `ADMIN_PASSCODE`: everything.
- `WAIT_PASSCODE`: wait times for every house.
- `REDEEM_PASSCODE`: redeem wheel tickets only.
- `BOOTH_<CODE>_PASSCODE`: award that one booth's stamp only (`INK`, `HAT`, `EYE`, `SKEL`, `SCREAM`).
- `HOUSE_<CODE>_PASSCODE`: wait time for that one house only.

Unlocking also needs a signed-in account whose `role` in the `students` table is `admin`, `stamps` or `waits` (anything else counts as a student). To make someone staff:

```sql
update public.students set role = 'admin' where student_number = 'P24XXXXX';
```
