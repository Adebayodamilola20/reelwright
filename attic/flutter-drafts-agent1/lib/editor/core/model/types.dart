/// Enumerations shared across the editor model.
///
/// JSON stores enum values by `.name`. Parsing tolerates unknown values by
/// falling back to a sensible default (forward-compat), except where noted.
library;

enum MediaKind { video, audio, image, other }

enum TrackKind { video, audio, text }

enum ClipKind { video, audio, image, text }

enum TransitionType { cut, dissolve, wipeLeft }

enum KeyframeProperty { opacity, volume, x, y, scale, rotationDeg }

enum KeyframeEasing { linear, easeIn, easeOut, easeInOut }

enum TextAlignment { left, center, right }

extension EnumJson<T extends Enum> on T {
  String toJsonName() => name;

  /// Parse [name] back; returns [fallback] when missing or unknown.
  static T fromJsonName<T extends Enum>(
      List<T> values, String? name, T fallback) {
    if (name == null) return fallback;
    for (final v in values) {
      if (v.name == name) return v;
    }
    return fallback;
  }
}
