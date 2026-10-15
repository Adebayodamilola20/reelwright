# test-media/ — deterministic fixtures (ffmpeg-generated)

Tiny, synthetic, license-clean media for engine tests (ingest/ffprobe
metadata, timeline split/trim math, export E2E, waveform peaks). All files
are regenerated from scratch by `regenerate.sh` — no external assets.

**Regenerate:** `bash test-media/regenerate.sh` (ffmpeg 8.1.1 verified on this
machine; H.264/AAC/MP3/PCM/PNG encoders all present).

**Facts below were measured with ffprobe after generation (Observed,
2026-10-15). If you change a fixture, regenerate AND update this table —
tests read these numbers.**

| file | size | container / streams | key facts |
|---|---|---|---|
| `bars-tone.mp4` | 29,978 B | mp4: h264 (yuv420p) + aac | 320x240, **30/1 fps, exactly 60 frames**, duration 2.000 s, audio 48 kHz stereo 440/880 Hz, +faststart |
| `bars-tone-2997.mp4` | 30,096 B | mp4: h264 (yuv420p) + aac | 320x240, **30000/1001 fps (29.97), 59 frames**, video duration 1.968633 s, audio 48 kHz stereo |
| `tone-48k.wav` | 192,078 B | wav: pcm_s16le | **48 000 Hz stereo, exactly 1.000 s** (48 000 samples/ch) |
| `tone-44100.mp3` | 12,897 B | mp3 | **44 100 Hz mono, 1.000 s** (lossy, NTSC-exact rate) |
| `still.png` | 803 B | png | 320x240 solid `#2060C0`, single frame, **no intrinsic duration** |

Why these five (Designed):

- Two frame rates (integer 30 and NTSC 29.97) let split/trim tests prove the
  tick timebase keeps frame boundaries exact where µs-based editors drift.
- 48 kHz (tick-exact) and 44.1 kHz (also tick-exact at 1600/1470 ticks) audio
  cover both sample-grid paths; MP3 + WAV + AAC cover lossy/lossless and
  mono/stereo ingest.
- The PNG exercises the "image clips carry explicit duration" rule.
- Total footprint ≈ 265 KB — safe to commit.

Adding fixtures: append to `regenerate.sh`, regenerate, and add a row here
with the ffprobe facts. Never commit media whose license is unclear.
