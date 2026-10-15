/** Locate external tools (ffmpeg/ffprobe) without hard-coding one path. */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const COMMON_DIRS = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'];

export function resolveTool(name: 'ffmpeg' | 'ffprobe', override?: string): string {
  if (override && existsSync(override)) return override;
  const envName = name === 'ffmpeg' ? 'VE_FFMPEG_PATH' : 'VE_FFPROBE_PATH';
  const fromEnv = process.env[envName];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const dir of COMMON_DIRS) {
    const candidate = `${dir}/${name}`;
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to PATH lookup; spawn will error clearly if absent.
  try {
    const found = execFileSync('which', [name], { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch {
    // not on PATH
  }
  return name;
}
