import 'dart:async';
import 'dart:io' as io;

import '../api/ports.dart';

/// INTERIM implementation (Agent 2): in-memory project library so the home
/// screen and editor chrome are fully exercisable before Agent 1's persistence
/// engine lands. Session-only — projects do not survive restart. When
/// `docs/PROJECT_CONTRACT.md` lands, `ContractProjectPort` replaces this and
/// the UI does not change (it only ever sees [ProjectPort]).
class LocalProjectPort implements ProjectPort {
  LocalProjectPort({bool seedDemo = false}) {
    if (seedDemo) {
      final now = DateTime.now();
      _projects = [
        ProjectSummary(
          id: 'demo-1',
          name: 'Product teaser',
          createdAt: now.subtract(const Duration(days: 2)),
          updatedAt: now.subtract(const Duration(hours: 5)),
          durationMicros: 42 * 1000000,
        ),
        ProjectSummary(
          id: 'demo-2',
          name: 'Interview cutdown',
          createdAt: now.subtract(const Duration(days: 9)),
          updatedAt: now.subtract(const Duration(days: 1)),
          missingAssetCount: 2,
        ),
      ];
    }
  }

  List<ProjectSummary> _projects = [];
  final _controller = StreamController<List<ProjectSummary>>.broadcast();
  final _saveControllers = <String, StreamController<SaveStatus>>{};
  final _saveState = <String, SaveStatus>{};
  int _idSeq = 0;

  void _emit() => _controller.add(List.unmodifiable(_projects));

  @override
  Stream<List<ProjectSummary>> watchProjects() async* {
    yield List.unmodifiable(_projects);
    yield* _controller.stream;
  }

  @override
  Future<List<ProjectSummary>> loadProjects() async =>
      List.unmodifiable(_projects);

  @override
  Future<ProjectSummary> createProject({required String name}) async {
    final now = DateTime.now();
    final project = ProjectSummary(
      id: 'p${now.microsecondsSinceEpoch}-${_idSeq++}',
      name: name.trim().isEmpty ? 'Untitled project' : name.trim(),
      createdAt: now,
      updatedAt: now,
    );
    _projects = [..._projects, project];
    _saveState[project.id] = const SaveStatus(SaveState.saved);
    _emit();
    return project;
  }

  @override
  Future<void> renameProject(String id, String name) async {
    _projects = [
      for (final p in _projects)
        if (p.id == id)
          p.copyWith(name: name.trim(), updatedAt: DateTime.now())
        else
          p,
    ];
    _emit();
  }

  @override
  Future<ProjectSummary> duplicateProject(String id) async {
    final source = _projects.firstWhere((p) => p.id == id);
    final now = DateTime.now();
    final copy = ProjectSummary(
      id: 'p${now.microsecondsSinceEpoch}-${_idSeq++}',
      name: '${source.name} copy',
      createdAt: now,
      updatedAt: now,
      thumbnailPath: source.thumbnailPath,
      durationMicros: source.durationMicros,
      missingAssetCount: source.missingAssetCount,
    );
    _projects = [..._projects, copy];
    _emit();
    return copy;
  }

  @override
  Future<void> deleteProject(String id) async {
    _projects = _projects.where((p) => p.id != id).toList();
    _emit();
  }

  @override
  Stream<SaveStatus> watchSaveStatus(String projectId) {
    final c = _saveControllers.putIfAbsent(
      projectId,
      StreamController<SaveStatus>.broadcast,
    );
    Future.microtask(() => c.add(
        _saveState[projectId] ?? const SaveStatus(SaveState.saved)));
    return c.stream;
  }

  /// Interim "autosave": mark dirty now, settle to saved shortly after —
  /// stands in for the engine's debounced persistence.
  void touch(String projectId) {
    _saveState[projectId] = const SaveStatus(SaveState.saving);
    _saveControllers[projectId]?.add(_saveState[projectId]!);
    _projects = [
      for (final p in _projects)
        if (p.id == projectId) p.copyWith(updatedAt: DateTime.now()) else p,
    ];
    _emit();
    Timer(const Duration(milliseconds: 600), () {
      _saveState[projectId] = SaveStatus(SaveState.saved,
          savedAt: DateTime.now());
      _saveControllers[projectId]?.add(_saveState[projectId]!);
    });
  }

