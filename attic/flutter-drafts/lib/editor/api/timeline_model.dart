import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import 'ports.dart';

/// Timeline model as the UI sees it (Owner: Agent 2's interface requirements;
/// semantics owned jointly — mutations must route through Agent 1's
/// command/undo stack once the contract lands).
///
/// All times are integer **microseconds**. Display timecode derives from the
/// project frame rate.
library;

enum TrackKind { video, overlay, text, audio }

// ---------------------------------------------------------------------------
// Property payloads — the inspector edits these; contract must carry them
// (as typed fields or a documented extras map; see docs/TEAM_STATUS.md req #6)
// ---------------------------------------------------------------------------

@immutable
class TransformProps {
  const TransformProps({
    this.x = 0,
    this.y = 0,
    this.scale = 1.0,
    this.rotationDeg = 0.0,
    this.opacity = 1.0,
  });

  /// Normalized offsets relative to frame center (-1..1) / scale multiplier.
  final double x;
  final double y;
  final double scale;
  final double rotationDeg;
  final double opacity;

  static const defaults = TransformProps();

  TransformProps copyWith({
    double? x,
    double? y,
    double? scale,
    double? rotationDeg,
    double? opacity,
  }) =>
      TransformProps(
        x: x ?? this.x,
        y: y ?? this.y,
        scale: scale ?? this.scale,
        rotationDeg: rotationDeg ?? this.rotationDeg,
        opacity: opacity ?? this.opacity,
      );
}

@immutable
class AudioProps {
  const AudioProps({
    this.volumeDb = 0.0,
    this.fadeInMicros = 0,
    this.fadeOutMicros = 0,
    this.muted = false,
  });

  /// Gain in decibels; 0 = unity. UI exposes it as a -60..+12 dB slider.
  final double volumeDb;
  final int fadeInMicros;
  final int fadeOutMicros;
  final bool muted;

  static const defaults = AudioProps();

  /// Convenience 0..1 linear gain for meters and sliders.
  double get linearGain => volumeDb <= -60 ? 0 : math.pow(10, volumeDb / 20).toDouble();

  AudioProps copyWith({
    double? volumeDb,
    int? fadeInMicros,
    int? fadeOutMicros,
    bool? muted,
  }) =>
      AudioProps(
        volumeDb: volumeDb ?? this.volumeDb,
        fadeInMicros: fadeInMicros ?? this.fadeInMicros,
        fadeOutMicros: fadeOutMicros ?? this.fadeOutMicros,
        muted: muted ?? this.muted,
      );
}

enum TextAlignOption { left, center, right }

@immutable
class TextProps {
  const TextProps({
    this.content = '',
    this.fontFamily,
    this.fontSize = 48,
    this.fontWeight = 600,
    this.color = 0xFFFFFFFF,
    this.alignment = TextAlignOption.center,
    this.backgroundColor,
    this.strokeWidth = 0,
    this.strokeColor = 0xFF000000,
    this.isCaption = false,
  });

  final String content;
  final String? fontFamily;
  final double fontSize;
  final int fontWeight;

  /// ARGB.
  final int color;
  final TextAlignOption alignment;
  final int? backgroundColor;
  final double strokeWidth;
  final int strokeColor;

  /// True when the clip came from transcription/caption flow (styling presets
  /// for captions apply).
  final bool isCaption;

  static const defaults = TextProps();

  TextProps copyWith({
    String? content,
    String? Function()? fontFamily,
    double? fontSize,
    int? fontWeight,
    int? color,
    TextAlignOption? alignment,
    int? Function()? backgroundColor,
    double? strokeWidth,
    int? strokeColor,
    bool? isCaption,
  }) =>
      TextProps(
        content: content ?? this.content,
        fontFamily: fontFamily != null ? fontFamily() : this.fontFamily,
        fontSize: fontSize ?? this.fontSize,
        fontWeight: fontWeight ?? this.fontWeight,
        color: color ?? this.color,
        alignment: alignment ?? this.alignment,
        backgroundColor:
            backgroundColor != null ? backgroundColor() : this.backgroundColor,
        strokeWidth: strokeWidth ?? this.strokeWidth,
        strokeColor: strokeColor ?? this.strokeColor,
        isCaption: isCaption ?? this.isCaption,
      );
}

@immutable
class SpeedProps {
  const SpeedProps({this.factor = 1.0, this.maintainPitch = true});
  final double factor;
  final bool maintainPitch;

  static const defaults = SpeedProps();

