import 'package:flutter/foundation.dart';

import 'timeline_model.dart';

/// Preview monitor / playback port (Agent 2's required surface; Agent 1 owns
/// the engine behind it once the contract lands).
library;

enum PlaybackState { idle, loading, ready, buffering, error }

@immutable
class PlaybackStatus {
  const PlaybackStatus({
    this.state = PlaybackState.idle,
    this.positionMicros = 0,
    this.durationMicros = 0,
    this.isPlaying = false,
    this.errorMessage,
    this.currentClipId,
  });

  final PlaybackState state;
  final int positionMicros;
  final int durationMicros;
  final bool isPlaying;

  /// Populated when [state] == error (honest failure surface).
  final String? errorMessage;

  /// Clip under the playhead — lets the monitor show a proxy/placeholder with
  /// the right label while the real engine is not connected.
  final String? currentClipId;

  double get progress =>
      durationMicros == 0 ? 0 : positionMicros / durationMicros;

  PlaybackStatus copyWith({
    PlaybackState? state,
    int? positionMicros,
    int? durationMicros,
    bool? isPlaying,
    String? Function()? errorMessage,
    String? Function()? currentClipId,
  }) =>
      PlaybackStatus(
        state: state ?? this.state,
        positionMicros: positionMicros ?? this.positionMicros,
        durationMicros: durationMicros ?? this.durationMicros,
        isPlaying: isPlaying ?? this.isPlaying,
        errorMessage:
            errorMessage != null ? errorMessage() : this.errorMessage,
        currentClipId:
            currentClipId != null ? currentClipId() : this.currentClipId,
      );
}

/// Where decoded frames should be composited.
///
/// The adapter binds a platform view / texture id; the UI only decides where
/// it sits. When no sink is attached the monitor shows an honest placeholder.
abstract class PreviewSink {
  void attach();
  void detach();
}

abstract class PlaybackPort {
  PlaybackStatus get status;
  Listenable get changes;

  Future<void> open(TimelineDocument document);
  Future<void> close();

  Future<void> play();
  Future<void> pause();
  Future<void> togglePlayPause();
  Future<void> seek(int positionMicros);

  /// Step exactly one frame (arrow-key stepping).
  Future<void> stepFrames(int frames, {required double frameRate});

  void attachSink(PreviewSink sink);
  void detachSink();
}
