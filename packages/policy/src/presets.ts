import type { DangerousToolPreset } from './types.js';

/** Glob patterns matched against bare and namespaced tool names. */
export const PRESET_PATTERNS: Readonly<Record<DangerousToolPreset, readonly string[]>> = {
  filesystem_write: [
    '*write*',
    '*mkdir*',
    '*create_file*',
    '*edit_file*',
    '*save_file*',
    '*append*',
    '*move_file*',
    '*rename*',
    '*chmod*',
    '*chown*',
  ],
  shell: ['*bash*', '*shell*', '*exec*', '*run_command*', '*terminal*', '*subprocess*', '*spawn*'],
  deploy: ['*deploy*', '*publish*', '*release*', '*rollout*', '*provision*'],
  delete: ['*delete*', '*remove*', '*destroy*', '*drop*', '*purge*', '*wipe*', '*truncate*'],
  network_exfiltration: [
    '*fetch*',
    '*http*',
    '*curl*',
    '*wget*',
    '*upload*',
    '*download*',
    '*request*',
    '*post_url*',
    '*send_webhook*',
  ],
};

export function listPresets(): readonly DangerousToolPreset[] {
  return Object.keys(PRESET_PATTERNS) as DangerousToolPreset[];
}
