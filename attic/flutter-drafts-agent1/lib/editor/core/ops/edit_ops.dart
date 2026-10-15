import '../model/clip.dart';
import '../model/edit_project.dart';
import '../model/ids.dart';
import '../model/keyframe.dart';
import '../model/media_asset.dart';
import '../model/track.dart';
import '../model/types.dart';
import 'op_result.dart';

/// Pure edit operations on an [EditProject].
///
/// Every op returns [OpSuccess] with a **new** project root (structural
/// sharing, `revision` bumped) or an [OpFailure] with a machine-readable code.
/// Ops never mutate and never throw for user-logic errors.
/// See docs/PROJECT_CONTRACT.md §6.
class EditOps {
  EditOps._();

  static const int minClipDurationUs = 1000; // 1 ms

  // ---------------------------------------------------------------- tracks

  static OpResult addTrack(
    EditProject p, {
    required TrackKind kind,
    String? name,
    int? index,
  }) {
    final sameKind = p.tracks.where((t) => t.kind == kind).length;
    final track = Track(
      id: newTrackId(),
      kind: kind,
      name: name ?? defaultTrackName(kind, sameKind),
    );
    final tracks = List<Track>.from(p.tracks);
    final at = index == null ? tracks.length : (index < 0 ? 0 : index > tracks.length ? tracks.length : index);
    tracks.insert(at, track);
    return OpSuccess(p.copyWith(tracks: tracks).bump(), ChangeKind.structure);
  }

  static OpResult removeTrack(EditProject p, String trackId) {
    final tracks = List<Track>.from(p.tracks);
    final i = tracks.indexWhere((t) => t.id == trackId);
    if (i < 0) {
      return OpFailure(OpErrorCode.trackNotFound, 'Track $trackId not found');
    }
    tracks.removeAt(i);
    return OpSuccess(p.copyWith(tracks: tracks).bump(), ChangeKind.structure);
  }

  static OpResult renameTrack(EditProject p, String trackId, String name) =>
      _updateTrack(p, trackId, (t) => t.copyWith(name: name),
          change: ChangeKind.structure);

  static OpResult setTrackFlags(
    EditProject p,
    String trackId, {
    bool? locked,
    bool? muted,
    bool? hidden,
  }) =>
      _updateTrack(
        p,
        trackId,
        (t) => t.copyWith(
          locked: locked ?? t.locked,
          muted: muted ?? t.muted,
          hidden: hidden ?? t.hidden,
        ),
        change: ChangeKind.structure,
      );

  // ---------------------------------------------------------------- assets

  static OpResult addAsset(EditProject p, MediaAsset asset) {
    if (p.findAsset(asset.id) != null) {
      return OpFailure(
          OpErrorCode.invalidRange, 'Asset ${asset.id} already exists');
    }
    final assets = List<MediaAsset>.from(p.assets)..add(asset);
    return OpSuccess(p.copyWith(assets: assets).bump(), ChangeKind.assets);
  }

  /// Removes the asset and every clip that references it.
  static OpResult removeAsset(EditProject p, String assetId) {
    if (p.findAsset(assetId) == null) {
      return OpFailure(
          OpErrorCode.assetNotFound, 'Asset $assetId not found');
    }
    final assets = List<MediaAsset>.from(p.assets)
      ..removeWhere((a) => a.id == assetId);
    final tracks = [
      for (final t in p.tracks)
        t.clips.any((c) => c.assetId == assetId)
            ? t.copyWith(
                clips: t.clips.where((c) => c.assetId != assetId).toList())
            : t,
    ];
    return OpSuccess(
        p.copyWith(assets: assets, tracks: tracks).bump(), ChangeKind.assets);
  }

  /// Replaces an asset record in place (used by relink).
  static OpResult updateAsset(EditProject p, MediaAsset asset) {
    final i = p.assets.indexWhere((a) => a.id == asset.id);
    if (i < 0) {
      return OpFailure(OpErrorCode.assetNotFound, 'Asset ${asset.id} not found');
    }
    final assets = List<MediaAsset>.from(p.assets)..[i] = asset;
    return OpSuccess(p.copyWith(assets: assets).bump(), ChangeKind.assets);
  }

  // ------------------------------------------------------------------ clips

