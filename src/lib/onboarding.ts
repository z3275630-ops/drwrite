import { readPreference, writePreference } from './preferences';
export const GUIDE_STEPS = [
  ['open', '打开示例书'], ['save', '写一句并成功保存'], ['card', '手工创建人物卡'], ['chapter', '查看本章工作台'], ['export', '导出本章 Markdown'],
] as const;
export type GuideStep = typeof GUIDE_STEPS[number][0];
export interface GuideState { dismissed: boolean; completed: string[] }
let guideQueue: Promise<unknown> = Promise.resolve();
export async function loadGuide(): Promise<GuideState> {
  const value = await readPreference<GuideState>('onboarding', 'v1');
  if (value && (typeof value.dismissed !== 'boolean' || !Array.isArray(value.completed) || value.completed.some(step => typeof step !== 'string'))) throw Error('引导记录格式损坏，原记录保留');
  return value ?? { dismissed: false, completed: [] };
}
export function completeGuide(step: GuideStep): Promise<GuideState> {
  const work = guideQueue.then(async () => {
    const current = await loadGuide(); if (current.completed.includes(step)) return current;
    const next = { ...current, completed: [...current.completed, step] };
    await writePreference('onboarding', 'v1', next); return next;
  }); guideQueue = work.catch(() => undefined); return work;
}
export function setGuideDismissed(dismissed: boolean): Promise<GuideState> {
  const work = guideQueue.then(async () => { const next = { ...await loadGuide(), dismissed }; await writePreference('onboarding', 'v1', next); return next; });
  guideQueue = work.catch(() => undefined); return work;
}
