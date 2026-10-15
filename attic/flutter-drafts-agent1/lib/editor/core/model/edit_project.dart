import 'media_asset.dart';
import 'project_settings.dart';
import 'track.dart';
import 'types.dart';
import 'clip.dart';

/// The root of a persisted edit: settings, media library and tracks.
///
/// Immutable. Every edit produces a new root with `revision` incremented;
/// undo/redo is a pointer swap between roots (docs/PROJECT_CONTRACT.md §6).
class EditProject {
  EditProject({
    this.formatVersion = 1,
    required this.id,
    required this.name,
    required this.createdAt,
    required this.updatedAt,
    ProjectSettings? settings,
    List<MediaAsset>? assets,
    List<Track>? tracks,
    this.revision = 0,
  })  : settings = settings ?? const ProjectSettings(),
        assets = List.unmodifiable(assets ?? const <MediaAsset>[]),
        tracks = List.unmodifiable(tracks ?? const <Track>[]);

  /// Serialization format version; see ProjectSerializer.
  final int formatVersion;

  final String id;
  final String name;
  final int createdAt; // epoch ms
  final int updatedAt; // epoch ms
  final ProjectSettings settings;
  final List<MediaAsset> assets;
  final List<Track> tracks;
  final int revision;

  // ---------------------------------------------------------------- lookups

  Track? findTrack(String trackId) {
    for (final t in tracks) {
      if (t.id == trackId) return t;
    }
    return null;
  }

  MediaAsset? findAsset(String assetId) {
    for (final a in assets) {
      if (a.id == assetId) return a;
    }
    return null;
  }

  Clip? findClip(String clipId) => findClipWithTrack(clipId)?.$2;

  /// The track containing [clipId], plus the clip itself.
  (Track, Clip)? findClipWithTrack(String clipId) {
    for (final t in tracks) {
      for (final c in t.clips) {
        if (c.id == clipId) return (t, c);
      }
    }
    return null;
  }

  int clipCount() => tracks.fold(0, (sum, t) => sum + t.clips.length);

  /// Longest extent of any track — the current project duration.
  int get durationUs =>
      tracks.isEmpty ? 0 : tracks.map((t) => t.endUs).reduce((a, b) => a > b ? a : b);

  Iterable<Clip> clipsForAsset(String assetId)* sync* {
    for (final t in tracks) {
      for (final c in t.clips) {
        if (c.assetId == assetId) yield c;
      }
    }
  }

  // --------------------------------------------------------------- mutation

  EditProject copyWith({
    Object? name = unsetParamName,
    Object? updatedAt = unsetParamName,
    Object? settings = unsetParamName,
    Object? assets = unsetParamName,
    Object? tracks = unsetParamName,
    Object? revision = unsetParamName,
  }) {
    T pick<T>(Object? v, T current) =>
        identical(v, unsetParamName) ? current : v as T;
    return EditProject(
      formatVersion: formatVersion,
      id: id,
      name: pick(name, this.name) as String,
      createdAt: createdAt,
      updatedAt: pick(updatedAt, this.updatedAt) as int,
      settings: pick(settings, this.settings) as ProjectSettings,
      assets: pick(assets, this.assets) as List<MediaAsset>,
      tracks: pick(tracks, this.tracks) as List<Track>,
      revision: pick(revision, this.revision) as int,
    );
  }

  /// New root for an accepted edit: bumps [revision] and stamps [updatedAt].
  EditProject bump() => copyWith(
        updatedAt: DateTime.now().millisecondsSinceEpoch,
        revision: revision + 1,
      );

  Map<String, dynamic> toJson() => {
        'formatVersion': formatVersion,
        'id': id,
        'name': name,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
        'settings': settings.toJson(),
        'revision': revision,
        'assets': [for (final a in assets) a.toJson()],
        'tracks': [for (final t in tracks) t.toJson()],
      };

  factory EditProject.fromJson(Map<String, dynamic> json) {
    return EditProject(
      formatVersion: (json['formatVersion'] as num?)?.toInt() ?? 0,
      id: json['id'] as String,
      name: json['name'] as String? ?? 'Untitled',
      createdAt: (json['createdAt'] as num?)?.toInt() ?? 0,
      updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
      settings: json['settings'] is Map<String, dynamic>
          ? ProjectSettings.fromJson(json['settings'] as Map<String, dynamic>)
          : const ProjectSettings(),
      revision: (json['revision'] as num?)?.toInt() ?? 0,
      assets: [
        for (final a in json['assets'] as List? ?? const [])
          MediaAsset.fromJson(Map<String, dynamic>.from(a as Map)),
      ],
      tracks: [
        for (final t in json['tracks'] as List? ?? const [])
          Track.fromJson(Map<String, dynamic>.from(t as Map)),
      ],
    );
  }
}

/// Local sentinel for EditProject.copyWith (kept private to this file).
const Object unsetParamName = Object();

/// Track-kind ↔ clip-kind compatibility, per contract §5.5.
bool trackAcceptsClipKind(TrackKind trackKind, ClipKind clipKind) {
  switch (trackKind) {
    case TrackKind.video:
      return clipKind == ClipKind.video || clipKind == ClipKind.image;
    case TrackKind.audio:
      return clipKind == ClipKind.audio;
    case TrackKind.text:
      return clipKind == ClipKind.text;
  }
}

/// Default human name for a new track, e.g. "Video 2".
String defaultTrackName(TrackKind kind, int existingCountOfSameKind) {
  final label = switch (kind) {
    TrackKind.video => 'Video',
    TrackKind.audio => 'Audio',
    TrackKind.text => 'Text',
  };
  return '$label ${existingCountOfSameKind + 1}';
}
