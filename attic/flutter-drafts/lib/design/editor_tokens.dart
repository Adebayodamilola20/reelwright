import 'package:flutter/material.dart';

/// Design tokens for the video studio experience.
///
/// Owner: Agent 2. Original identity for the product — internal codename
/// **Reelkit** (working name; not derived from any existing product's branding).
/// Dark-first, high-contrast, dense-but-readable, in line with professional
/// editing tools while honoring the app's light/dark themeMode.
///
/// Attached to [ThemeData] via [ThemeExtension], so widgets read it with
/// `Theme.of(context).extension<EditorColors>()`.
@immutable
class EditorColors extends ThemeExtension<EditorColors> {
  const EditorColors({
    required this.panel,
    required this.panelElevated,
    required this.panelSunken,
    required this.border,
    required this.borderStrong,
    required this.textPrimary,
    required this.textSecondary,
    required this.textFaint,
    required this.accent,
    required this.accentSoft,
    required this.onAccent,
    required this.danger,
    required this.warning,
    required this.success,
    required this.trackBackground,
    required this.rulerBackground,
    required this.clipVideo,
    required this.clipAudio,
    required this.clipText,
    required this.clipOverlay,
    required this.playhead,
    required this.selection,
    required this.scrim,
    required this.isDark,
  });

  // Surfaces.
  final Color panel;
  final Color panelElevated;
  final Color panelSunken;
  final Color border;
  final Color borderStrong;

  // Text.
  final Color textPrimary;
  final Color textSecondary;
  final Color textFaint;

  // Semantic.
  final Color accent;
  final Color accentSoft;
  final Color onAccent;
  final Color danger;
  final Color warning;
  final Color success;

  // Timeline-specific.
  final Color trackBackground;
  final Color rulerBackground;
  final Color clipVideo;
  final Color clipAudio;
  final Color clipText;
  final Color clipOverlay;
  final Color playhead;
  final Color selection;

  final Color scrim;
  final bool isDark;

  static EditorColors dark() => const EditorColors(
        panel: Color(0xFF121316),
        panelElevated: Color(0xFF1A1C21),
        panelSunken: Color(0xFF0C0D10),
        border: Color(0xFF2A2D34),
        borderStrong: Color(0xFF3C4049),
        textPrimary: Color(0xFFF2F3F5),
        textSecondary: Color(0xFF9CA3AF),
        textFaint: Color(0xFF6B7280),
        accent: Color(0xFF7C6CFF),
        accentSoft: Color(0x337C6CFF),
        onAccent: Colors.white,
        danger: Color(0xFFFF5C6C),
        warning: Color(0xFFF5B942),
        success: Color(0xFF3ECF8E),
        trackBackground: Color(0xFF16181D),
        rulerBackground: Color(0xFF0F1013),
        clipVideo: Color(0xFF3E6C8F),
        clipAudio: Color(0xFF2F7D5B),
        clipText: Color(0xFF8A5CD6),
        clipOverlay: Color(0xFFB0762F),
        playhead: Color(0xFFFF4D5E),
        selection: Color(0xFF7C6CFF),
        scrim: Color(0x99000000),
        isDark: true,
      );

  static EditorColors light() => const EditorColors(
        panel: Color(0xFFF7F8FA),
        panelElevated: Colors.white,
        panelSunken: Color(0xFFECEEF2),
        border: Color(0xFFE0E3E8),
        borderStrong: Color(0xFFC7CCD4),
        textPrimary: Color(0xFF14161A),
        textSecondary: Color(0xFF565C66),
        textFaint: Color(0xFF8B919B),
        accent: Color(0xFF5B4BE0),
        accentSoft: Color(0x1F5B4BE0),
        onAccent: Colors.white,
        danger: Color(0xFFD93049),
        warning: Color(0xFFB67C10),
        success: Color(0xFF12805C),
        trackBackground: Color(0xFFEDEFF3),
        rulerBackground: Color(0xFFF2F4F7),
        clipVideo: Color(0xFF4A7FA8),
        clipAudio: Color(0xFF358C66),
        clipText: Color(0xFF8259CC),
        clipOverlay: Color(0xFFBE8135),
        playhead: Color(0xFFE0293E),
        selection: Color(0xFF5B4BE0),
        scrim: Color(0x66000000),
        isDark: false,
      );

  @override
  EditorColors copyWith({
    Color? panel,
    Color? panelElevated,
    Color? panelSunken,
    Color? border,
    Color? borderStrong,
    Color? textPrimary,
    Color? textSecondary,
    Color? textFaint,
    Color? accent,
    Color? accentSoft,
    Color? onAccent,
    Color? danger,
    Color? warning,
    Color? success,
    Color? trackBackground,
    Color? rulerBackground,
    Color? clipVideo,
    Color? clipAudio,
    Color? clipText,
    Color? clipOverlay,
    Color? playhead,
    Color? selection,
    Color? scrim,
    bool? isDark,
  }) {
    return EditorColors(
      panel: panel ?? this.panel,
      panelElevated: panelElevated ?? this.panelElevated,
      panelSunken: panelSunken ?? this.panelSunken,
      border: border ?? this.border,
      borderStrong: borderStrong ?? this.borderStrong,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textFaint: textFaint ?? this.textFaint,
      accent: accent ?? this.accent,
      accentSoft: accentSoft ?? this.accentSoft,
      onAccent: onAccent ?? this.onAccent,
      danger: danger ?? this.danger,
      warning: warning ?? this.warning,
      success: success ?? this.success,
      trackBackground: trackBackground ?? this.trackBackground,
      rulerBackground: rulerBackground ?? this.rulerBackground,
      clipVideo: clipVideo ?? this.clipVideo,
      clipAudio: clipAudio ?? this.clipAudio,
      clipText: clipText ?? this.clipText,
      clipOverlay: clipOverlay ?? this.clipOverlay,
      playhead: playhead ?? this.playhead,
      selection: selection ?? this.selection,
      scrim: scrim ?? this.scrim,
      isDark: isDark ?? this.isDark,
    );
  }