  /// Places [clip] on [trackId]. The clip must already carry a timeline
  /// position, duration and (for media) an assetId.
  static OpResult placeClip(
    EditProject p, {
    required String trackId,
    required Clip clip,
  }) {
    final track = _requireTrack(p, trackId);
    if (track == null) return _noTrack(trackId);
    final gate = _gateClip(p, track, clip);
    if (gate != null) return gate;
    if (track.overlaps(clip.timelineStartUs, clip.timelineEndUs)) {
      return const OpFailure(
          OpErrorCode.overlap, 'Clips on a track may not overlap');
    }
    final newClips = _insertSorted(track.clips, clip);
    return _replaceTrack(p, trackId, (t) => t.copyWith(clips: newClips));
  }

  /// Removes a clip from its track.
  static OpResult removeClip(EditProject p, String clipId) {
    final found = p.findClipWithTrack(clipId);
    if (found == null) {
      return OpFailure(OpErrorCode.clipNotFound, 'Clip $clipId not found');
    }
    final (track, _) = found;
    if (track.locked) return _locked(track);
    final newClips =
        track.clips.where((c) => c.id != clipId).toList(growable: false);
    return _replaceTrack(p, track.id, (t) => t.copyWith(clips: newClips));
  }

  /// Moves a clip to [toStartUs] on [toTrackId] (defaults to its own track).
  static OpResult moveClip(
    EditProject p, {
    required String clipId,
    required int toStartUs,
    String? toTrackId,
  }) {
    final found = p.findClipWithTrack(clipId);
    if (found == null) {
      return OpFailure(OpErrorCode.clipNotFound, 'Clip $clipId not found');
    }
    final (sourceTrack, clip) = found;
    if (sourceTrack.locked) return _locked(sourceTrack);
    final targetId = toTrackId ?? sourceTrack.id;
    final targetTrack = _requireTrack(p, targetId);
    if (targetTrack == null) return _noTrack(targetId);
    if (targetTrack.locked) return _locked(targetTrack);
    if (!trackAcceptsClipKind(targetTrack.kind, clip.kind)) {
      return OpFailure(OpErrorCode.incompatibleTrack,
          '${targetTrack.kind.name} track cannot hold ${clip.kind.name} clips');
    }
    if (toStartUs < 0) {
      return const OpFailure(
          OpErrorCode.outOfBounds, 'Timeline position cannot be negative');
    }
    final moved = clip.copyWith(timelineStartUs: toStartUs);
    if (targetTrack.overlaps(
        moved.timelineStartUs, moved.timelineEndUs,
        ignoreClipId: clipId)) {
      return const OpFailure(
          OpErrorCode.overlap, 'Clips on a track may not overlap');
    }
    return _replaceClipPair(
      p,
      sourceTrack.id,
      targetTrack.id,
      removeClipId: clipId,
      insert: moved,
    );
  }

  /// Trims the clip's head to [newStartUs] (must stay strictly inside the
  /// current range). Source in-point advances by the trimmed span × speed.
  static OpResult trimClipStart(EditProject p,
      {required String clipId, required int newStartUs}) {
    final found = p.findClipWithTrack(clipId);
    if (found == null) {
      return OpFailure(OpErrorCode.clipNotFound, 'Clip $clipId not found');
    }
    final (track, clip) = found;
    if (track.locked) return _locked(track);
    if (newStartUs <= clip.timelineStartUs ||
        newStartUs > clip.timelineEndUs - minClipDurationUs) {
      return OpFailure(OpErrorCode.invalidRange,
          'New start must be inside the clip and leave ${minClipDurationUs}us');
    }
    final deltaUs = newStartUs - clip.timelineStartUs;
    final sourceIn = clip.sourceInUs + (deltaUs * clip.speed).round();
    final trimmed = clip.copyWith(
      timelineStartUs: newStartUs,
      sourceInUs: sourceIn,
      durationUs: clip.durationUs - deltaUs,
    );
    final asset = clip.assetId == null ? null : p.findAsset(clip.assetId!);
    final bound = _checkSourceBounds(asset, trimmed);
    if (bound != null) return bound;
    return _replaceClip(p, track.id, trimmed);
  }

