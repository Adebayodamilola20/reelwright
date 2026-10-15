import 'package:flutter/foundation.dart';

import '../api/ports.dart';
import '../api/timeline_controller.dart';
import '../api/timeline_model.dart';

/// INTERIM implementation (Agent 2): a real, undoable timeline document that
/// gives the UI correct semantics *today*. Once Agent 1's contract lands, a
/// thin adapter implements the same [TimelineController] surface over the
/// engine's document + command stack and this file is deleted — the UI is
/// written only against the interface.
///
/// Notable behaviors encoded here (and expected from the real engine):
/// - undo/redo snapshots with gesture coalescing (one drag = one undo step)
/// - collision-free moves (clamped into free gaps, rejected when no room)
/// - head/tail trimming bounded by neighbours and source length when known
/// - split-at-playhead producing two clips with correct source offsets
/// - snapping against clip edges / project start / playhead
class LocalTimelineController implements TimelineController {
  LocalTimelineController({
    required TimelineDocument document,
    this.assetOf,
  }) : _doc = document;

  /// Resolver so `placeAsset` / `replaceAsset` can label clips and size them
  /// from real media metadata when available.
  final MediaAsset? Function(String assetId)? assetOf;

  TimelineDocument _doc;
  Set<String> _selected = <String>{};
  final _changes = ChangeNotifier();
  final _outer = ChangeNotifier();

  // history
  final List<_HistoryEntry> _undo = [];
  final List<_HistoryEntry> _redo = [];
  static const int _maxHistory = 200;

  // gesture coalescing
  String? _gestureLabel;
  TimelineDocument? _gestureBaseline;
  int _gestureDepth = 0;

  double _microsPerPixel = 1000000 / 80; // 80 px per second at default zoom

  // -- Listenable plumbing -------------------------------------------------

  @override
  TimelineDocument get document => _doc;

  @override
  Listenable get changes => Listenable.merge([_changes, _outer]);

  @override
  Set<String> get selectedClipIds => Set.unmodifiable(_selected);

  void _notify() {
    _changes.notifyListeners();
    _outer.notifyListeners();
  }

  @override
  bool isSelected(String clipId) => _selected.contains(clipId);

  @override
  void select(String clipId, {bool additive = false}) {
    if (additive) {
      _selected = {..._selected}..add(clipId);
    } else {
      _selected = {clipId};
    }
    _notify();
  }

  @override
  void selectRange(Set<String> clipIds, {bool additive = false}) {
    _selected = additive ? {..._selected, ...clipIds} : {...clipIds};
    _notify();
  }

  @override
  void clearSelection() {
    if (_selected.isEmpty) return;
    _selected = {};
    _notify();
  }

  // -- history -------------------------------------------------------------

  @override
  bool get canUndo => _undo.isNotEmpty;

  @override
  bool get canRedo => _redo.isNotEmpty;

  @override
  String? get undoLabel => _undo.isEmpty ? null : _undo.last.label;

  @override
  String? get redoLabel => _redo.isEmpty ? null : _redo.last.label;

  @override
  bool get hasOpenTransaction => _gestureDepth > 0;

  @override
  void beginGesture(String label) {
    if (_gestureDepth == 0) {
      _gestureLabel = label;
      _gestureBaseline = _doc;
    }
    _gestureDepth++;
  }

  @override
  void endGesture() {
    if (_gestureDepth == 0) return;
    _gestureDepth--;
    if (_gestureDepth == 0) {
      final baseline = _gestureBaseline;
      final label = _gestureLabel ?? 'Edit';
      _gestureBaseline = null;
      _gestureLabel = null;
      if (baseline != null && !identical(baseline, _doc)) {
        _pushHistory(label, baseline, _doc);
      }
    }
  }

  void _pushHistory(String label, TimelineDocument before, TimelineDocument after) {
    _undo.add(_HistoryEntry(label, before, after));
    if (_undo.length > _maxHistory) _undo.removeAt(0);
    _redo.clear();
  }

  /// Apply a document change: when inside a gesture, just mutate; otherwise
  /// record history immediately.
  void _commit(TimelineDocument next, String label) {
    final before = _doc;
    _doc = next;
    _pruneSelection();
    if (_gestureDepth == 0) {
      _pushHistory(label, before, next);
    }
    _notify();
  }

  void _pruneSelection() {
    final live = _doc.allClips.map((c) => c.id).toSet();
    _selected = _selected.where(live.contains).toSet();
  }

