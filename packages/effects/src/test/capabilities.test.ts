import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFiltersAvailable,
  assertXfadeTransitionAvailable,
  missingFilters,
  parseFfmpegFilters,
  parseXfadeTransitions,
  probeFfmpegCapabilities,
} from '../capabilities.js';
import { EffectsError } from '../errors.js';

const FILTERS_OUTPUT = `
 T. eq                    V->V       Adjust brightness, contrast, gamma, and saturation.
 .. scale                  V->V       Scale the input video size and/or convert the image format.
 TS gblur                  V->V       Apply Gaussian Blur filter.
 .. concat                 N->N       Concatenate audio and video streams.
`;

const XFADE_HELP_OUTPUT = `
xfade AVOptions:
   transition        <int>        ..FV....... set cross fade transition (from -1 to 57) (default fade)
     custom          -1           ..FV....... custom transition
     fade            0            ..FV....... fade transition
     wipeleft        1            ..FV....... wipe left transition
     fadeblack       12           ..FV....... fadeblack transition
`;

test('parseFfmpegFilters extracts names from -filters output', () => {
  const set = parseFfmpegFilters(FILTERS_OUTPUT);
  assert.ok(set.has('eq'));
  assert.ok(set.has('scale'));
  assert.ok(set.has('gblur'));
  assert.ok(set.has('concat'));
  assert.equal(set.size, 4);
});

test('parseFfmpegFilters ignores non-filter lines', () => {
  const set = parseFfmpegFilters('\nrandom prose line\n\n');
  assert.equal(set.size, 0);
});

test('parseXfadeTransitions extracts transition names', () => {
  const set = parseXfadeTransitions(XFADE_HELP_OUTPUT);
  assert.ok(set.has('fade'));
  assert.ok(set.has('wipeleft'));
  assert.ok(set.has('fadeblack'));
  assert.ok(set.has('custom'));
  assert.equal(set.size, 4);
});

test('missingFilters + assertFiltersAvailable behavior', () => {
  const caps = {
    ffmpegPath: 'f', version: 'v', filters: new Set(['eq', 'scale']),
    xfadeTransitions: new Set<string>(), probedAt: 'now',
  };
  assert.deepEqual(missingFilters(['eq', 'gblur'], caps), ['gblur']);
  assertFiltersAvailable(['eq'], caps, 'Eq'); // no throw
  try {
    assertFiltersAvailable(['gblur', 'hue'], caps, 'Blur & Grayscale');
    assert.fail('expected UNSUPPORTED_FEATURE');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'UNSUPPORTED_FEATURE');
    assert.match(err.message, /gblur, hue/);
    assert.match(err.hint ?? '', /brew install ffmpeg/);
  }
});

test('assertXfadeTransitionAvailable checks both filter and name', () => {
  const noFilter = {
    ffmpegPath: 'f', version: 'v', filters: new Set<string>(),
    xfadeTransitions: new Set<string>(), probedAt: 'now',
  };
  assert.throws(() => assertXfadeTransitionAvailable('fade', noFilter, 'Fade'),
    (e: unknown) => e instanceof EffectsError && e.code === 'UNSUPPORTED_FEATURE');
  const noName = {
    ffmpegPath: 'f', version: 'v', filters: new Set(['xfade']),
    xfadeTransitions: new Set(['fade']), probedAt: 'now',
  };
  assert.throws(() => assertXfadeTransitionAvailable('wipeleft', noName, 'Wipe'),
    (e: unknown) => e instanceof EffectsError && /wipeleft/.test(e.message));
  assert.doesNotThrow(() => assertXfadeTransitionAvailable('fade', noName, 'Fade'));
});

test('probeFfmpegCapabilities: real local ffmpeg (Observed environment)', async () => {
  const caps = await probeFfmpegCapabilities('ffmpeg');
  assert.match(caps.version, /^ffmpeg version/i);
  // Filters this package depends on — probe must see them on this machine.
  for (const f of ['scale', 'eq', 'gblur', 'unsharp', 'hue', 'colorchannelmixer',
    'colortemperature', 'vignette', 'negate', 'rgbashift', 'geq', 'format',
    'xfade', 'setpts', 'atempo', 'acrossfade', 'concat', 'rotate']) {
    assert.ok(caps.filters.has(f), `local ffmpeg should have ${f}`);
  }
  for (const t of ['fade', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'wipeup', 'wipedown']) {
    assert.ok(caps.xfadeTransitions.has(t), `local xfade should have ${t}`);
  }
});

test('probeFfmpegCapabilities: missing binary → FFMPEG_NOT_FOUND + hint', async () => {
  await assert.rejects(
    () => probeFfmpegCapabilities('/definitely/not/ffmpeg'),
    (err: unknown) => err instanceof EffectsError && err.code === 'FFMPEG_NOT_FOUND',
  );
});