  /// Trims the clip's tail to [newEndUs] (must stay strictly inside the
  /// current range).
  static OpResult trimClipEnd(EditProject p,
      {required String clipId, required int newEndUs}) {
    final found = p.findClipWithTrack(clipId);
    if (found == null) {
      return OpFailure(OpErrorCode.clipNotFound, 'Clip $clipId not found');
    }
    final (track, clip) = found;
    if (track.locked) return _locked(track);
    if (newEndUs >= clip.timelineEndUs || newEndUs <= clip.timelineStartUs) {
      return OpFailure(OpErrorCode.invalidRange,
          'New end must be inside the clip and leave ${minClipDurationUs}us');
    }
    final trimmed =
        clip.copyWith(durationUs: newEndUs - clip.timelineStartUs);
    final asset = clip.assetId == null ? null : p.findAsset(clip.assetId!);
    final bound = _checkSourceBounds(asset, trimmed);
    if (bound != null) return bound;
    return _replaceClip(p, track.id, trimmed);
  }

  /// Splits [clipId] at [atUs] (timeline-absolute, strictly inside the clip).
  /// Left keeps transition-in; right keeps transition-out; keyframes are
  /// partitioned and re-based on the right half.
  static OpResult splitClipAt(EditProject p,
      {required String clipId, required int atUs}) {
    final found = p.findClipWithTrack(clipId);
    if (found == null) {
      return OpFailure(OpErrorCode.clipNotFound, 'Clip $clipId not found');
    }
    final (track, clip) = found;
    if (track.locked) return _locked(track);
    if (atUs <= clip.timelineStartUs || atUs >= clip.timelineEndUs) {
      return const OpFailure(OpErrorCode.invalidRange,
          'Split point must be strictly inside the clip');
    }
    final leftDur = atUs - clip.timelineStartUs;
    final rightDur = clip.durationUs - leftDur;
    final left = clip.copyWith(
      durationUs: leftDur,
      fadeOutUs: 0,
      transitionOut: null,
      keyframes:
          clip.keyframes.where((k) => k.atUs < leftDur).toList(growable: false),
    );
    final right = Clip(
      id: newClipId(),
      kind: clip.kind,
      assetId: clip.assetId,
      label: clip.label,
      timelineStartUs: atUs,
      sourceInUs: clip.sourceInUs + (leftDur * clip.speed).round(),
      durationUs: rightDur,
      speed: clip.speed,
      volume: clip.volume,
      opacity: clip.opacity,
      transform: clip.transform,
      text: clip.text,
      fadeInUs: 0,
      fadeOutUs: clip.fadeOutUs,
      transitionIn: null,
      transitionOut: clip.transitionOut,
      keyframes: [
        for (final k in clip.keyframes)
          if (k.atUs >= leftDur)
            Keyframe(
              property: k.property,
              atUs: k.atUs - leftDur,
              value: k.value,
              easing: k.easing,
            ),
      ],
    );
    final newClips = _insertSorted(
      _insertSorted(
        track.clips.where((c) => c.id != clipId).toList(growable: false),
        left,
      ),
      right,
    );
    return _replaceTrack(p, track.id, (t) => t.copyWith(clips: newClips));
  }

  /// Duplicates a clip next to itself (or at [insertAtUs] / on another track).
  static OpResult duplicateClip(
    EditProject p, {
    required String clipId,
    int? insertAtUs,
    String? toTrackId,
  }) {
    final found = p.findClipWithTrack(clipId);
    if (found == null) {
      return OpFailure(OpErrorCode.clipNotFound, 'Clip $clipId not found');
    }
    final (sourceTrack, clip) = found;
    if (sourceTrack.locked) return _locked(sourceTrack);
    final targetId = toTrackId ?? sourceTrack.id;
    final targetTrack = _requireTrack(p, targetId);
    if (targetTrack == null) return _noTrack(targetId);
    if (targetTrack.locked) return _locked(targetTrack);
    final start = insertAtUs ?? clip.timelineEndUs;
    final copy = Clip(
      id: newClipId(),
      kind: clip.kind,
      assetId: clip.assetId,
      label: clip.label,
      timelineStartUs: start,
      sourceInUs: clip.sourceInUs,
      durationUs: clip.durationUs,
      speed: clip.speed,
      volume: clip.volume,
      opacity: clip.opacity,
      transform: clip.transform,
      text: clip.text,
      fadeInUs: clip.fadeInUs,
      fadeOutUs: clip.fadeOutUs,
      transitionIn: clip.transitionIn,
      transitionOut: clip.transitionOut,
      keyframes: clip.keyframes,
    );
    final gate = _gateClip(p, targetTrack, copy);
    if (gate != null) return gate;
    if (targetTrack.overlaps(copy.timelineStartUs, copy.timelineEndUs,
        ignoreClipId: clipId)) {
      return const OpFailure(
          OpErrorCode.overlap, 'Clips on a track may not overlap');
    }
    return _replaceTrack(
        p, targetId, (t) => t.copyWith(clips: _insertSorted(t.clips, copy)));
  }

