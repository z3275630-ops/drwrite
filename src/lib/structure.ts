/**
 * 结构层数据：时间线（剧情线+事件）与伏笔。
 * 文件形态：entities/timeline.json、entities/foreshadows.json。
 * 原则：伏笔状态由锚点推导，不手填；锚点指向章节（信息型连接，只跳转不反写）。
 */
import type { ChapterMeta, Foreshadow, ForeshadowState, TimelineEvent } from '../types';
import { MODEL_VERSION } from '../types';
import type { JsonValue } from './json';
import { readJsonOrNull, writeJson, joinPath } from './fs';
import { genId, nowIso } from './id';

export interface TimelineLane {
  id: string;
  name: string;
}

export interface TimelineData {
  lanes: TimelineLane[];
  events: TimelineEvent[];
}

/* ---------- 读写 ---------- */

function pathOf(root: string, dirName: string, file: string): string {
  return joinPath(joinPath(root, dirName), 'entities', file);
}

export async function loadTimeline(root: string, dirName: string): Promise<TimelineData> {
  const v = await readJsonOrNull(pathOf(root, dirName, 'timeline.json'));
  const d = v as unknown as TimelineData | null;
  if (d && Array.isArray(d.lanes) && Array.isArray(d.events)) return d;
  return { lanes: [{ id: genId(), name: '主线' }], events: [] };
}

export async function saveTimeline(root: string, dirName: string, data: TimelineData): Promise<void> {
  await writeJson(pathOf(root, dirName, 'timeline.json'), data as unknown as JsonValue);
}

export async function loadForeshadows(root: string, dirName: string): Promise<Foreshadow[]> {
  const v = await readJsonOrNull(pathOf(root, dirName, 'foreshadows.json'));
  return Array.isArray(v) ? (v as unknown as Foreshadow[]) : [];
}

export async function saveForeshadows(root: string, dirName: string, list: Foreshadow[]): Promise<void> {
  await writeJson(pathOf(root, dirName, 'foreshadows.json'), list as unknown as JsonValue);
}

/* ---------- 工厂 ---------- */

export function newEvent(laneId: string): TimelineEvent {
  return { id: genId(), laneId, title: '', anchor: null, relatedEntityIds: [] };
}

export function newForeshadow(title: string): Foreshadow {
  return {
    id: genId(),
    title,
    plantAnchors: [],
    reinforceAnchors: [],
    payoffAnchor: null,
    derivedState: '未设伏',
  };
}

/* ---------- 派生 ---------- */

/** 埋伏过久的阈值：距最后一次设伏超过多少章仍未回收 */
export const TOO_LONG_GAP = 40;

export function foreshadowStateOf(f: Foreshadow, chapters: ChapterMeta[]): ForeshadowState {
  if (f.payoffAnchor) return '已回收';
  if (!f.plantAnchors.length) return '未设伏';
  const indexOf = (id: string) => chapters.find((c) => c.id === id)?.index ?? 0;
  const maxPlant = Math.max(...f.plantAnchors.map((a) => indexOf(a.chapterId)));
  const latest = chapters.length - 1;
  if (latest - maxPlant > TOO_LONG_GAP) return '埋伏过久';
  return '待回收';
}

export const FORESHADOW_ORDER: ForeshadowState[] = ['待回收', '埋伏过久', '已设伏', '已回收', '未设伏'];

export function foreshadowStateColor(s: ForeshadowState): string {
  switch (s) {
    case '待回收':
      return '#a06a3c';
    case '埋伏过久':
      return '#b04a3a';
    case '已设伏':
      return '#7d7a52';
    case '已回收':
      return '#5a7d4f';
    default:
      return '#9a9484';
  }
}

/** 时间线事件按锚点章节排序（无锚点的排最后） */
export function sortEvents(events: TimelineEvent[], chapters: ChapterMeta[]): TimelineEvent[] {
  const indexOf = (id: string) => {
    const i = chapters.findIndex((c) => c.id === id);
    return i === -1 ? 9999 : i;
  };
  return [...events].sort((a, b) => indexOf(a.anchor?.chapterId ?? '') - indexOf(b.anchor?.chapterId ?? ''));
}

export function touchMeta(): { createdAt: string; updatedAt: string } {
  return { createdAt: nowIso(), updatedAt: nowIso() };
}

export { MODEL_VERSION };
