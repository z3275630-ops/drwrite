export interface StoryTime { calendar: string; year: number; month?: number; day?: number; order?: number }
export function validateStoryTime(time: StoryTime | undefined): string | null {
  if (!time) return null;
  if (!time.calendar.trim()) return '请填写历法名称';
  if (![time.year, time.month, time.day, time.order].every(value => value === undefined || Number.isSafeInteger(value))) return '年、月、日和排序号必须是有限整数';
  if (time.day !== undefined && time.month === undefined) return '填写日期前请先填写月份';
  return null;
}
export function compareStoryTime(a: StoryTime, b: StoryTime): number | null {
  if (a.calendar.trim() !== b.calendar.trim()) return null;
  if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
  if ([a.month, a.day, b.month, b.day].some(value => value === undefined)) return null;
  return a.year - b.year || a.month! - b.month! || a.day! - b.day!;
}
export function storySections<T extends { storyTime?: StoryTime }>(events: T[]) {
  const groups = new Map<string, T[]>();
  for (const event of events) {
    const calendar = event.storyTime?.calendar.trim() || '未设置故事时间';
    const list = groups.get(calendar) ?? []; list.push(event); groups.set(calendar, list);
  }
  return [...groups].map(([calendar, list]) => {
    const byOrder = list.every(event => event.storyTime?.order !== undefined);
    const byDate = list.every(event => event.storyTime?.month !== undefined && event.storyTime?.day !== undefined);
    return { calendar, sorted: byOrder || byDate, events: byOrder || byDate ? [...list].sort((a, b) => byOrder
      ? a.storyTime!.order! - b.storyTime!.order! : a.storyTime!.year - b.storyTime!.year || a.storyTime!.month! - b.storyTime!.month! || a.storyTime!.day! - b.storyTime!.day!) : list };
  });
}
export function formatStoryTime(time?: StoryTime): string {
  if (!time) return '未设置故事时间';
  return `${time.calendar} · ${time.year}年${time.month === undefined ? '' : time.month + '月'}${time.day === undefined ? '' : time.day + '日'}${time.order === undefined ? '' : ' · 序 ' + time.order}`;
}
