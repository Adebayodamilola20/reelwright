import 'dart:async';

import 'package:flutter/foundation.dart';

import '../model/edit_project.dart';
import '../ops/op_result.dart';
import '../persistence/project_repository.dart';
import '../persistence/project_serializer.dart';
import 'undo_stack.dart';

/// A load/save failure surfaced to the UI. The store keeps the edit in memory
/// (and stays dirty) when a save fails — an edit is never dropped silently.
class ProjectStoreError {
  const ProjectStoreError(this.message, {this.cause, this.isSave = false});

  final String message;
  final Object? cause;
  final bool isSave;

  @override
  String toString() => 'ProjectStoreError($message)';
}

/// Live editing state: the current project root, undo/redo, dirty tracking
/// and debounced autosave. This is the primary surface Agent 2 integrates
/// with (docs/PROJECT_CONTRACT.md §7).
///
/// Usage: `store.apply((p) => EditOps.addTrack(p, kind: TrackKind.video))`.
/// Listeners are notified once per committed change with [lastChange] set.
class ProjectStore extends ChangeNotifier {
  ProjectStore({
    required EditProject project,
    ProjectRepository? repository,
    this.autosaveDelay = const Duration(milliseconds: 1500),
    int undoLimit = 100,
  })  : _project = project,
        _repository = repository,
        _undoStack = UndoStack(limit: undoLimit);

  /// In-memory store (no persistence) — handy for tests and previews.
  ProjectStore.memory(EditProject project)
      : this(project: project, repository: null);

  final ProjectRepository? repository;
  final Duration autosaveDelay;

  EditProject _project;
  final UndoStack _undoStack;
  bool _isDirty = false;
  bool _isSaving = false;
  ChangeKind _lastChange = ChangeKind.loaded;
  Timer? _autosaveTimer;
  Future<void> _saveQueue = Future.value();
  final StreamController<ProjectStoreError> _errors =
      StreamController<ProjectStoreError>.broadcast();

  // ------------------------------------------------------------- accessors

  EditProject get project => _project;
  bool get canUndo => _undoStack.canUndo;
  bool get canRedo => _undoStack.canRedo;
  bool get isDirty => _isDirty;
  bool get isSaving => _isSaving;
  ChangeKind get lastChange => _lastChange;
  bool get isPersistent => repository != null;

  /// Save/load problems; subscribe before importing large batches.
  Stream<ProjectStoreError> get errors => _errors.stream;

  // --------------------------------------------------------------- commits

  /// Runs [op] on the current root. On success commits the new root,
  /// notifies listeners, records undo history and schedules autosave.
  OpResult apply(EditOp op) {
    final result = op(_project);
    final next = result.projectOrNull;
    if (next == null) return result;
    _undoStack.push(_project);
    _commit(next, result is OpSuccess ? result.change : ChangeKind.clips);
    return result;
  }

  /// Replaces the root wholesale (used by undo/redo and external loads).
  void replaceProject(EditProject next, {ChangeKind change = ChangeKind.restored}) {
    _undoStack.push(_project);
    _commit(next, change);
  }

  Future<void> undo() async {
    final prev = _undoStack.undo(_project);
    if (prev == null) return;
    _commit(prev, ChangeKind.restored);
  }

  Future<void> redo() async {
    final next = _undoStack.redo(_project);
    if (next == null) return;
    _commit(next, ChangeKind.restored);
  }

  void _commit(EditProject next, ChangeKind change) {
    _project = next;
    _isDirty = true;
    _lastChange = change;
    notifyListeners();
    _scheduleAutosave();
  }

  // ------------------------------------------------------------ persistence

  void _scheduleAutosave() {
    if (repository == null) return;
    _autosaveTimer?.cancel();
    _autosaveTimer = Timer(autosaveDelay, () {
      saveNow().catchError((Object e) {
        _errors.add(ProjectStoreError('Autosave failed: $e', cause: e, isSave: true));
      });
    });
  }

  /// Flushes the current project to the repository immediately. Concurrent
  /// saves are serialized. Returns after the data is durably written (or
  /// reports via [errors] and leaves the store dirty).
  Future<void> saveNow() async {
    _autosaveTimer?.cancel();
    final repo = repository;
    if (repo == null) return;
    // Recover the chain after a previous failure so one bad save does not
    // block all later ones.
    _saveQueue =
        _saveQueue.catchError((Object _) {}).then((_) => _performSave(repo));
    return _saveQueue;
  }

  Future<void> _performSave(ProjectRepository repo) async {
    _isSaving = true;
    notifyListeners();
    try {
      await repo.saveProject(_project);
      _isDirty = false;
    } catch (e) {
      _errors.add(ProjectStoreError('Save failed: $e', cause: e, isSave: true));
      rethrow;
    } finally {
      _isSaving = false;
      notifyListeners();
    }
  }

  /// Cancels timers and, when dirty, performs a final save.
  Future<void> close() async {
    _autosaveTimer?.cancel();
    if (_isDirty && repository != null) {
      await saveNow().catchError((Object _) {});
    }
    await _errors.close();
  }

  /// Serializes the current state — useful for snapshots and tests.
  String serialize() => ProjectSerializer.serialize(_project);

  @override
  void dispose() {
    _autosaveTimer?.cancel();
    if (!_errors.isClosed) _errors.close();
    super.dispose();
  }
}

/// Re-exported for convenience so UI code needs one import.
typedef EditOperation = EditOp;
