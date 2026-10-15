import '../model/edit_project.dart';

/// Bounded undo/redo history of project roots.
///
/// Because the model is immutable, history is just saved pointers — undo and
/// redo are O(1) swaps with structural sharing between roots.
class UndoStack {
  UndoStack({this.limit = 100}) : assert(limit > 0);

  final int limit;
  final List<EditProject> _undo = [];
  final List<EditProject> _redo = [];

  bool get canUndo => _undo.isNotEmpty;
  bool get canRedo => _redo.isNotEmpty;
  int get undoDepth => _undo.length;
  int get redoDepth => _redo.length;

  /// Records [previous] before a new edit lands. Clears the redo branch.
  void push(EditProject previous) {
    _undo.add(previous);
    if (_undo.length > limit) _undo.removeAt(0);
    _redo.clear();
  }

  /// Steps back; returns the restored root or null when nothing to undo.
  EditProject? undo(EditProject current) {
    if (_undo.isEmpty) return null;
    final prev = _undo.removeLast();
    _redo.add(current);
    return prev;
  }

  /// Steps forward; returns the restored root or null when nothing to redo.
  EditProject? redo(EditProject current) {
    if (_redo.isEmpty) return null;
    final next = _redo.removeLast();
    _undo.add(current);
    return next;
  }

  void clear() {
    _undo.clear();
    _redo.clear();
  }
}
