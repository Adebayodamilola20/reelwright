import 'package:flutter/foundation.dart';

/// UI-side ports for the studio (Owner: Agent 2).
///
/// These interfaces are what the editor UI *needs*; they are deliberately
/// minimal and engine-agnostic. When `docs/PROJECT_CONTRACT.md` lands, an
/// adapter in `lib/editor/api/contract_adapter.dart` implements these ports on
/// top of Agent 1's project model / media engine. Until then the UI runs on
/// clearly-marked interim implementations in `lib/editor/session/`.
///
/// Time unit convention (proposal sent to Agent 1, see docs/TEAM_STATUS.md):
/// integer **microseconds** everywhere; frame-accurate display derives from
/// the project frame rate.
library;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

@immutable
class ProjectSummary {
  const ProjectSummary({
    required this.id,
    required this.name,
    required this.createdAt,
    required this.updatedAt,
    this.thumbnailPath,
    this.durationMicros = 0,
    this.missingAssetCount = 0,
  });

  final String id;
  final String name;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// Optional poster/thumbnail image path (local). Null = show placeholder.
  final String? thumbnailPath;
  final int durationMicros;
  final int missingAssetCount;

  bool get needsRelink => missingAssetCount > 0;

  ProjectSummary copyWith({
    String? name,
    DateTime? updatedAt,
    String? thumbnailPath,
    int? durationMicros,
    int? missingAssetCount,
  }) {
    return ProjectSummary(
      id: id,
      name: name ?? this.name,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      thumbnailPath: thumbnailPath ?? this.thumbnailPath,
      durationMicros: durationMicros ?? this.durationMicros,
      missingAssetCount: missingAssetCount ?? this.missingAssetCount,
    );
  }
}

/// Autosave / persistence state surfaced in the editor title bar.
enum SaveState {
  saved,
  saving,
  dirty,
  error,
  readOnly, // e.g. relinking required or engine unavailable
}

@immutable
class SaveStatus {
  const SaveStatus(this.state, {this.message, this.savedAt});

  final SaveState state;
  final String? message;
  final DateTime? savedAt;

  static const initial = SaveStatus(SaveState.saved);
}

/// Project lifecycle as needed by the home library and editor chrome.
abstract class ProjectPort {
  /// Emits the full project list whenever anything changes (create, rename,
  /// autosave timestamp bump, delete, relink status).
  Stream<List<ProjectSummary>> watchProjects();

  Future<List<ProjectSummary>> loadProjects();

  Future<ProjectSummary> createProject({required String name});

  Future<void> renameProject(String id, String name);

  Future<ProjectSummary> duplicateProject(String id);

  Future<void> deleteProject(String id);

  /// Save status for the currently open project (home ignores this).
  Stream<SaveStatus> watchSaveStatus(String projectId);

  /// Emits when the open project's media/timeline changed and should reload.
  Future<void> openProject(String id) async {}
  Future<void> closeProject() async {}
}

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

enum MediaKind { video, audio, image, text, other }

enum AssetAvailability { available, missing, unsupported, analyzing }

@immutable
class MediaAsset {
  const MediaAsset({
    required this.id,
    required this.kind,
    required this.displayName,
    required this.sourcePath,
    this.thumbnailPath,
    this.durationMicros,
    this.sizeBytes,
    this.width,
    required this.availability,
    this.frameRate,
    this.sampleRate,
    this.errorMessage,
  });

  final String id;
  final MediaKind kind;
  final String displayName;
  final String sourcePath;

  /// Poster/thumbnail path once the engine has generated one.
  final String? thumbnailPath;
  final int? durationMicros;
  final int? sizeBytes;
  final int? width;
  final int? height;
  final double? frameRate;
  final int? sampleRate;
  final AssetAvailability availability;

  /// Populated for `unsupported`/failed imports so the bin can explain why.
  final String? errorMessage;

  bool get isUsable => availability == AssetAvailability.available;

  MediaAsset copyWith({
    String? thumbnailPath,
    int? durationMicros,
    int? sizeBytes,
    int? width,
    int? height,
    AssetAvailability? availability,
    double? frameRate,
    int? sampleRate,
    String? errorMessage,
  }) {
    return MediaAsset(
      id: id,
      kind: kind,
      displayName: displayName,
      sourcePath: sourcePath,
      thumbnailPath: thumbnailPath ?? this.thumbnailPath,
      durationMicros: durationMicros ?? this.durationMicros,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      width: width ?? this.width,
      height: height ?? this.height,
      availability: availability ?? this.availability,
      frameRate: frameRate ?? this.frameRate,
      sampleRate: sampleRate ?? this.sampleRate,
      errorMessage: errorMessage,
    );
  }
}

/// Per-file import result: either [asset] or [error] — never both.
@immutable
class ImportOutcome {
  const ImportOutcome.ok(MediaAsset this.asset) : error = null;
  const ImportOutcome.failure(String this.error) : asset = null;

  final MediaAsset? asset;
  final String? error;

  bool get ok => asset != null;
}

/// Progress while a batch import is running (UI renders per-file rows).
@immutable
class ImportProgress {
  const ImportProgress({
    required this.total,
    required this.completed,
    required this.currentFile,
    this.currentFileStatus,
  });

  final int total;
  final int completed;
  final String currentFile;

  /// analyzing | done | failed — honest per-file status text.
  final String? currentFileStatus;

  double get fraction => total == 0 ? 0 : completed / total;
}

abstract class MediaLibraryPort {
  Stream<List<MediaAsset>> watchAssets();

  Future<List<MediaAsset>> loadAssets();

  /// Import user-selected paths. Emits [ImportProgress] while running and
  /// resolves with one [ImportOutcome] per input path.
  Stream<ImportProgress> importProgress();

  Future<List<ImportOutcome>> importPaths(List<String> paths);

  Future<void> removeAsset(String assetId);

  /// Point a `missing` asset at a new file (relink workflow).
  Future<void> relinkAsset(String assetId, String newPath);

  /// Live list of source paths that no longer resolve, for the relink banner.
  Stream<List<MediaAsset>> watchMissingAssets();
}
