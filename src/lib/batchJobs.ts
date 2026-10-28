import type { AiConfig, AiMessage, AiResult } from './ai';
import type { Book, ChapterMeta } from '../types';
import type { JsonValue } from './json';
import { exists, joinPath, listDir, readJson, writeJson } from './fs';
import { budgetContext, type BudgetSource, type ContextPolicy } from './contextBudget';
export type JobKind = 'reader' | 'synopsis' | 'consistency';
export const JOB_LABELS: Record<JobKind, string> = { reader: '通读建卡', synopsis: '批量梗概', consistency: '一致性检查' };
export interface CardSuggestion { kind: 'character' | 'lore' | 'prop'; name: string; aliases: string[]; summary: string; evidence: string }
export interface JobChapter { id: string; title: string; index: number; hash: string; synopsis: string }
export interface JobUnit { chapterId: string; from: number; to: number; part: number; parts: number }
export interface JobResult { unit: number; raw: string; parsed?: string | CardSuggestion[]; error?: string; at: string; promptTokens?: number; completionTokens?: number }
export interface BatchJob {
  version: 1; promptVersion: 1; id: string; bookId: string; bookTitle: string; kind: JobKind; model: string;
  createdAt: string; updatedAt: string; chapters: JobChapter[]; units: JobUnit[]; sources: BudgetSource[]; policy: ContextPolicy;
  contextHash: string; next: number; results: JobResult[]; applied: string[]; state: 'paused' | 'done' | 'error';
}
export const modelIdentity = (config: AiConfig) => {
  const endpoint = new URL(config.baseUrl);
  return endpoint.origin + endpoint.pathname.replace(/\/+$/, '') + '|' + config.model;
};
export async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function chapterUnits(id: string, text: string, size = 3500): JobUnit[] {
  if (!Number.isSafeInteger(size) || size < 2) throw Error('无效的分批长度');
  const ranges: JobUnit[] = []; let from = 0;
  while (from < text.length) {
    let to = Math.min(text.length, from + size);
    if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
    ranges.push({ chapterId: id, from, to, part: ranges.length + 1, parts: 0 }); from = to;
  }
  ranges.forEach(unit => { unit.parts = ranges.length; }); return ranges;
}
export async function prepareJob(book: Book, chapters: ChapterMeta[], kind: JobKind, config: AiConfig, policy: ContextPolicy, sources: BudgetSource[], loadText: (id: string) => Promise<string>) {
  const texts = new Map<string, string>(), selected: JobChapter[] = [], units: JobUnit[] = [];
  for (const chapter of chapters) {
    const text = await loadText(chapter.id); texts.set(chapter.id, text);
    selected.push({ id: chapter.id, title: chapter.title, index: chapter.index, hash: await fingerprint(text), synopsis: chapter.synopsis ?? '' });
    units.push(...chapterUnits(chapter.id, text));
  }
  if (!units.length) throw Error('所选章节没有可分析的正文');
  const now = new Date().toISOString();
  const job: BatchJob = { version: 1, promptVersion: 1, id: crypto.randomUUID(), bookId: book.id, bookTitle: book.title, kind,
    model: modelIdentity(config), createdAt: now, updatedAt: now, chapters: selected, units, sources, policy,
    contextHash: await fingerprint(sources), next: 0, results: [], applied: [], state: 'paused' };
  for (let index = 0; index < units.length; index++) requestForUnit(job, index, texts);
  return { job, texts };
}
export async function validateResume(job: BatchJob, book: Book, config: AiConfig, sources: BudgetSource[], loadText: (id: string) => Promise<string>) {
  if (job.bookId !== book.id || job.promptVersion !== 1 || job.model !== modelIdentity(config)) throw Error('作品、模型或提示版本已变化，请新建任务；旧结果保留');
  if (await fingerprint(sources) !== job.contextHash) throw Error('资料或来源开关已变化，请恢复原选择或新建任务；旧结果保留');
  const texts = new Map<string, string>();
  for (const chapter of job.chapters) {
    const meta = book.chapters.find(item => item.id === chapter.id);
    if (!meta || meta.index !== chapter.index || meta.title !== chapter.title) throw Error('任务中的章节目录已变化，请新建任务');
    const text = await loadText(chapter.id);
    if (await fingerprint(text) !== chapter.hash) throw Error('章节正文已变化：' + chapter.title + '。原检查点未被用于新内容');
    texts.set(chapter.id, text);
  }
  return texts;
}
const instructions: Record<JobKind, string> = {
  reader: '从小说片段抽取有明确正文依据的人物、设定、道具。只输出 JSON 数组，每项必须为 {"kind":"character|lore|prop","name":"名称","aliases":["别名"],"summary":"概括","evidence":"正文依据"}。没有则输出 []，不要代码围栏，不编造未给出的事实。',
  synopsis: '概括给定小说片段已发生的关键事实、行动与转折。只输出简明梗概，不评价、不续写、不编造片段外情节。若是章内一个片段，只概括这个片段。',
  consistency: '核对小说片段与所给资料，列出明确冲突及正文依据，并单列信息不足、需要作者判断的疑点。没有发现也明确说明；不把缺资料当成矛盾，不编造前后文，不修改正文。',
};
export function requestForUnit(job: BatchJob, index: number, texts: Map<string, string>): AiMessage[] {
  const unit = job.units[index], chapter = job.chapters.find(item => item.id === unit?.chapterId);
  if (!unit || !chapter || !texts.has(unit.chapterId)) throw Error('任务批次或原文缺失');
  const base: AiMessage[] = [{ role: 'system', content: instructions[job.kind] }, { role: 'user', content: `《${job.bookTitle}》第${chapter.index + 1}章 ${chapter.title}，片段 ${unit.part}/${unit.parts}：\n` + texts.get(unit.chapterId)!.slice(unit.from, unit.to) }];
  const result = budgetContext(base, job.sources, job.policy);
  if (result.error) throw Error(`第${index + 1}批：${result.error}`); return result.messages;
}
export function parseJobResult(kind: JobKind, raw: string): string | CardSuggestion[] {
  if (!raw.trim()) throw Error('模型未返回有效内容');
  if (kind !== 'reader') return raw.trim();
  const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as unknown;
  if (!Array.isArray(value) || value.some(item => !item || !['character', 'lore', 'prop'].includes(item.kind)
    || typeof item.name !== 'string' || !item.name.trim() || !Array.isArray(item.aliases) || item.aliases.some((alias: unknown) => typeof alias !== 'string')
    || typeof item.summary !== 'string' || typeof item.evidence !== 'string')) throw Error('建卡结果不是约定的 JSON 数组，原始回复已保留，未跳过此批');
  return value as CardSuggestion[];
}
const jobDirectory = (root: string, dir: string) => joinPath(root, dir, 'entities', 'ai-jobs');
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
}
export function validateJob(value: unknown): BatchJob {
  const job = value as BatchJob;
  if (!job || job.version !== 1 || job.promptVersion !== 1 || typeof job.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(job.id) || !JOB_LABELS[job.kind]
    || typeof job.bookId !== 'string' || typeof job.bookTitle !== 'string' || typeof job.model !== 'string' || typeof job.createdAt !== 'string' || typeof job.updatedAt !== 'string'
    || !job.policy || !Number.isSafeInteger(job.policy.maxChars) || job.policy.maxChars <= 0 || !Array.isArray(job.policy.disabled) || job.policy.disabled.some(key => typeof key !== 'string')
    || !Array.isArray(job.units) || !Array.isArray(job.results) || !Array.isArray(job.chapters) || !Array.isArray(job.applied) || job.applied.some(key => typeof key !== 'string')
    || !Array.isArray(job.sources) || job.sources.some(source => !source || typeof source.key !== 'string' || typeof source.label !== 'string' || typeof source.text !== 'string')
    || typeof job.contextHash !== 'string' || !Number.isSafeInteger(job.next) || job.next < 0 || job.next > job.units.length
    || job.chapters.some(chapter => !chapter || typeof chapter.id !== 'string' || typeof chapter.title !== 'string' || typeof chapter.hash !== 'string' || typeof chapter.synopsis !== 'string' || !Number.isSafeInteger(chapter.index))
    || job.units.some(unit => !unit || !job.chapters.some(chapter => chapter.id === unit.chapterId) || ![unit.from, unit.to, unit.part, unit.parts].every(Number.isSafeInteger) || unit.from < 0 || unit.to <= unit.from || unit.part < 1 || unit.parts < unit.part)
    || job.results.some(result => !result || !Number.isSafeInteger(result.unit) || result.unit < 0 || result.unit >= job.units.length || typeof result.raw !== 'string' || typeof result.at !== 'string')) throw Error('任务格式损坏，原文件保留');
  for (let index = 0; index < job.next; index++) {
    const result = [...job.results].reverse().find(item => item.unit === index && item.parsed !== undefined && !item.error);
    if (!result || canonicalJson(parseJobResult(job.kind, result.raw)) !== canonicalJson(result.parsed)) throw Error('任务检查点与已保存结果不一致，未跳过批次');
  }
  return job;
}
export async function saveJob(root: string, dir: string, job: BatchJob) {
  if (!/^[a-zA-Z0-9_-]+$/.test(job.id)) throw Error('无效任务身份');
  await writeJson(joinPath(jobDirectory(root, dir), job.id + '.json'), job as unknown as JsonValue);
}
export async function listJobs(root: string, dir: string) {
  const jobs: BatchJob[] = [], warnings: string[] = [];
  if (!(await exists(jobDirectory(root, dir)))) return { jobs, warnings };
  for (const file of await listDir(jobDirectory(root, dir))) {
    if (!file.endsWith('.json')) continue;
    try {
      const job = validateJob(await readJson(joinPath(jobDirectory(root, dir), file)));
      if (job.id + '.json' !== file) throw Error('任务文件名与身份不一致');
      jobs.push(job);
    } catch (error) { warnings.push(file + '：' + String(error)); }
  }
  jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); return { jobs, warnings };
}
/** One result + its next checkpoint share the same atomic file. Failed saves never trigger another request. */
export class JobRunner {
  running = false; pauseRequested = false; pendingSave: BatchJob | null = null;
  pause() { this.pauseRequested = true; }
  async retrySave(save: (job: BatchJob) => Promise<void>) {
    if (!this.pendingSave) return;
    const snapshot = this.pendingSave; await save(snapshot); if (this.pendingSave === snapshot) this.pendingSave = null;
  }
  async run(initial: BatchJob, request: (unit: number) => Promise<AiResult>, save: (job: BatchJob) => Promise<void>, update: (job: BatchJob) => void): Promise<BatchJob> {
    if (this.running) throw Error('任务仍在运行');
    if (this.pendingSave) throw Error('先重试保存已有结果，不会重复请求模型');
    this.running = true; this.pauseRequested = false; let job = initial;
    try {
      while (job.next < job.units.length && !this.pauseRequested) {
        let result: AiResult;
        try { result = await request(job.next); }
        catch (reason) {
          const partial = (reason as { partial?: unknown })?.partial;
          if (typeof partial === 'string' && partial) {
            job = { ...job, state: 'error', updatedAt: new Date().toISOString(), results: [...job.results,
              { unit: job.next, raw: partial, error: '请求中断，保留已收到的片段：' + String(reason), at: new Date().toISOString() }] };
            this.pendingSave = job; update(job); await this.retrySave(save);
          }
          throw reason;
        }
        let parsed: JobResult['parsed'], error: string | undefined;
        try { parsed = parseJobResult(job.kind, result.text); } catch (reason) { error = String(reason); }
        const entry: JobResult = { unit: job.next, raw: result.text, parsed, error, at: new Date().toISOString(), promptTokens: result.promptTokens, completionTokens: result.completionTokens };
        job = { ...job, next: error ? job.next : job.next + 1, results: [...job.results, entry], updatedAt: new Date().toISOString(), state: error ? 'error' : job.next + 1 === job.units.length ? 'done' : 'paused' };
        this.pendingSave = job; update(job); await this.retrySave(save);
        if (error) throw Error(error);
      }
      return job;
    } finally { this.running = false; }
  }
}
