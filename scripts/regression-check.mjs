// Run with `node scripts/regression-check.mjs`; reuses the installed TypeScript compiler.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

const urls = new Map();
async function moduleUrl(file) {
  file = path.resolve(file);
  if (urls.has(file)) return urls.get(file);
  let js = ts.transpileModule(await fs.readFile(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const match of [...js.matchAll(/from ['"]([.][^'"]+)['"]/g)]) {
    let dependency = path.resolve(path.dirname(file), match[1]);
    try { await fs.access(dependency + '.ts'); dependency += '.ts'; }
    catch { dependency = path.join(dependency, 'index.ts'); }
    js = js.replace(match[0], `from '${await moduleUrl(dependency)}'`);
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
  urls.set(file, url);
  return url;
}

const { SaveCoordinator, SerialQueue } = await import(await moduleUrl('src/lib/saveCoordinator.ts'));
const { buildAiMessages, buildContextSources } = await import(await moduleUrl('src/lib/assembler.ts'));

const saver = new SaveCoordinator();
let text = 'A';
let release;
const paused = new Promise((resolve) => { release = resolve; });
const saved = [];
saver.markDirty();
const flushing = saver.flush(async () => {
  const snapshot = text;
  if (saved.length === 0) await paused;
  saved.push(snapshot);
});
assert.equal(saver.flush(async () => { throw Error('must not start a second writer'); }), flushing);
await Promise.resolve();
text = 'ABC';
saver.markDirty();
release();
assert.equal(await flushing, true);
assert.deepEqual(saved, ['A', 'ABC']);
assert.equal(saver.dirty, false);
saver.markDirty();
assert.equal(await saver.flush(async () => { throw Error('disk locked'); }), false);
assert.equal(saver.dirty, true);
assert.match(String(saver.error), /disk locked/);
assert.equal(await saver.flush(async () => { saved.push('retried'); }), true);
assert.equal(saver.dirty, false);

const queue = new SerialQueue();
const events = [];
await Promise.allSettled([
  queue.run(async () => { events.push('body'); throw Error('expected'); }),
  queue.run(async () => { events.push('metadata'); }),
]);
await queue.idle();
assert.deepEqual(events, ['body', 'metadata']);

const chapters = [0, 1, 2].map((index) => ({ id: 'c' + index, index, title: 'Chapter ' + index }));
const input = {
  book: { title: 'Test', chapters }, chapter: chapters[1], kind: 'continue', relatedIds: [],
  chapterTail: '【old opening】' + '过渡正文'.repeat(1500) + '【latest ending in desert】',
  foreshadows: [
    { title: 'already planted', plantAnchors: [{ chapterId: 'c0' }], payoffAnchor: null },
    { title: 'future plant', plantAnchors: [{ chapterId: 'c2' }], payoffAnchor: null },
    { title: 'already resolved', plantAnchors: [{ chapterId: 'c0' }], payoffAnchor: { chapterId: 'c0' } },
  ],
};
const messages = buildAiMessages(input, [], [], []);
const prompt = messages[1].content;
assert(prompt.includes('【latest ending in desert】'));
assert(!prompt.includes('【old opening】'));
assert(prompt.includes('already planted'));
assert(!prompt.includes('future plant'));
assert(!prompt.includes('already resolved'));
for (const source of buildContextSources(input, [], [], [])) assert(prompt.includes(source.text));
const selection = '完整选区'.repeat(1000);
const rewrite = buildAiMessages({ ...input, kind: 'rewrite', selection, chapterAfter: 'nearby after' }, [], [], [])[1].content;
assert(rewrite.includes(selection));
assert(rewrite.includes('nearby after'));
assert(rewrite.includes('【latest ending in desert】'));
console.log('PASS: save revisions, failed-save retry, ordered metadata, latest ending, context preview, foreshadow scope, complete selection');