  SpeedProps copyWith({double? factor, bool? maintainPitch}) => SpeedProps(
        factor: factor ?? this.factor,
        maintainPitch: maintainPitch ?? this.maintainPitch,
      );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

@immutable
class TimelineClip {
  const TimelineClip({
    required this.id,
    required this.trackId,
    required this.kind,
    this.assetId,
    required this.label,
    required this.startMicros,
    required this.durationMicros,
    required this.sourceInMicros,
    this.transform = TransformProps.defaults,
    this.audio = AudioProps.defaults,
    this.text = TextProps.defaults,
    this.speed = SpeedProps.defaults,
    this.transitionInMicros = 0,
    this.transitionOutMicros = 0,
    this.thumbColor = 0xFF3E6C8F,
  });

  final String id;
  final String trackId;

  /// What the clip *is* on the timeline (a text clip may reference no asset).
  final MediaKind kind;
  final String? assetId;
  final String label;
  /// Timeline position (project time) and length on the timeline.
  final int startMicros;
  final int durationMicros;

  /// Source media window: offset into the source and covered length.
  final int sourceInMicros;

  final TransformProps transform;
  final AudioProps audio;
  final TextProps text;
  final SpeedProps speed;

  final int transitionInMicros;
  final int transitionOutMicros;

  /// Swatch used until real thumbnails exist (UI fallback only).
  final int thumbColor;

  int get endMicros => startMicros + durationMicros;

  /// Source length consumed (out point).
  int get sourceOutMicros => sourceInMicros + durationMicros;

  TimelineClip copyWith({
    String? trackId,
    String? assetId,
    String? label,
    int? startMicros,
    int? durationMicros,
    int? sourceInMicros,
    TransformProps? transform,
    AudioProps? audio,
    TextProps? text,
    SpeedProps? speed,
    int? transitionInMicros,
    int? transitionOutMicros,
    int? thumbColor,
  }) {
    return TimelineClip(
      id: id,
      trackId: trackId ?? this.trackId,
      assetId: assetId ?? this.assetId,
      kind: kind,
      label: label ?? this.label,
      startMicros: startMicros ?? this.startMicros,
      durationMicros: durationMicros ?? this.durationMicros,
      sourceInMicros: sourceInMicros ?? this.sourceInMicros,
      transform: transform ?? this.transform,
      audio: audio ?? this.audio,
      text: text ?? this.text,
      speed: speed ?? this.speed,
      transitionInMicros: transitionInMicros ?? this.transitionInMicros,
      transitionOutMicros: transitionOutMicros ?? this.transitionOutMicros,
      thumbColor: thumbColor ?? this.thumbColor,
    );
  }
}

@immutable
class TimelineTrack {
  const TimelineTrack({
    required this.id,
    required this.kind,
    required this.name,
    this.clips = const [],
    this.locked = false,
    this.muted = false,
    this.hidden = false,
  });

  final String id;
  final TrackKind kind;
  final String name;

  /// Clips on this track, ordered by [TimelineClip.startMicros].
  final List<TimelineClip> clips;
  final bool locked;
  final bool muted;
  final bool hidden;

  double get heightPx => switch (kind) {
        TrackKind.video => 64,
        TrackKind.overlay => 52,
        TrackKind.text => 44,
        TrackKind.audio => 56,
      };

  TimelineTrack copyWith({
    String? name,
    List<TimelineClip>? clips,
    bool? locked,
    bool? muted,
    bool? hidden,
  }) =>
      TimelineTrack(
        id: id,
        kind: kind,
        name: name ?? this.name,
        clips: clips ?? this.clips,
        locked: locked ?? this.locked,
        muted: muted ?? this.muted,
        hidden: hidden ?? this.hidden,
      );
}

@immutable
class TimelineDocument {
  const TimelineDocument({
    required this.projectId,
    required this.frameRate,
    required this.tracks,
    required this.durationMicros,
    this.backgroundColor = 0xFF000000,
    this.width = 1920,
    this.height = 1080,
  });

  final String projectId;

  /// Project frame rate used for snapping/timecode/preview cadence.
  final double frameRate;
  final List<TimelineTrack> tracks;
  final int durationMicros;
  final int backgroundColor;
  final int width;
  final int height;

  static final empty = TimelineDocument(
    projectId: '',
    frameRate: 30,
    durationMicros: 0,
    tracks: const [],
  );

  TimelineClip? clipById(String id) {
    for (final t in tracks) {
      for (final c in t.clips) {
        if (c.id == id) return c;
      }
    }
    return null;
  }

  Iterable<TimelineClip> get allClips sync* {
    for (final t in tracks) {
      yield* t.clips;
    }
  }
}
