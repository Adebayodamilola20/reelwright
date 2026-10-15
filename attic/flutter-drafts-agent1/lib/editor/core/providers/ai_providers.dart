import 'dart:io';

import '../model/edit_project.dart';

/// Availability of an optional external service. The UI must render tools
/// disabled with the [reason] until a provider reports available — never show
/// a control that cannot work (docs/PROJECT_CONTRACT.md §9, §10).
enum ProviderAvailabilityKind {
  available,
  unavailable,
  requiresNetwork,
  requiresApproval,
}

class ProviderAvailability {
  const ProviderAvailability(this.kind, {this.reason});

  final ProviderAvailabilityKind kind;
  final String? reason;

  bool get isUsable => kind == ProviderAvailabilityKind.available;

  static const available = ProviderAvailability(ProviderAvailabilityKind.available);

  const factory ProviderAvailability.unavailable(String reason) =
      _Unavailable;

  static ProviderAvailability requiresNetwork(String reason) =>
      ProviderAvailability(ProviderAvailabilityKind.requiresNetwork,
          reason: reason);

  static ProviderApproval pending(String reason) =>
      ProviderApproval(ProviderAvailabilityKind.requiresApproval, reason);
}

class _Unavailable extends ProviderAvailability {
  const _Unavailable(String reason)
      : super(ProviderAvailabilityKind.unavailable, reason: reason);
}

/// Alias kept for readability at call sites.
typedef ProviderApproval = ProviderAvailability;

/// Base for all optional AI/service providers wired into the editor.
/// No implementation may make a network call without the owner's approval.
abstract class AiProvider {
  String get name;
  ProviderAvailability get availability;
}

/// Speech-to-text: audio → timed segments in canonical µs.
class TimedTextSegment {
  const TimedTextSegment({
    required this.startUs,
    required this.endUs,
    required this.text,
    this.confidence,
  });

  final int startUs;
  final int endUs;
  final String text;
  final double? confidence;
}

abstract class TranscriptionProvider extends AiProvider {
  Future<List<TimedTextSegment>> transcribe(File audio,
      {String? languageCode});
}

abstract class BackgroundRemovalProvider extends AiProvider {
  /// Returns a new file (e.g. RGBA video/image) with the background removed.
  Future<File> removeBackground(File input);
}

abstract class VoiceSynthesisProvider extends AiProvider {
  Future<File> synthesize(String text, {String? voiceId, double? rate});
}

/// Scene/clip search over the project's media library.
class ClipSearchHit {
  const ClipSearchHit({required this.assetId, required this.score, this.note});

  final String assetId;
  final double score;
  final String? note;
}

abstract class ClipSearchProvider extends AiProvider {
  Future<List<ClipSearchHit>> search(EditProject project, String query);
}
