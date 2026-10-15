# Reelwright

**An original, local-first video editor for desktop** — multitrack timeline, effects, captions, audio tools, and an honest capability model. Built in the open, MIT-licensed, designed so everything you edit stays on your machine.

> **Status: under active construction (v0.0.1).** This project is being built in phases with working tests and evidence at every step — see [Honest status](#honest-status) below. It is **not** affiliated with, endorsed by, or derived from CapCut or any other commercial editor; all code, UI, branding, effects, and templates here are original.

## What it does today

- **Projects** — create/save/reopen a plain-JSON `.veproj` file; media are referenced (never moved/copied); missing files are detected and relinkable; autosave with recovery prompts.
- **Import** — video/audio/images probed locally with `ffprobe` (duration, fps, resolution, codecs).
- **Multitrack timeline** — add tracks, place clips, drag/move, **trim, split**, overlap protection, snapping; exact integer-tick timebase (70,560,000 ticks/s — frame-exact even at NTSC 29.97/59.94).
- **Preview monitor** — clip-under-playhead playback with an honest transport (controls disable with real reasons when something isn't wired yet).
- **Text/captions** — text clips fully editable in the timeline; export path is a **sidecar `.srt`** (see honesty note below).
- **Export** — driven by local `ffmpeg` with live progress, cancellation, and human-readable errors; a preflight reports blockers *before* you start; unsupported features are refused with actionable hints, never silently dropped.
- **Effects & transitions** (package-level, UI wiring in progress) — 13 original effects (blur, sharpen, color grading, duotone, vignette, pixelate…), fade/wipe/dip transitions, keyframe evaluator with easing, speed changes, geometric masks, presets.
- **Audio** — waveform peaks, per-clip volume/fades mapped exactly into the export mix, 4 noise-cleanup profiles (runtime-probed against your ffmpeg), voiceover capture path.
- **Templates & AI hooks** — original template blueprints; AI tools (reframe, background removal, transcription, TTS…) sit behind provider interfaces that report honestly when unavailable. Nothing phones home; no paid services are wired in.

## Requirements

- **Node.js ≥ 20** (developed on 24) and npm
- **ffmpeg + ffprobe on your PATH** (macOS: `brew install ffmpeg`)
- ~1 GB free RAM while editing; no GPU requirement

## Quick start

```bash
git clone https://github.com/Adebayodamilola20/reelwright.git
cd reelwright
npm install

# build the two packages needed to run:
npm run build -w @ve/engine
npm run build -w @ve/app

# launch:
npm start
```

> Electron download issues on your network? Run `npm run fix:electron` and retry `npm start`.

Build every package (engine, app, effects, audio, templates):

```bash
npm run build
```

## Verify your build (the evidence suite)

The project ships the same checks the maintainers gate releases on:

```bash
npm run verify:timebase   # 41/41 exact-time arithmetic checks
npm run verify:export     # 39/39 export E2E: success, progress, cancel, error paths
npm run verify:app-smoke  # Electron boot + renderer + engine-bridge round-trip
npm test -w @ve/effects   # 85 effect/transition/keyframe tests
npm test -w @ve/audio     # 54 waveform/SRT/mix/voiceover tests
```

Media fixtures aren't committed — regenerate them locally (small, ffmpeg-synthesized):

```bash
./test-media/regenerate.sh
```

## Architecture

```
packages/
  engine/    # @ve/engine — pure Node/TS: project model, timeline ops, persistence,
             #              ffmpeg export planning, IPC dispatcher. No Electron/DOM imports.
  app/       # @ve/app    — Electron shell + renderer UI (vanilla TS + Vite): home/library,
             #              media bin, preview, timeline, inspector, export dialog.
  effects/   # @ve/effects   — effect/transition/keyframe/mask math + ffmpeg chain plans.
  audio/     # @ve/audio     — waveform peaks, sidecar SRT, mix planning, voiceover.
  templates/ # @ve/templates — template blueprints + provider interfaces for optional AI tools.
docs/        # PROJECT_CONTRACT.md (module/data contracts), FEATURE_MATRIX.md (status +
             #              evidence labels), ROADMAP.md, and the full build logs.
```

Design rules the code follows:

1. **Local-first by default** — no network I/O, no uploads, no paid services.
2. **Honest capabilities** — a control never appears functional when it isn't; unavailable features disable with a real reason (e.g. text burn-in requires an ffmpeg build with libfreetype — this machine's doesn't have it, so captions export as `.srt` instead).
3. **Non-destructive edits** — the timeline edits project data only; your source media are never modified.
4. **Evidence-labeled claims** — every feature row is marked *Observed / Documented / Inferred / Designed* in [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md).

## Honest status

| Area | State |
|---|---|
| Engine model, timeline ops, persistence, export planning | ✅ implemented, tested |
| Export E2E (progress/cancel/errors) | ✅ evidence suite green |
| UI shell, home, media bin, preview, timeline, inspector, export dialog | 🟡 built; click-through flows under acceptance review |
| Effects / audio / templates packages | 🟡 implemented + tested at package level; UI wiring in progress |
| Transcription, TTS, background removal, cloud/sync | ⛔ provider-gated stubs — honestly reported as unavailable |

Follow live progress in [`docs/FEATURE_MATRIX.md`](docs/FEATURE_MATRIX.md) and the plan in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Contributing

Issues and PRs welcome. Read `docs/PROJECT_CONTRACT.md` (module boundaries and data shapes) and `docs/TEAM_STATUS.md` (how the team coordinates) first. Rule zero: **no placeholder controls** — if a feature can't work yet, it must say why, not pretend.

## License

[MIT](LICENSE) — see `LICENSE` and `THIRD_PARTY_NOTICES` where applicable (ffmpeg is invoked as an external tool under its own license; it is not bundled).

## Disclaimer

Reelwright is an independent, original project for lawful, personal use. "Reelwright" is this project's own name; no affiliation with ByteDance/CapCut or any other editor is implied.
