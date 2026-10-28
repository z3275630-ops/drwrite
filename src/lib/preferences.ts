import { appSettingsPath, exists, readJson, updateSettingEntry } from './fs';
import type { JsonValue } from './json';

export async function readPreference<T>(section: string, key: string): Promise<T | null> {
  const path = await appSettingsPath();
  if (!(await exists(path))) return null;
  const settings = await readJson(path) as Record<string, Record<string, unknown>>;
  return (settings?.[section]?.[key] as T) ?? null;
}
export const writePreference = (section: string, key: string, value: unknown) => updateSettingEntry(section, key, value as JsonValue);

export interface WorkspacePreference { left: number; right: number; leftOpen?: boolean; rightOpen?: boolean; rightView: 'chapter' | 'chat' }
