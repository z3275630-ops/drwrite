/**
 * 场景层（P6）：章内的「带名字分隔线」。
 * 正文里的 sceneMark 节点是场景的真源；这里只做 JSON 读取与定位辅助。
 */
import type { JsonValue } from './json';
import type { Node as DocumentNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';

export interface SceneInfo {
  /** 章内第几个块（0 基，与 refs 的 blockIndex 同口径） */
  blockIndex: number;
  title: string;
  id?: string;
  key?: string;
  summary?: string;
  missing?: boolean;
}

interface DocNode {
  type: string;
  attrs?: { title?: JsonValue; id?: JsonValue; summary?: JsonValue };
  content?: DocNode[];
}

/** 从章节 doc JSON 里取场景列表（供时间线/伏笔锚点、本章面板用） */
export function scenesFromDocJson(doc: JsonValue): SceneInfo[] {
  const d = doc as unknown as DocNode;
  const out: SceneInfo[] = [];
  (d?.content ?? []).forEach((block, i) => {
    if (block.type === 'sceneMark') {
      out.push({ blockIndex: i, title: typeof block.attrs?.title === 'string' ? block.attrs.title : '',
        id: typeof block.attrs?.id === 'string' ? block.attrs.id : undefined, summary: typeof block.attrs?.summary === 'string' ? block.attrs.summary : '' });
    }
  });
  return out;
}

const temporaryIds = new WeakMap<DocumentNode, string>();
const identityAliases = new Map<string, string>();
export function sceneKey(node: DocumentNode): string {
  let key = temporaryIds.get(node); if (!key) { key = crypto.randomUUID(); temporaryIds.set(node, key); } return key;
}
export function scenesFromEditor(editor: Editor): SceneInfo[] {
  const out: SceneInfo[] = [];
  const ids = new Set<string>();
  editor.state.doc.content.forEach((node, _position, blockIndex) => {
    if (node.type.name !== 'sceneMark') return;
    const id = node.attrs.id || undefined, duplicate = !!id && ids.has(id);
    let key = temporaryIds.get(node);
    if (!key) { key = id && !ids.has(id) ? identityAliases.get(id) ?? id : crypto.randomUUID(); temporaryIds.set(node, key!); }
    if (id) ids.add(id);
    out.push({ blockIndex, title: node.attrs.title ?? '', id: duplicate ? undefined : id, key, summary: node.attrs.summary ?? '' });
  }); return out;
}
/** Resolve identity against the current document, never trust an old block index. */
export function updateScene(editor: Editor, identity: string, patch: { title?: string; summary?: string }): boolean {
  let position = -1; let attrs: Record<string, unknown> = {};
  editor.state.doc.content.forEach((node, offset) => { if (node.type.name === 'sceneMark' && sceneKey(node) === identity) {
    position = offset;
    let copies = 0; editor.state.doc.content.forEach(other => { if (other.type.name === 'sceneMark' && other.attrs.id && other.attrs.id === node.attrs.id) copies++; });
    const id = copies > 1 ? crypto.randomUUID() : node.attrs.id || crypto.randomUUID();
    identityAliases.set(id, identity);
    attrs = { ...node.attrs, id, ...patch };
  } });
  if (position < 0) return false;
  const tr = editor.state.tr.setNodeMarkup(position, undefined, attrs);
  temporaryIds.set(tr.doc.nodeAt(position)!, identity);
  editor.view.dispatch(tr); return true;
}

/** 场景显示名 */
export function sceneLabel(s: SceneInfo, no: number): string {
  return s.title.trim() || `场景 ${no}`;
}
