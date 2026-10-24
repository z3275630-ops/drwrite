/**
 * 文件层：桌面端走 Tauri 命令（真磁盘），浏览器端走 localStorage 模拟。
 * 所有路径统一用平台原始分隔符的字符串，由调用方拼接。
 */
import type { JsonValue } from './json';

export const isDesktop = typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window;

/* ---------- Tauri 后端 ---------- */

async function invokeCmd<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/* ---------- 浏览器模拟后端（开发/预览用） ---------- */

const LS_PREFIX = 'drwrite-fs:';

function lsKey(path: string) {
  return LS_PREFIX + path;
}

function lsSet(path: string, content: string) {
  localStorage.setItem(lsKey(path), content);
}

function lsGet(path: string): string | null {
  return localStorage.getItem(lsKey(path));
}

function normalize(p: string) {
  // 目录路径统一保证结尾有且仅有一个 /（供前缀匹配用）
  return p.replace(/[\\/]+$/, '') + '/';
}

/* ---------- 统一接口 ---------- */

export async function readJson(path: string): Promise<JsonValue | null> {
  if (isDesktop) {
    try {
      return await invokeCmd<JsonValue>('read_json_file', { path });
    } catch (e) {
      throw new Error(String(e));
    }
  }
  const raw = lsGet(path);
  if (raw == null) throw new Error(`文件不存在: ${path}`);
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    throw new Error(`JSON 解析失败: ${path}`);
  }
}

export async function readJsonOrNull(path: string): Promise<JsonValue | null> {
  try {
    return await readJson(path);
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: JsonValue): Promise<void> {
  if (isDesktop) {
    await invokeCmd('write_json_file', { path, value });
    return;
  }
  lsSet(path, JSON.stringify(value, null, 2));
}

export async function writeText(path: string, content: string): Promise<void> {
  if (isDesktop) {
    await invokeCmd('write_text_file', { path, content });
    return;
  }
  lsSet(path, content);
}

/** 返回子项名；目录名以 / 结尾 */
export async function listDir(path: string): Promise<string[]> {
  if (isDesktop) {
    return invokeCmd<string[]>('list_dir_entries', { path });
  }
  const prefix = normalize(path);
  const names = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(LS_PREFIX + prefix)) continue;
    const rest = k.slice(LS_PREFIX.length + prefix.length);
    if (!rest) continue;
    const seg = rest.split('/')[0];
    names.add(rest.includes('/') ? seg + '/' : seg);
  }
  return [...names].sort();
}

export async function exists(path: string): Promise<boolean> {
  if (isDesktop) {
    return invokeCmd<boolean>('path_exists', { path });
  }
  const p = normalize(path);
  if (lsGet(path) != null) return true;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LS_PREFIX + p)) return true;
  }
  return false;
}

export async function mkdir(path: string): Promise<void> {
  if (isDesktop) {
    await invokeCmd('create_dir', { path });
    return;
  }
  // 模拟后端：写一个占位文件代表目录存在
  lsSet(normalize(path) + '.keep', '');
}

export async function deleteFile(path: string): Promise<void> {
  if (isDesktop) {
    await invokeCmd('delete_file', { path });
    return;
  }
  localStorage.removeItem(lsKey(path));
}

/** 删除整个目录（前端必须先弹确认） */
export async function deleteDir(path: string): Promise<void> {
  if (isDesktop) {
    await invokeCmd('delete_dir', { path });
    return;
  }
  const prefix = LS_PREFIX + normalize(path);
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}

export async function copyTree(src: string, dst: string): Promise<void> {
  if (isDesktop) {
    await invokeCmd('copy_tree', { src, dst });
    return;
  }
  const prefix = LS_PREFIX + normalize(src);
  const newPrefix = LS_PREFIX + normalize(dst);
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(prefix)) continue;
    const tail = k.slice(prefix.length);
    localStorage.setItem(newPrefix + tail, localStorage.getItem(k) ?? '');
  }
}

export function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/');
}

/** 默认书库目录（文档\Drwrite 书库）；浏览器模式返回虚拟路径 */
export async function defaultLibraryDir(): Promise<string> {
  if (isDesktop) {
    return invokeCmd<string>('default_library_dir', {});
  }
  return 'C:/虚拟书库';
}

export async function appSettingsPath(): Promise<string> {
  if (isDesktop) {
    return invokeCmd<string>('app_settings_path', {});
  }
  return 'C:/虚拟书库/settings.json';
}
