# @ve/audio — Reelwright audio & captions package (Phase 3)

> Owner: **Agent 3 (Phase 3)** per `docs/PHASE_PLAN.md`. Scope: waveform peaks,
> sidecar SRT export, clip-audio → ffmpeg mapping, voiceover data path, noise
> cleanup, transcription behind provider availability.
> This package has **no Electron/DOM dependency** and **zero runtime npm
> dependencies** — Node stdlib + the local ffmpeg/ffprobe binaries only.

## Honesty table (capability → implementation → availability)

Every row is evidence-labelled per the charter (**Observed** = measured in this
environment; **Designed** = implemented + unit-tested here, integration pending;
**Planned** = designed but not implemented).

| Capability | Implementation | Availability | Evidence |
|---|---|---|---|
| Waveform peaks (min/max per bucket) | `computeWaveform`: ffprobe duration → ffmpeg decode to mono s16le @ 8 kHz → streaming downsample in Node | **Available** (video+audio, audio-only, mp3, wav; fails honestly on video-only files) | Observed (tests run against ffmpeg-generated fixtures) |
| Waveform sidecar cache (UI reads without re-decode) | `waveformCached` / `readWaveformSidecar`: versioned JSON, source fingerprint (size+mtime) + bucket count invalidation, atomic write | **Available in package**; engine wiring proposed | Designed |
| Sidecar SRT export from text clips | `cuesFromClips` / `cuesFromProject` / `buildSrt` / `writeSrtFile`: SubRip, ms timestamps from ticks (±0.5 ms), wrap/split/min-duration/overlap-clamp options, warnings for excluded clips | **Available in package**; `exportMedia.exportSrt` proposed to contract | Designed |
| Volume / fadeIn / fadeOut → ffmpeg | `planClipAudio`: `volume=` + `afade=t=in/out` with tick-exact seconds; `tryPlanClipAudio` for preflight | **Available in package**; export-plan wiring is Agent 1's (proposal filed) | Designed |
| Volume automation (keyframed volume) | — | **Not implemented** (contract v1 stores keyframes but doesn't evaluate them; engine-wide decision) | Planned |
| Speed ≠ 1/1 audio (atempo) | Rejected by `planClipAudio` with `UNSUPPORTED_FEATURE` | Gated off honestly | Designed |
| Noise cleanup | `planNoiseCleanup` + `runNoiseCleanup`: 4 profiles (`light`, `hum-removal`, `standard`, `strong`) built on probed filters (`highpass`, `lowpass`, `bandreject`, `afftdn`) | **Available** on this ffmpeg build (probe-verified at runtime; other builds gate with real reason) | Observed |
| Voiceover: PCM capture path | `VoiceoverSession` (chunked s16le append → WAV via pure-Node encoder; optional MP3 via libmp3lame), exact-tick durations | **Available in package**; renderer `getUserMedia` capture + IPC wiring is Agent 2's (contract documented below) | Designed |
| Voiceover: timeline data shape | `voiceoverClipFromRecording`: contract-`Clip`-shaped object (start/duration/sourceIn 0/speed 1-1/audio defaults) | Available in package | Designed |
| Transcription provider interface | `TranscriptionProvider` + `UnavailableTranscriptionProvider` stub (`available:false`, `reason`) + `WhisperCliProvider` detection-only | **Gated OFF honestly** — no backend implemented; no network, no installs | Designed |
| Local whisper detection | `detectLocalWhisper`: PATH lookup for `whisper-cli`/`whisper-cpp` + shallow model-file scan (`ggml*.bin`) in known dirs | **Available** (this machine: `whisper-cli` detected at `/usr/local/bin/whisper-cli`, no models found → provider stays unavailable with that exact reason) | Observed |
| Speech-to-captions pipeline | — | **Planned** (needs model file or approved service; would emit `SrtCue[]` into `buildSrt`) | Planned |
| Burned-in captions on export | — | **Impossible in this environment** (local ffmpeg has no libfreetype/libass — no `drawtext`/`subtitles`/`ass`). SRT sidecar is the honest alternative. | Observed (contract "Environment baseline") |

## API overview

```ts
import {
  computeWaveform, waveformCached, readWaveformSidecar,  // waveform
  cuesFromClips, cuesFromProject, buildSrt, writeSrtFile, // captions
  planClipAudio, tryPlanClipAudio,                        // export mapping
  planNoiseCleanup, runNoiseCleanup, listNoiseProfiles,   // noise cleanup
  VoiceoverSession, voiceoverClipFromRecording,           // voiceover
  WhisperCliProvider, UnavailableTranscriptionProvider,   // providers
  audioCapabilities,                                      // runtime probe
} from '@ve/audio';
```

All errors are `AudioError { code, message, hint?, details? }` with codes
mirroring the contract's `EngineErrorShape` (`INVALID_ARGUMENT`,
`UNSUPPORTED_FEATURE`, `FFMPEG_NOT_FOUND`, `FFMPEG_FAILED`, `IO_ERROR`,
`NOT_CONFIGURED`) so the engine can forward them across IPC unmapped.

