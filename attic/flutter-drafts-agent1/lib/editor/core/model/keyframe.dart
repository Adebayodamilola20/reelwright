import 'types.dart';

/// A single keyframe on a clip.
///
/// [atUs] is **clip-relative** (0 = clip start), independent of where the clip
/// sits on the timeline, so moving a clip never breaks its animation.
class Keyframe {
  const Keyframe({
    required this.property,
    required this.atUs,
    required this.value,
    this.easing = KeyframeEasing.linear,
  }) : assert(atUs >= 0);

  final KeyframeProperty property;
  final int atUs;
  final double value;

  /// Easing of the segment that starts at this keyframe.
  final KeyframeEasing easing;

  Map<String, dynamic> toJson() => {
        'property': property.name,
        'atUs': atUs,
        'value': value,
        'easing': easing.name,
      };

  factory Keyframe.fromJson(Map<String, dynamic> json) => Keyframe(
        property: EnumJson.fromJsonName(KeyframeProperty.values,
            json['property'] as String?, KeyframeProperty.opacity),
        atUs: (json['atUs'] as num?)?.toInt() ?? 0,
        value: (json['value'] as num?)?.toDouble() ?? 0,
        easing: EnumJson.fromJsonName(KeyframeEasing.values,
            json['easing'] as String?, KeyframeEasing.linear),
      );
}
