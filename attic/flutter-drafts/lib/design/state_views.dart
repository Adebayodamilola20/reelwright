import 'package:flutter/material.dart';

import 'editor_tokens.dart';

/// Shared empty / loading / error / status building blocks for the studio.
/// Owner: Agent 2. All are presentation-only (no data logic).
library;

/// A friendly empty state: icon, title, message, optional actions.
class EmptyStateView extends StatelessWidget {
  const EmptyStateView({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.primaryAction,
    this.secondaryAction,
    this.compact = false,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? primaryAction;
  final Widget? secondaryAction;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = context.editorColors;
    final pad = compact ? EditorSpacing.lg : EditorSpacing.xxl;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: EdgeInsets.all(pad),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: compact ? 52 : 72,
                height: compact ? 52 : 72,
                decoration: BoxDecoration(
                  color: colors.accentSoft,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  icon,
                  size: compact ? 26 : 34,
                  color: colors.accent,
                  semanticLabel: title,
                ),
              ),
              const SizedBox(height: EditorSpacing.lg),
              Text(
                title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: colors.textPrimary,
                    ),
              ),
              const SizedBox(height: EditorSpacing.sm),
              Text(
                message,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: colors.textSecondary,
                      height: 1.45,
                    ),
              ),
              if (primaryAction != null || secondaryAction != null) ...[
                const SizedBox(height: EditorSpacing.xl),
                Wrap(
                  spacing: EditorSpacing.md,
                  runSpacing: EditorSpacing.sm,
                  alignment: WrapAlignment.center,
                  children: [
                    if (primaryAction != null) primaryAction!,
                    if (secondaryAction != null) secondaryAction!,
                  ],
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// An error state with retry affordance. `details` (if any) is collapsed
/// behind a disclosure so technical messages stay available but secondary.
class ErrorStateView extends StatelessWidget {
  const ErrorStateView({
    super.key,
    required this.title,
    required this.message,
    this.details,
    this.onRetry,
    this.retryLabel = 'Try again',
    this.compact = false,
  });

  final String title;
  final String message;
  final String? details;
  final VoidCallback? onRetry;
  final String retryLabel;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = context.editorColors;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: Padding(
          padding: EdgeInsets.all(compact ? EditorSpacing.lg : EditorSpacing.xxl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline_rounded,
                  size: compact ? 32 : 44, color: colors.danger),
              const SizedBox(height: EditorSpacing.md),
              Text(
                title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: colors.textPrimary,
                    ),
              ),
              const SizedBox(height: EditorSpacing.sm),
              Text(
                message,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: colors.textSecondary,
                      height: 1.45,
                    ),
              ),
              if (details != null) ...[
                const SizedBox(height: EditorSpacing.md),
                _DetailsDisclosure(details: details!),
              ],
              if (onRetry != null) ...[
                const SizedBox(height: EditorSpacing.lg),
                FilledButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh_rounded, size: 18),
                  label: Text(retryLabel),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailsDisclosure extends StatefulWidget {
  const _DetailsDisclosure({required this.details});
  final String details;

  @override
  State<_DetailsDisclosure> createState() => _DetailsDisclosureState();
}

class _DetailsDisclosureState extends State<_DetailsDisclosure> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.editorColors;
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: colors.panelSunken,
        borderRadius: BorderRadius.circular(EditorRadii.md),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextButton.icon(
            onPressed: () => setState(() => _open = !_open),
            icon: Icon(
              _open ? Icons.expand_less_rounded : Icons.expand_more_rounded,
              size: 18,
            ),
            label: const Text('Technical details'),
          ),
          if (_open)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                EditorSpacing.md, 0, EditorSpacing.md, EditorSpacing.md,
              ),
              child: SelectableText(
                widget.details,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: colors.textSecondary,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Pulsing skeleton placeholder for a loading region.
///
/// [pattern] describes row heights: e.g. `[72]` for cards,
/// `[24, 16]` for text lines. Each entry becomes a full-width rounded block.
class LoadingSkeletonView extends StatefulWidget {
  const LoadingSkeletonView({
    super.key,
    this.pattern = const [24, 16],
    this.spacing = EditorSpacing.sm,
    this.padding = EdgeInsets.zero,
    this.crossAxisCount = 1,
    this.childAspectRatio = 6,
  });

  final List<double> pattern;
  final double spacing;
  final EdgeInsetsGeometry padding;
  final int crossAxisCount;
  final double childAspectRatio;

  @override
  State<LoadingSkeletonView> createState() => _LoadingSkeletonViewState();
}

class _LoadingSkeletonViewState extends State<LoadingSkeletonView>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.editorColors;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final opacity = 0.45 + 0.35 * _controller.value;
        final base = colors.isDark ? Colors.white : Colors.black;
        Widget block(double height, {double? width, double radius = 8}) =>
            Container(
              height: height,
              width: width,
              decoration: BoxDecoration(
                color: base.withValues(alpha: opacity * 0.12),
                borderRadius: BorderRadius.circular(radius),
              ),
            );

        return Padding(
          padding: widget.padding,
          child: widget.crossAxisCount == 1
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final h in widget.pattern) ...[
                      block(h),
                      const SizedBox(height: EditorSpacing.sm),
                    ],
                  ],
                )
              : GridView.count(
                  crossAxisCount: widget.crossAxisCount,
                  childAspectRatio: widget.childAspectRatio,
                  mainAxisSpacing: widget.spacing,
                  crossAxisSpacing: widget.spacing,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  children: [
                    for (var i = 0; i < widget.crossAxisCount * 2; i++)
                      block(double.infinity, radius: EditorRadii.lg),
                  ],
                ),
        );
      },
    );
  }
}

enum BannerTone { info, warning, error, success }

/// Inline status banner (missing files, save failures, offline, etc).
class StatusBanner extends StatelessWidget {
  const StatusBanner({
    super.key,
    required this.tone,
    required this.message,
    this.actionLabel,
    this.onAction,
    this.onDismiss,
  });

  final BannerTone tone;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    final colors = context.editorColors;
    final (color, icon) = switch (tone) {
      BannerTone.info => (colors.accent, Icons.info_outline_rounded),
      BannerTone.warning => (colors.warning, Icons.warning_amber_rounded),
      BannerTone.error => (colors.danger, Icons.error_outline_rounded),
      BannerTone.success => (colors.success, Icons.check_circle_outline_rounded),
    };
    return Material(
      color: color.withValues(alpha: 0.12),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: EditorSpacing.md,
          vertical: EditorSpacing.sm,
        ),
        decoration: BoxDecoration(
          border: Border(left: BorderSide(color: color, width: 3)),
        ),
        child: Row(
          children: [
            Icon(icon, size: 18, color: color, semanticLabel: tone.name),
            const SizedBox(width: EditorSpacing.sm),
            Expanded(
              child: Text(
                message,
                style: TextStyle(
                  color: colors.textPrimary,
                  fontSize: 13,
                  height: 1.35,
                ),
              ),
            ),
            if (actionLabel != null && onAction != null)
              TextButton(onPressed: onAction, child: Text(actionLabel!)),
            if (onDismiss != null)
              IconButton(
                onPressed: onDismiss,
                icon: const Icon(Icons.close_rounded, size: 16),
                tooltip: 'Dismiss',
                visualDensity: VisualDensity.compact,
              ),
          ],
        ),
      ),
    );
  }
}
