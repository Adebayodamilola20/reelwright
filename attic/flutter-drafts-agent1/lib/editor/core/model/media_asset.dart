import 'types.dart';

/// A file in the project media library.
///
/// After import the copy inside `<projectDir>/media/` is the source of truth
/// ([relativePath]); [absolutePath] remembers where the file came from and is
/// the fallback when the relative copy is gone. Null metadata means "unknown",
/// never zero (see docs/PROJECT_CONTRACT.md §5.3).
class MediaAsset {
  const MediaAsset({
    required this.id,
    required this.kind,
    this.relativePath,
    this.absolutePath,
    required this.originalFilename,
    required this.addedAt,
    this.fileSizeBytes,
    this.durationUs,
    this.width,
    this.height,
    this.fpsNum,
    this.fpsDen,
    this.sampleRate,
    this.channels,
    this.container,
    this.videoCodec,
    this.audioCodec,
  })  : assert(id != ''),
        assert(originalFilename != '');

  final String id;
  final MediaKind kind;

  /// Path relative to the project directory (portable, preferred).
  final String? relativePath;

  /// Original/absolute location (fallback when [relativePath] is missing).
  final String? absolutePath;

  final String originalFilename;
  final int addedAt; // epoch ms
  final int? fileSizeBytes;
  final int? durationUs;
  final int? width;
  final int? height;
  final int? fpsNum;
  final int? fpsDen;
  final int? sampleRate;
  final int? channels;
  final String? container;
  final String? videoCodec;
  final String? audioCodec;

  String get displayName => originalFilename;

  bool get hasKnownDuration => durationUs != null && durationUs! > 0;

  MediaAsset copyWith({
    Object? id = unsetParam,
    Object? kind = unsetParam,
    Object? relativePath = unsetParam,
    Object? absolutePath = unsetParam,
    Object? originalFilename = unsetParam,
    Object? addedAt = unsetParam,
    Object? fileSizeBytes = unsetParam,
    Object? durationUs = unsetParam,
    Object? width = unsetParam,
    Object? height = unsetParam,
    Object? fpsNum = unsetParam,
    Object? fpsDen = unsetParam,
    Object? sampleRate = unsetParam,
    Object? channels = unsetParam,
    Object? container = unsetParam,
    Object? videoCodec = unsetParam,
    Object? audioCodec = unsetParam,
  }) {
    T pick<T>(Object? v, T current) =>
        identical(v, unsetParam) ? current : v as T;
    return MediaAsset(
      id: pick(id, this.id),
      kind: pick(kind, this.kind) as MediaKind,
      relativePath: pick(relativePath, this.relativePath) as String?,
      absolutePath: pick(absolutePath, this.absolutePath) as String?,
      originalFilename: pick(originalFilename, this.originalFilename) as String,
      addedAt: pick(addedAt, this.addedAt) as int,
      fileSizeBytes: pick(fileSizeBytes, this.fileSizeBytes) as int?,
      durationUs: pick(durationUs, this.durationUs) as int?,
      width: pick(width, this.width) as int?,
      height: pick(height, this.height) as int?,
      fpsNum: pick(fpsNum, this.fpsNum) as int?,
      fpsDen: pick(fpsDen, this.fpsDen) as int?,
      sampleRate: pick(sampleRate, this.sampleRate) as int?,
      channels: pick(channels, this.channels) as int?,
      container: pick(container, this.container) as String?,
      videoCodec: pick(videoCodec, this.videoCodec) as String?,
      audioCodec: pick(audioCodec, this.audioCodec) as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind.name,
        if (relativePath != null) 'relativePath': relativePath,
        if (absolutePath != null) 'absolutePath': absolutePath,
        'originalFilename': originalFilename,
        'addedAt': addedAt,
        if (fileSizeBytes != null) 'fileSizeBytes': fileSizeBytes,
        if (durationUs != null) 'durationUs': durationUs,
        if (width != null) 'width': width,
        if (height != null) 'height': height,
        if (fpsNum != null) 'fpsNum': fpsNum,
        if (fpsDen != null) 'fpsDen': fpsDen,
        if (sampleRate != null) 'sampleRate': sampleRate,
        if (channels != null) 'channels': channels,
        if (container != null) 'container': container,
        if (videoCodec != null) 'videoCodec': videoCodec,
        if (audioCodec != null) 'audioCodec': audioCodec,
      };

  factory MediaAsset.fromJson(Map<String, dynamic> json) {
    T? read<T>(Object? v) => v is T ? v : null;
    return MediaAsset(
      id: json['id'] as String,
      kind: EnumJson.fromJsonName(
          MediaKind.values, json['kind'] as String?, MediaKind.other),
      relativePath: read<String>(json['relativePath']),
      absolutePath: read<String>(json['absolutePath']),
      originalFilename: json['originalFilename'] as String,
      addedAt: (json['addedAt'] as num?)?.toInt() ?? 0,
      fileSizeBytes: read<int>(json['fileSizeBytes']),
      durationUs: read<int>(json['durationUs']),
      width: read<int>(json['width']),
      height: read<int>(json['height']),
      fpsNum: read<int>(json['fpsNum']),
      fpsDen: read<int>(json['fpsDen']),
      sampleRate: read<int>(json['sampleRate']),
      channels: read<int>(json['channels']),
      container: read<String>(json['container']),
      videoCodec: read<String>(json['videoCodec']),
      audioCodec: read<String>(json['audioCodec']),
    );
  }
}
