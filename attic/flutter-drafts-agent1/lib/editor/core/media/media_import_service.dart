import 'dart:io';

import '../model/ids.dart';
import '../model/media_asset.dart';
import '../model/types.dart';
import '../ops/edit_ops.dart';
import '../ops/op_result.dart';
import '../persistence/project_repository.dart';
import '../state/project_store.dart';
import 'media_probe.dart';

/// One file that could not be imported.
class ImportFailure {
  const ImportFailure(this.path, this.message);

  final String path;
  final String message;

  @override
  String toString() => 'ImportFailure($path: $message)';
}

/// Outcome of an import batch. Partial success is normal and must be shown
/// as such by the UI.
class ImportResult {
  const ImportResult({required this.added, required this.failures});

  final List<MediaAsset> added;
  final List<ImportFailure> failures;

  bool get isFullySuccessful => failures.isEmpty && added.isNotEmpty;
}

/// Brings external files into a project: copies them into the project media
/// directory (local by default — nothing is uploaded), probes them and
/// commits assets to the store. Also handles relinking and missing-file
/// detection. See docs/PROJECT_CONTRACT.md §8.
class MediaImportService {
  MediaImportService({
    required this.store,
    required this.repository,
    this.probe = const ExtensionMediaProbe(),
  });

  final ProjectStore store;
  final ProjectRepository repository;
  final MediaProbe probe;

  /// Copies each file into the project, adds an asset per supported file and
  /// reports per-file failures without aborting the batch.
  Future<ImportResult> importFiles(Iterable<String> paths) async {
    final added = <MediaAsset>[];
    final failures = <ImportFailure>[];
    final mediaPath = repository.mediaDir(store.project.id).path;

    for (final path in paths) {
      try {
        final file = File(path);
        if (!await file.exists()) {
          failures.add(ImportFailure(path, 'File not found'));
          continue;
        }
        final probed = await probe.probe(file);
        if (probed.kind == MediaKind.other) {
          failures.add(ImportFailure(
              path, 'Unsupported file type (${probed.container ?? 'unknown'})'));
          continue;
        }
        final assetId = newAssetId();
        final ext = probed.container ?? 'bin';
        await Directory(mediaPath).create(recursive: true);
        final destPath = '$mediaPath/$assetId.$ext';
        await file.copy(destPath);

        final asset = probed.toAsset(
          id: assetId,
          originalFilename: _baseName(path),
          relativePath: 'media/$assetId.$ext',
          absolutePath: _absoluteOf(path),
        );
        final result = store.apply((p) => EditOps.addAsset(p, asset));
        if (result is OpSuccess) {
          added.add(asset);
        } else {
          failures.add(
              ImportFailure(path, result.failureOrNull?.message ?? 'Rejected'));
          // Best-effort cleanup of the copy we just made.
          try {
            await File(destPath).delete();
          } catch (_) {}
        }
      } catch (e) {
        failures.add(ImportFailure(path, 'Import failed: $e'));
      }
    }
    return ImportResult(added: added, failures: failures);
  }

  /// Points [assetId] at an existing file the user located. The file is copied
  /// into the project (keeping the project self-contained) and the asset's
  /// kind must still match.
  Future<OpResult> relinkAsset(String assetId, String newPath) async {
    final asset = store.project.findAsset(assetId);
    if (asset == null) {
      return OpFailure(OpErrorCode.assetNotFound, 'Asset $assetId not found');
    }
    final file = File(newPath);
    if (!await file.exists()) {
      return OpFailure(OpErrorCode.assetNotFound, 'File not found: $newPath');
    }
    final probed = await probe.probe(file);
    if (probed.kind != asset.kind) {
      return OpFailure(OpErrorCode.incompatibleAsset,
          'Located file is ${probed.kind.name}, expected ${asset.kind.name}');
    }
    final mediaPath = repository.mediaDir(store.project.id).path;
    await Directory(mediaPath).create(recursive: true);
    final ext = probed.container ?? 'bin';
    final destPath = '$mediaPath/${asset.id}.$ext';
    await file.copy(destPath);

    final relinked = asset.copyWith(
      relativePath: 'media/${asset.id}.$ext',
      absolutePath: _absoluteOf(newPath),
      fileSizeBytes: probed.fileSizeBytes ?? asset.fileSizeBytes,
    );
    return store.apply((p) => EditOps.updateAsset(p, relinked),
        change: ChangeKind.assets);
  }

  /// Assets whose files can no longer be resolved on disk.
  List<MediaAsset> findMissingAssets() => [
        for (final a in store.project.assets)
          if (resolveAssetFile(a) == null) a
      ];

  /// Resolves an asset to an existing [File], trying the project copy first
  /// and the recorded absolute path second; null when neither exists.
  File? resolveAssetFile(MediaAsset asset) {
    final projectDirPath = repository.projectDir(store.project.id).path;
    final rel = asset.relativePath;
    if (rel != null) {
      final f = File('$projectDirPath/$rel');
      // ignore: avoid_blocking_io
      if (f.existsSync()) return f;
    }
    final abs = asset.absolutePath;
    if (abs != null) {
      final f = File(abs);
      if (f.existsSync()) return f;
    }
    return null;
  }
}

String _baseName(String path) {
  final slash = path.lastIndexOf('/') < path.lastIndexOf('\\')
      ? path.lastIndexOf('\\')
      : path.lastIndexOf('/');
  return slash < 0 ? path : path.substring(slash + 1);
}

String _absoluteOf(String path) {
  final f = File(path);
  try {
    return f.absolute.path;
  } catch (_) {
    return path;
  }
}
