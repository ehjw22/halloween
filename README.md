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

1. Run the SQL in `supabase/` in order (see the top of each file).
2. Set the environment variables listed in `.env.example` in Vercel (Production and Preview). Staff passwords should be bcrypt hashes: `npm run hash-passcode -- "three random words"`.
3. Push. Use a Vercel preview deployment with Deployment Protection to check changes before production.

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
