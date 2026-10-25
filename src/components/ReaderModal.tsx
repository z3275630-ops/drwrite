import { useState } from 'react';
import type { Book, Character, LoreEntry, Prop } from '../types';
import { chatAi } from '../lib/ai';
import type { AiConfig } from '../lib/ai';
import * as lib from '../lib/library';
import * as ent from '../lib/entities';
import * as propl from '../lib/props';
import { readChapter } from '../lib/library';
import { docToPlainText } from '../lib/words';
import { Modal } from './Modal';
import { toast } from './Toast';

type SugKind = 'character' | 'lore' | 'prop';

interface Suggestion {
  kind: SugKind;
  name: string;
  aliases: string[];
  summary: string;
  evidence: string;
  checked: boolean;
  exists: boolean;
}

const KIND_LABEL: Record<SugKind, string> = { character: '人物', lore: '设定', prop: '道具' };

/**
 * AI 通读建卡（P6，学织境的「AI 先读完整部作品帮你搭设定集」）：
 * 分批把章节正文交给模型，抽取人物/设定/道具建议；作者勾选后才真正建卡。
 */
export default function ReaderModal(props: {
  root: string;
  dirName: string;
  book: Book;
  aiCfg: AiConfig;
  chars: Character[];
  lore: LoreEntry[];
  propEnts: Prop[];
  onCreated: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [progress, setProgress] = useState('');
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [creating, setCreating] = useState(false);

  const BATCH_CHARS = 5000;

  const knownNames = () => {
    const m = new Map<string, SugKind>();
    for (const c of props.chars) {
      m.set(c.name.toLowerCase(), 'character');
      c.aliases.forEach((a) => m.set(a.toLowerCase(), 'character'));
    }
    for (const l of props.lore) {
      m.set(l.name.toLowerCase(), 'lore');
      l.aliases.forEach((a) => m.set(a.toLowerCase(), 'lore'));
    }
    for (const p of props.propEnts) {
      m.set(p.name.toLowerCase(), 'prop');
      p.aliases.forEach((a) => m.set(a.toLowerCase(), 'prop'));
    }
    return m;
  };

  const mergeSuggestion = (known: Map<string, SugKind>, raw: unknown) => {
    const arr = Array.isArray(raw) ? raw : [];
    setSugs((prev) => {
      const seen = new Set(prev.map((s) => s.kind + ':' + s.name));
      const next = [...prev];
      for (const item of arr) {
        const o = item as { kind?: string; name?: string; aliases?: string[]; summary?: string; evidence?: string };
        const kind = (['character', 'lore', 'prop'].includes(String(o.kind)) ? o.kind : 'character') as SugKind;
        const name = String(o.name ?? '').trim().slice(0, 24);
        if (!name || name.length < 2) continue;
        const key = kind + ':' + name;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({
          kind,
          name,
          aliases: (o.aliases ?? []).map(String).filter((a) => a && a !== name).slice(0, 4),
          summary: String(o.summary ?? '').slice(0, 120),
          evidence: String(o.evidence ?? '').slice(0, 60),
          checked: true,
          exists: known.get(name.toLowerCase()) === kind,
        });
      }
      return next;
    });
  };

  const run = async () => {
    setPhase('running');
    setProgress('正在读取章节……');
    try {
      const written = props.book.chapters.filter((c) => c.wordCount > 0);
      // 分批：每批累计约 BATCH_CHARS 字
      const batches: { metas: typeof written; from: number; to: number }[] = [];
      let buf: typeof written = [];
      let size = 0;
      let from = 0;
      for (const m of written) {
        buf.push(m);
        size += m.wordCount;
        if (size >= BATCH_CHARS) {
          batches.push({ metas: [...buf], from, to: m.index });
          from = m.index + 1;
          buf = [];
          size = 0;
        }
      }
      if (buf.length) batches.push({ metas: [...buf], from, to: buf[buf.length - 1].index });
      if (!batches.length) {
        toast('还没有可读的正文', 'err');
        setPhase('idle');
        return;
      }
      const known = knownNames();
      let log = '';
      for (let i = 0; i < batches.length; i++) {
        const b = batches[i];
        setProgress(`通读中 ${i + 1}/${batches.length}（第${b.from + 1}～${b.to + 1}章）……`);
        const parts: string[] = [];
        for (const m of b.metas) {
          const f = await readChapter(props.root, props.dirName, m.id);
          if (!f) continue;
          const text = docToPlainText(f.doc as never).slice(0, 1600);
          parts.push(`【第${m.index + 1}章 ${m.title}】\n${text}`);
        }
        const r = await chatAi(
          props.aiCfg,
          [
            {
              role: 'system',
              content:
                '你从小说正文里抽取实体。只输出一个 JSON 数组，不要任何解释或代码块标记。' +
                '数组每项：{"kind":"character|lore|prop","name":"名字","aliases":["别名"],"summary":"一句话概括（身份/内容/作用）","evidence":"正文依据（≤30字）"}。' +
                '只抽有名有姓、反复出现或影响情节的：人物（character）、设定/地点/势力/规则（lore）、道具/法宝/信物（prop）。' +
                '没有就输出 []。',
            },
            { role: 'user', content: `《${props.book.title}》节选：\n\n` + parts.join('\n\n') },
          ],
          { maxTokens: 3000, temperature: 0.3 },
          {
            onContent: (full) => {
              log = full;
              setProgress(`通读中 ${i + 1}/${batches.length}（第${b.from + 1}～${b.to + 1}章）…… 已收到 ${full.length} 字`);
            },
          }
        );
        // 宽松解析：剥掉可能的 ```json 围栏后取第一个 [...] 
        let cleaned = r.text.replace(/```(?:json)?/g, '').trim();
        const lb = cleaned.indexOf('[');
        const rb = cleaned.lastIndexOf(']');
        if (lb >= 0 && rb > lb) {
          try {
            cleaned = cleaned.slice(lb, rb + 1);
            mergeSuggestion(known, JSON.parse(cleaned));
          } catch {
            /* 这一批解析失败就跳过 */
          }
        }
      }
      setPhase('done');
      setProgress(`通读完成，共 ${batches.length} 批`);
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), 'err');
      setPhase('idle');
    }
  };

  const createChecked = async () => {
    setCreating(true);
    let n = 0;
    try {
      for (const s of sugs.filter((x) => x.checked && !x.exists)) {
        if (s.kind === 'character') {
          const c = ent.newCharacter(s.name);
          c.aliases = s.aliases;
          c.personality = s.summary + (s.evidence ? `（依据：${s.evidence}）` : '');
          await ent.saveCharacter(props.root, props.dirName, c);
        } else if (s.kind === 'lore') {
          const l = ent.newLore(s.name, '世界观');
          l.aliases = s.aliases;
          l.content = s.summary + (s.evidence ? `（依据：${s.evidence}）` : '');
          await ent.saveLore(props.root, props.dirName, l);
        } else {
          const p = propl.newProp(s.name);
          p.aliases = s.aliases;
          p.content = s.summary + (s.evidence ? `（依据：${s.evidence}）` : '');
          await propl.saveProp(props.root, props.dirName, p);
        }
        n++;
      }
      await props.onCreated();
      toast(`已建 ${n} 张卡`);
      props.onClose();
    } catch (e) {
      toast('建卡失败：' + String(e), 'err');
    } finally {
      setCreating(false);
    }
  };

  const toggle = (i: number) =>
    setSugs((prev) => prev.map((s, j) => (j === i ? { ...s, checked: !s.checked } : s)));

  const checkedCount = sugs.filter((s) => s.checked && !s.exists).length;

  return (
    <Modal title="AI 通读建卡" width={640} onClose={props.onClose}>
      <p className="hint-text">
        AI 分批通读全书正文，抽取人物 / 设定 / 道具建议卡；<b>你勾选之后才会真正建卡</b>，已有的卡会自动跳过。
        建完卡，正文中出现这些名字时就会有淡提示，一点即关联。
      </p>
      {phase === 'idle' && (
        <>
          <p className="confirm-text">
            本书可读章节：{props.book.chapters.filter((c) => c.wordCount > 0).length} 章 ·
            约 {lib.fmtNum(props.book.stats.totalWords)} 字（预计 {Math.max(1, Math.ceil(props.book.stats.totalWords / BATCH_CHARS))} 次 AI 调用）
          </p>
          <div className="modal-actions">
            <button className="ghost-btn" onClick={props.onClose}>
              取消
            </button>
            <button className="primary-btn" onClick={() => void run()}>
              开始通读
            </button>
          </div>
        </>
      )}
      {phase === 'running' && (
        <div className="prop-loading">
          <div className="prop-shimmer" />
          <div className="prop-shimmer short" />
          <p className="hint-text">{progress}</p>
        </div>
      )}
      {phase === 'done' && (
        <>
          <p className="hint-text">
            {progress} · 建议 {sugs.length} 条，其中新卡 {sugs.filter((s) => !s.exists).length} 条
          </p>
          <div className="reader-list">
            {!sugs.length && <div className="entity-empty">没有抽出可建卡的实体</div>}
            {sugs.map((s, i) => (
              <label key={i} className={'reader-item' + (s.exists ? ' exists' : '')}>
                <input type="checkbox" checked={s.checked && !s.exists} disabled={s.exists} onChange={() => toggle(i)} />
                <span className={`cat-badge c-${s.kind === 'prop' ? '道具' : s.kind === 'character' ? '事件' : '世界观'}`}>
                  {KIND_LABEL[s.kind]}
                </span>
                <span className="entity-name">{s.name}</span>
                <span className="entity-sub">{s.exists ? '已有' : s.summary}</span>
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button className="ghost-btn" onClick={props.onClose}>
              关闭
            </button>
            <button className="primary-btn" disabled={!checkedCount || creating} onClick={() => void createChecked()}>
              {creating ? '建卡中…' : `建 ${checkedCount} 张卡`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
