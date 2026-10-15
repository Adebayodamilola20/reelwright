import 'clip.dart';
import 'copy_with.dart';
import 'types.dart';

/// A timeline track. Clips are kept sorted by `timelineStartUs` by all ops.
///
/// Track order in the project: video track index 0 is the bottom-most layer,
/// higher video indices render on top. Audio tracks mix in parallel and their
/// index carries no stacking meaning. See docs/PROJECT_CONTRACT.md §5.4.
class Track {
  Track({
    required this.id,
    required this.kind,
    required this.name,
    this.locked = false,
    this.muted = false,
    this.hidden = false,
    List<Clip>? clips,
  }) : clips = List.unmodifiable(clips ?? const <Clip>[]);

  final String id;
  final TrackKind kind;
  final String name;
  final bool locked;
  final bool muted;
  final bool hidden;
  final List<Clip> clips;

  /// End of the last clip (µs), i.e. the used length of this track.
  int get endUs => clips.isEmpty ? 0 : clips.last.timelineEndUs;

  /// True when [startUs, endUs) intersects any clip except [ignoreClipId].
  bool overlaps(int startUs, int endUs, {String? ignoreClipId}) {
    for (final c in clips) {
      if (c.id == ignoreClipId) continue;
      if (startUs < c.timelineEndUs && endUs > c.timelineStartUs) return true;
    }
    return false;
  }

  Track copyWith({
    Object? id = unsetParam,
    Object? kind = unsetParam,
    Object? name = unsetParam,
    Object? locked = unsetParam,
    Object? muted = unsetParam,
    Object? hidden = unsetParam,
    Object? clips = unsetParam,
  }) {
    T pick<T>(Object? v, T current) =>
        identical(v, unsetParam) ? current : v as T;
    return Track(
      id: pick(id, this.id) as String,
      kind: pick(kind, this.kind) as TrackKind,
      name: pick(name, this.name) as String,
      locked: pick(locked, this.locked) as bool,
      muted: pick(muted, this.muted) as bool,
      hidden: pick(hidden, this.hidden) as bool,
      clips: pick(clips, this.clips) as List<Clip>,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind.name,
        'name': name,
        'locked': locked,
        'muted': muted,
        'hidden': hidden,
        'clips': [for (final c in clips) c.toJson()],
      };

  factory Track.fromJson(Map<String, dynamic> json) => Track(
        id: json['id'] as String,
        kind: EnumJson.fromJsonName(
            TrackKind.values, json['kind'] as String?, TrackKind.video),
        name: json['name'] as String? ?? '',
        locked: json['locked'] as bool? ?? false,
        muted: json['muted'] as bool? ?? false,
        hidden: json['hidden'] as bool? ?? false,
        clips: [
          for (final c in json['clips'] as List? ?? const [])
            Clip.fromJson(Map<String, dynamic>.from(c as Map)),
        ],
      );
}
