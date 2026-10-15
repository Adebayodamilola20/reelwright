import 'dart:async';

import '../model/edit_project.dart';

/// Playback boundary (docs/PROJECT_CONTRACT.md §9).
///
/// Slice 1 ships [NullPlaybackEngine] only. The transport UI must consult
/// [isAvailable] and disable itself with [unavailableReason] until a real
/// engine is integrated — never pretend to play.
abstract class PlaybackEngine {
  /// False when this engine cannot actually render audio/video.
  bool get isAvailable;
  String? get unavailableReason;

  bool get isPlaying;
  int get positionUs;
  double get rate;

  /// Emits the playhead position in µs while playing (and on seeks).
  Stream<int> get positionUsStream;

  Future<void> setProject(EditProject project);
  Future<void> play();
  Future<void> pause();
  Future<void> seekUs(int positionUs);
  Future<void> setRate(double rate);
  Future<void> dispose();
}

/// Placeholder engine: holds a position, reports paused, never renders.
/// Honest about being unavailable; usable by the UI for scrub-state tests.
class NullPlaybackEngine implements PlaybackEngine {
  final StreamController<int> _positions = StreamController<int>.broadcast();
  EditProject? _project;
  int _positionUs = 0;
  double _rate = 1.0;

  @override
  bool get isAvailable => false;

  @override
  String? get unavailableReason =>
      'Preview playback needs the media engine, which is not integrated yet';

  @override
  bool get isPlaying => false;

  @override
  int get positionUs => _positionUs;

  @override
  double get rate => _rate;

  EditProject? get project => _project;

  @override
  Stream<int> get positionUsStream => _positions.stream;

  @override
  Future<void> setProject(EditProject project) async {
    _project = project;
    if (_positionUs > project.durationUs) {
      await seekUs(project.durationUs);
    }
  }

  @override
  Future<void> play() async {
    // Not available — stays paused. See unavailableReason.
  }

  @override
  Future<void> pause() async {}

  @override
  Future<void> seekUs(int positionUs) async {
    _positionUs = positionUs < 0 ? 0 : positionUs;
    if (!_positions.isClosed) _positions.add(_positionUs);
  }

  @override
  Future<void> setRate(double rate) async {
    if (rate > 0) _rate = rate;
  }

  @override
  Future<void> dispose() async {
    await _positions.close();
  }
}
