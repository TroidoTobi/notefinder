# AGENTS.md

## Stack
- Single-package Vite + React 18 + TypeScript app. Use `npm`, not pnpm or bun.
- CI uses Node 20 and `npm ci` (`.github/workflows/deploy.yml`). Local README says Node 18+.

## Verified Commands
- Install: `npm install`
- Dev server: `npm run dev`
- LAN dev server: `npm run dev -- --host`
- Lint: `npm run lint`
- Production verification: `npm run build`

## Verification Notes
- There is no test script in `package.json`.
- `npm run build` is the typecheck step too: it runs `tsc -b && vite build`.
- For focused validation after code changes, run `npm run lint` first, then `npm run build`.

## Code Layout
- `src/main.tsx` is the only app entrypoint.
- `src/App.tsx` contains nearly all product logic and UI subcomponents (`SetupPanel`, `GameScreen`, `Fretboard`, `ResultsScreen`) in one file. Read this file before making behavioral changes.
- Styling lives in `src/App.css` and `src/index.css`.

## Deployment Quirk
- `vite.config.ts` sets `base` dynamically: `/` locally, but `/${repo-name}/` during GitHub Actions builds using `GITHUB_ACTIONS` and `GITHUB_REPOSITORY`.
- Do not hardcode a base path in app code unless you also update that deployment behavior.

## Lint/TypeScript Constraints
- TypeScript is strict and disallows unused locals/parameters (`tsconfig.app.json`, `tsconfig.node.json`).
- ESLint only targets `*.ts`/`*.tsx` and ignores `dist`.