  @override
  Future<void> undo() async {
    if (_undo.isEmpty || _gestureDepth > 0) return;
    final entry = _undo.removeLast();
    _redo.add(entry);
    _doc = entry.before;
    _pruneSelection();
    _notify();
  }

  @override
  Future<void> redo() async {
    if (_redo.isEmpty || _gestureDepth > 0) return;
    final entry = _redo.removeLast();
    _undo.add(entry);
    _doc = entry.after;
    _pruneSelection();
    _notify();
  }

  @override
  void markDirty() {
    // Interim engine persists nothing; the session layer surfaces save state.
    _outer.notifyListeners();
  }

  // -- helpers -------------------------------------------------------------

  static const int _minClipMicros = 100000; // 0.1 s floor for any clip

  TimelineClip _clip(String clipId) {
    final c = _doc.clipById(clipId);
    if (c == null) throw ArgumentError('Unknown clip $clipId');
    return c;
  }

  TimelineTrack _trackOf(String trackId) =>
      _doc.tracks.firstWhere((t) => t.id == trackId);

  List<TimelineTrack> _tracksFor(MediaKind kind) => switch (kind) {
        MediaKind.video || MediaKind.image => _doc.tracks
            .where((t) => t.kind == TrackKind.video || t.kind == TrackKind.overlay)
            .toList(),
        MediaKind.audio =>
          _doc.tracks.where((t) => t.kind == TrackKind.audio).toList(),
        MediaKind.text =>
          _doc.tracks.where((t) => t.kind == TrackKind.text).toList(),
        MediaKind.other => _doc.tracks.toList(),
      };

  int _sourceDurationUs(TimelineClip clip) {
    final asset = clip.assetId == null ? null : assetOf?.call(clip.assetId!);
    return asset?.durationMicros ?? 0; // 0 = unknown / unbounded
  }

  // -- moves ---------------------------------------------------------------

  @override
  int moveClip({
    required String clipId,
    required int startMicros,
    String? targetTrackId,
    bool snap = true,
  }) {
    final clip = _clip(clipId);
    final currentTrack = _trackOf(clip.trackId);
    if (currentTrack.locked) return clip.startMicros;

    var targetTrack = targetTrackId == null ? currentTrack : _trackOf(targetTrackId);
    if (targetTrack.locked) targetTrack = currentTrack;
    if (!_tracksFor(clip.kind).any((t) => t.id == targetTrack.id)) {
      targetTrack = currentTrack; // incompatible track family: stay put
    }

    var start = startMicros < 0 ? 0 : startMicros;
    if (snap) start = resolveSnap(
      proposedStartMicros: start,
      movingClipIds: {clipId},
      thresholdMicros: _microsPerPixel * 8,
    );

    // Collision handling on the target track.
    final others = targetTrack.clips.where((c) => c.id != clipId).toList()
      ..sort((a, b) => a.startMicros.compareTo(b.startMicros));
    final end = start + clip.durationMicros;
    int floor = 0;
    int? ceil;
    for (final o in others) {
      if (o.endMicros <= start) {
        if (o.endMicros > floor) floor = o.endMicros;
      }
      if (o.startMicros >= end || (o.startMicros < end && o.endMicros > start)) {
        // overlapping or ahead — track the tightest ceiling
        if (ceil == null || o.startMicros < ceil) ceil = o.startMicros;
      }
    }
    if (start < floor) {
      // snap back to the end of the preceding neighbour if it still fits
      if (floor + clip.durationMicros <= (ceil ?? 1 << 62)) {
        start = floor;
      } else {
        return clip.startMicros; // no room: reject move
      }
    }
    if (ceil != null && start + clip.durationMicros > ceil) {
      final shifted = ceil - clip.durationMicros;
      if (shifted >= floor) {
        start = shifted;
      } else {
        return clip.startMicros;
      }
    }

    if (start == clip.startMicros && targetTrack.id == clip.trackId) {
      return clip.startMicros;
    }

    _commit(
      _replaceClip(clip, clip.copyWith(startMicros: start, trackId: targetTrack.id)),
      'Move clip',
    );
    return start;
  }

  // -- trimming ------------------------------------------------------------

