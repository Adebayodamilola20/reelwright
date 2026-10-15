import '../time.dart';
import 'copy_with.dart';

/// Resolution, frame rate and audio format of a project.
class ProjectSettings {
  const ProjectSettings({
    this.width = 1920,
    this.height = 1080,
    this.fpsNum = 30,
    this.fpsDen = 1,
    this.sampleRate = 48000,
    this.channels = 2,
  })  : assert(width > 0),
        assert(height > 0),
        assert(fpsNum > 0),
        assert(fpsDen > 0),
        assert(sampleRate > 0),
        assert(channels > 0);

  final int width;
  final int height;
  final int fpsNum;
  final int fpsDen;
  final int sampleRate;
  final int channels;

  Rational get fps => Rational(fpsNum, fpsDen);

  double get aspectRatio => width / height;

  ProjectSettings copyWith({
    Object? width = unsetParam,
    Object? height = unsetParam,
    Object? fpsNum = unsetParam,
    Object? fpsDen = unsetParam,
    Object? sampleRate = unsetParam,
    Object? channels = unsetParam,
  }) {
    T pick<T>(Object? v, T current) =>
        identical(v, unsetParam) ? current : v as T;
    return ProjectSettings(
      width: pick(width, this.width) as int,
      height: pick(height, this.height) as int,
      fpsNum: pick(fpsNum, this.fpsNum) as int,
      fpsDen: pick(fpsDen, this.fpsDen) as int,
      sampleRate: pick(sampleRate, this.sampleRate) as int,
      channels: pick(channels, this.channels) as int,
    );
  }

  Map<String, dynamic> toJson() => {
        'width': width,
        'height': height,
        'fpsNum': fpsNum,
        'fpsDen': fpsDen,
        'sampleRate': sampleRate,
        'channels': channels,
      };

  factory ProjectSettings.fromJson(Map<String, dynamic> json) =>
      ProjectSettings(
        width: (json['width'] as num?)?.toInt() ?? 1920,
        height: (json['height'] as num?)?.toInt() ?? 1080,
        fpsNum: (json['fpsNum'] as num?)?.toInt() ?? 30,
        fpsDen: (json['fpsDen'] as num?)?.toInt() ?? 1,
        sampleRate: (json['sampleRate'] as num?)?.toInt() ?? 48000,
        channels: (json['channels'] as num?)?.toInt() ?? 2,
      );
}