  void dispose() {
    _controller.close();
    for (final c in _saveControllers.values) {
      c.close();
    }
  }
}

/// INTERIM implementation (Agent 2): registers imported files with basic,
/// verifiable metadata only (existence, size, kind by extension). Duration,
/// dimensions, thumbnails and codec checks are the media engine's job — those
/// fields stay null / `analyzing` here and the UI reports them as pending
/// rather than inventing values.
class LocalMediaLibraryPort implements MediaLibraryPort {
  LocalMediaLibraryPort();

  final _assets = <MediaAsset>[];
  final _controller = StreamController<List<MediaAsset>>.broadcast();
  final _progress = StreamController<ImportProgress>.broadcast();
  final _missing = StreamController<List<MediaAsset>>.broadcast();
  int _idSeq = 0;

  void _emit() => _controller.add(List.unmodifiable(_assets));

  @override
  Stream<List<MediaAsset>> watchAssets() async* {
    yield List.unmodifiable(_assets);
    yield* _controller.stream;
  }

  @override
  Future<List<MediaAsset>> loadAssets() async => List.unmodifiable(_assets);

  @override
  Stream<ImportProgress> importProgress() => _progress.stream;

  @override
  Future<List<ImportOutcome>> importPaths(List<String> paths) async {
    final results = <ImportOutcome>[];
    for (var i = 0; i < paths.length; i++) {
      final path = paths[i];
      _progress.add(ImportProgress(
        total: paths.length,
        completed: i,
        currentFile: _basename(path),
        currentFileStatus: 'checking',
      ));
      await Future<void>.delayed(const Duration(milliseconds: 120));
      results.add(_registerOne(path));
      _emit();
    }
    _progress.add(ImportProgress(
      total: paths.length,
      completed: paths.length,
      currentFile: paths.isEmpty ? '' : _basename(paths.last),
      currentFileStatus: 'done',
    ));
    return results;
  }

  ImportOutcome _registerOne(String path) {
    final file = io.File(path);
    if (!file.existsSync()) {
      return ImportOutcome.failure('File not found: $_basename(path)');
    }
    final ext = _extensionOf(path);
    final kind = kindForExtension(ext);
    if (kind == null) {
      return ImportOutcome.failure(
          'Unsupported file type "${ext.isEmpty ? path.split('.').last : '.$ext'}". '
          'Supported: mp4, mov, webm, mkv, avi, mp3, wav, m4a, aac, flac, '
          'png, jpg, jpeg, webp, gif, heic.');
    }
    final asset = MediaAsset(
      id: 'a${DateTime.now().microsecondsSinceEpoch}-${_idSeq++}',
      kind: kind,
      displayName: _basename(path),
      sourcePath: path,
      sizeBytes: file.lengthSync(),
      availability: AssetAvailability.available,
    );
    _assets = [..._assets, asset];
    _missing.add(List.unmodifiable(
        _assets.where((a) => a.availability == AssetAvailability.missing)));
    return ImportOutcome.ok(asset);
  }

  @override
  Future<void> removeAsset(String assetId) async {
    _assets = _assets.where((a) => a.id != assetId).toList();
    _emit();
  }

  @override
  Future<void> relinkAsset(String assetId, String newPath) async {
    _assets = [
      for (final a in _assets)
        a.id == assetId
            ? a.copyWith(
                availability: AssetAvailability.available,
                sizeBytes: io.File(newPath).existsSync()
                    ? io.File(newPath).lengthSync()
                    : null,
              )
            : a,
    ];
    _emit();
  }

  /// Test/harness hook used by the media engine adapter later.
  void debugReplace(List<MediaAsset> next) {
    _assets = [...next];
    _emit();
  }

  static const _videoExt = {'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp'};
  static const _audioExt = {'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'};
  static const _imageExt = {'png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'bmp'};

  static MediaKind? kindForExtension(String ext) {
    final e = ext.toLowerCase();
    if (_videoExt.contains(e)) return MediaKind.video;
    if (_audioExt.contains(e)) return MediaKind.audio;
    if (_imageExt.contains(e)) return MediaKind.image;
    return null;
  }

  static String _basename(String path) =>
      path.split(RegExp(r'[\\/]')).last;

  static String _extensionOf(String path) {
    final name = _basename(path);
    final dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.substring(dot + 1);
  }
}