Time is **contract ticks** (`TICKS_PER_SECOND = 70_560_000`) everywhere; this
package mirrors `@ve/engine`'s `time.ts` structurally instead of importing it
(keeps the package standalone-buildable; structural typing makes engine values
assignable). SRT output quantizes to milliseconds (SRT format limit, ±0.5 ms);
ffmpeg filter seconds are formatted to nanosecond precision.

## Design decisions

1. **No `@ve/engine` import.** Mirrored minimal shapes (`Ticks`, `Rational`)
   mean `@ve/audio` compiles/tests even when the engine is mid-flight, and the
   engine can adopt it as a dependency without a cycle. Integration is a
   proposal in the contract's review notes.
2. **Waveform decode at 8 kHz mono** (configurable). UI peaks don't need
   48 kHz resolution; 8 kHz keeps decode fast and sidecars small. The sidecar
   records `decodeRate` so a future higher-quality pass invalidates cleanly.
3. **WAV as the recording format** (not MP3): lossless, zero-latency write
   (pure-Node 44-byte header), sample-exact tick math. MP3 offered post-record
   via ffmpeg (Observed: `libmp3lame` present), never as the live format.
4. **Provider gating is binary-honest**: `WhisperCliProvider.status()` never
   reports `available: true` in v1 even when a CLI + model exist, because the
   transcription pipeline isn't implemented; the `reason` carries the concrete
   detection facts instead.
5. **Noise profiles probe, never assume**: `planNoiseCleanup` takes the
   available-filter set as input; `runNoiseCleanup` probes `ffmpeg -filters`
   first. A build lacking `afftdn` yields `UNSUPPORTED_FEATURE` + missing
   filter names, not a silent skip.

## Voiceover IPC contract (for Agent 2)

The renderer (getUserMedia → PCM s16le frames, e.g. via AudioWorklet) streams
chunks to the Electron main process, which owns this package:

```
voiceover.startSession({ sampleRate: 48000, channels: 1 }) → { sessionId }
voiceover.appendChunk(sessionId, base64Pcm)               → { receivedBytes }
voiceover.finalize(sessionId, { format: 'wav'|'mp3', projectDir })
    → { result: VoiceoverFinalizeResult, clip: VoiceoverClip }
voiceover.abort(sessionId)                                → void
```

- Sample rates are restricted to **44100 / 48000 / 96000** — the contract's
  tick rate divides them evenly (1600/1470/735 ticks per sample), so recorded
  durations are exact integer ticks.
- `finalize` writes `<projectDir>/audio/voiceovers/vo_<sessionId>.<fmt>`
  atomically (temp + rename) and returns the contract-shaped clip ready for
  `timeline.addClip`. The engine-side asset registration (`assets.import` on
  the new file) remains the engine's call.
- The TS interface is exported as `VoiceoverBridge` for preload typing.

## Running the tests

```bash
npm run build -w @ve/audio        # tsc → dist/
npm test  -w @ve/audio            # node --test dist/test/  (54 tests)
```

Tests synthesize all media with local ffmpeg (sine/silence/noise/bars tones) in
the OS temp dir and clean up after themselves — no binary fixtures committed,
no network.
