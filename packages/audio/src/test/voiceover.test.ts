import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import {
  encodeWavPcm16,
  parseWav,
  durationTicksFromSamples,
  voiceoverClipFromRecording,
  voiceoverOutputPath,
  VoiceoverSession,
  validateRecordingFormat,
  probeEncoders,
  TICKS_PER_SECOND,
  AudioError,
} from '../index.js';
import { cleanupTempDir, makeTempDir, sinePcmS16 } from './fixtures.js';

test('encodeWavPcm16 → parseWav round-trip (exact sample counts)', () => {
  const pcm = sinePcmS16(48000, 48000); // 1.000 s mono @ 48 kHz
  const wav = encodeWavPcm16(pcm, 48000, 1);
  assert.equal(wav.length, 44 + pcm.length);
  const info = parseWav(wav);
  assert.equal(info.sampleRate, 48000);
  assert.equal(info.channels, 1);
  assert.equal(info.bitsPerSample, 16);
  assert.equal(info.sampleCount, 48000);
});

test('encodeWavPcm16: odd byte counts and partial frames rejected', () => {
  assert.throws(
    () => encodeWavPcm16(Buffer.alloc(3), 48000, 1),
    (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
  );
  // 2 bytes = 1 sample; not a whole 2-channel frame.
  assert.throws(
    () => encodeWavPcm16(Buffer.alloc(2), 48000, 2),
    (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
  );
});

test('parseWav: garbage rejected with INVALID_ARGUMENT', () => {
  assert.throws(
    () => parseWav(Buffer.from('not a wav file at all, just text padding padding', 'ascii')),
    (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
  );
});

test('durationTicksFromSamples: contract rates are exact', () => {
  assert.equal(durationTicksFromSamples(48000, 48000), TICKS_PER_SECOND);
  assert.equal(durationTicksFromSamples(44100, 44100), TICKS_PER_SECOND);
  assert.equal(durationTicksFromSamples(96000, 96000), TICKS_PER_SECOND);
  assert.equal(durationTicksFromSamples(1, 48000), 1470); // one sample = 1470 ticks
  assert.equal(durationTicksFromSamples(0, 48000), 0);
  assert.throws(() => durationTicksFromSamples(-1, 48000), RangeError);
});

test('validateRecordingFormat: supported rates and channels only', () => {
  validateRecordingFormat({ sampleRate: 48000, channels: 1 });
  assert.throws(
    () => validateRecordingFormat({ sampleRate: 22050, channels: 1 }),
    (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => validateRecordingFormat({ sampleRate: 48000, channels: 7 }),
    (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
  );
});

test('voiceoverClipFromRecording: contract-shaped clip with exact duration', () => {
  const clip = voiceoverClipFromRecording({
    clipId: 'c1',
    assetId: 'a1',
    startTicks: 5 * TICKS_PER_SECOND,
    sampleCount: 48000,
    sampleRate: 48000,
    fadeInTicks: 1470,
  });
  assert.equal(clip.start, 5 * TICKS_PER_SECOND);
  assert.equal(clip.duration, TICKS_PER_SECOND);
  assert.equal(clip.sourceIn, 0);
  assert.deepEqual(clip.speed, { n: 1, d: 1 });
  assert.equal(clip.audio.volume, 1);
  assert.equal(clip.audio.fadeIn, 1470);
  assert.equal(clip.audio.muted, false);
  assert.deepEqual(clip.keyframes, []);
  assert.throws(
    () =>
      voiceoverClipFromRecording({
        clipId: 'c2',
        assetId: 'a1',
        startTicks: 0,
        sampleCount: 48000,
        sampleRate: 48000,
        fadeInTicks: 30_000_000,
        fadeOutTicks: 60_000_000, // 90M > 70.56M ticks (1 s @ 48 kHz)
      }),
    (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
  );
});

test('VoiceoverSession: chunked append → finalize WAV with exact duration', async () => {
  const dir = await makeTempDir();
  try {
    const session = new VoiceoverSession({ sampleRate: 48000, channels: 1 });
    const chunk1 = sinePcmS16(24000, 48000);
    const chunk2 = sinePcmS16(24000, 48000);
    assert.equal(session.append(chunk1).receivedBytes, chunk1.length);
    assert.equal(session.append(chunk2).receivedBytes, chunk1.length + chunk2.length);

    const out = voiceoverOutputPath(dir, session.sessionId, 'wav');
    const result = await session.finalize('wav', { outputPath: out });
    assert.equal(result.sampleCount, 48000);
    assert.equal(result.durationTicks, TICKS_PER_SECOND);
    assert.equal(result.sampleRate, 48000);
    assert.ok(result.path.includes(path.join('audio', 'voiceovers')));
    const info = parseWav(await (await import('node:fs/promises')).readFile(out));
    assert.equal(info.sampleCount, 48000);
  } finally {
    await cleanupTempDir(dir);
  }
});

test('VoiceoverSession: lifecycle guards', async () => {
  const dir = await makeTempDir();
  try {
    const s = new VoiceoverSession({ sampleRate: 48000, channels: 1 });
    s.append(sinePcmS16(4800, 48000));
    await s.finalize('wav', { outputPath: path.join(dir, 'a.wav') });
    assert.throws(
      () => s.append(sinePcmS16(100, 48000)),
      (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
    );

    const aborted = new VoiceoverSession({ sampleRate: 48000, channels: 1 });
    aborted.abort();
    await assert.rejects(
      () => aborted.finalize('wav', { outputPath: path.join(dir, 'b.wav') }),
      (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
    );

    const empty = new VoiceoverSession({ sampleRate: 48000, channels: 1 });
    await assert.rejects(
      () => empty.finalize('wav', { outputPath: path.join(dir, 'c.wav') }),
      (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
    );

    const odd = new VoiceoverSession({ sampleRate: 48000, channels: 1 });
    assert.throws(
      () => odd.append(Buffer.from([1, 2, 3])),
      (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
    );
  } finally {
    await cleanupTempDir(dir);
  }
});

test('VoiceoverSession: mp3 finalize encodes via libmp3lame (or fails honestly)', async () => {
  const dir = await makeTempDir();
  try {
    const encoders = await probeEncoders();
    const session = new VoiceoverSession({ sampleRate: 48000, channels: 1 });
    session.append(sinePcmS16(24000, 48000));
    const out = path.join(dir, 'vo.mp3');
    if (encoders.has('libmp3lame')) {
      const result = await session.finalize('mp3', { outputPath: out });
      assert.equal(result.format, 'mp3');
      assert.ok((await stat(out)).size > 0);
    } else {
      await assert.rejects(
        () => session.finalize('mp3', { outputPath: out }),
        (err: unknown) => err instanceof AudioError && err.code === 'UNSUPPORTED_FEATURE',
      );
    }
  } finally {
    await cleanupTempDir(dir);
  }
});

test('VoiceoverSession: safety cap', () => {
  const session = new VoiceoverSession({ sampleRate: 48000, channels: 1 }, { maxBytes: 100 });
  session.append(Buffer.alloc(100));
  assert.throws(
    () => session.append(Buffer.alloc(2)),
    (err: unknown) => err instanceof AudioError && err.code === 'IO_ERROR',
  );
});
