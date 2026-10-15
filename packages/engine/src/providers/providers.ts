/**
 * Provider interfaces for optional AI / cloud services (charter gate).
 *
 * v1 ships ONLY these interfaces plus unconfigured stubs. Nothing here
 * performs network I/O, uploads files, or costs money. Attaching a real
 * provider requires explicit project-owner approval and a register() call.
 */

import { fail } from '../errors.js';

export type ProviderKind =
  | 'transcription'
  | 'voice'
  | 'mediaAnalysis'
  | 'cloudSync'
  | 'publish';

export interface ProviderStatus {
  available: boolean;
  reason?: string;
}

export type ProviderStatusReport = Record<
  ProviderKind,
  { providerId: string | null } & ProviderStatus
>;

export interface ProviderBase {
  id: string;
  displayName: string;
  status(): ProviderStatus;
}

export interface TranscriptionProvider extends ProviderBase {
  kind: 'transcription';
  transcribe(assetId: string): Promise<{ segments: Array<{ startTicks: number; endTicks: number; text: string }> }>;
}

export interface VoiceProvider extends ProviderBase {
  kind: 'voice';
  synthesize(text: string, voice: string): Promise<{ assetPath: string }>;
}

export interface MediaAnalysisProvider extends ProviderBase {
  kind: 'mediaAnalysis';
  detectScenes(assetId: string): Promise<{ sceneChangesTicks: number[] }>;
}

export interface CloudSyncProvider extends ProviderBase {
  kind: 'cloudSync';
  pushProject(): Promise<{ remoteId: string }>;
}

export interface PublishProvider extends ProviderBase {
  kind: 'publish';
  publish(outputPath: string, meta: { title: string }): Promise<{ url: string }>;
}

export type AnyProvider =
  | TranscriptionProvider
  | VoiceProvider
  | MediaAnalysisProvider
  | CloudSyncProvider
  | PublishProvider;

const ALL_KINDS: ProviderKind[] = ['transcription', 'voice', 'mediaAnalysis', 'cloudSync', 'publish'];

export class ProviderRegistry {
  private providers = new Map<ProviderKind, AnyProvider>();

  register(provider: AnyProvider): void {
    this.providers.set(provider.kind, provider);
  }

  get(kind: ProviderKind): AnyProvider {
    const provider = this.providers.get(kind);
    if (!provider || !provider.status().available) {
      fail('NOT_CONFIGURED',
        `No "${kind}" provider is configured.`,
        'AI/cloud features stay disabled until a provider is registered with owner approval.');
    }
    return provider;
  }

  status(): ProviderStatusReport {
    const report: ProviderStatusReport = {} as ProviderStatusReport;
    for (const kind of ALL_KINDS) {
      const provider = this.providers.get(kind);
      const status = provider ? provider.status() : { available: false, reason: 'no provider configured' };
      report[kind] = { providerId: provider?.id ?? null, ...status };
    }
    return report;
  }
}