  @override
  EditorColors lerp(ThemeExtension<EditorColors>? other, double t) {
    if (other is! EditorColors) return this;
    return EditorColors(
      panel: Color.lerp(panel, other.panel, t)!,
      panelElevated: Color.lerp(panelElevated, other.panelElevated, t)!,
      panelSunken: Color.lerp(panelSunken, other.panelSunken, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderStrong: Color.lerp(borderStrong, other.borderStrong, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textFaint: Color.lerp(textFaint, other.textFaint, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
      onAccent: Color.lerp(onAccent, other.onAccent, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      success: Color.lerp(success, other.success, t)!,
      trackBackground: Color.lerp(trackBackground, other.trackBackground, t)!,
      rulerBackground: Color.lerp(rulerBackground, other.rulerBackground, t)!,
      clipVideo: Color.lerp(clipVideo, other.clipVideo, t)!,
      clipAudio: Color.lerp(clipAudio, other.clipAudio, t)!,
      clipText: Color.lerp(clipText, other.clipText, t)!,
      clipOverlay: Color.lerp(clipOverlay, other.clipOverlay, t)!,
      playhead: Color.lerp(playhead, other.playhead, t)!,
      selection: Color.lerp(selection, other.selection, t)!,
      scrim: Color.lerp(scrim, other.scrim, t)!,
      isDark: t < 0.5 ? isDark : other.isDark,
    );
  }
}

/// Non-color design tokens (spacing, radii, motion).
abstract final class EditorSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
}

abstract final class EditorRadii {
  static const double sm = 4;
  static const double md = 8;
  static const double lg = 12;
  static const double pill = 999;
}

abstract final class EditorMotion {
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration normal = Duration(milliseconds: 200);
  static const Duration slow = Duration(milliseconds: 320);
  static const Curve easeOut = Curves.easeOutCubic;
}

/// Builds a complete [ThemeData] for studio surfaces (home + editor).
///
/// Uses the platform/default font family deliberately: no runtime font
/// downloads (google_fonts fetches at first run and fails offline).
ThemeData buildEditorTheme(Brightness brightness) {
  final colors =
      brightness == Brightness.dark ? EditorColors.dark() : EditorColors.light();
  final scheme = ColorScheme(
    brightness: brightness,
    primary: colors.accent,
    onPrimary: colors.onAccent,
    secondary: colors.accent,
    onSecondary: colors.onAccent,
    error: colors.danger,
    onError: Colors.white,
    surface: colors.panel,
    onSurface: colors.textPrimary,
    surfaceContainerHighest: colors.panelElevated,
    surfaceContainerLow: colors.panel,
    surfaceContainer: colors.panelElevated,
    surfaceContainerHigh: colors.panelElevated,
    outline: colors.border,
    outlineVariant: colors.border,
    tertiary: colors.success,
    onTertiary: Colors.white,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: colors.panel,
    canvasColor: colors.panel,
    dividerColor: colors.border,
    extensions: [colors],
    splashFactory: InkSparkle.splashFactory,
    textTheme: ThemeData(brightness: brightness)
        .textTheme
        .apply(bodyColor: colors.textPrimary, displayColor: colors.textPrimary),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: colors.accent,
        foregroundColor: colors.onAccent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EditorRadii.md),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: EditorSpacing.lg,
          vertical: EditorSpacing.sm + 2,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: colors.textPrimary,
        side: BorderSide(color: colors.borderStrong),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EditorRadii.md),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: EditorSpacing.lg,
          vertical: EditorSpacing.sm + 2,
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: colors.accent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EditorRadii.sm),
        ),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: colors.panelElevated,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(EditorRadii.lg),
        side: BorderSide(color: colors.border),
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: colors.panel,
      foregroundColor: colors.textPrimary,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      iconTheme: IconThemeData(color: colors.textSecondary),
      titleTextStyle: TextStyle(
        color: colors.textPrimary,
        fontSize: 16,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.2,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.panelSunken,
      hintStyle: TextStyle(color: colors.textFaint),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: EditorSpacing.md,
        vertical: EditorSpacing.sm + 2,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(EditorRadii.md),
        borderSide: BorderSide(color: colors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(EditorRadii.md),
        borderSide: BorderSide(color: colors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(EditorRadii.md),
        borderSide: BorderSide(color: colors.accent, width: 1.5),
      ),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? colors.accent
            : colors.panelSunken,
      ),
      side: BorderSide(color: colors.borderStrong),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(EditorRadii.sm - 2),
      ),
    ),
    sliderTheme: SliderThemeData(
      activeTrackColor: colors.accent,
      inactiveTrackColor: colors.panelSunken,
      thumbColor: colors.accent,
      overlayColor: colors.accentSoft,
      trackHeight: 4,
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: colors.accent,
      linearTrackColor: colors.panelSunken,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: colors.panelElevated,
      contentTextStyle: TextStyle(color: colors.textPrimary),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(EditorRadii.md),
        side: BorderSide(color: colors.border),
      ),
    ),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(
        color: colors.panelElevated,
        borderRadius: BorderRadius.circular(EditorRadii.sm),
        border: Border.all(color: colors.border),
      ),
      textStyle: TextStyle(color: colors.textPrimary, fontSize: 12),
    ),
    visualDensity: VisualDensity.compact,
  );
}

/// Convenience accessor.
extension EditorColorsX on BuildContext {
  EditorColors get editorColors =>
      Theme.of(this).extension<EditorColors>() ?? EditorColors.dark();
}
