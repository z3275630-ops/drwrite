/**
 * 场景层（P6）：章内的「带名字分隔线」。
 * 正文里的 sceneMark 节点是场景的真源；这里只做 JSON 读取与定位辅助。
 */
import type { JsonValue } from './json';

export interface SceneInfo {
  /** 章内第几个块（0 基，与 refs 的 blockIndex 同口径） */
  blockIndex: number;
  title: string;
}

interface DocNode {
  type: string;
  attrs?: { title?: JsonValue };
  content?: DocNode[];
}

/** 从章节 doc JSON 里取场景列表（供时间线/伏笔锚点、本章面板用） */
export function scenesFromDocJson(doc: JsonValue): SceneInfo[] {
  const d = doc as unknown as DocNode;
  const out: SceneInfo[] = [];
  (d?.content ?? []).forEach((block, i) => {
    if (block.type === 'sceneMark') {
      out.push({ blockIndex: i, title: typeof block.attrs?.title === 'string' ? block.attrs.title : '' });
    }
  });
  return out;
}

/** 场景显示名 */
export function sceneLabel(s: SceneInfo, no: number): string {
  return s.title.trim() || `场景 ${no}`;
}
