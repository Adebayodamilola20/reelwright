/** Asset path resolution (reopen recovery) and relink verification. */

import { existsSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fail } from '../errors.js';
import type { Asset, AssetResolution } from '../types.js';

/** Path relative to the project dir when the file lives inside it, else undefined. */
export function computeRelPath(assetPath: string, projectDir: string): string | undefined {
  const rel = relative(projectDir, assetPath);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  return undefined;
}

/**
 * Resolve where an asset's bytes currently are (contract order):
 * stored absolute path → relPath vs project dir → <projectDir>/<basename>
 * → <projectDir>/media/<basename>. Never scans deeper; never touches network.
 */
export function resolveAssetPath(asset: Asset, projectDir: string): AssetResolution {
  if (asset.kind === 'text') return { assetId: asset.id, status: 'ok', resolvedPath: '' };
  const candidates: string[] = [];
  if (asset.source.path) candidates.push(asset.source.path);
  if (asset.source.relPath) candidates.push(resolve(projectDir, asset.source.relPath));
  if (asset.source.path) {
    candidates.push(join(projectDir, basename(asset.source.path)));
    candidates.push(join(projectDir, 'media', basename(asset.source.path)));
  }
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (existsSync(candidate)) {
      return { assetId: asset.id, status: 'ok', resolvedPath: candidate };
    }
  }
  return { assetId: asset.id, status: 'missing' };
}

export function resolveAllAssets(assets: Asset[], projectDir: string): AssetResolution[] {
  return assets.map((a) => resolveAssetPath(a, projectDir));
}

/** Relink validation: file must exist and match by basename or size (charter-safe). */
export function relinkAsset(asset: Asset, newPath: string, projectDir: string): Asset {
  if (!isAbsolute(newPath)) fail('INVALID_ARGUMENT', 'Relink path must be absolute.');
  if (!existsSync(newPath)) fail('NOT_FOUND', `File not found: ${newPath}`);
  const stat = statSync(newPath);
  if (!stat.isFile()) fail('INVALID_ARGUMENT', `Not a file: ${newPath}`);
  const nameMatches = basename(newPath) === basename(asset.source.path);
  const sizeMatches = asset.file !== undefined && asset.file.sizeBytes === stat.size;
  if (!nameMatches && !sizeMatches) {
    fail('INVALID_ARGUMENT',
      `"${newPath}" does not look like the missing file "${asset.source.path}".`,
      'Choose a file with the same name, or the same size.');
  }
  const relPath = computeRelPath(newPath, projectDir);
  return {
    ...asset,
    source: { path: newPath, ...(relPath ? { relPath } : {}) },
    file: { sizeBytes: stat.size, modifiedMs: Math.round(stat.mtimeMs) },
  };
}

export function projectDirOf(projectFilePath: string): string {
  return dirname(resolve(projectFilePath));
}
