/**
 * 道具数据层（P6）：法宝/信物/金手指，一等的流转史。
 * 文件形态：entities/props/<id>.json。持有人 = 流转历史最后一条（派生，不单独存）。
 */
import type { Prop } from '../types';
import { MODEL_VERSION } from '../types';
import type { JsonValue } from './json';
import { readJsonOrNull, writeJson, listDir, deleteFile, joinPath, exists } from './fs';
import { genId, nowIso } from './id';

export function newProp(name: string): Prop {
  return {
    id: genId(),
    protocolVersion: MODEL_VERSION,
    type: 'prop',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    name,
    aliases: [],
    content: '',
    transfers: [],
  };
}

function propsDir(root: string, dirName: string): string {
  return joinPath(joinPath(root, dirName), 'entities', 'props');
}

export async function listProps(root: string, dirName: string): Promise<Prop[]> {
  const dir = propsDir(root, dirName);
  if (!(await exists(dir))) return [];
  const files = await listDir(dir);
  const out: Prop[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const v = await readJsonOrNull(joinPath(dir, f));
    const p = v as unknown as Prop;
    if (p?.id && p.name) out.push(p);
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return out;
}

export async function saveProp(root: string, dirName: string, p: Prop): Promise<void> {
  p.updatedAt = nowIso();
  await writeJson(joinPath(propsDir(root, dirName), `${p.id}.json`), p as unknown as JsonValue);
}

export async function deleteProp(root: string, dirName: string, id: string): Promise<void> {
  try {
    await deleteFile(joinPath(propsDir(root, dirName), `${id}.json`));
  } catch {
    // 文件不存在就算了
  }
}
