/**
 * Unit tests for the keyboard map (pure matching logic).
 * Run: node --test 'packages/app/test/*.test.ts'
 * (node 24: a bare directory arg is treated as an entry module — MODULE_NOT_FOUND.)
 *
 * Includes the K1 regression guard (second-head fix): uppercase single-letter
 * bindings ("S", "K", "N" …) previously never matched real keypresses because
 * eventToKey() lowercases printable keys while parseBinding() kept them as-is.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseBinding, resolveEvent, describeBinding, KEYBOARD_ACTIONS,
} from "../src/ui/interaction/keyboard-map.ts";

function ev(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    ...mods,
  } as KeyboardEvent;
}

test("K1 regression: uppercase letter bindings match real keypresses", () => {
  assert.equal(resolveEvent(ev("s"), "other")?.id, "edit.split");
  assert.equal(resolveEvent(ev("k"), "other")?.id, "playback.toggle");
  assert.equal(resolveEvent(ev("j"), "other")?.id, "playback.stop");
  assert.equal(resolveEvent(ev("n"), "other")?.id, "timeline.snapToggle");
  assert.equal(resolveEvent(ev("v"), "other")?.id, "tool.select");
  assert.equal(resolveEvent(ev("t"), "other")?.id, "tool.text");
});

test("modifiers route correctly per platform", () => {
  assert.equal(resolveEvent(ev("z", { metaKey: true }), "mac")?.id, "edit.undo");
  assert.equal(resolveEvent(ev("z", { metaKey: true, shiftKey: true }), "mac")?.id, "edit.redo");
  assert.equal(resolveEvent(ev("z", { ctrlKey: true }), "other")?.id, "edit.undo");
  // Mac event must not fire on ctrl alone:
  assert.equal(resolveEvent(ev("z", { ctrlKey: true }), "mac"), null);
});

test("alt-modified bindings stay distinct from their plain versions", () => {
  assert.equal(resolveEvent(ev("[", { altKey: true }), "other")?.id, "edit.trimStart");
  assert.equal(resolveEvent(ev("ArrowLeft"), "other")?.id, "playback.frameBack");
});

test("outsideInput suppresses shortcuts while typing", () => {
  assert.equal(resolveEvent(ev("s"), "other", { inTextInput: true }), null);
  // Non-outsideInput bindings still fire (e.g. Mod+N new project):
  assert.equal(resolveEvent(ev("n", { metaKey: true }), "mac", { inTextInput: true })?.id, "project.new");
});

test("unmatched keys resolve to null", () => {
  assert.equal(resolveEvent(ev("q"), "other"), null);
});

test("describeBinding renders mac symbols and capitals", () => {
  assert.equal(describeBinding("Mod+S", "mac"), "⌘S");
  assert.equal(describeBinding("Mod+Shift+Z", "mac"), "⌘⇧Z");
});

test("every action has at least one binding and unique id", () => {
  const ids = new Set<string>();
  for (const a of KEYBOARD_ACTIONS) {
    assert.ok(a.bindings.length >= 1, `${a.id} has no bindings`);
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`);
    ids.add(a.id);
  }
});

test("parseBinding canonicalizes single-char keys", () => {
  assert.deepEqual(parseBinding("S"), { mod: false, shift: false, alt: false, key: "s" });
  assert.deepEqual(parseBinding("Mod+Shift+Z"), { mod: true, shift: true, alt: false, key: "z" });
});
