import 'dart:convert';

import '../model/edit_project.dart';

/// Hand-written JSON (de)serialization for [EditProject].
///
/// Format v1: a single JSON object with `formatVersion` plus the model maps.
/// Unknown keys are dropped when loading (forward-compat policy: old readers
/// ignore new data; bump `formatVersion` for breaking changes).
/// See docs/PROJECT_CONTRACT.md §7.
class ProjectSerializer {
  ProjectSerializer._();

  static const int formatVersion = 1;

  static String serialize(EditProject project) =>
      const JsonEncoder.withIndent('  ').convert(toJson(project));

  static EditProject deserialize(String source) {
    final Object? decoded;
    try {
      decoded = jsonDecode(source);
    } on FormatException catch (e) {
      throw FormatException('Project file is not valid JSON: ${e.message}');
    }
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Project file must contain a JSON object');
    }
    return fromJson(decoded);
  }

  static Map<String, dynamic> toJson(EditProject project) {
    final json = project.toJson();
    json['formatVersion'] = formatVersion;
    return json;
  }

  static EditProject fromJson(Map<String, dynamic> json) {
    final version = (json['formatVersion'] as num?)?.toInt();
    if (version == null) {
      throw const FormatException('Missing formatVersion');
    }
    if (version > formatVersion) {
      throw FormatException(
          'Project formatVersion $version is newer than supported $formatVersion');
    }
    final project = EditProject.fromJson(json);
    if (project.id.isEmpty) {
      throw const FormatException('Project id is missing');
    }
    return project;
  }
}
