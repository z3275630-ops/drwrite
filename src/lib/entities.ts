/**
 * 资料库数据层：人物卡与设定词条的增删改查，以及正文引用倒排索引（refs.json）。
 * 文件形态：entities/characters/<id>.json、entities/lore/<id>.json。
 * 原则（继承自织境拆解）：
 *  - 引用存稳定 ID，改名不断链，正文同名文字不全局替换
 *  - 势力归属真源 = 设定词条（势力类），人物只存 factionIds 引用；成员列表是派生视图
 *  - 对象删除后正文引用保留 displayText，检视器标记「已删除」
 */
import type { Character, LoreEntry, LoreCategory, RefIndexEntry, RefTargetType, CharacterTier } from '../types';
import { MODEL_VERSION } from '../types';
import type { JsonValue } from './json';
import { readJsonOrNull, writeJson, listDir, deleteFile, joinPath, exists } from './fs';
import { genId, nowIso } from './id';

export type EntityKind = 'character' | 'lore';

export interface AnyEntity {
  kind: EntityKind;
  character?: Character;
  lore?: LoreEntry;
}

/* ---------- 工厂 ---------- */

export function newCharacter(name: string): Character {
  return {
    id: genId(),
    protocolVersion: MODEL_VERSION,
    type: 'character',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    name,
    aliases: [],
    tier: '配角',
    profile: {},
    personality: '',
    biography: [],
    factionIds: [],
    relations: [],
  };
}

export function newLore(name: string, category: LoreCategory = '世界观'): LoreEntry {
  return {
    id: genId(),
    protocolVersion: MODEL_VERSION,
    type: 'lore',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    name,
    aliases: [],
    category,
    content: '',
    inlineRefs: [],
  };
}

export const TIERS: CharacterTier[] = ['主角', '配角', '闲角', '过客', '龙套'];
export const LORE_CATEGORIES: LoreCategory[] = ['世界观', '地点', '势力', '规则', '术语', '事件'];

/* ---------- 读写 ---------- */

function entityDir(root: string, dirName: string, kind: EntityKind): string {
  return joinPath(joinPath(root, dirName), 'entities', kind === 'character' ? 'characters' : 'lore');
}

export async function listCharacters(root: string, dirName: string): Promise<Character[]> {
  const dir = entityDir(root, dirName, 'character');
  if (!(await exists(dir))) return [];
  const files = await listDir(dir);
  const out: Character[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const v = await readJsonOrNull(joinPath(dir, f));
    const c = v as unknown as Character;
    if (c?.id && c.name) out.push(c);
  }
  out.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.name.localeCompare(b.name, 'zh'));
  return out;
}

export async function listLore(root: string, dirName: string): Promise<LoreEntry[]> {
  const dir = entityDir(root, dirName, 'lore');
  if (!(await exists(dir))) return [];
  const files = await listDir(dir);
  const out: LoreEntry[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const v = await readJsonOrNull(joinPath(dir, f));
    const l = v as unknown as LoreEntry;
    if (l?.id && l.name) out.push(l);
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return out;
}

export async function saveCharacter(root: string, dirName: string, c: Character): Promise<void> {
  c.updatedAt = nowIso();
  await writeJson(joinPath(entityDir(root, dirName, 'character'), `${c.id}.json`), c as unknown as JsonValue);
}

export async function saveLore(root: string, dirName: string, l: LoreEntry): Promise<void> {
  l.updatedAt = nowIso();
  await writeJson(joinPath(entityDir(root, dirName, 'lore'), `${l.id}.json`), l as unknown as JsonValue);
}

export async function deleteEntity(root: string, dirName: string, kind: EntityKind, id: string): Promise<void> {
  try {
    await deleteFile(joinPath(entityDir(root, dirName, kind), `${id}.json`));
  } catch {
    // 文件不存在就算了
  }
}

/* ---------- 检索 ---------- */

export function aliasMatch(name: string, aliases: string[] | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (name.toLowerCase().includes(q)) return true;
  return (aliases ?? []).some((a) => a.toLowerCase().includes(q));
}

/* ---------- refs.json 倒排索引 ---------- */

interface DocNode {
  type: string;
  text?: string;
  marks?: { type: string; attrs?: Record<string, JsonValue> }[];
  content?: DocNode[];
}

/** 扫描一章文档里的 entityRef mark → 引用条目 */
export function scanDocRefs(doc: JsonValue, chapterId: string): RefIndexEntry[] {
  const out: RefIndexEntry[] = [];
  const d = doc as unknown as DocNode;
  let blockIndex = -1;
  const walk = (node: DocNode) => {
    if (node.type === 'text' && node.marks) {
      for (const m of node.marks) {
        if (m.type === 'entityRef' && m.attrs?.targetId) {
          out.push({
            protocolVersion: MODEL_VERSION,
            targetType: String(m.attrs.targetType) as RefTargetType,
            targetId: String(m.attrs.targetId),
            displayText: String(m.attrs.displayText ?? ''),
            chapterId,
            blockIndex,
          });
        }
      }
    }
    if (node.content) node.content.forEach(walk);
  };
  (d.content ?? []).forEach((block) => {
    blockIndex++;
    walk(block);
  });
  return out;
}

export async function readRefs(root: string, dirName: string): Promise<RefIndexEntry[]> {
  const p = joinPath(joinPath(root, dirName), 'refs.json');
  const v = await readJsonOrNull(p);
  return Array.isArray(v) ? (v as unknown as RefIndexEntry[]) : [];
}

async function writeRefs(root: string, dirName: string, refs: RefIndexEntry[]): Promise<void> {
  await writeJson(joinPath(joinPath(root, dirName), 'refs.json'), refs as unknown as JsonValue);
}

/** 增量更新某一章的引用条目（doc=null 表示该章不再贡献引用，如被删除） */
export async function updateRefsForChapter(
  root: string,
  dirName: string,
  chapterId: string,
  doc: JsonValue | null
): Promise<void> {
  const refs = await readRefs(root, dirName);
  const others = refs.filter((r) => r.chapterId !== chapterId);
  if (doc) others.push(...scanDocRefs(doc, chapterId));
  await writeRefs(root, dirName, others);
}

/** 全量重建（恢复快照等大变动后用） */
export async function rebuildAllRefs(
  root: string,
  dirName: string,
  chapters: { id: string }[],
  readChapterDoc: (id: string) => Promise<JsonValue | null>
): Promise<void> {
  const all: RefIndexEntry[] = [];
  for (const c of chapters) {
    const doc = await readChapterDoc(c.id);
    if (doc) all.push(...scanDocRefs(doc, c.id));
  }
  await writeRefs(root, dirName, all);
}

/** 某实体被引用的章（去重） */
export function refChapters(refs: RefIndexEntry[], targetId: string): RefIndexEntry[] {
  const seen = new Set<string>();
  const out: RefIndexEntry[] = [];
  for (const r of refs) {
    if (r.targetId !== targetId || seen.has(r.chapterId)) continue;
    seen.add(r.chapterId);
    out.push(r);
  }
  return out;
}
