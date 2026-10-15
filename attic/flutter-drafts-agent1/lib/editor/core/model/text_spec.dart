import 'types.dart';
import 'copy_with.dart';

/// Visual specification for a text clip.
///
/// Sizes and padding are in project-resolution pixels (default project is
/// 1920x1080, fontSize default 48).
class TextSpec {
  const TextSpec({
    required this.text,
    this.fontFamily,
    this.fontSize = 48,
    this.color = 0xFFFFFFFF,
    this.backgroundColor = 0x00000000,
    this.bold = false,
    this.italic = false,
    this.underline = false,
    this.alignment = TextAlignment.center,
    this.borderWidth = 0,
    this.borderColor = 0xFF000000,
    this.boxPadding = 8,
  });

  final String text;
  final String? fontFamily;
  final double fontSize;
  final int color; // ARGB
  final int backgroundColor; // ARGB, default transparent
  final bool bold;
  final bool italic;
  final bool underline;
  final TextAlignment alignment;
  final double borderWidth;
  final int borderColor; // ARGB
  final double boxPadding;

  TextSpec copyWith({
    Object? text = unsetParam,
    Object? fontFamily = unsetParam,
    Object? fontSize = unsetParam,
    Object? color = unsetParam,
    Object? backgroundColor = unsetParam,
    Object? bold = unsetParam,
    Object? italic = unsetParam,
    Object? underline = unsetParam,
    Object? alignment = unsetParam,
    Object? borderWidth = unsetParam,
    Object? borderColor = unsetParam,
    Object? boxPadding = unsetParam,
  }) {
    T pick<T>(Object? v, T current) =>
        identical(v, unsetParam) ? current : v as T;
    return TextSpec(
      text: pick(text, this.text) as String,
      fontFamily: pick(fontFamily, this.fontFamily) as String?,
      fontSize: pick(fontSize, this.fontSize) as double,
      color: pick(color, this.color) as int,
      backgroundColor: pick(backgroundColor, this.backgroundColor) as int,
      bold: pick(bold, this.bold) as bool,
      italic: pick(italic, this.italic) as bool,
      underline: pick(underline, this.underline) as bool,
      alignment: pick(alignment, this.alignment) as TextAlignment,
      borderWidth: pick(borderWidth, this.borderWidth) as double,
      borderColor: pick(borderColor, this.borderColor) as int,
      boxPadding: pick(boxPadding, this.boxPadding) as double,
    );
  }

  Map<String, dynamic> toJson() => {
        'text': text,
        if (fontFamily != null) 'fontFamily': fontFamily,
        'fontSize': fontSize,
        'color': color,
        'backgroundColor': backgroundColor,
        'bold': bold,
        'italic': italic,
        'underline': underline,
        'alignment': alignment.name,
        'borderWidth': borderWidth,
        'borderColor': borderColor,
        'boxPadding': boxPadding,
      };

  factory TextSpec.fromJson(Map<String, dynamic> json) {
    double d(Object? v, double fb) => v is num ? v.toDouble() : fb;
    return TextSpec(
      text: json['text'] as String? ?? '',
      fontFamily: json['fontFamily'] as String?,
      fontSize: d(json['fontSize'], 48),
      color: (json['color'] as num?)?.toInt() ?? 0xFFFFFFFF,
      backgroundColor: (json['backgroundColor'] as num?)?.toInt() ?? 0x00000000,
      bold: json['bold'] as bool? ?? false,
      italic: json['italic'] as bool? ?? false,
      underline: json['underline'] as bool? ?? false,
      alignment: EnumJson.fromJsonName(TextAlignment.values,
          json['alignment'] as String?, TextAlignment.center),
      borderWidth: d(json['borderWidth'], 0),
      borderColor: (json['borderColor'] as num?)?.toInt() ?? 0xFF000000,
      boxPadding: d(json['boxPadding'], 8),
    );
  }
}
