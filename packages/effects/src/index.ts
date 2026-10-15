/**
 * @ve/effects — effects, transitions, keyframes, speed, masks, color,
 * stickers, and filter presets for the video editor.
 *
 * Design: docs + this package's README.md (effect → preview → export →
 * availability matrix). Contract integration: proposals live in
 * docs/PROJECT_CONTRACT.md "Contract review notes" (Agent 2.5).
 *
 * Everything is pure data + pure functions; no DOM, no Electron, no ffmpeg
 * spawning except the one capability probe (capabilities.ts).
 */

export * from './types.js';
export * from './errors.js';
export * from './ticks.js';
export * from './easing.js';
export * from './keyframes.js';
export * from './speed.js';
export * from './capabilities.js';
export * from './effects/definitions.js';
export * from './effects/registry.js';
export * from './transitions.js';
export * from './masks.js';
export * from './stickers.js';
export * from './presets.js';
export * from './preview.js';
export * from './export-chain.js';
