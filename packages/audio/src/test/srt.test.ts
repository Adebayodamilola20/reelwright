import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildSrt,
  cuesFromClips,
  cuesFromProject,
  formatSrtTimestamp,
  TICKS_PER_SECOND,
  ticksFromSec,
  wrapText,
  writeSrtFile,
  AudioError,
} from '../index.js';
import { cleanupTempDir, makeTempDir } from './fixtures.js';

test('formatSrtTimestamp: contract ticks → SubRip HH:MM:SS,mmm', () => {
  assert.equal(formatSrtTimestamp(0), '00:00:00,000');
  assert.equal(formatSrtTimestamp(ticksFromSec(1.5)), '00:00:01,500');
  assert.equal(formatSrtTimestamp(ticksFromSec(3661.234)), '01:01:01,234');
  assert.equal(formatSrtTimestamp(TICKS_PER_SECOND * 360_000), '100:00:00,000'); // hours ≥ 100 unbounded
  assert.throws(() => formatSrtTimestamp(-1), (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT');
});

test('cuesFromClips: extracts text clips, skips non-text/disabled/empty with warnings', () => {
  const { cues, warnings } = cuesFromClips([
    { id: 'a', start: ticksFromSec(0), duration: ticksFromSec(2), text: { text: 'Hello' } },
    { id: 'b', start: ticksFromSec(2), duration: ticksFromSec(1) }, // no text → silent skip
    { id: 'c', start: ticksFromSec(3), duration: ticksFromSec(1), enabled: false, text: { text: 'Off' } },
    { id: 'd', start: ticksFromSec(4), duration: ticksFromSec(1), text: { text: '   ' } },
    { id: 'e', start: ticksFromSec(5), duration: 0, text: { text: 'Zero dur' } },
    { id: 'f', start: ticksFromSec(6), duration: ticksFromSec(1), text: 'plain string text' },
  ]);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Hello');
  assert.equal(cues[1].text, 'plain string text');
  assert.equal(cues[1].startTicks, ticksFromSec(6));
  assert.equal(cues[1].endTicks, ticksFromSec(7));
  assert.equal(warnings.length, 3); // disabled, empty, zero-duration
});

test('cuesFromClips: resolveText fallback for asset-backed text clips', () => {
  const { cues } = cuesFromClips(
    [{ id: 't1', start: 0, duration: ticksFromSec(1) }],
    { resolveText: (clip) => (clip.id === 't1' ? 'From asset' : null) },
  );
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'From asset');
});

test('cuesFromProject: hidden track excluded (with warning), muted track kept', () => {
  const project = {
    tracks: [
      { kind: 'video', hidden: true, clips: [{ id: 'h1', start: 0, duration: ticksFromSec(1), text: { text: 'Hidden' } }] },
      { kind: 'video', hidden: false, clips: [{ id: 'v1', start: 0, duration: ticksFromSec(1), text: { text: 'Visible' } }] },
      { kind: 'audio', muted: true, clips: [{ id: 'a1', start: ticksFromSec(2), duration: ticksFromSec(1), text: { text: 'Audio-track caption' } }] },
    ],
  };
  const { cues, warnings } = cuesFromProject(project);
  assert.deepEqual(cues.map((c) => c.text), ['Visible', 'Audio-track caption']);
  assert.ok(warnings.some((w) => w.message.includes('hidden track')));
});

test('buildSrt: exact rendering of the sample document', () => {
  const srt = buildSrt([
    { startTicks: ticksFromSec(1), endTicks: ticksFromSec(3), text: 'Hello world' },
    { startTicks: ticksFromSec(4), endTicks: ticksFromSec(5.5), text: 'Line one\nLine two' },
  ]);
  assert.equal(
    srt,
    '1\n00:00:01,000 --> 00:00:03,000\nHello world\n' +
      '\n2\n00:00:04,000 --> 00:00:05,500\nLine one\nLine two\n',
  );
});

test('buildSrt: stable sort by start time regardless of input order', () => {
  const srt = buildSrt([
    { startTicks: ticksFromSec(5), endTicks: ticksFromSec(6), text: 'Third' },
    { startTicks: ticksFromSec(1), endTicks: ticksFromSec(2), text: 'First' },
    { startTicks: ticksFromSec(3), endTicks: ticksFromSec(4), text: 'Second' },
  ]);
  const bodies = srt.trimEnd().split(/\n\n+/).map((block) => block.split('\n').slice(2).join('\n'));
  assert.deepEqual(bodies, ['First', 'Second', 'Third']);
});

test('buildSrt: overlapPolicy clamp trims the earlier cue', () => {
  const cues = [
    { startTicks: ticksFromSec(0), endTicks: ticksFromSec(3), text: 'Long' },
    { startTicks: ticksFromSec(2), endTicks: ticksFromSec(4), text: 'Next' },
  ];
  const kept = buildSrt(cues, { overlapPolicy: 'keep' });
  assert.match(kept, /00:00:00,000 --> 00:00:03,000/); // untouched by default
  const clamped = buildSrt(cues, { overlapPolicy: 'clamp' });
  assert.match(clamped, /00:00:00,000 --> 00:00:02,000/);
});

test('buildSrt: minDurationMs extends short cues', () => {
  const srt = buildSrt(
    [{ startTicks: ticksFromSec(1), endTicks: ticksFromSec(1.1), text: 'Flash' }],
    { minDurationMs: 500 },
  );
  assert.match(srt, /00:00:01,000 --> 00:00:01,500/);
});

test('buildSrt: wrapping and long-cue splitting preserve total span', () => {
  const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
  const wrapped = buildSrt([{ startTicks: ticksFromSec(0), endTicks: ticksFromSec(10), text }], {
    maxCharsPerLine: 12,
  });
  for (const line of wrapped.split('\n')) {
    if (line.includes('-->') || /^\d+$/.test(line) || line === '') continue;
    assert.ok(line.length <= 12, `line ≤ 12 chars: "${line}"`);
  }

  const split = buildSrt([{ startTicks: ticksFromSec(0), endTicks: ticksFromSec(10), text }], {
    maxCharsPerLine: 20,
    splitLongCues: 2,
  });
  const blocks = split.trimEnd().split(/\n\n+/);
  assert.ok(blocks.length > 1, 'long cue was split into multiple cues');
  assert.match(blocks[0], /00:00:00,000 -->/);
  const lastTimestamps = /(\d\d:\d\d:\d\d,\d{3})\n/.exec(blocks[blocks.length - 1]);
  assert.ok(lastTimestamps);
  assert.equal(formatSrtTimestamp(ticksFromSec(10)), lastTimestamps[1]); // span preserved
});

test('buildSrt: CR/CRLF normalized, degenerate cues dropped', () => {
  const srt = buildSrt([
    { startTicks: ticksFromSec(0), endTicks: ticksFromSec(1), text: 'Windows\r\nlines\r' },
    { startTicks: ticksFromSec(2), endTicks: ticksFromSec(2), text: 'Zero length' },
  ]);
  assert.ok(!srt.includes('\r'));
  const blocks = srt.trimEnd().split(/\n\n+/);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /Windows\nlines/);
});

test('wrapText: greedy, keeps long words intact', () => {
  assert.equal(wrapText('aaa bbb ccc ddd', 7), 'aaa bbb\nccc ddd');
  assert.equal(wrapText('supercalifragilistic', 5), 'supercalifragilistic');
});

test('writeSrtFile: writes parseable SRT with correct cue count', async () => {
  const dir = await makeTempDir();
  try {
    const out = path.join(dir, 'captions.srt');
    const { cueCount, bytes } = await writeSrtFile(out, [
      { startTicks: ticksFromSec(0), endTicks: ticksFromSec(1), text: 'One' },
      { startTicks: ticksFromSec(1), endTicks: ticksFromSec(2), text: 'Two' },
    ]);
    assert.equal(cueCount, 2);
    assert.ok(bytes > 0);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(out, 'utf8');
    assert.match(content, /^1\n00:00:00,000 --> 00:00:01,000\nOne\n\n2\n00:00:01,000 --> 00:00:02,000\nTwo\n$/);
  } finally {
    await cleanupTempDir(dir);
  }
});
