import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  UnavailableTranscriptionProvider,
  WhisperCliProvider,
  detectLocalWhisper,
  AudioError,
} from '../index.js';
import { cleanupTempDir, makeTempDir } from './fixtures.js';

test('UnavailableTranscriptionProvider: always unavailable with an accurate reason', async () => {
  const p = new UnavailableTranscriptionProvider('test-stub', 'Test stub', 'no backend configured in unit tests');
  const status = await p.status();
  assert.equal(status.available, false);
  assert.ok(status.reason && status.reason.length > 0);
  await assert.rejects(
    () => p.transcribe('/nonexistent.wav'),
    (err: unknown) => err instanceof AudioError && err.code === 'NOT_CONFIGURED',
  );
});

test('WhisperCliProvider: reports honest status, never claims availability in v1', async () => {
  const p = new WhisperCliProvider();
  const status = await p.status();
  assert.equal(status.available, false, 'v1 must not claim transcription availability');
  assert.ok(status.reason && status.reason.length > 0, 'unavailable status carries a real reason');
  await assert.rejects(
    () => p.transcribe('/nonexistent.wav'),
    (err: unknown) => err instanceof AudioError && err.code === 'NOT_CONFIGURED',
  );
});

test('detectLocalWhisper: returns detection facts (Observed at runtime)', async () => {
  const detection = await detectLocalWhisper();
  assert.equal(typeof detection.summary, 'string');
  assert.ok(detection.summary.length > 0);
  assert.ok(Array.isArray(detection.modelPaths));
  if (detection.binaryPath !== null) {
    assert.ok(path.isAbsolute(detection.binaryPath), 'binary path is absolute');
    // Local environment (Observed 2026-10-15): whisper-cli present, no models.
    assert.ok(detection.summary.includes('detected'), detection.summary);
  }
});

test('detectLocalWhisper: honours injected binary/model dirs (no network, local FS only)', async () => {
  const dir = await makeTempDir('whisper-fake-');
  try {
    const binDir = path.join(dir, 'bin');
    const modelDir = path.join(dir, 'models');
    await mkdir(binDir, { recursive: true });
    await mkdir(modelDir, { recursive: true });

    // No binary on our injected PATH-like dirs → not detected.
    const clean = await detectLocalWhisper(['definitely-not-a-real-binary'], [modelDir]);
    assert.equal(clean.binaryPath, null);

    // A fake "binary" (executable bit) IS detected; a fake model file is listed.
    const { chmod } = await import('node:fs/promises');
    const fakeBin = path.join(binDir, 'whisper-cli');
    await writeFile(fakeBin, '#!/bin/sh\nexit 0\n');
    await chmod(fakeBin, 0o755);
    await writeFile(path.join(modelDir, 'ggml-tiny.bin'), 'fake');
    const found = await detectLocalWhisper(['whisper-cli'], [modelDir, path.join(dir, 'nonexistent')], [binDir]);
    assert.equal(found.binaryPath, fakeBin);
    assert.equal(found.modelPaths.length, 1);
    assert.ok(found.modelPaths[0].endsWith('ggml-tiny.bin'));
  } finally {
    await cleanupTempDir(dir);
  }
});

test('detectLocalWhisper: default model dirs include the user cache (existence-only scan)', async () => {
  // Sanity: the default scan must not throw even if dirs are missing.
  const detection = await detectLocalWhisper([], [
    path.join(homedir(), '.cache', 'whisper'),
    path.join(homedir(), 'definitely-missing-dir'),
  ]);
  assert.deepEqual(detection.modelPaths, []);
});
