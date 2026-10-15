import 'package:flutter/foundation.dart';

import 'timeline_model.dart';

/// The mutation surface the timeline UI calls (Owner of semantics: Agent 1,
/// via the contract; this file records Agent 2's required surface and is the
/// seam an adapter implements).
///
/// Rules encoded here:
/// - Every mutating call goes through the shared undo/redo stack.
/// - The UI listens on [changes] (fires for undo/redo AND direct calls) and
///   re-reads [document].
/// - Drag interactions preview locally, then commit once on pointer-up.
/// - Snapping resolves through [resolveSnap] so ruler/clip edges/playhead all
///   participate symmetrically.
abstract class TimelineController extends ChangeNotifier {
  /// Current immutable document snapshot. UI rebuilds from this.
  TimelineDocument get document;

  /// Fires after any change (mutation, undo, redo, selection change).
  Listenable get changes;

  // -- selection ----------------------------------------------------------

  Set<String> get selectedClipIds;

  bool isSelected(String clipId);

  void select(String clipId, {bool additive = false});

  void selectRange(Set<String> clipIds, {bool additive = false});

  void clearSelection();

  // -- history ------------------------------------------------------------

  bool get canUndo;
  bool get canRedo;
  String? get undoLabel;
  String? get redoLabel;

  Future<void> undo();
  Future<void> redo();

  /// True while a gesture-owned transaction (e.g. a drag) is open. Splitting
  /// during an open transaction is rejected by the engine.
  bool get hasOpenTransaction;

  void beginGesture(String label);
  void endGesture();

  /// Marks the document dirty so autosave runs (engine may debounce).
  void markDirty();

  // -- structural operations ---------------------------------------------

  /// Move [clipId] to [startMicros] on [targetTrackId] (defaults to current
  /// track). Returns the position actually applied (post-snap, post-collision).
  /// The UI commits its preview against this return value.
  int moveClip({
    required String clipId,
    required int startMicros,
    String? targetTrackId,
    bool snap = true,
  });

  /// Trim by dragging one edge: [deltaMicros] > 0 extends, < 0 shortens.
  /// Returns the applied delta (clamped to source bounds / neighbours).
  int trimClip({
    required String clipId,
    required bool trimStart,
    required int deltaMicros,
  });

  /// Split every selected clip (or the clip under [clipId]) at project time
  /// [atMicros]. Returns ids of the newly created right-hand clips.
  Future<List<String>> splitAt(int atMicros, {String? clipId});

  Future<void> deleteSelection();
  Future<List<String>> duplicateSelection();

  /// Replace the backing asset of [clipId] while keeping timing/props
  /// (top-level "Replace" workflow). Returns false if incompatible.
  Future<bool> replaceAsset({required String clipId, required String assetId});

  // -- tracks -------------------------------------------------------------

  Future<String> addTrack(TrackKind kind, {String? name});

  Future<void> removeTrack(String trackId);

  Future<void> setTrackFlags(
    String trackId, {
    bool? locked,
    bool? muted,
    bool? hidden,
  });

  Future<void> renameTrack(String trackId, String name);

  Future<void> reorderTracks(List<String> orderedTrackIds);

  // -- clip properties (inspector) ---------------------------------------

  /// Patch exactly one clip; [label] names the undo entry ("Move clip",
  /// "Change volume", …). During slider drags call with `begin/endGesture`
  /// so a whole drag coalesces into one undo step.
  Future<void> updateClip(
    String clipId,
    TimelineClip Function(TimelineClip current) patch, {
    required String label,
  });

  /// Apply a patch to all selected clips at once (multi-select inspector).
  Future<void> updateSelected(
    TimelineClip Function(TimelineClip current) patch, {
    required String label,
  });

  // -- playback-time edits ------------------------------------------------

  /// Insert a new text/caption clip at [startMicros] on a text track,
  /// creating a track if none exists. Returns the clip id.
  Future<String> addTextClip({
    required String content,
    required int startMicros,
    required int durationMicros,
    bool isCaption = false,
  });

  /// Put [assetId] on the timeline at [startMicros] on the first compatible
  /// free track (or [trackId]). Returns the clip id, or null when rejected.
  Future<String?> placeAsset({
    required String assetId,
    required int startMicros,
    String? trackId,
  });

  // -- snapping -----------------------------------------------------------

  /// Resolve a proposed timeline start for [movingClipIds] against snap
  /// candidates (clip edges, project start, [playheadMicros] when provided).
  /// Returns the snapped start; the UI highlights a guide at the returned
  /// candidate by calling again with the same inputs (deterministic), or
  /// simply hides guides when the returned value equals the proposal.
  int resolveSnap({
    required int proposedStartMicros,
    required Set<String> movingClipIds,
    required double thresholdMicros,
    int? playheadMicros,
  });

  /// Microseconds per pixel at current zoom — stored here so the timeline UI
  /// and snapping share one source of truth (zoom is not part of undo
  /// history).
  double get microsPerPixel;

  void setZoom(double microsPerPixel);
}
