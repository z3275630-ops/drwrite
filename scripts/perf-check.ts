/**
 * 规模性能实测（P5 安全垫）：用真实代码路径跑一个 300 章 × ~1800 字 + 140 实体的书。
 * 跑法：npx vite-node scripts/perf-check.ts
 * 用内存 localStorage 替身模拟文件层（桌面端 invoke 的额外开销是每次 ~0.1ms 级）。
 */
import type { Book, ChapterFile, ChapterMeta } from '../src/types';
import { MODEL_VERSION } from '../src/types';

/* ---------- 内存版 localStorage 替身 ---------- */
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

const lib = await import('../src/lib/library');
const ent = await import('../src/lib/entities');
const { genId, nowIso } = await import('../src/lib/id');

const ROOT = 'C:/perf-test';
const N_CHAPTERS = 300;
const PARAS_PER_CH = 8;
const SENT = '陆沉数了数手里的铜钱，窗外的雪落得愈发密了，他想起三年前那个离奇的雨夜，师父留下的铜镜在匣中微微发烫。';

function makeDoc(seedIdx: number) {
  const names = ['陆沉', '白霜儿', '墨老', '青璃'];
  const paras: unknown[] = [];
  for (let p = 0; p < PARAS_PER_CH; p++) {
    const who = names[(seedIdx + p) % names.length];
    paras.push({
      type: 'paragraph',
      content: [{ type: 'text', text: `第${seedIdx + 1}段：${who}说，${SENT}` }],
    });
  }
  return { type: 'doc', content: paras };
}

async function main() {
  const t = (label: string, fn: () => Promise<void> | void) => async () => {
    const t0 = Date.now();
    await fn();
    console.log(`${label}: ${Date.now() - t0} ms`);
  };

  const chars = Array.from({ length: 80 }, (_, i) => {
    const c = ent.newCharacter(`人物${i + 1}`);
    c.personality = '沉稳寡言，重诺。';
    c.biography = ['幼年失怙', '拜入山门'];
    return c;
  });
  const lores = Array.from({ length: 60 }, (_, i) => {
    const l = ent.newLore(`设定${i + 1}`, '地点');
    l.content = '一座常年积雪的山城，出产玄铁。';
    return l;
  });

  console.log(`规模：${N_CHAPTERS} 章 × ${PARAS_PER_CH} 段 ≈ ${N_CHAPTERS * PARAS_PER_CH * SENT.length * 2} 字，80 人物 + 60 设定`);

  await t('1) 新建书骨架', () => lib.createBook(ROOT, '性能实测之书', 4000))();

  const entry = (await lib.listBooks(ROOT))[0];
  await t('2) 书架列目录', async () => {
    await lib.listBooks(ROOT);
  })();

  await t(`3) 批量写入 ${N_CHAPTERS} 章（含建实体）`, async () => {
    for (const c of chars) await ent.saveCharacter(ROOT, entry.dirName, c);
    for (const l of lores) await ent.saveLore(ROOT, entry.dirName, l);
    const book0 = await lib.loadBook(ROOT, entry.dirName);
    let book = book0!;
    const first = book.chapters[0];
    for (let i = 0; i < N_CHAPTERS; i++) {
      if (i === 0) {
        const f = await lib.readChapter(ROOT, entry.dirName, first.id);
        const meta: ChapterMeta = { ...f!.meta, wordCount: 0 };
        const file: ChapterFile = { protocolVersion: MODEL_VERSION, meta, doc: makeDoc(0) as never };
        book = await lib.saveChapterWithStats(ROOT, entry.dirName, book, file);
        continue;
      }
      const meta: ChapterMeta = {
        id: genId(),
        index: i,
        title: `第${i + 1}章`,
        wordCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const file: ChapterFile = { protocolVersion: MODEL_VERSION, meta, doc: makeDoc(i) as never };
      book.chapters.push(meta);
      book = await lib.saveChapterWithStats(ROOT, entry.dirName, book, file);
    }
    (globalThis as Record<string, unknown>).__perfBook = book;
  })();

  const book = (globalThis as { __perfBook: Book }).__perfBook;

  await t('4) 单章保存（增量引用索引，日常打字的路径）', async () => {
    const last = book.chapters[book.chapters.length - 1];
    const f = (await lib.readChapter(ROOT, entry.dirName, last.id))!;
    book.chapters = book.chapters.map((c) => (c.id === last.id ? { ...c, wordCount: 0 } : c));
    await lib.saveChapterWithStats(ROOT, entry.dirName, book, {
      ...f,
      doc: makeDoc(999) as never,
    } as ChapterFile);
  })();

  await t('5) 全量重建引用索引（快照恢复触发）', async () => {
    await ent.rebuildAllRefs(
      ROOT,
      entry.dirName,
      book.chapters.map((c) => ({ id: c.id })),
      async (id) => {
        const f = await lib.readChapter(ROOT, entry.dirName, id);
        return (f?.doc as never) ?? null;
      }
    );
  })();

  await t('6) 全书导出（MD 拼装）', async () => {
    await lib.composeExport(ROOT, entry.dirName, book, { format: 'md', scope: 'all' });
  })();

  await t('7) 手动快照（整书拷贝）', async () => {
    await lib.createSnapshot(ROOT, entry.dirName);
  })();

  const kb = (store.size ? [...store.values()].reduce((s, v) => s + v.length, 0) / 1024 : 0).toFixed(0);
  console.log(`存储总量：约 ${kb} KB（${store.size} 个文件）`);
  console.log('完成。');
}

void main();
