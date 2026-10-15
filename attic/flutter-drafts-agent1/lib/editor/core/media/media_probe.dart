import 'dart:io';

import '../model/media_asset.dart';
import '../model/types.dart';

/// Metadata extracted from a media file. Null fields mean **unknown** —
/// never guess zero (docs/PROJECT_CONTRACT.md §8).
class ProbedMedia {
  const ProbedMedia({
    required this.kind,
    this.container,
    this.durationUs,
    this.width,
    this.height,
    this.fpsNum,
    this.fpsDen,
    this.sampleRate,
    this.channels,
    this.videoCodec,
    this.audioCodec,
    this.fileSizeBytes,
  });

  final MediaKind kind;
  final String? container;
  final int? durationUs;
  final int? width;
  final int? height;
  final int? fpsNum;
  final int? fpsDen;
  final int? sampleRate;
  final int? channels;
  final String? videoCodec;
  final int? fileSizeBytes;
  final String? audioCodec;

  MediaAsset toAsset({
    required String id,
    required String originalFilename,
    String? relativePath,
    String? absolutePath,
    int? addedAt,
  }) =>
      MediaAsset(
        id: id,
        kind: kind,
        relativePath: relativePath,
        absolutePath: absolutePath,
        originalFilename: originalFilename,
        addedAt: addedAt ?? DateTime.now().millisecondsSinceEpoch,
        fileSizeBytes: fileSizeBytes,
        durationUs: durationUs,
        width: width,
        height: height,
        fpsNum: fpsNum,
        fpsDen: fpsDen,
        sampleRate: sampleRate,
        channels: channels,
        container: container,
        videoCodec: videoCodec,
        audioCodec: audioCodec,
      );
}

/// Extracts media metadata from a file. Real (codec-aware) probing arrives
/// with the native decoder dependency; until then the app ships
/// [ExtensionMediaProbe], which honestly reports only what it can know.
abstract class MediaProbe {
  Future<ProbedMedia> probe(File file);
}

class ExtensionMediaProbe implements MediaProbe {
  const ExtensionMediaProbe();

  static const Set<String> videoExtensions = {
    'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'mts', 'm2ts',
    '3gp', 'wmv', 'flv', 'ts',
  };
  static const Set<String> audioExtensions = {
    'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff',
    'aif',
  };
  static const Set<String> imageExtensions = {
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'avif',
    'svg',
  };

  static String? extensionOf(String path) {
    final name = _baseName(path);
    final dot = name.lastIndexOf('.');
    if (dot <= 0 || dot == name.length - 1) return null;
    return name.substring(dot + 1).toLowerCase();
  }

  static MediaKind kindForPath(String path) {
    final ext = extensionOf(path);
    if (ext == null) return MediaKind.other;
    if (videoExtensions.contains(ext)) return MediaKind.video;
    if (audioExtensions.contains(ext)) return MediaKind.audio;
    if (imageExtensions.contains(ext)) return MediaKind.image;
    return MediaKind.other;
  }

  @override
  Future<ProbedMedia> probe(File file) async {
    final stat = await file.stat();
    final ext = extensionOf(file.path);
    return ProbedMedia(
      kind: kindForPath(file.path),
      container: ext,
      fileSizeBytes: stat.size,
    );
  }
}

String _baseName(String path) {
  final slash = _max2(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash < 0 ? path : path.substring(slash + 1);
}

int _max2(int a, int b) => a > b ? a : b;
