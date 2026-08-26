# Skedle

A minimal timetable viewer for CIT schedules, deployed as a Cloudflare Worker
with static assets.

## Architecture

- `src/worker.ts` — Worker: routes `/api/login` and `/api/day`, validates input,
  talks to the CIT portal, and returns normalized JSON (`src/contracts.ts`).
- `src/timetable.ts` — pure transformation of raw CIT rows into `Session`s.
- `src/client/` — browser app written in TypeScript, bundled to `public/app.js`.
- `public/` — static assets (`index.html`, `styles.css`, built `app.js`).

## Develop

```bash
npm install
npm run dev        # rebuilds the client bundle, then starts wrangler dev
```

For a fast client edit loop in a second terminal:

```bash
npm run watch:client
```

## Quality gates

```bash
npm run typecheck  # server + client type checks
npm run test       # vitest (timetable logic + client renderer)
npm run check      # typecheck + test + build client bundle
```

## Deploy

```bash
npm run deploy     # runs `npm run check` first, then wrangler deploy
```

## Notes

- The client bundle `public/app.js` is a build artifact produced by esbuild from
  `src/client/app.ts`. Run `npm run build:client` (or `npm run check`) after
  editing client source.
- The auth token is stored in `sessionStorage` (cleared when the browser session
  ends) to limit exposure.
