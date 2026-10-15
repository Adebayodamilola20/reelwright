# ACCEPTANCE_WALKTHROUGH.md — coordinator's executable Phase 1 gate script

Owner: coordinator. This is the literal sequence I run at gate #2/B3. Every step
must pass with evidence before Phase 1 closes. Agents may read; only I check boxes.

## Prereqs

- [ ] `npx tsc -p packages/engine --noEmit` exit 0 (verified green 2026-10-15)
- [ ] `npx tsc -p packages/app --noEmit` exit 0 (B1 — currently RED)
- [ ] `node scripts/verify-timebase.mjs` → 41/41 (verified)
- [ ] `node scripts/export-e2e.mjs` → success/progress/cancel/error evidence (B2)
- [ ] Fresh `git status` — no agent mid-write churn in files I touch during the run

## Walk (manual, in the running app)

1. **Create project** → appears in recent/home; `.veproj` on disk is valid JSON with `timebase: 70560000`.
2. **Import** one video, one audio, one image from `test-media/` → duration/fps/resolution/codec metadata populated (ffprobe truth), correct `kind`.
3. **Timeline** → add tracks, place all three clips, drag positions → preview shows clip-under-playhead; play/pause/seek work (or transport honestly disabled with reason if playback is UI-in-progress — record which).
4. **Trim + split** → trim head/tail, split mid-clip, undo/redo restores exactly; overlap rejection fires when forced.
5. **Text/caption overlay** → add text clip, edit content, visible in preview; export path: sidecar SRT or honest `UNSUPPORTED_FEATURE` + hint (no silent drop).
6. **Audio** → volume + fade on audio clip applied.
7. **Export** → mp4 created; progress events monotonic 0→100; cancel mid-run leaves no partial file; force an error (missing asset) → readable error + hint, not a stack trace.
8. **Reopen/relink** → reopen restores timeline; move one media file → `missing` reported, relink restores it.
9. **Honesty sweep** → every disabled control shows an accurate reason; no placeholder pretends to work; no CapCut branding/assets anywhere (grep case-insensitive `capcut|tiktok|bytedance` in source → only docs/roadmap references allowed).
10. **Phase 2/3/4 packages** → build green: `@ve/effects`, `@ve/audio`, `@ve/templates`; feature matrix rows match reality.

## Verdict

- PASS → close Phase 1 in PHASE_PLAN + TEAM_STATUS; open gate #3 for Phase 2 as its evidence lands.
- FAIL → per-blocker owner list with exact repro; re-run only failed steps.