  /// Points a media clip at a different asset of the same kind, clamping the
  /// visible span to the new asset's duration when known.
  static OpResult replaceClipAsset(EditProject p,
      {required String clipId, required String newAssetId}) {
    final found = p.findClipWithTrack(clipId);
    if (found == null) {
      return OpFailure(OpErrorCode.clipNotFound, 'Clip $clipId not found');
    }
    final (track, clip) = found;
    if (track.locked) return _locked(track);
    if (clip.kind == ClipKind.text) {
      return const OpFailure(OpErrorCode.incompatibleAsset,
          'Text clips have no asset to replace');
    }
    final newAsset = p.findAsset(newAssetId);
    if (newAsset == null) {
      return OpFailure(
          OpErrorCode.assetNotFound, 'Asset $newAssetId not found');
    }
    if (!_assetMatchesClipKind(newAsset, clip.kind)) {
      return OpFailure(OpErrorCode.incompatibleAsset,
          'Asset is ${newAsset.kind.name}, clip is ${clip.kind.name}');
    }
    var replaced = clip.copyWith(assetId: newAssetId, sourceInUs: 0);
    if (newAsset.hasKnownDuration) {
      final maxDur =
          (newAsset.durationUs! / replaced.speed).floor();
      if (maxDur < minClipDurationUs) {
        return const OpFailure(OpErrorCode.invalidRange,
            'New asset is too short for this clip');
      }
      if (replaced.durationUs > maxDur) {
        replaced = replaced.copyWith(durationUs: maxDur);
      }
    }
    return _replaceClip(p, track.id, replaced);
  }

  /// Generic clip property update. The transform callback receives the clip
  /// and returns the modified copy; the result is re-validated.
  static OpResult updateClip(EditProject p,
      {required String clipId, required Clip Function(Clip) transform}) {
    final found = p.findClipWithTrack(clipId);
    if (found == null) {
      return OpFailure(OpErrorCode.clipNotFound, 'Clip $clipId not found');
    }
    final (track, clip) = found;
    if (track.locked) return _locked(track);
    final updated = transform(clip).copyWith(id: clip.id);
    if (updated.durationUs < minClipDurationUs) {
      return OpFailure(OpErrorCode.invalidRange,
          'Clip duration must be at least ${minClipDurationUs}us');
    }
    if (updated.timelineStartUs < 0) {
      return const OpFailure(
          OpErrorCode.outOfBounds, 'Timeline position cannot be negative');
    }
    if (track.overlaps(updated.timelineStartUs, updated.timelineEndUs,
        ignoreClipId: clipId)) {
      return const OpFailure(
          OpErrorCode.overlap, 'Clips on a track may not overlap');
    }
    final asset =
        updated.assetId == null ? null : p.findAsset(updated.assetId!);
    final bound = _checkSourceBounds(asset, updated);
    if (bound != null) return bound;
    return _replaceClip(p, track.id, updated);
  }

  // -------------------------------------------------------------- internals

  static Track? _requireTrack(EditProject p, String trackId) =>
      p.findTrack(trackId);

  static OpFailure _noTrack(String trackId) =>
      OpFailure(OpErrorCode.trackNotFound, 'Track $trackId not found');

  static OpFailure _locked(Track t) =>
      OpFailure(OpErrorCode.trackLocked, 'Track "${t.name}" is locked');