  @override
  int trimClip({
    required String clipId,
    required bool trimStart,
    required int deltaMicros,
  }) {
    final clip = _clip(clipId);
    if (_trackOf(clip.trackId).locked) return 0;
    if (deltaMicros == 0) return 0;

    final applied = trimStart
        ? _trimStart(clip, deltaMicros)
        : _trimEnd(clip, deltaMicros);
    if (applied == 0) return 0;

    final next = trimStart
        ? clip.copyWith(
            startMicros: clip.startMicros + applied,
            durationMicros: clip.durationMicros - applied,
            sourceInMicros: clip.sourceInMicros + applied,
          )
        : clip.copyWith(durationMicros: clip.durationMicros + applied);

    _commit(_replaceClip(clip, next), 'Trim clip');
    return applied;
  }

  int _trimStart(TimelineClip clip, int delta) {
    // delta > 0 shortens from the head (start moves right).
    var d = delta;
    if (d > 0) {
      final maxShrink = clip.durationMicros - _minClipMicros;
      if (maxShrink <= 0) return 0;
      if (d > maxShrink) d = maxShrink;
      // cannot trim past the previous neighbour's end
      final prevEnd = _prevClipEnd(clip);
      if (clip.startMicros + d < prevEnd) {
        d = prevEnd - clip.startMicros;
        if (d <= 0) return 0;
      }
      // source side: cannot go below 0
      if (clip.sourceInMicros + d < 0) d = -clip.sourceInMicros;
      if (d <= 0) return 0;
    } else {
      // delta < 0 extends the head leftwards (restores earlier source)
      if (clip.sourceInMicros + d < 0) d = -clip.sourceInMicros;
      final roomLeft = clip.startMicros - _prevClipEnd(clip);
      if (-d > roomLeft) d = -roomLeft;
      final src = _sourceDurationUs(clip);
      if (src > 0 && clip.sourceOutMicros + d > src) {
        d = src - clip.sourceOutMicros;
      }
      if (d >= 0) return 0;
    }
    return d;
  }

  int _trimEnd(TimelineClip clip, int delta) {
    var d = delta;
    if (d < 0) {
      final maxShrink = clip.durationMicros - _minClipMicros;
      if (maxShrink <= 0) return 0;
      if (-d > maxShrink) d = -maxShrink;
      final nextStart = _nextClipStart(clip);
      if (clip.endMicros + d > nextStart) {
        d = nextStart - clip.endMicros;
        if (d >= 0) return 0;
      }
      if (d == 0) return 0;
    } else {
      // extend rightwards, bounded by neighbour and source length
      final nextStart = _nextClipStart(clip);
      if (clip.endMicros + d > nextStart) d = nextStart - clip.endMicros;
      final src = _sourceDurationUs(clip);
      if (src > 0 && clip.sourceOutMicros + d > src) {
        d = src - clip.sourceOutMicros;
      }
      if (d <= 0) return 0;
    }
    return d;
  }

  int _prevClipEnd(TimelineClip clip) {
    final track = _trackOf(clip.trackId);
    var end = 0;
    for (final c in track.clips) {
      if (c.id == clip.id) continue;
      if (c.endMicros <= clip.startMicros && c.endMicros > end) {
        end = c.endMicros;
      }
    }
    return end;
  }

  int _nextClipStart(TimelineClip clip) {
    final track = _trackOf(clip.trackId);
    var start = 1 << 62;
    for (final c in track.clips) {
      if (c.id == clip.id) continue;
      if (c.startMicros >= clip.endMicros && c.startMicros < start) {
        start = c.startMicros;
      }
    }
    return start;
  }

  // -- split / delete / duplicate -----------------------------------------

  @override
  Future<List<String>> splitAt(int atMicros, {String? clipId}) async {
    if (atMicros <= 0) return const [];
    final targets = clipId != null
        ? [for (final c in _doc.allClips) if (c.id == clipId) c]
        : (_selected.isEmpty
            ? _doc.allClips
                .where((c) =>
                    c.startMicros < atMicros && c.endMicros > atMicros)
                .toList()
            : _selected
                .map((id) => _doc.clipById(id))
                .whereType<TimelineClip>()
                .where((c) =>
                    c.startMicros < atMicros && c.endMicros > atMicros)
                .toList());

    if (targets.isEmpty) return const [];
    if (targets.any((c) => _trackOf(c.trackId).locked)) {
      return const [];
    }

    var next = _doc;
    final created = <String>[];
    var seq = 0;
    for (final clip in targets) {
      if (atMicros <= clip.startMicros || atMicros >= clip.endMicros) continue;
      final cut = atMicros - clip.startMicros;
      final left = clip.copyWith(durationMicros: cut);
      final right = clip.copyWith(
        id: '${clip.id}-split${DateTime.now().microsecondsSinceEpoch}-$seq',
        trackId: clip.trackId,
        startMicros: atMicros,
        durationMicros: clip.durationMicros - cut,
        sourceInMicros: clip.sourceInMicros + cut,
      );
      seq++;
      next = _withClipReplaced(next, clip, [left, right]);
      created.add(right.id);
    }
    if (identical(next, _doc)) return const [];
    _commit(next, 'Split clip');
    _selected = {..._selected, ...created};
    _notify();
    return created;
  }

