import { invoke } from '@tauri-apps/api/core';
import { isDesktop, joinPath } from './fs';

export interface SnapshotInfo {
  name: string;
  legacy: boolean;
  valid: boolean;
  createdAt: number;
  error: string | null;
}

function desktopOnly() {
  if (!isDesktop) throw new Error('完整作品快照需要桌面版；浏览器预览不会写入磁盘备份。');
}

export async function recoverBookRestore(root: string, dirName: string): Promise<void> {
  if (isDesktop) await invoke('recover_book_restore', { bookDir: joinPath(root, dirName) });
}

export async function createSnapshot(root: string, dirName: string, auto = false): Promise<string> {
  desktopOnly();
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return invoke('create_book_snapshot', { bookDir: joinPath(root, dirName), nameBase: (auto ? 'auto-' : '') + stamp });
}

export async function listSnapshots(root: string, dirName: string): Promise<SnapshotInfo[]> {
  desktopOnly();
  return invoke('list_book_snapshots', { bookDir: joinPath(root, dirName) });
}

/** Returns true for old snapshots, which deliberately keep the current entity library. */
export async function restoreSnapshot(root: string, dirName: string, name: string): Promise<boolean> {
  desktopOnly();
  return invoke('restore_book_snapshot', { bookDir: joinPath(root, dirName), name });
}
