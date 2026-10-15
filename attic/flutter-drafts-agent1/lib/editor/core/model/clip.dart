import 'copy_with.dart';
import 'keyframe.dart';
import 'text_spec.dart';
import 'types.dart';

/// A transition attached to a clip edge.
class TransitionSpec {
  const TransitionSpec({
    this.type = TransitionType.dissolve,
    required this.durationUs,
  }) : assert(durationUs > 0);

  final TransitionType type;
  final int durationUs;

  Map<String, dynamic> toJson() =>
      {'type': type.name, 'durationUs': durationUs};

  factory TransitionSpec.fromJson(Map<String, dynamic> json) =>
      TransitionSpec(
        type: EnumJson.fromJsonName(
            TransitionType.values, json['type'] as String?, TransitionType.cut),
        durationUs: (json['durationUs'] as num?)?.toInt() ?? 0,
      );
}

/// Position/size of a clip's content inside the frame.
///
/// [x] and [y] are normalized offsets of the content center from the frame
/// center: −1.0..1.0 spans one full frame width/height. [scale] 1.0 = fits.
class ClipTransform {
  const ClipTransform({
    this.x = 0,
    this.y = 0,
    this.scale = 1.0,
    this.rotationDeg = 0,
    this.flipH = false,
    this.flipV = false,
  });

  final double x;
  final double y;
  final double scale;
  final double rotationDeg;
  final bool flipH;
  final bool flipV;

  ClipTransform copyWith({
    Object? x = unsetParam,
    Object? y = unsetParam,
    Object? scale = unsetParam,
    Object? rotationDeg = unsetParam,
    Object? flipH = unsetParam,
    Object? flipV = unsetParam,
  }) {
    T pick<T>(Object? v, T current) =>
        identical(v, unsetParam) ? current : v as T;
    return ClipTransform(
      x: pick(x, this.x) as double,
      y: pick(y, this.y) as double,
      scale: pick(scale, this.scale) as double,
      rotationDeg: pick(rotationDeg, this.rotationDeg) as double,
      flipH: pick(flipH, this.flipH) as bool,
      flipV: pick(flipV, this.flipV) as bool,
    );
  }

  Map<String, dynamic> toJson() => {
        'x': x,
        'y': y,
        'scale': scale,
        'rotationDeg': rotationDeg,
        'flipH': flipH,
        'flipV': flipV,
      };

  factory ClipTransform.fromJson(Map<String, dynamic> json) {
    double d(Object? v, double fb) => v is num ? v.toDouble() : fb;
    return ClipTransform(
      x: d(json['x'], 0),
      y: d(json['y'], 0),
      scale: d(json['scale'], 1.0),
      rotationDeg: d(json['rotationDeg'], 0),
      flipH: json['flipH'] as bool? ?? false,
      flipV: json['flipV'] as bool? ?? false,
    );
  }
}

/// A clip on a track. Immutable; all edits go through EditOps.
///
/// Timeline occupancy is `[timelineStartUs, timelineStartUs + durationUs)`;
/// source occupancy is `[sourceInUs, sourceInUs + durationUs * speed)`.
/// See docs/PROJECT_CONTRACT.md §5.5.
class Clip {
  Clip({
    required this.id,
    required this.kind,
    this.assetId,
    this.label,
    required this.timelineStartUs,
    this.sourceInUs = 0,
    required this.durationUs,
    this.speed = 1.0,
    this.volume = 1.0,
    this.opacity = 1.0,
    this.transform = const ClipTransform(),
    this.text,
    this.fadeInUs = 0,
    this.fadeOutUs = 0,
    this.transitionIn,
    this.transitionOut,
    List<Keyframe>? keyframes,
  })  : assert(timelineStartUs >= 0),
        assert(sourceInUs >= 0),
        assert(durationUs > 0),
        assert(speed > 0),
        assert(kind != ClipKind.text || text != null,
            'text clips require a TextSpec'),
        assert(kind == ClipKind.text || assetId != null,
            'media clips require an assetId'),
        keyframes = List.unmodifiable(keyframes ?? const <Keyframe>[]);

  final String id;
  final ClipKind kind;
  final String? assetId;
  final String? label;
  final int timelineStartUs;
  final int sourceInUs;
  final int durationUs;
  final double speed;
  final double volume;
  final double opacity;
  final ClipTransform transform;
  final TextSpec? text;
  final int fadeInUs;
  final int fadeOutUs;
  final TransitionSpec? transitionIn;
  final TransitionSpec? transitionOut;
  final List<Keyframe> keyframes;

  int get timelineEndUs => timelineStartUs + durationUs;

  /// Source position (µs) corresponding to the end of the clip.
  int get sourceOutUs => sourceInUs + (durationUs * speed).round();

