import '../model/edit_project.dart';

/// What a committed change touched, so the UI can react selectively.
enum ChangeKind { loaded, structure, clips, assets, metadata, restored }

/// Machine-readable failure reasons. Ops never throw for user-logic errors;
/// they return [OpFailure]. See docs/PROJECT_CONTRACT.md §6.
enum OpErrorCode {
  trackNotFound,
  trackLocked,
  clipNotFound,
  assetNotFound,
  overlap,
  invalidRange,
  incompatibleTrack,
  incompatibleAsset,
  outOfBounds,
}

/// Result of a pure edit operation.
sealed class OpResult {
  const OpResult();

  R when<R>({
    required R Function(EditProject project, ChangeKind change) success,
    required R Function(OpErrorCode code, String message) failure,
  }) => switch (this) {
        OpSuccess(:final project, :final change) => success(project, change),
        OpFailure(:final code, :final message) => failure(code, message),
      };

  EditProject? get projectOrNull =>
      switch (this) { OpSuccess(:final project) => project, _ => null };

  OpFailure? get failureOrNull =>
      switch (this) { OpFailure f => f, _ => null };
}

final class OpSuccess extends OpResult {
  const OpSuccess(this.project, [this.change = ChangeKind.clips]);

  final EditProject project;
  final ChangeKind change;
}

final class OpFailure extends OpResult {
  const OpFailure(this.code, this.message);

  final OpErrorCode code;
  final String message;

  @override
  String toString() => 'OpFailure(${code.name}: $message)';
}

/// A deferred operation: the UI stores these as closures and hands them to
/// `ProjectStore.apply`.
typedef EditOp = OpResult Function(EditProject project);