  @override
  Future<void> deleteSelection() async {
    if (_selected.isEmpty) return;
    final doomed = <String>{};
    for (final id in _selected) {
      final clip = _doc.clipById(id);
      if (clip != null && !_trackOf(clip.trackId).locked) doomed.add(id);
    }
    if (doomed.isEmpty) return;
    var next = _doc;
    for (final id in doomed) {
      final clip = _doc.clipById(id);
      if (clip != null) next = _withClipReplaced(next, clip, const []);
    }
    _commit(next, 'Delete clip');
    _selected = {};
    _notify();
  }

  @override
  Future<List<String>> duplicateSelection() async {
    if (_selected.isEmpty) return const [];
    final clips = _selected
        .map((id) => _doc.clipById(id))
        .whereType<TimelineClip>()
        .where((c) => !_trackOf(c.trackId).locked)
        .toList();
    if (clips.isEmpty) return const [];

    var next = _doc;
    final created = <String>[];
    final ts = DateTime.now().microsecondsSinceEpoch;
    var seq = 0;
    for (final clip in clips) {
      final track = _trackOf(clip.trackId);
      var start = clip.endMicros;
      // find the first free slot after the original that fits
      var fits = false;
      while (!fits) {
        fits = true;
        for (final o in track.clips) {
          if (start < o.endMicros && start + clip.durationMicros > o.startMicros) {
            start = o.endMicros;
            fits = false;
          }
        }
      }
      final copy = clip.copyWith(
        id: '${clip.id}-dup$ts-${seq++}',
        startMicros: start,
      );
      next = _replaceTrackClips(next, track, [...track.clips, copy]);
      created.add(copy.id);
    }
    _commit(next, 'Duplicate clip');
    _selected = {...created};
    _notify();
    return created;
  }

  @override
  Future<bool> replaceAsset({
    required String clipId,
    required String assetId,
  }) async {
    final clip = _clip(clipId);
    final incoming = assetOf?.call(assetId);
    if (incoming == null) return false;
    if (incoming.kind != clip.kind) return false;
    final label = incoming.displayName;
    _commit(
      _replaceClip(
        clip,
        clip.copyWith(assetId: assetId, label: label),
      ),
      'Replace media',
    );
    return true;
  }

  // -- tracks --------------------------------------------------------------

  @override
  Future<String> addTrack(TrackKind kind, {String? name}) async {
    final ts = DateTime.now().microsecondsSinceEpoch;
    final id = 'track-$ts';
    final track = TimelineTrack(
      id: id,
      kind: kind,
      name: name ?? _defaultTrackName(kind, _doc.tracks.where((t) => t.kind == kind).length),
    );
    final next = _doc.copyWith(tracks: [..._doc.tracks, track]);
    _commit(next, 'Add track');
    return id;
  }

  @override
  Future<void> removeTrack(String trackId) async {
    if (_doc.tracks.length <= 1) return;
    _commit(
      _doc.copyWith(tracks: _doc.tracks.where((t) => t.id != trackId).toList()),
      'Remove track',
    );
  }

  @override
  Future<void> setTrackFlags(
    String trackId, {
    bool? locked,
    bool? muted,
    bool? hidden,
  }) async {
    _commit(
      _withTrack(_doc, (t) =>
          t.id == trackId ? t.copyWith(locked: locked, muted: muted, hidden: hidden) : t),
      'Track settings',
    );
  }

  @override
  Future<void> renameTrack(String trackId, String name) async {
    _commit(
      _withTrack(_doc, (t) => t.id == trackId ? t.copyWith(name: name) : t),
      'Rename track',
    );
  }

  @override
  Future<void> reorderTracks(List<String> orderedTrackIds) async {
    final byId = {for (final t in _doc.tracks) t.id: t};
    final ordered = [
      for (final id in orderedTrackIds)
        if (byId.containsKey(id)) byId.remove(id)!,
      ...byId.values,
    ];
    if (ordered.length != _doc.tracks.length) return;
    _commit(_doc.copyWith(tracks: ordered), 'Reorder tracks');
  }

