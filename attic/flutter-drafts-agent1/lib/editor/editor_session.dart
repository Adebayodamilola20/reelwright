import 'dart:io';

import 'core/export/export_service.dart';
import 'core/media/media_import_service.dart';
import 'core/media/media_probe.dart';
import 'core/model/edit_project.dart';
import 'core/model/project_settings.dart';
import 'core/playback/playback_engine.dart';
import 'core/persistence/project_repository.dart';
import 'core/state/project_store.dart';

/// Facade that wires an open project together for the UI layer.
///
/// ```dart
/// final session = await EditorSession.createNew(name: 'My edit');
/// session.store.apply((p) => EditOps.addTrack(p, kind: TrackKind.video));
/// await session.store.saveNow();
/// await session.dispose();
/// ```
/// See docs/PROJECT_CONTRACT.md §7.
class EditorSession {
  EditorSession._({
    required this.store,
    required this.repository,
    required this.media,
    required this.playback,
    required this.exportService,
  });

  final ProjectStore store;
  final FileProjectRepository repository;
  final MediaImportService media;
  final PlaybackEngine playback;
  final ExportService exportService;

  EditProject get project => store.project;
  String get projectId => store.project.id;

  /// Default storage root for projects.
  ///
  /// Desktop slice 1: `<cwd>/reelforge_data`. Replacing this with the OS
  /// app-documents directory needs `path_provider` (official plugin, BSD-3),
  /// which is a planned pubspec addition requiring owner approval.
  static Directory defaultRoot() =>
      Directory('${Directory.current.path}/reelforge_data');

  /// Creates a brand-new project on disk and opens a session for it.
  static Future<EditorSession> createNew({
    required String name,
    ProjectSettings? settings,
    Directory? root,
    MediaProbe? probe,
  }) async {
    final repository = FileProjectRepository(root ?? defaultRoot());
    final project =
        await repository.createProject(name: name, settings: settings);
    return _open(project, repository, probe: probe);
  }

  /// Reopens an existing project; asset references are checked lazily via
  /// [MediaImportService.findMissingAssets] so a missing file never blocks
  /// opening the rest of the edit.
  static Future<EditorSession> open(
    String projectId, {
    Directory? root,
    MediaProbe? probe,
  }) async {
    final repository = FileProjectRepository(root ?? defaultRoot());
    final project = await repository.loadProject(projectId);
    return _open(project, repository, probe: probe);
  }

  static EditorSession _open(
    EditProject project,
    FileProjectRepository repository, {
    MediaProbe? probe,
  }) {
    final store = ProjectStore(project: project, repository: repository);
    final media = MediaImportService(
      store: store,
      repository: repository,
      probe: probe ?? const ExtensionMediaProbe(),
    );
    return EditorSession._(
      store: store,
      repository: repository,
      media: media,
      playback: NullPlaybackEngine(),
      exportService: const UnavailableExportService(
          'Video export needs the native encoder, which is not integrated yet'),
    );
  }

  /// Flushes pending saves and releases the playback engine.
  Future<void> dispose() async {
    await playback.dispose();
    await store.close();
  }
}
