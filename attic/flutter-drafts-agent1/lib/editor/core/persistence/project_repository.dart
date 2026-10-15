import 'dart:io';

import '../model/edit_project.dart';
import '../model/ids.dart';
import '../model/project_settings.dart';
import 'project_serializer.dart';

/// Load/save failure raised by repositories. Repositories throw; the UI layer
/// converts these into error states. User-logic failures use OpResult instead.
class RepositoryException implements Exception {
  RepositoryException(this.message, {this.cause});

  final String message;
  final Object? cause;

  @override
  String toString() => 'RepositoryException($message)';
}

/// Summary row for the project library screen.
class ProjectMetadata {
  const ProjectMetadata({
    required this.id,
    required this.name,
    required this.createdAt,
    required this.updatedAt,
    required this.dir,
    required this.hasProjectFile,
  });

  final String id;
  final String name;
  final int createdAt; // epoch ms
  final int updatedAt; // epoch ms
  final Directory dir;
  final bool hasProjectFile; // false = folder exists but file is unreadable
}

/// Storage contract for projects. See docs/PROJECT_CONTRACT.md §7.
abstract class ProjectRepository {
  /// Creates the project directory structure and persists a fresh project.
  Future<EditProject> createProject({
    required String name,
    ProjectSettings? settings,
  });

  Future<EditProject> loadProject(String projectId);

  /// Atomic write of [project] (temp file + rename).
  Future<void> saveProject(EditProject project);

  Future<void> deleteProject(String projectId);

  Future<List<ProjectMetadata>> listProjects();

  Directory projectDir(String projectId);

  Directory mediaDir(String projectId);
}

/// Directory-based repository.
///
/// Layout: `<root>/reelforge/projects/<projectId>/project.json` and
/// `<projectId>/media/<assetId>.<ext>` for imported copies.
class FileProjectRepository implements ProjectRepository {
  FileProjectRepository(this.root);

  /// Storage root, e.g. the app documents directory (desktop) or an injected
  /// temp directory in tests.
  final Directory root;

  Directory get projectsRoot => Directory('${root.path}/reelforge/projects');

  @override
  Directory projectDir(String projectId) =>
      Directory('${projectsRoot.path}/$projectId');

  @override
  Directory mediaDir(String projectId) =>
      Directory('${projectDir(projectId).path}/media');

  File _projectFile(String projectId) =>
      File('${projectDir(projectId).path}/project.json');

  @override
  Future<EditProject> createProject({
    required String name,
    ProjectSettings? settings,
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final project = EditProject(
      id: newProjectId(),
      name: name.trim().isEmpty ? 'Untitled project' : name.trim(),
      createdAt: now,
      updatedAt: now,
      settings: settings,
    );
    await projectDir(project.id).create(recursive: true);
    await mediaDir(project.id).create(recursive: true);
    await saveProject(project);
    return project;
  }

  @override
  Future<EditProject> loadProject(String projectId) async {
    final file = _projectFile(projectId);
    if (!await file.exists()) {
      throw RepositoryException('Project file not found: ${file.path}');
    }
    final source = await file.readAsString();
    try {
      return ProjectSerializer.deserialize(source);
    } catch (e) {
      throw RepositoryException(
          'Could not read project $projectId: $e', cause: e);
    }
  }

  @override
  Future<void> saveProject(EditProject project) async {
    final dir = projectDir(project.id);
    try {
      await dir.create(recursive: true);
      final target = _projectFile(project.id);
      final tmp = File('${target.path}.tmp');
      await tmp.writeAsString(ProjectSerializer.serialize(project), flush: true);
      await tmp.rename(target.path); // atomic on the same filesystem
    } catch (e) {
      throw RepositoryException('Could not save project ${project.id}: $e',
          cause: e);
    }
  }

  @override
  Future<void> deleteProject(String projectId) async {
    final dir = projectDir(projectId);
    if (await dir.exists()) {
      try {
        await dir.delete(recursive: true);
      } catch (e) {
        throw RepositoryException('Could not delete project $projectId: $e',
            cause: e);
      }
    }
  }

  @override
  Future<List<ProjectMetadata>> listProjects() async {
    final rootDir = projectsRoot;
    if (!await rootDir.exists()) return const [];
    final out = <ProjectMetadata>[];
    await for (final entry in rootDir.list(followLinks: false)) {
      if (entry is! Directory) continue;
      final id = entry.path.split(Platform.pathSeparator).last;
      final file = File('${entry.path}/project.json');
      if (!await file.exists()) {
        out.add(ProjectMetadata(
          id: id,
          name: id,
          createdAt: 0,
          updatedAt: 0,
          dir: entry,
          hasProjectFile: false,
        ));
        continue;
      }
      try {
        final project =
            ProjectSerializer.deserialize(await file.readAsString());
        out.add(ProjectMetadata(
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          dir: entry,
          hasProjectFile: true,
        ));
      } catch (_) {
        out.add(ProjectMetadata(
          id: id,
          name: '$id (unreadable)',
          createdAt: 0,
          updatedAt: 0,
          dir: entry,
          hasProjectFile: false,
        ));
      }
    }
    out.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return out;
  }
}
