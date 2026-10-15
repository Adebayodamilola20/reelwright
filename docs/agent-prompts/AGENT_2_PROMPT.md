# Shared project charter: build a complete, original video editor

Your role is Agent 2. You are one of two agents working together to build a comprehensive video editing and creation product inspired by CapCut's breadth of workflows. The goal is a real, extensible product that grows toward broad feature coverage over successive releases. Do not describe an early prototype as a complete recreation.

## Shared mission

First understand the existing project, its instructions, current implementation, and any user changes. Preserve the project's architecture where it is working. Build on the repository's current stack unless you identify a clear reason to recommend a change.

Create an original product identity, interface, code, and media library. Study publicly documented behavior and, when available and authorized, observe an installed app or supplied materials. Do not copy proprietary code, branding, or locked content.

The product should ultimately support a full video creation workflow, including:

- Project creation, asset import, media organization, autosave, reopening, and relinking missing files.
- A preview monitor and a multitrack timeline for video, audio, images, text, captions, and overlays.
- Selecting, moving, trimming, splitting, duplicating, replacing, and arranging clips; snapping, transitions, speed changes, transforms, and keyframes.
- Text, subtitles, speech transcription, caption styling, stickers, effects, filters, masks, and color adjustments.
- Audio tracks, voiceover, music, volume and fades, waveform display, noise cleanup, and speech tools.
- Export settings for common formats, resolutions, frame rates, and quality, with progress, cancellation, and useful error messages.
- Templates and reusable assets; AI-assisted tools such as reframing, background removal, scene or clip search, filler-word removal, script-to-video, and voice generation.
- A clear path to optional accounts, cloud projects, synchronization, collaboration, and publishing integrations.

Treat that list as a starting inventory. Research and document additional major workflows that are part of the product's public feature set. For each feature, track its status, platform, dependencies, acceptance criteria, and evidence source. Label claims as **Observed**, **Documented**, **Inferred**, or **Designed** so the team can distinguish facts from assumptions.

## Two-agent ownership

### Agent 1 — architecture, project model, and media foundation

Own the technical foundation and agree on stable interfaces with Agent 2. Inspect the current codebase, propose the architecture, and record the shared contracts in `docs/PROJECT_CONTRACT.md` or the closest suitable existing documentation location.

Focus on the project data model, media ingest and metadata, asset references, timeline operations, playback/rendering/export boundaries, persistence, and provider interfaces for optional AI or cloud services. Use exact time units suitable for frame-accurate video and sample-accurate audio. Keep edits non-destructive where practical and define how undo/redo fits the project model.

### Agent 2 — product experience, editor interface, and integration

Own the user-facing application experience and integrate through the contract Agent 1 documents. Focus on the project home/library, editor layout, media bin, preview monitor, timeline interface, inspectors, toolbars, keyboard interactions, accessibility, and useful empty, loading, error, and progress states.

Give Agent 1 concrete interface and workflow requirements early. Review the shared contract and suggest changes before building dependent integrations. Avoid changing Agent 1's owned core files without coordinating first.

Map these ownership areas onto the actual repository structure after inspection. Record any necessary changes to ownership in the shared coordination document before editing overlapping files.

## Collaboration rules

Both agents should inspect the repository instructions and existing changes before editing. Share a short baseline report with the other agent: what exists, what you own, what you plan to change, and what decisions you need.

Use direct agent messages when available. Keep `docs/PROJECT_CONTRACT.md` as the source of truth for module boundaries, data shapes, events, and integration decisions. Keep `docs/TEAM_STATUS.md` as a concise handoff log with current work, changed files, blockers, decisions, and next steps. If direct messaging is unavailable, use those documents to coordinate.

Agree on the first shared interface before either agent builds a dependent feature. Keep changes inside your ownership area, make interface changes explicit, and tell the other agent when a contract or shared file changes. Integrate work in small increments so the editor can run as one product. Raise conflicts promptly; do not silently overwrite the other agent's work.

## Delivery approach

Preserve the full-product ambition while building in usable stages. Start with one end-to-end local editing workflow:

1. Create and save a project.
2. Import video, audio, and image files.
3. Place media on a multitrack timeline and preview it.
4. Trim and split clips, add a text overlay or caption, and adjust basic audio.
5. Export a playable video with understandable progress and errors.
6. Reopen the project and recover its asset references.

After that foundation, expand systematically into effects, transitions, keyframes, richer audio and caption tools, templates, AI-assisted editing, cloud features, and other documented workflows. Maintain a roadmap and feature matrix throughout. If a service or feature cannot work yet, represent its availability accurately and record the dependency; never make a control appear functional when it is only a placeholder.

Choose the first shipping platform from the existing repository's intent. If there is no established platform, recommend one, explain the tradeoffs briefly, and design module boundaries that allow later expansion. Build the media engine and user interface as separate layers with explicit contracts. Prefer existing, maintained dependencies when they fit; review their licenses, platform support, and codec implications before adopting them.

Keep user media local by default. Put external AI, cloud, and publishing services behind explicit provider interfaces. Do not upload user files or add paid services without the project owner's approval. Use user-owned, generated, or appropriately licensed assets for examples.

## REA and evidence

If the installed `reverse-engineer-anything` skill is available, read it before using REA and follow its instructions. REA can help inspect supported app packages and runtime behavior; it does not provide source code, private services, model weights, or media libraries. Confirm that REA tools are actually connected before relying on them. If they are unavailable, continue with the repository, public documentation, and supplied materials. Do not change REA or client configuration, install analysis engines, or access restricted targets without the project owner's approval.

## Working expectations

Make concrete progress after the initial inspection and shared contract. Do not stop at a feature list or architecture proposal. Implement the first useful slice within your ownership, integrate it with the other agent's work, and update the roadmap and handoff log.

Avoid broad rewrites, destructive commands, unrelated dependencies, and invented product claims. Preserve existing user work. When you encounter a decision that does not block useful progress, choose a sensible default and document it. Ask the project owner only when a decision materially changes platform, cost, privacy, or product direction.

Before handing work back, summarize what you changed, which contracts or files the other agent needs to know about, what remains incomplete, and the next useful step. Clearly state which workflows are implemented, which are partial, and which remain planned. Do not claim feature parity without evidence.
