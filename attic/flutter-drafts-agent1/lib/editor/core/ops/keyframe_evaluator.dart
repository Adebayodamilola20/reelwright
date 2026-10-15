import '../model/clip.dart';
import '../model/keyframe.dart';
import '../model/types.dart';

/// Pure keyframe value lookup with easing. Clip-relative time in µs.
class KeyframeEvaluator {
  KeyframeEvaluator._();

  /// Interpolated value of [prop] on [clip] at [clipRelativeUs], or
  /// [defaultValue] when the property has no keyframes.
  static double evaluateClipProperty(
    Clip clip,
    KeyframeProperty prop,
    int clipRelativeUs,
    double defaultValue,
  ) {
    return tryValueAt(clip.keyframes, prop, clipRelativeUs) ?? defaultValue;
  }

  /// Interpolated value of [prop] at [atUs], or null when no keyframes exist
  /// for the property.
  ///
  /// Before the first keyframe → first value; after the last → last value.
  /// Segment easing is taken from the **left** keyframe of each segment.
  static double? tryValueAt(
      List<Keyframe> keyframes, KeyframeProperty prop, int atUs) {
    final sorted = keyframes.where((k) => k.property == prop).toList()
      ..sort((a, b) => a.atUs.compareTo(b.atUs));
    if (sorted.isEmpty) return null;
    if (atUs <= sorted.first.atUs) return sorted.first.value;
    if (atUs >= sorted.last.atUs) return sorted.last.value;
    for (var i = 0; i < sorted.length - 1; i++) {
      final a = sorted[i];
      final b = sorted[i + 1];
      if (atUs >= a.atUs && atUs <= b.atUs) {
        if (b.atUs == a.atUs) return b.value;
        final t = (atUs - a.atUs) / (b.atUs - a.atUs);
        final e = applyEasing(a.easing, t);
        return a.value + (b.value - a.value) * e;
      }
    }
    return sorted.last.value;
  }

  /// Easing curve applied to a normalized t in 0..1.
  static double applyEasing(KeyframeEasing easing, double t) {
    final x = t < 0 ? 0.0 : t > 1 ? 1.0 : t;
    switch (easing) {
      case KeyframeEasing.linear:
        return x;
      case KeyframeEasing.easeIn:
        return x * x;
      case KeyframeEasing.easeOut:
        return 1 - (1 - x) * (1 - x);
      case KeyframeEasing.easeInOut:
        return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
    }
  }
}

/// Convenience for fades: normalized 0..1 gain at [relativeUs] given fades.
double fadeGainAt(int relativeUs, int durationUs, int fadeInUs, int fadeOutUs) {
  var gain = 1.0;
  if (fadeInUs > 0 && relativeUs < fadeInUs) {
    gain *= relativeUs / fadeInUs;
  }
  final fadeOutStart = durationUs - fadeOutUs;
  if (fadeOutUs > 0 && relativeUs > fadeOutStart) {
    final remaining = durationUs - relativeUs;
    gain *= remaining / fadeOutUs;
  }
  if (gain < 0) return 0;
  if (gain > 1) return 1;
  return gain;
}
