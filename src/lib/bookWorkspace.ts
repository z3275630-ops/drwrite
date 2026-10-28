import { exists, joinPath, readJson, writeJson } from './fs';
import { SerialQueue } from './saveCoordinator';
import type { JsonValue } from './json';
export interface ObservationNote { id: string; fromId: string; toId: string; text: string }
export interface BookWorkspace { ignoredHealth: string[]; observationNotes: ObservationNote[] }
const queues = new Map<string, SerialQueue>();
export async function loadWorkspace(root: string, dir: string): Promise<BookWorkspace> {
  const path = joinPath(root, dir, 'entities', 'workspace.json');
  if (!(await exists(path))) return { ignoredHealth: [], observationNotes: [] };
  const value = await readJson(path) as unknown as BookWorkspace;
  if (!value || !Array.isArray(value.ignoredHealth) || !Array.isArray(value.observationNotes)) throw Error('作品工作记录损坏，未覆盖原记录');
  return value;
}
export async function updateWorkspace(root: string, dir: string, update: (current: BookWorkspace) => BookWorkspace) {
  const path = joinPath(root, dir, 'entities', 'workspace.json');
  if (!queues.has(path)) queues.set(path, new SerialQueue());
  return queues.get(path)!.run(async () => {
    const next = update(await loadWorkspace(root, dir)); await writeJson(path, next as unknown as JsonValue); return next;
  });
}