  static String _defaultTrackName(TrackKind kind, int index) {
    final suffix = index == 0 ? '' : ' ${index + 1}';
    return switch (kind) {
      TrackKind.video => 'Video$suffix',
      TrackKind.overlay => 'Overlay$suffix',
      TrackKind.text => 'Text$suffix',
      TrackKind.audio => 'Audio$suffix',
    };
  }

  // -- properties ----------------------------------------------------------

  @override
  Future<void> updateClip(
    String clipId,
    TimelineClip Function(TimelineClip current) patch, {
    required String label,
  }) async {
    final clip = _clip(clipId);
    _commit(_replaceClip(clip, patch(clip)), label);
  }

  @override
  Future<void> updateSelected(
    TimelineClip Function(TimelineClip current) patch, {
    required String label,
  }) async {
    if (_selected.isEmpty) return;
    var next = _doc;
    for (final id in _selected) {
      final clip = next.clipById(id);
      if (clip == null) continue;
      if (_trackOf(clip.trackId).locked) continue;
      next = _withClipReplaced(next, clip, [patch(clip)]);
    }
    if (identical(next, _doc)) return;
    _commit(next, label);
  }

  // -- construction helpers ------------------------------------------------

  @override
  Future<String> addTextClip({
    required String content,
    required int startMicros,
    required int durationMicros,
    bool isCaption = false,
  }) async {
    var next = _doc;
    var track = next.tracks.where((t) => t.kind == TrackKind.text).firstOrNull;
    if (track == null) {
      final id = 'track-${DateTime.now().microsecondsSinceEpoch}';
      track = TimelineTrack(
        id: id,
        kind: TrackKind.text,
        name: 'Text',
      );
      next = next.copyWith(tracks: [...next.tracks, track]);
    }
    if (track.locked) return '';
    final clip = TimelineClip(
      id: 'clip-${DateTime.now().microsecondsSinceEpoch}',
      trackId: track.id,
      kind: MediaKind.text,
      label: content.isEmpty ? 'Text' : _truncate(content, 24),
      startMicros: startMicros < 0 ? 0 : startMicros,
      durationMicros: durationMicros < _minClipMicros
          ? _minClipMicros
          : durationMicros,
      sourceInMicros: 0,
      text: TextProps(content: content, isCaption: isCaption),
      thumbColor: 0xFF8A5CD6,
    );
    next = _withClipAdded(next, clip);
    _commit(next, isCaption ? 'Add caption' : 'Add text');
    _selected = {clip.id};
    _notify();
    return clip.id;
  }

  @override
  Future<String?> placeAsset({
    required String assetId,
    required int startMicros,
    String? trackId,
  }) async {
    final asset = assetOf?.call(assetId);
    if (asset == null) return null;

    final compatible = trackId != null
        ? [_trackOf(trackId)]
        : _tracksFor(asset.kind);
    if (compatible.isEmpty) {
      // create a track of the right kind
      final kind = switch (asset.kind) {
        MediaKind.audio => TrackKind.audio,
        MediaKind.text => TrackKind.text,
        MediaKind.image || MediaKind.video => TrackKind.video,
        MediaKind.other => TrackKind.video,
      };
      final id = await addTrack(kind);
      compatible.add(_trackOf(id));
    }

    final duration = asset.durationMicros ??
        switch (asset.kind) {
          MediaKind.image => 5 * 1000000,
          MediaKind.video => 10 * 1000000,
          MediaKind.audio => 30 * 1000000,
          _ => 5 * 1000000,
        };

    // pick first track with free space at the requested start
    for (final track in compatible) {
      if (track.locked) continue;
      final overlaps = track.clips.any((c) =>
          startMicros < c.endMicros && startMicros + duration > c.startMicros);
      if (overlaps) continue;
      final clip = TimelineClip(
        id: 'clip-${DateTime.now().microsecondsSinceEpoch}',
        trackId: track.id,
        kind: asset.kind,
        assetId: asset.id,
        label: asset.displayName,
        startMicros: startMicros < 0 ? 0 : startMicros,
        durationMicros: duration,
        sourceInMicros: 0,
        thumbColor: switch (asset.kind) {
          MediaKind.audio => 0xFF2F7D5B,
          MediaKind.image => 0xFFB0762F,
          _ => 0xFF3E6C8F,
        },
      );
      _commit(_withClipAdded(_doc, clip), 'Add clip');
      _selected = {clip.id};
      _notify();
      return clip.id;
    }
    return null;
  }

