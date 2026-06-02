# NassaAPI Frontend Isolation Context

Source conversation:

- Rollout file: `/Users/w/.codex/sessions/2026/05/30/rollout-2026-05-30T10-30-29-019e76b7-f9b5-74e2-94a2-dfb7bf526914.jsonl`
- Thread id: `019e76b7-f9b5-74e2-94a2-dfb7bf526914`
- Session index: `/Users/w/.codex/session_index.jsonl`
- Thread metadata DB: `/Users/w/.codex/state_5.sqlite`

## User Intent

The user wants to continue frontend work for the local NassaAPI project. They explicitly wanted a premium Apple-style homepage and wanted to inspect the result locally. They were concerned whether any server was modified, so future frontend work should stay local unless the user explicitly asks for deployment or server changes.

Primary design request from the original conversation:

- Rebuild the NassaAPI AI proxy homepage with an Apple HIG / apple.com style.
- Use pure black `#000000` background, text `#F5F5F7`, secondary text `#86868B`.
- Use Apple system font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif`.
- Hero should center around:
  - eyebrow: `PRO-LEVEL AI PROXY`
  - title: `NassaAPI`
  - subtitle: `让 AI 编程触手可及`
  - primary CTA: white pill button
  - secondary CTA: text button with right arrow
- Feature section should be a spacious Bento grid using minimal monochrome Lucide icons.
- Motion should use Apple-like physical easing: `cubic-bezier(0.32, 0.72, 0, 1)`.
- Entry animations should slide up from 30px, fade in, last at least 800ms, and stagger by about 100ms.
- Hover interactions should be subtle: slight card background lift and tiny icon glow/rotation only.

## Correct Frontend Target

The relevant frontend is:

`/Users/w/Desktop/newapi/new-api-fork/web/default`

The earlier agent determined this matched the actual screenshot/project better than the separate `nassaapi-frontend` candidate.

## Files Changed For The Apple-Style Homepage

Main homepage files:

- `/Users/w/Desktop/newapi/new-api-fork/web/default/src/features/home/components/sections/hero.tsx`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/src/features/home/components/sections/features.tsx`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/src/features/home/index.tsx`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/src/styles/index.css`

Supporting files touched for local preview / homepage behavior:

- `/Users/w/Desktop/newapi/new-api-fork/web/default/src/components/layout/components/public-header.tsx`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/src/features/home/api.ts`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/src/features/home/hooks/use-home-page-content.ts`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/src/lib/api.ts`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/src/styles/theme.css`

Preview screenshots created by the earlier run:

- `/Users/w/Desktop/newapi/new-api-fork/web/default/nassaapi-preview-desktop.png`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/nassaapi-preview-bento.png`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/nassaapi-preview-mobile.png`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/nassaapi-local-home.png`
- `/Users/w/Desktop/newapi/new-api-fork/web/default/nassaapi-local-home-desktop.png`

## Current Implemented Shape

`hero.tsx`:

- Removed the old translated generic gateway hero and terminal demo.
- Uses black Spotlight section with a restrained purple radial glow.
- Shows `PRO-LEVEL AI PROXY`, huge `NassaAPI`, Chinese subtitle, and a short developer-facing description.
- Uses `/dashboard` CTA when authenticated, otherwise `/sign-up` and `/pricing`.

`features.tsx`:

- Replaced old multi-feature layout with a Bento grid.
- Uses `PlugZap`, `Network`, `ReceiptText`, `ShieldCheck`, and `LifeBuoy` from Lucide.
- Feature copy is Chinese and focused on fast API access, ecosystem coverage, transparent billing, and 7x24 service.

`home/index.tsx`:

- Wraps the homepage in `nassa-apple-home dark`.
- Injects custom NassaAPI header branding with `NassaLogo`.
- Orders homepage sections as `Hero`, `Features`, `Stats`, `HowItWorks`, `CTA`, then `Footer`.
- If backend custom `HomePageContent` exists, it can still override the default homepage.

`index.css`:

- Defines `--nassa-ease: cubic-bezier(0.32, 0.72, 0, 1)`.
- Updates landing animation duration/easing and 30px slide-up.
- Adds `nassa-apple-home`, `nassa-apple-header`, `hig-primary-action`, `nassa-glass-card`, and `nassa-card-icon`.
- Adds reduced-motion fallbacks.

API handling:

- `/api/home_page_content`, `/api/status`, and `/api/notice` were made silent on local failure so a missing backend does not show noisy error toasts during local homepage preview.
- `lib/api.ts` also contains user warning API additions from other work; avoid disturbing those unless the task is about warnings.

## Local Run State

As of this isolation file, local preview is listening on:

`http://localhost:5174/`

Confirmed with:

`lsof -nP -iTCP:5174 -sTCP:LISTEN`

Run commands from the frontend directory:

```bash
cd /Users/w/Desktop/newapi/new-api-fork/web/default
npm run typecheck
npm run build
npm run preview -- --host 0.0.0.0 --port 5174
```

Available package scripts:

- `npm run dev`
- `npm run build`
- `npm run build:check`
- `npm run typecheck`
- `npm run lint`
- `npm run preview`

## Verification Already Reported In The Original Conversation

Earlier agent reported:

- `npm run typecheck` passed.
- `npm run build` passed.
- Desktop and mobile browser checks were done.
- Production preview was used at `http://localhost:5174/`.

If continuing work now, rerun verification because the worktree has many unrelated changes.

## Important Boundaries

- Do not modify servers, VPS, deployment scripts, or push anything unless the user explicitly asks.
- Do not assume changes in unrelated directories are yours. The worktree is dirty and includes many backend/status/nassa-cards changes.
- Keep frontend work scoped to `/Users/w/Desktop/newapi/new-api-fork/web/default` unless the user says otherwise.
- The user wants local visual inspection. After significant frontend changes, run the local app and verify in the browser.
- If `localhost` refuses connection, the preview server has likely stopped. Restart it from the frontend directory.

## Known Gotcha

If the live backend has custom `HomePageContent` configured, that content can override the default React homepage. To see this Apple-style default homepage in production, backend custom homepage content must be cleared or replaced.

