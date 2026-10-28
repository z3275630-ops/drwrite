import { UiSelect, ControlGroup } from './Controls';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, Character, LoreEntry, Prop } from '../types';
import type { AiConfig } from '../lib/ai';
import { chatAi } from '../lib/ai';
import { entityCardLines } from '../lib/assembler';
import { JobRunner, JOB_LABELS, fingerprint, listJobs, prepareJob, requestForUnit, saveJob, validateResume, type BatchJob, type CardSuggestion, type JobKind } from '../lib/batchJobs';
import { DEFAULT_CONTEXT_POLICY, type BudgetSource } from '../lib/contextBudget';
import { readChapter, safeName, saveExportFile } from '../lib/library';
import { docToPlainText } from '../lib/words';
import * as ent from '../lib/entities';
import * as propsLib from '../lib/props';
import { exists, joinPath, readJson } from '../lib/fs';
import { ContextControls } from './ContextReviewModal';
import { Modal } from './Modal';

export function AiTaskCenter(props: {
  root: string; dirName: string; book: Book; config: AiConfig | null; chars: Character[]; lore: LoreEntry[]; propEnts: Prop[];
  activeId: string | null; open: boolean; request?: { kind: JobKind; revision: number; chapterId?: string };
  onOpen: () => void; onClose: () => void; onSettings: () => void; onCreated: () => Promise<void>;
  onSynopsis: (id: string, expected: string, value: string) => Promise<void>;
  onRegisterFlush: (flush: () => Promise<boolean>) => void;
  onUnfinishedCount: (count: number) => void;
}) {
  const [jobs, setJobs] = useState<BatchJob[]>([]), [job, setJobState] = useState<BatchJob | null>(null), [kind, setKind] = useState<JobKind>('reader');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [running, setRunning] = useState(false), [progress, setProgress] = useState('');
  const [mode, setMode] = useState<'configure' | 'job'>('configure');
  const [scope, setScope] = useState('current'), [selected, setSelected] = useState<string[]>([]), [policy, setPolicy] = useState(DEFAULT_CONTEXT_POLICY);
  const [cardsOn, setCardsOn] = useState(true), [summaryOn, setSummaryOn] = useState(false), [preview, setPreview] = useState('');
  const runner = useRef(new JobRunner()).current, jobRef = useRef(job), busyRef = useRef(false);
  busyRef.current = busy;
  const setJob = (next: BatchJob) => { jobRef.current = next; setJobState(next); setJobs(previous => [next, ...previous.filter(item => item.id !== next.id)]); };
  const writeJob = useCallback((next: BatchJob) => saveJob(props.root, props.dirName, next), [props.root, props.dirName]);
  const flush = useCallback(async () => {
    if (runner.running || busyRef.current) { runner.pause(); props.onOpen(); setError('任务正在处理当前批次，已请求暂停；待结果保存后再离开。'); return false; }
    try { await runner.retrySave(writeJob); return true; }
    catch (reason) { setError('任务结果尚未保存，已取消离开：' + String(reason)); props.onOpen(); return false; }
  }, [runner, writeJob, props.onOpen]);
  useEffect(() => { props.onRegisterFlush(flush); return () => props.onRegisterFlush(async () => true); }, [props.onRegisterFlush, flush]);
  useEffect(() => props.onUnfinishedCount(jobs.filter(item => item.next < item.units.length).length), [jobs, props.onUnfinishedCount]);
  useEffect(() => { let alive = true; void listJobs(props.root, props.dirName).then(result => { if (alive) { setJobs(result.jobs); setError(result.warnings.join('\n')); } }).catch(reason => { if (alive) setError(String(reason)); }); return () => { alive = false; }; }, [props.root, props.dirName]);
  useEffect(() => { if (props.request && !runner.running) {
    setKind(props.request.kind); setMode('configure');
    if (props.request.chapterId) { setScope('selected'); setSelected([props.request.chapterId]); }
  } }, [props.request, runner]);
  const loadText = async (id: string) => { const file = await readChapter(props.root, props.dirName, id); if (!file) throw Error('章节读取失败'); return docToPlainText(file.doc); };
  const contextSources = (): BudgetSource[] => [
    ...(cardsOn ? [{ key: 'cards', label: '资料卡', text: entityCardLines(props.chars, props.lore, [...props.chars, ...props.lore, ...props.propEnts].map(item => item.id), props.propEnts).join('\n'), priority: 100 }] : []),
    ...(summaryOn && props.book.plotSummary ? [{ key: 'summary', label: '剧情总览', text: props.book.plotSummary, tail: true, priority: 50 }] : []),
  ];
  const range = props.book.chapters.filter(chapter => scope === 'all' || scope === 'current' && chapter.id === props.activeId || scope === 'selected' && selected.includes(chapter.id)
    || scope.startsWith('volume:') && (chapter.volumeId ?? '') === scope.slice(7));
  const prepare = async () => {
    if (!props.config) { props.onSettings(); return; }
    if (!range.length) { setError('先选择至少一个章节'); return; }
    setBusy(true); setError(''); setProgress('读取所选章节并计算内容指纹…');
    try {
      const prepared = await prepareJob(props.book, range, kind, props.config, policy, contextSources(), loadText);
      await writeJob(prepared.job);
      setJob(prepared.job); setMode('job');
      setPreview(JSON.stringify(requestForUnit(prepared.job, 0, prepared.texts), null, 2));
      setProgress(`已准备 ${range.length} 章 / ${prepared.job.units.length} 批；尚未请求模型。`);
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const start = async () => {
    if (!job || !props.config || runner.running || busy) return;
    if (runner.pendingSave) { setError('已有生成结果等待落盘，请先重试保存'); return; }
    setBusy(true); setError('');
    try {
      // Re-read even a just-prepared task; its original input may have changed meanwhile.
      if (policy.maxChars !== job.policy.maxChars || [...policy.disabled].sort().join('\0') !== [...job.policy.disabled].sort().join('\0')) throw Error('预算已改变，请重新准备任务；续跑沿用原预算');
      const texts = await validateResume(job, props.book, props.config, contextSources(), loadText);
      await writeJob(job); setBusy(false); setRunning(true);
      const current = await runner.run(job, async index => {
        setProgress(`正在处理第 ${index + 1}/${job.units.length} 批；暂停将在此批结束并保存后生效。`);
        let partial = '';
        try { return await chatAi(props.config!, requestForUnit(job, index, texts), { maxTokens: 3000, temperature: 0.3 }, { onContent: text => { partial = text; } }); }
        catch (reason) { throw Object.assign(new Error(String(reason)), { partial }); }
      }, writeJob, setJob);
      setJob(current); setProgress(current.next === current.units.length ? '全部批次完成，结果已保存；请自行检查后采纳。' : `已暂停，完成 ${current.next}/${current.units.length} 批。`);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); setRunning(false); }
  };
  const recordApplied = async (key: string) => {
    const current = jobRef.current!; const next = { ...current, applied: [...new Set([...current.applied, key])], updatedAt: new Date().toISOString() };
    runner.pendingSave = next; setJob(next); await runner.retrySave(writeJob);
  };
  const checkChapter = async (chapterId: string) => {
    const original = jobRef.current?.chapters.find(chapter => chapter.id === chapterId);
    if (!original || !props.book.chapters.some(chapter => chapter.id === chapterId) || await fingerprint(await loadText(chapterId)) !== original.hash) throw Error('原章节已变化，结果保留供你参考，不直接写入');
  };
  const applySynopsis = async (chapterId: string) => {
    if (!job || busy || runner.pendingSave || runner.running) return;
    setBusy(true);
    try {
      await checkChapter(chapterId);
      const units = job.units.map((unit, index) => ({ ...unit, index })).filter(unit => unit.chapterId === chapterId);
      if (!units.length) throw Error('此章没有可采纳的结果');
      const results = units.map(unit => [...job.results].reverse().find(result => result.unit === unit.index && typeof result.parsed === 'string'));
      if (results.some(result => !result)) throw Error('此章还有未完成批次');
      const value = results.map((result, index) => results.length > 1 ? `片段 ${index + 1}：${result!.parsed}` : String(result!.parsed)).join('\n\n');
      await props.onSynopsis(chapterId, job.chapters.find(chapter => chapter.id === chapterId)!.synopsis, value);
      await recordApplied('synopsis:' + chapterId); setError('');
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const applyCard = async (resultUnit: number, index: number, suggestion: CardSuggestion) => {
    if (!job || busy || runner.running || runner.pendingSave) return;
    setBusy(true);
    try {
      await checkChapter(job.units[resultUnit].chapterId);
      const id = `${job.id}-${resultUnit}-${index}`;
      const directory = suggestion.kind === 'character' ? 'characters' : suggestion.kind === 'lore' ? 'lore' : 'props';
      const path = joinPath(props.root, props.dirName, 'entities', directory, id + '.json');
      if (await exists(path)) {
        const previous = await readJson(path) as unknown as { name: string; type: string };
        if (previous.name !== suggestion.name || previous.type !== suggestion.kind) throw Error('已创建卡片被修改，未覆盖，请手工核对');
      } else {
        const all = [...await ent.listCharacters(props.root, props.dirName), ...await ent.listLore(props.root, props.dirName), ...await propsLib.listProps(props.root, props.dirName)];
        if (all.some(item => [item.name, ...item.aliases].some(name => name.trim().toLocaleLowerCase() === suggestion.name.trim().toLocaleLowerCase()))) throw Error('已有同名或别名卡片，请先到资料库核对，不重复创建');
        const description = suggestion.summary + (suggestion.evidence ? '\n依据：' + suggestion.evidence : '');
        if (suggestion.kind === 'character') { const card = ent.newCharacter(suggestion.name); card.id = id; card.aliases = suggestion.aliases; card.personality = description; await ent.saveCharacter(props.root, props.dirName, card); }
        else if (suggestion.kind === 'lore') { const card = ent.newLore(suggestion.name); card.id = id; card.aliases = suggestion.aliases; card.content = description; await ent.saveLore(props.root, props.dirName, card); }
        else { const card = propsLib.newProp(suggestion.name); card.id = id; card.aliases = suggestion.aliases; card.content = description; await propsLib.saveProp(props.root, props.dirName, card); }
      }
      await recordApplied(`card:${resultUnit}:${index}`); await props.onCreated(); setError('');
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  if (!props.open) return null;
  const blocked = busy || running || !!runner.pendingSave;
  const retrySaving = async () => {
    try { await runner.retrySave(writeJob); setError(''); setProgress('结果已保存，可以继续。'); }
    catch (reason) { setError(String(reason)); }
  };
  return <Modal title="AI 任务" description="分批阅读所选正文。建议先保存，由你决定是否采纳。" className="tool-modal" width={840} onClose={props.onClose} busy={blocked}
    footer={<><span className="footer-caption">{running ? `正在处理 ${Math.min((job?.next ?? 0) + 1, job?.units.length ?? 0)} / ${job?.units.length ?? 0} 批` : mode === 'configure' ? `已选 ${range.length} 章` : job ? `已保存 ${job.next} / ${job.units.length} 批` : ''}</span>
      <div className="footer-actions">
        {mode === 'job' && <button className="ghost-btn" disabled={blocked} onClick={() => setMode('configure')}>任务设置</button>}
        <button className="ghost-btn" disabled={blocked} onClick={props.onClose}>关闭</button>
        {runner.pendingSave ? <button className="primary-btn" disabled={busy || running} onClick={() => void retrySaving()}>重试保存结果</button>
          : running ? <button className="primary-btn" disabled={runner.pauseRequested} onClick={() => { runner.pause(); setProgress('暂停请求已收到，当前批保存后停止。'); }}>当前批结束后暂停</button>
          : mode === 'configure' ? <button className="primary-btn" disabled={busy || !range.length} onClick={() => void prepare()}>{busy ? '正在准备…' : '准备任务'}</button>
          : job && job.next < job.units.length ? <button className="primary-btn" disabled={busy} onClick={() => void start()}>{job.results.length ? '继续剩余批次' : `开始 ${job.units.length} 批请求`}</button>
          : <button className="primary-btn" disabled={busy} onClick={props.onClose}>返回写作</button>}
      </div></>}>
    {error && <div className="tool-message error" role="alert">{error}{runner.pendingSave && <p>已生成的内容仍保留在这里，重试保存不会再次请求模型。</p>}</div>}
    <div hidden={mode !== 'configure'}>
    <ControlGroup disabled={blocked}><legend>这次想做什么</legend><div className="form-grid">
      <label className="field">任务类型<UiSelect value={kind} onChange={event => setKind(event.target.value as JobKind)}>{Object.entries(JOB_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</UiSelect></label>
      <label className="field">阅读范围<UiSelect value={scope} onChange={event => setScope(event.target.value)}><option value="current">本章</option><option value="all">全书</option><option value="selected">勾选章节</option><option value="volume:">未分卷</option>{props.book.volumes?.map(volume => <option key={volume.id} value={'volume:' + volume.id}>{volume.title}</option>)}</UiSelect></label>
    </div>{scope === 'selected' && <div className="task-chapter-selection">{props.book.chapters.map(chapter => <label key={chapter.id}><input type="checkbox" checked={selected.includes(chapter.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, chapter.id] : previous.filter(id => id !== chapter.id))} />{chapter.index + 1}. {chapter.title}</label>)}</div>}
      <details className="tool-disclosure"><summary>上下文选项<span>{policy.maxChars.toLocaleString()} 字符上限</span></summary><div>
        <ContextControls policy={policy} onChange={setPolicy} />
        <div className="option-checks"><label><input type="checkbox" checked={cardsOn} onChange={event => setCardsOn(event.target.checked)} />带资料卡</label><label><input type="checkbox" checked={summaryOn} onChange={event => setSummaryOn(event.target.checked)} />带剧情总览</label></div>
        <p className="hint-text">资料卡沿用当前精简格式，最多 12 张；可以在请求预览中核对。长章完整分片，不只读取开头。</p>
      </div></details>
    </ControlGroup>
    {!!jobs.length && <section className="tool-section"><h3 className="tool-section-title">接着上次的任务</h3>
      <UiSelect aria-label="已保存任务" disabled={blocked} value={job?.id ?? ''} onChange={event => {
        const next = jobs.find(item => item.id === event.target.value); if (!next) return;
        setJob(next); setMode('job'); setPolicy(next.policy); setCardsOn(next.sources.some(source => source.key === 'cards')); setSummaryOn(next.sources.some(source => source.key === 'summary')); setPreview(''); setError(''); setProgress('继续前会核对原文、模型和来源。');
      }}><option value="">选择已保存任务</option>{jobs.map(item => <option key={item.id} value={item.id}>{JOB_LABELS[item.kind]} · {item.next}/{item.units.length} 批 · {new Date(item.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</option>)}</UiSelect>
    </section>}
    </div>
    {mode === 'job' && job && <><div className="tool-summary">
      <div><span className="tool-kicker">{JOB_LABELS[job.kind]}</span><h3>{job.chapters.length === 1 ? job.chapters[0].title : `${job.chapters.length} 章，按原目录顺序`}</h3></div>
      <div className="summary-number"><strong>{job.next}<small> / {job.units.length}</small></strong><span>批已保存</span></div>
    </div><progress className="tool-progress" aria-label="任务完成进度" max={job.units.length || 1} value={job.next} />
      <p className="tool-status" role="status">{progress || '任务已保存，可以继续处理剩余批次。'}</p>
      {!job.results.length && <div className="tool-message">准备完成，尚未请求模型。开始后将分 {job.units.length} 批处理；每批保存后才进行下一批。</div>}
      <details className="tool-disclosure"><summary>请求与模型详情</summary><div><p className="hint-text">{job.model} · 每批预算 {job.policy.maxChars.toLocaleString()} 字符</p>
        {preview ? <pre className="preview-body">{preview}</pre> : <p className="hint-text">任务的原始结果与完成位置均保存在本书中，继续前会重新校验原文。</p>}
      </div></details>
    </>}
    {mode === 'job' && job && <><button className="ghost-btn small" onClick={() => void saveExportFile(safeName(props.book.title) + '-' + JOB_LABELS[job.kind] + '-原始结果.txt', job.results.map(result => `第${result.unit + 1}批${result.error ? '（未通过解析）' : ''}\n${result.raw}`).join('\n\n'), props.root).catch(reason => setError(String(reason)))}>另存原始结果 TXT</button>
      <div className="task-results polished-results">{job.results.map((result, resultIndex) => <section key={resultIndex}><h3>第 {result.unit + 1} 批 · {job.chapters.find(chapter => chapter.id === job.units[result.unit]?.chapterId)?.title}</h3>
        <small>输入 {result.promptTokens ?? '未报告'} / 输出 {result.completionTokens ?? '未报告'} tokens</small>
        {result.error && <p role="alert">{result.error}</p>}
        {job.kind === 'reader' ? <details><summary>查看原始回复{result.error ? '（解析未通过）' : ''}</summary><pre>{result.raw}</pre></details> : <pre>{result.raw}</pre>}
        {Array.isArray(result.parsed) && result.parsed.map((card, index) => <article key={index}><b>{card.name} · {{ character: '人物', lore: '设定', prop: '道具' }[card.kind]}</b><p>{card.summary}</p><small>依据：{card.evidence}</small>
          <button className="ghost-btn small" disabled={busy || running || !!runner.pendingSave || job.applied.includes(`card:${result.unit}:${index}`)} onClick={() => void applyCard(result.unit, index, card)}>{job.applied.includes(`card:${result.unit}:${index}`) ? '已采纳' : '确认创建这张卡'}</button>
        </article>)}
      </section>)}</div>
      {job.kind === 'synopsis' && job.chapters.map(chapter => <p key={chapter.id}>{chapter.title} · {chapter.synopsis ? '原有手写梗概，采纳将替换，请核对上方结果' : '原梗概为空'} <button className="ghost-btn small" disabled={busy || running || !!runner.pendingSave || job.applied.includes('synopsis:' + chapter.id) || job.units.some((unit, index) => unit.chapterId === chapter.id && index >= job.next)} onClick={() => void applySynopsis(chapter.id)}>{job.applied.includes('synopsis:' + chapter.id) ? '已采纳' : '确认采纳此章梗概'}</button></p>)}
    </>}
  </Modal>;
}
