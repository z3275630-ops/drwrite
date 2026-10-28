import { isDesktop, joinPath } from './fs';
export async function acquireBookLease(root: string, dirName: string): Promise<() => Promise<void>> {
  if (!isDesktop) return async () => {};
  const { invoke } = await import('@tauri-apps/api/core');
  const bookDir = joinPath(root, dirName), token = crypto.randomUUID();
  await invoke('acquire_book_lease', { bookDir, token });
  let releasing: Promise<void> | null = null;
  return () => releasing ??= invoke<void>('release_book_lease', { bookDir, token });
}