  String get displayName => label ??
      (kind == ClipKind.text
          ? (text?.text ?? 'Text')
          : 'Clip ${id.substring(0, 6)}');

  Clip copyWith({
    Object? id = unsetParam,
    Object? kind = unsetParam,
    Object? assetId = unsetParam,
    Object? label = unsetParam,
    Object? timelineStartUs = unsetParam,
    Object? sourceInUs = unsetParam,
    Object? durationUs = unsetParam,
    Object? speed = unsetParam,
    Object? volume = unsetParam,
    Object? opacity = unsetParam,
    Object? transform = unsetParam,
    Object? text = unsetParam,
    Object? fadeInUs = unsetParam,
    Object? fadeOutUs = unsetParam,
    Object? transitionIn = unsetParam,
    Object? transitionOut = unsetParam,
    Object? keyframes = unsetParam,
  }) {
    T pick<T>(Object? v, T current) =>
        identical(v, unsetParam) ? current : v as T;
    return Clip(
      id: pick(id, this.id) as String,
      kind: pick(kind, this.kind) as ClipKind,
      assetId: pick(assetId, this.assetId) as String?,
      label: pick(label, this.label) as String?,
      timelineStartUs: pick(timelineStartUs, this.timelineStartUs) as int,
      sourceInUs: pick(sourceInUs, this.sourceInUs) as int,
      durationUs: pick(durationUs, this.durationUs) as int,
      speed: pick(speed, this.speed) as double,
      volume: pick(volume, this.volume) as double,
      opacity: pick(opacity, this.opacity) as double,
      transform: pick(transform, this.transform) as ClipTransform,
      text: pick(text, this.text) as TextSpec?,
      fadeInUs: pick(fadeInUs, this.fadeInUs) as int,
      fadeOutUs: pick(fadeOutUs, this.fadeOutUs) as int,
      transitionIn: pick(transitionIn, this.transitionIn) as TransitionSpec?,
      transitionOut: pick(transitionOut, this.transitionOut) as TransitionSpec?,
      keyframes: pick(keyframes, this.keyframes) as List<Keyframe>,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind.name,
        if (assetId != null) 'assetId': assetId,
        if (label != null) 'label': label,
        'timelineStartUs': timelineStartUs,
        'sourceInUs': sourceInUs,
        'durationUs': durationUs,
        'speed': speed,
        'volume': volume,
        'opacity': opacity,
        'transform': transform.toJson(),
        if (text != null) 'text': text!.toJson(),
        'fadeInUs': fadeInUs,
        'fadeOutUs': fadeOutUs,
        if (transitionIn != null) 'transitionIn': transitionIn!.toJson(),
        if (transitionOut != null) 'transitionOut': transitionOut!.toJson(),
        'keyframes': [for (final k in keyframes) k.toJson()],
      };

  factory Clip.fromJson(Map<String, dynamic> json) {
    double d(Object? v, double fb) => v is num ? v.toDouble() : fb;
    return Clip(
      id: json['id'] as String,
      kind: EnumJson.fromJsonName(
          ClipKind.values, json['kind'] as String?, ClipKind.video),
      assetId: json['assetId'] as String?,
      label: json['label'] as String?,
      timelineStartUs: (json['timelineStartUs'] as num?)?.toInt() ?? 0,
      sourceInUs: (json['sourceInUs'] as num?)?.toInt() ?? 0,
      durationUs: (json['durationUs'] as num?)?.toInt() ?? 0,
      speed: d(json['speed'], 1.0),
      volume: d(json['volume'], 1.0),
      opacity: d(json['opacity'], 1.0),
      transform: json['transform'] is Map<String, dynamic>
          ? ClipTransform.fromJson(json['transform'] as Map<String, dynamic>)
          : const ClipTransform(),
      text: json['text'] is Map<String, dynamic>
          ? TextSpec.fromJson(json['text'] as Map<String, dynamic>)
          : null,
      fadeInUs: (json['fadeInUs'] as num?)?.toInt() ?? 0,
      fadeOutUs: (json['fadeOutUs'] as num?)?.toInt() ?? 0,
      transitionIn: json['transitionIn'] is Map<String, dynamic>
          ? TransitionSpec.fromJson(json['transitionIn'] as Map<String, dynamic>)
          : null,
      transitionOut: json['transitionOut'] is Map<String, dynamic>
          ? TransitionSpec.fromJson(json['transitionOut'] as Map<String, dynamic>)
          : null,
      keyframes: [
        for (final k in json['keyframes'] as List? ?? const [])
          Keyframe.fromJson(Map<String, dynamic>.from(k as Map)),
      ],
    );
  }
}
