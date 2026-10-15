import 'dart:math';

/// Opaque id generation for editor entities. Ids are stable strings and are
/// the only identity a persisted project keeps, so never reuse them.
final Random _rng = Random();

String newId(String prefix) {
  final ts = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
  final r = (_rng.nextInt(1 << 30)).toRadixString(36);
  return '${prefix}_${ts}$r';
}

String newProjectId() => newId('p');
String newAssetId() => newId('a');
String newTrackId() => newId('t');
String newClipId() => newId('c');
