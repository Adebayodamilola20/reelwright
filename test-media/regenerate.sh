#!/usr/bin/env bash
# regenerate.sh — deterministic tiny test fixtures for the video editor.
#
# Regenerates every file in test-media/ from scratch with ffmpeg (8.1.1
# verified locally; H.264/AAC/MP3 encoders and scale/fps/color/overlay filters
# confirmed). No external assets, everything synthesized — no licensing
# questions. Keep files small (~160 KB total); desktop has limited free space.
#
# Usage:  bash test-media/regenerate.sh     (from anywhere; writes next to it)
#
# Fixture facts are documented in test-media/README.md — if you change a
# fixture, update that table (it is consumed by engine/export tests).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FFMPEG="${FFMPEG:-ffmpeg}"

command -v "$FFMPEG" >/dev/null || { echo "ffmpeg not found (set \$FFMPEG)" >&2; exit 1; }

echo "regenerating fixtures in $DIR with $($FFMPEG -version | head -1)"

# 1) bars-tone.mp4 — the workhorse: SMPTE-like color bars + 440/880 Hz stereo
#    tone, 2.000 s, 320x240, exactly 60 frames at 30/1. yuv420p + +faststart
#    for maximum compatibility (web preview, mp4 demux everywhere).
"$FFMPEG" -y -v error \
  -f lavfi -i "smptebars=size=320x240:rate=30:duration=2" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" \
  -f lavfi -i "sine=frequency=880:sample_rate=48000:duration=2" \
  -filter_complex "[1:a][2:a]amerge=inputs=2[a]" \
  -map 0:v -map "[a]" \
  -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -ar 48000 -ac 2 \
  -movflags +faststart -shortest \
  "$DIR/bars-tone.mp4"

# 2) bars-tone-2997.mp4 — same content at NTSC 30000/1001 (59.94 fields
#    worth of drift per minute) so frame-math tests can prove no drift over
#    splits. 60 frames ≈ 2.002 s.
"$FFMPEG" -y -v error \
  -f lavfi -i "smptebars=size=320x240:rate=30000/1001:duration=2" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=2" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -ar 48000 -ac 2 -shortest \
  "$DIR/bars-tone-2997.mp4"

# 3) tone-48k.wav — 1.000 s stereo PCM sine pair at 48 kHz (exact sample
#    math: 48000 samples) for audio trim/split/volume/fade tests.
"$FFMPEG" -y -v error \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=1" \
  -f lavfi -i "sine=frequency=880:sample_rate=48000:duration=1" \
  -filter_complex "[0:a][1:a]amerge=inputs=2[a]" -map "[a]" \
  -c:a pcm_s16le -ar 48000 -ac 2 \
  "$DIR/tone-48k.wav"

# 4) tone-44100.mp3 — 1.000 s mono MP3 at 44.1 kHz (lossy, NTSC-exact
#    sample rate) for container/codec-mix ingest tests.
"$FFMPEG" -y -v error \
  -f lavfi -i "sine=frequency=330:sample_rate=44100:duration=1" \
  -c:a libmp3lame -b:a 96k -ac 1 \
  "$DIR/tone-44100.mp3"

# 5) still.png — single 320x240 color frame (image placement: explicit
#    duration, no intrinsic length).
"$FFMPEG" -y -v error \
  -f lavfi -i "color=c=0x2060C0:size=320x240:rate=1" -frames:v 1 \
  "$DIR/still.png"

echo "done:"
ls -la "$DIR" | grep -E '\.(mp4|wav|mp3|png)$' || true
