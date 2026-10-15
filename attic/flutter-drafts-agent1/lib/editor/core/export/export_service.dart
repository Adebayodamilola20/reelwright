import '../model/edit_project.dart';

/// Export boundary (docs/PROJECT_CONTRACT.md §9).
///
/// Slice 1 ships [UnavailableExportService]: the export UI must render
/// disabled with [unavailableReason]. A real encoder (native, behind owner
/// approval) implements this interface later without changing callers.
enum ExportContainer { mp4, mov, webm }

enum ExportQuality { low, medium, high, custom }

enum ExportPhase { preparing, encoding, finalizing, done, cancelled, failed }

class ExportOptions {
  const ExportOptions({
    this.container = ExportContainer.mp4,
    this.width,
    this.height,
    this.fpsNum,
    this.fpsDen,
    this.quality = ExportQuality.high,
    this.videoBitrateKbps,
    this.audioBitrateKbps = 192,
    this.fileName,
  });

  final ExportContainer container;

  /// null = inherit from project settings.
  final int? width;
  final int? height;
  final int? fpsNum;
  final int? fpsDen;
  final ExportQuality quality;

  /// Only honored when [quality] is custom.
  final int? videoBitrateKbps;
  final int? audioBitrateKbps;
  final String? fileName;

  Map<String, dynamic> toJson() => {
        'container': container.name,
        if (width != null) 'width': width,
        if (height != null) 'height': height,
        if (fpsNum != null) 'fpsNum': fpsNum,
        if (fpsDen != null) 'fpsDen': fpsDen,
        'quality': quality.name,
        if (videoBitrateKbps != null) 'videoBitrateKbps': videoBitrateKbps,
        if (audioBitrateKbps != null) 'audioBitrateKbps': audioBitrateKbps,
        if (fileName != null) 'fileName': fileName,
      };
}

class ExportProgress {
  const ExportProgress(
    this.phase, {
    this.percent = -1,
    this.etaSeconds,
    this.message,
  });

  final ExportPhase phase;

  /// 0..100, or -1 when indeterminate.
  final double percent;
  final int? etaSeconds;
  final String? message;

  bool get isFinished =>
      phase == ExportPhase.done ||
      phase == ExportPhase.cancelled ||
      phase == ExportPhase.failed;
}

abstract class ExportService {
  bool get isAvailable;

  /// Human reason shown on the disabled export control when unavailable.
  String? get unavailableReason;

  /// Starts an export; emits progress until done/cancelled/failed.
  Stream<ExportProgress> export(EditProject project, ExportOptions options);

  Future<void> cancel();
}

/// Honest placeholder: reports unavailable until a native encoder exists.
class UnavailableExportService implements ExportService {
  const UnavailableExportService(this._reason);

  final String _reason;

  @override
  bool get isAvailable => false;

  @override
  String? get unavailableReason => _reason;

  @override
  Stream<ExportProgress> export(EditProject project, ExportOptions options) =>
      Stream.value(const ExportProgress(ExportPhase.failed,
          message: 'Export is not available yet'));

  @override
  Future<void> cancel() async {}
}
