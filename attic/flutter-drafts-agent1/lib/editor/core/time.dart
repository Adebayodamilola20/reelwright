/// Canonical time model for the Reelforge editor.
///
/// Every timestamp, duration and offset in the editor is an **integer number
/// of microseconds** (`int`, field suffix `Us`) — see docs/PROJECT_CONTRACT.md §4.
/// Frame rates are rationals (`fpsNum`/`fpsDen`), never floats.
///
/// Conversions round exactly once at the boundary. Never accumulate time by
/// repeatedly converting frames→µs→frames; that drifts for rational rates
/// such as 30000/1001.
library;

/// An exact rational number, used for frame rates and boundary conversions.
class Rational {
  const Rational(this.numerator, [this.denominator = 1])
      : assert(denominator > 0, 'denominator must be positive');

  final int numerator;
  final int denominator;

  double get toDouble => numerator / denominator;

  Rational operator *(Rational other) =>
      Rational(numerator * other.numerator, denominator * other.denominator);

  Rational operator /(Rational other) =>
      Rational(numerator * other.denominator, denominator * other.numerator);

  @override
  bool operator ==(Object other) =>
      other is Rational &&
      numerator * other.denominator == other.numerator * denominator;

  @override
  int get hashCode => Object.hash(numerator, denominator);

  @override
  String toString() =>
      denominator == 1 ? '$numerator' : '$numerator/$denominator';
}

/// Microsecond time helpers. All static; import and use as `Times.x`.
class Times {
  Times._();

  static const int usPerSecond = 1000000;
  static const int usPerMillisecond = 1000;

  /// Minimum allowed clip duration in the editor (1 ms).
  static const int minClipDurationUs = 1000;

  static int fromSeconds(double seconds) {
    final v = (seconds * usPerSecond).round();
    return v < 0 ? 0 : v;
  }

  static int fromMillis(int millis) => millis * usPerMillisecond;

  static double toSeconds(int us) => us / usPerSecond;

  /// Whole seconds represented by [us] (floor).
  static int secondsPart(int us) => us ~/ usPerSecond;

  /// Convert frames to microseconds using an exact rational frame rate.
  /// Rounds to nearest at the boundary.
  static int framesToUs(int frames, int fpsNum, int fpsDen) {
    assert(fpsNum > 0 && fpsDen > 0);
    return (frames * fpsDen * usPerSecond * 2 + fpsNum) ~/ (fpsNum * 2);
  }

  /// Convert microseconds to frames (floor), using an exact rational rate.
  static int usToFrames(int us, int fpsNum, int fpsDen) {
    assert(fpsNum > 0 && fpsDen > 0);
    return us * fpsNum ~/ (fpsDen * usPerSecond);
  }

  /// Convert audio samples to microseconds at [sampleRate] Hz (rounds once).
  static int samplesToUs(int samples, int sampleRate) {
    assert(sampleRate > 0);
    return (samples * usPerSecond * 2 + sampleRate) ~/ (sampleRate * 2);
  }

  /// Convert microseconds to audio samples (floor).
  static int usToSamples(int us, int sampleRate) {
    assert(sampleRate > 0);
    return us * sampleRate ~/ usPerSecond;
  }

  static int clampUs(int us, {int min = 0, int? max}) {
    var v = us < min ? min : us;
    if (max != null && v > max) v = max;
    return v;
  }

  /// `HH:MM:SS:FF` timecode at the given rational frame rate.
  static String formatTimecode(int us, int fpsNum, int fpsDen) {
    final clamped = us < 0 ? 0 : us;
    final totalSeconds = clamped ~/ usPerSecond;
    final ff = usToFrames(clamped % usPerSecond, fpsNum, fpsDen);
    final hh = totalSeconds ~/ 3600;
    final mm = (totalSeconds ~/ 60) % 60;
    final ss = totalSeconds % 60;
    String two(int v) => v < 10 ? '0$v' : '$v';
    return '${two(hh)}:${two(mm)}:${two(ss)}:${two(ff)}';
  }

  /// Human duration, e.g. `1:02.500` or `1:02:03.250`.
  static String formatDuration(int us) {
    final clamped = us < 0 ? 0 : us;
    final totalSeconds = clamped ~/ usPerSecond;
    final millis = (clamped % usPerSecond) ~/ usPerMillisecond;
    String three(int v) => v < 10 ? '00$v' : v < 100 ? '0$v' : '$v';
    final ss = three(totalSeconds % 60);
    if (totalSeconds < 3600) {
      return '${totalSeconds ~/ 60}:$ss.$millis';
    }
    final mm = three((totalSeconds ~/ 60) % 60);
    final hh = totalSeconds ~/ 3600;
    return '$hh:$mm:$ss.$millis';
  }
}
