import 'dart:math' as math;

import '../model/clip.dart';
import '../model/edit_project.dart';
import '../model/media_asset.dart';
import '../model/track.dart';
import '../model/types.dart';
import '../ops/keyframe_evaluator.dart';

/// A clip that is visible/audible at the queried playhead, with all
/// playhead-dependent values already evaluated. This is the single input a
/// preview renderer needs (docs/PROJECT_CONTRACT.md §9).
class ResolvedClip {
  const ResolvedClip({
    required this.clip,
    required this.asset,
    required this.trackIndex,
    required this.trackKind,
    required this.trackMuted,
    required this.sourceOffsetUs,
    required this.opacity,
    required this.volume,
    required this.x,
    required this.y,
    required this.scale,
    required this.rotationDeg,
    this.transitionInProgress,
  });

  final Clip clip;
  final MediaAsset? asset;
  final int trackIndex; // higher = rendered on top (video tracks)
  final TrackKind trackKind;
  final bool trackMuted;

  /// Source position (µs, speed-adjusted) matching the playhead.
  final int sourceOffsetUs;

  /// Keyframe-evaluated property values.
  final double opacity;
  final double volume;
  final double x;
  final double y;
  final double scale;
  final double rotationDeg;

  /// 0..1 progress through the clip's transition-in, or null when not in a
  /// transition window (or the transition is a cut).
  final double? transitionInProgress;
}

/// Pure compositor math: what the frame at [playheadUs] consists of.
///
/// Layering: tracks are walked bottom (index 0) upward; the returned list is
/// in paint order — render each entry in order. Hidden video/text tracks are
/// skipped; muted audio tracks are still returned (with [trackMuted] set) so
/// an audio renderer can decide.
class TimelineComposer {
  TimelineComposer._();

  static List<ResolvedClip> resolveAt(EditProject project, int playheadUs) {
    final out = <ResolvedClip>[];
    for (var i = 0; i < project.tracks.length; i++) {
      final track = project.tracks[i];
      if (track.kind != TrackKind.audio && track.hidden) continue;
      for (final clip in track.clips) {
        final resolved =
            _resolveClip(project, track, i, clip, playheadUs);
        if (resolved != null) out.add(resolved);
      }
    }
    return out;
  }

  static ResolvedClip? _resolveClip(
    EditProject project,
    Track track,
    int trackIndex,
    Clip clip,
    int playheadUs,
  ) {
    if (playheadUs < clip.timelineStartUs ||
        playheadUs >= clip.timelineEndUs) {
      return null;
    }
    final rel = playheadUs - clip.timelineStartUs;
    final sourceOffsetUs =
        clip.sourceInUs + (rel * clip.speed).round();

    double? transitionProgress;
    final ti = clip.transitionIn;
    if (ti != null &&
        ti.type != TransitionType.cut &&
        ti.durationUs > 0 &&
        rel < ti.durationUs) {
      final span = math.min(ti.durationUs, clip.durationUs).toDouble();
      transitionProgress = (rel / span).clamp(0.0, 1.0).toDouble();
    }

    final t = clip.transform;
    return ResolvedClip(
      clip: clip,
      asset: clip.assetId == null ? null : project.findAsset(clip.assetId!),
      trackIndex: trackIndex,
      trackKind: track.kind,
      trackMuted: track.muted,
      sourceOffsetUs: sourceOffsetUs,
      opacity: KeyframeEvaluator.evaluateClipProperty(
              clip, KeyframeProperty.opacity, rel, clip.opacity)
          .clamp(0.0, 1.0)
          .toDouble(),
      volume: KeyframeEvaluator.evaluateClipProperty(
              clip, KeyframeProperty.volume, rel, clip.volume)
          .clamp(0.0, 2.0)
          .toDouble(),
      x: KeyframeEvaluator.evaluateClipProperty(
          clip, KeyframeProperty.x, rel, t.x),
      y: KeyframeEvaluator.evaluateClipProperty(
          clip, KeyframeProperty.y, rel, t.y),
      scale: KeyframeEvaluator.evaluateClipProperty(
              clip, KeyframeProperty.scale, rel, t.scale)
          .clamp(0.0, 100.0)
          .toDouble(),
      rotationDeg: KeyframeEvaluator.evaluateClipProperty(
          clip, KeyframeProperty.rotationDeg, rel, t.rotationDeg),
      transitionInProgress: transitionProgress,
    );
  }

  /// Audio gain multiplier at [playheadUs] for one clip: keyframed volume ×
  /// fades. 0..2.
  static double audioGainAt(Clip clip, int playheadUs) {
    final rel = playheadUs - clip.timelineStartUs;
    final keyframed = KeyframeEvaluator.evaluateClipProperty(
        clip, KeyframeProperty.volume, rel, clip.volume);
    final fade = fadeGainAt(rel, clip.durationUs, clip.fadeInUs, clip.fadeOutUs);
    final gain = keyframed * fade;
    return gain < 0 ? 0 : gain > 2 ? 2 : gain;
  }
}