  /// Validation shared by place/duplicate: kind compatibility + asset state.
  static OpFailure? _gateClip(EditProject p, Track track, Clip clip) {
    if (!trackAcceptsClipKind(track.kind, clip.kind)) {
      return OpFailure(OpErrorCode.incompatibleTrack,
          '${track.kind.name} track cannot hold ${clip.kind.name} clips');
    }
    if (clip.durationUs < minClipDurationUs) {
      return OpFailure(OpErrorCode.invalidRange,
          'Clip duration must be at least ${minClipDurationUs}us');
    }
    if (clip.timelineStartUs < 0 || clip.sourceInUs < 0) {
      return const OpFailure(
          OpErrorCode.outOfBounds, 'Positions and in-points cannot be negative');
    }
    if (clip.kind != ClipKind.text) {
      final asset = clip.assetId == null ? null : p.findAsset(clip.assetId!);
      if (asset == null) {
        return OpFailure(OpErrorCode.assetNotFound,
            'Asset ${clip.assetId ?? '(none)'} not found');
      }
      final bound = _checkSourceBounds(asset, clip);
      if (bound != null) return bound;
    }
    return null;
  }

  /// Fails when a clip's source span would run past a known asset duration.
  static OpFailure? _checkSourceBounds(MediaAsset? asset, Clip clip) {
    if (asset == null || !asset.hasKnownDuration) return null;
    if (clip.kind == ClipKind.image) return null;
    if (clip.sourceOutUs > asset.durationUs!) {
      return OpFailure(
        OpErrorCode.invalidRange,
        'Clip reads past the end of "${asset.displayName}" '
        '(${clip.sourceOutUs}us > ${asset.durationUs}us)',
      );
    }
    return null;
  }

  static bool _assetMatchesClipKind(MediaAsset asset, ClipKind clipKind) {
    return switch (clipKind) {
      ClipKind.video => asset.kind == MediaKind.video,
      ClipKind.audio => asset.kind == MediaKind.audio,
      ClipKind.image => asset.kind == MediaKind.image,
      ClipKind.text => false,
    };
  }

  static List<Clip> _insertSorted(List<Clip> clips, Clip clip) {
    final out = List<Clip>.from(clips);
    var i = 0;
    while (i < out.length && out[i].timelineStartUs <= clip.timelineStartUs) {
      i++;
    }
    out.insert(i, clip);
    return out;
  }

  static OpResult _updateTrack(
    EditProject p,
    String trackId,
    Track Function(Track) f, {
    ChangeKind change = ChangeKind.structure,
  }) {
    final track = p.findTrack(trackId);
    if (track == null) return _noTrack(trackId);
    final tracks = List<Track>.from(p.tracks);
    final i = tracks.indexWhere((t) => t.id == trackId);
    tracks[i] = f(track);
    return OpSuccess(p.copyWith(tracks: tracks).bump(), change);
  }

  static OpResult _replaceTrack(
    EditProject p,
    String trackId,
    Track Function(Track) f,
  ) {
    final track = p.findTrack(trackId);
    if (track == null) return _noTrack(trackId);
    final tracks = List<Track>.from(p.tracks);
    final i = tracks.indexWhere((t) => t.id == trackId);
    tracks[i] = f(track);
    return OpSuccess(p.copyWith(tracks: tracks).bump(), ChangeKind.clips);
  }

  static OpResult _replaceClip(EditProject p, String trackId, Clip clip) =>
      _replaceTrack(p, trackId,
          (t) => t.copyWith(clips: _insertSorted(
              t.clips.where((c) => c.id != clip.id).toList(growable: false),
              clip)));

  static OpResult _replaceClipPair(
    EditProject p,
    String sourceTrackId,
    String targetTrackId, {
    required String removeClipId,
    required Clip insert,
  }) {
    if (sourceTrackId == targetTrackId) {
      return _replaceClip(p, targetTrackId, insert);
    }
    final source = p.findTrack(sourceTrackId)!;
    final target = p.findTrack(targetTrackId)!;
    final newSource = source.copyWith(
        clips: source.clips.where((c) => c.id != removeClipId).toList());
    final newTarget =
        target.copyWith(clips: _insertSorted(target.clips, insert));
    final tracks = List<Track>.from(p.tracks);
    tracks[tracks.indexWhere((t) => t.id == sourceTrackId)] = newSource;
    tracks[tracks.indexWhere((t) => t.id == targetTrackId)] = newTarget;
    return OpSuccess(p.copyWith(tracks: tracks).bump(), ChangeKind.clips);
  }
}
