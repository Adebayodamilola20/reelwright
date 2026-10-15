import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

import '../api/playback_port.dart';
import '../api/timeline_model.dart';

/// INTERIM implementation (Agent 2): a frame-cadence transport clock that
/// drives the playhead and proxy preview so the whole editing loop is usable
/// before the real render engine exists.
///
/// Honesty contract: this advances *time*, it does not decode video. The
/// preview monitor must show a "proxy preview" badge while no real
/// [PreviewSink] is attached (see ProxyPreviewBadge). When Agent 1's engine
/// lands, the contract adapter implements [PlaybackPort] over it and the
/// badge disappears.
class LocalPlaybackPort implements PlaybackPort {
  LocalPlaybackPort();

  PlaybackStatus _status = const PlaybackStatus();
  final _changes = ChangeNotifier();
  TimelineDocument? _doc;
  Ticker? _ticker;
  DateTime? _lastTick;
  PreviewSink? _sink;
  final _subs = <StreamSubscription>[];

  @override
  PlaybackStatus get status => _status;

  @override
  Listenable get changes => _changes;

  void _set(PlaybackStatus next) {
    if (next == _status) return;
    _status = next;
    _changes.notifyListeners();
  }

  @override
  Future<void> open(TimelineDocument document) async {
    await close();
    _doc = document;
    _set(PlaybackStatus(
      state: PlaybackState.ready,
      positionMicros: 0,
      durationMicros: document.durationMicros,
      isPlaying: false,
    ));
  }

  @override
  Future<void> close() async {
    _ticker?.dispose();
    _ticker = null;
    for (final s in _subs) {
      await s.cancel();
    }
    _doc = null;
    _set(const PlaybackStatus());
  }

  @override
  Future<void> play() async {
    final doc = _doc;
    if (doc == null || doc.durationMicros <= 0) return;
    if (_status.isPlaying) return;
    // restart from the beginning when at the tail
    final startAt = _status.positionMicros >= doc.durationMicros
        ? 0
        : _status.positionMicros;
    _lastTick = null;
    _ticker?.dispose();
    _ticker = Ticker(_onTick)..start();
    _set(_status.copyWith(
      state: PlaybackState.ready,
      positionMicros: startAt,
      isPlaying: true,
      errorMessage: () => null,
    ));
  }

  void _onTick(Duration elapsed) {
    final doc = _doc;
    if (doc == null) return;
    final now = DateTime.now();
    final last = _lastTick ?? now;
    _lastTick = now;
    var next = _status.positionMicros +
        now.difference(last).inMicroseconds;
    if (next >= doc.durationMicros) {
      next = doc.durationMicros;
      _ticker?.dispose();
      _ticker = null;
      _set(_status.copyWith(
        positionMicros: next,
        isPlaying: false,
        currentClipId: () => null,
      ));
      return;
    }
    _set(_status.copyWith(
      positionMicros: next,
      currentClipId: () => _clipAt(doc, next),
    ));
  }

  String? _clipAt(TimelineDocument doc, int micros) {
    for (final track in doc.tracks) {
      if (track.kind == TrackKind.audio) continue;
      for (final c in track.clips) {
        if (micros >= c.startMicros && micros < c.endMicros) return c.id;
      }
    }
    return null;
  }

  @override
  Future<void> pause() async {
    _ticker?.dispose();
    _ticker = null;
    _lastTick = null;
    _set(_status.copyWith(isPlaying: false));
  }

  @override
  Future<void> togglePlayPause() async {
    if (_status.isPlaying) {
      await pause();
    } else {
      await play();
    }
  }

  @override
  Future<void> seek(int positionMicros) async {
    final doc = _doc;
    final duration = doc?.durationMicros ?? 0;
    final clamped = positionMicros < 0
        ? 0
        : (duration > 0 && positionMicros > duration ? duration : positionMicros);
    _lastTick = null;
    _set(_status.copyWith(
      positionMicros: clamped,
      currentClipId: () => doc == null ? null : _clipAt(doc, clamped),
    ));
  }

  @override
  Future<void> stepFrames(int frames, {required double frameRate}) async {
    final usPerFrame = (1000000 / frameRate).round();
    await seek(_status.positionMicros + frames * usPerFrame);
  }

  @override
  void attachSink(PreviewSink sink) {
    _sink = sink;
    sink.attach();
  }

  @override
  void detachSink() {
    _sink?.detach();
    _sink = null;
  }

  bool get hasAttachedSink => _sink != null;

  void dispose() {
    _ticker?.dispose();
    for (final s in _subs) {
      unawaited(s.cancel());
    }
    _changes.dispose();
  }
}