  // -- snapping ------------------------------------------------------------

  @override
  int resolveSnap({
    required int proposedStartMicros,
    required Set<String> movingClipIds,
    required double thresholdMicros,
    int? playheadMicros,
  }) {
    if (thresholdMicros <= 0) return proposedStartMicros;
    final moving = <TimelineClip>[];
    for (final id in movingClipIds) {
      final c = _doc.clipById(id);
      if (c != null) moving.add(c);
    }
    if (moving.isEmpty) return proposedStartMicros;

    var start = proposedStartMicros < 0 ? 0 : proposedStartMicros;

    final candidates = <int>{0};
    if (playheadMicros != null && playheadMicros >= 0) {
      candidates.add(playheadMicros);
    }
    for (final t in _doc.tracks) {
      for (final c in t.clips) {
        if (movingClipIds.contains(c.id)) continue;
        candidates.add(c.startMicros);
        candidates.add(c.endMicros);
      }
    }

    // Evaluate snapping each moving clip's head/tail edge (relative to the
    // group's leading edge) and keep the closest candidate within threshold.
    final groupHead = moving.fold<int>(
        1 << 62, (acc, c) => c.startMicros < acc ? c.startMicros : acc);
    var bestOffset = thresholdMicros;
    var snapped = start;
    for (final movingClip in moving) {
      final offsetInGroup = movingClip.startMicros - groupHead;
      for (final edgeOffset in [
        offsetInGroup,
        offsetInGroup + movingClip.durationMicros,
      ]) {
        final edge = start + edgeOffset;
        for (final cand in candidates) {
          final delta = (cand - edge).abs();
          if (delta < bestOffset) {
            bestOffset = delta;
            snapped = cand - offsetInGroup;
          }
        }
      }
    }
    if (snapped < 0) snapped = 0;
    return snapped;
  }

  @override
  double get microsPerPixel => _microsPerPixel;

  @override
  void setZoom(double microsPerPixel) {
    final clamped = microsPerPixel.clamp(1000000 / 600, 1000000 / 4);
    if (clamped == _microsPerPixel) return;
    _microsPerPixel = clamped;
    _notify();
  }

  // -- document surgery ----------------------------------------------------

  TimelineDocument _replaceClip(
    TimelineClip old,
    TimelineClip replacement,
  ) =>
      _withClipReplaced(_doc, old, [replacement]);

  TimelineDocument _withClipReplaced(
    TimelineDocument doc,
    TimelineClip old,
    List<TimelineClip> replacements,
  ) {
    return _withTrack(doc, (t) {
      if (t.id != old.trackId) return t;
      final next = <TimelineClip>[];
      for (final c in t.clips) {
        if (c.id == old.id) {
          next.addAll(replacements);
        } else {
          next.add(c);
        }
      }
      next.sort((a, b) => a.startMicros.compareTo(b.startMicros));
      return t.copyWith(clips: next);
    });
  }

  TimelineDocument _withClipAdded(TimelineDocument doc, TimelineClip clip) {
    return _withTrack(doc, (t) {
      if (t.id != clip.trackId) return t;
      final next = [...t.clips, clip]
        ..sort((a, b) => a.startMicros.compareTo(b.startMicros));
      return t.copyWith(clips: next);
    });
  }

  TimelineDocument _withTrack(
    TimelineDocument doc,
    TimelineTrack Function(TimelineTrack) map,
  ) {
    var changed = false;
    final tracks = <TimelineTrack>[];
    for (final t in doc.tracks) {
      final mapped = map(t);
      if (!identical(mapped, t)) changed = true;
      tracks.add(mapped);
    }
    if (!changed) return doc;
    return doc.copyWith(tracks: tracks);
  }

  TimelineDocument _replaceTrackClips(
    TimelineDocument doc,
    TimelineTrack track,
    List<TimelineClip> clips,
  ) =>
      _withTrack(doc, (t) => t.id == track.id ? t.copyWith(clips: clips) : t);

  static String _truncate(String s, int n) =>
      s.length <= n ? s : '${s.substring(0, n - 1)}…';

  void dispose() {
    _changes.dispose();
    _outer.dispose();
  }
}

class _HistoryEntry {
  const _HistoryEntry(this.label, this.before, this.after);
  final String label;
  final TimelineDocument before;
  final TimelineDocument after;
}
