import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

const modules = new Map();
async function url(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file);
  let js = ts.transpileModule(await fs.readFile(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  for (const match of [...js.matchAll(/from ['"]([.][^'"]+)['"]/g)]) {
    let dependency = path.resolve(path.dirname(file), match[1]);
    try { await fs.access(dependency + '.ts'); dependency += '.ts'; } catch { dependency = path.join(dependency, 'index.ts'); }
    js = js.replace(match[0], `from '${await url(dependency)}'`);
  }
  const result = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64'); modules.set(file, result); return result;
}
const { filterChapters } = await import(await url('src/lib/chapterWorkflow.ts'));
const { ChapterTextSearch } = await import(await url('src/lib/chapterSearch.ts'));
const chapters = Array.from({ length: 400 }, (_, index) => ({ id: 'chapter-' + index, index, title: '第' + index + '章', updatedAt: 'one', workflow: index % 2 ? 'review' : undefined }));
assert.equal(filterChapters(chapters, '', 'review').length, 200);
assert.equal(filterChapters(chapters, '', 'unmarked').length, 200);
assert.equal(filterChapters(chapters, '第1章', 'all')[0].id, 'chapter-1');
assert.equal(chapters[0].workflow, undefined);
const engine = new ChapterTextSearch(); let loads = 0, active = 0, peak = 0;
const load = async id => { loads++; active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return '林岚离开 ' + id; };
assert.equal((await engine.search('one', chapters, '林岚', load)).length, 400);
assert(peak <= 4); assert.equal(loads, 400);
assert.equal((await engine.search('one', chapters, '林岚', load)).length, 400); assert.equal(loads, 400);
await engine.search('one', chapters.map((chapter, index) => index === 1 ? { ...chapter, updatedAt: 'two' } : chapter), '林岚', load); assert.equal(loads, 401);
let release;
const old = engine.search('slow-book', chapters.slice(0, 1), '旧词', () => new Promise(resolve => { release = resolve; }));
const latest = await engine.search('latest-book', chapters.slice(0, 1), '新词', async () => '新词');
release('旧词'); assert.equal(await old, null); assert.equal(latest.length, 1);
let finish;
const abandoned = engine.search('abandoned', chapters.slice(0, 1), '词', () => new Promise(resolve => { finish = resolve; }));
engine.invalidate(); finish('词'); assert.equal(await abandoned, null);
await assert.rejects(engine.search('failure', chapters.slice(0, 1), '词', async () => { throw Error('read locked'); }), /read locked/);
assert.equal((await engine.search('failure', chapters.slice(0, 1), '词', async () => '词')).length, 1);
console.log('PASS: workflow compatibility/filtering; 400-chapter search, bounded concurrency, cache/version invalidation, stale/closed queries, failed read retry');

const { validateStoryTime, compareStoryTime, storySections } = await import(await url('src/lib/storyTime.ts'));
const time = { calendar: '天启历', year: -2, month: 13, day: 40 };
assert.equal(validateStoryTime(time), null);
assert.match(validateStoryTime({ ...time, year: NaN }), /整数/);
assert.match(validateStoryTime({ ...time, month: undefined }), /月份/);
assert.equal(compareStoryTime(time, { ...time, calendar: '另一历' }), null);
assert(compareStoryTime(time, { ...time, year: 1 }) < 0);
const partial = [{ id: 1, storyTime: { calendar: '纪元', year: 1 } }, { id: 2, storyTime: { calendar: '纪元', year: -1 } }];
assert.deepEqual(storySections(partial)[0].events.map(x => x.id), [1, 2]);
assert.deepEqual(storySections(partial.map((x, i) => ({ ...x, storyTime: { ...x.storyTime, order: 2 - i } })))[0].events.map(x => x.id), [2, 1]);
const { sessionProgress, movingAverage, quotedRatio, bookTotal } = await import(await url('src/lib/writingMetrics.ts'));
assert.deepEqual(sessionProgress({ baseline: 100, target: 50 }, 70), { net: -30, ratio: 0 });
assert.deepEqual(sessionProgress({ baseline: 100, target: 0 }, 200), { net: 100, ratio: 0 });
assert.equal(sessionProgress({ baseline: 100, target: 50 }, 200).ratio, 1);
assert.deepEqual(movingAverage([1, 2, 3, 4, 5, 6]), [null, null, null, null, 3, 4]);
assert.equal(quotedRatio(''), null); assert.equal(quotedRatio('“甲乙” 丙'), 2 / 5);
assert.equal(bookTotal([{ id: 'a', wordCount: 30 }, { id: 'b', wordCount: 20 }], 'a', 10), 30);
const { characterHealth } = await import(await url('src/lib/characterHealth.ts'));
const people = [{ id: 'a', name: '林澄', aliases: ['阿澄'], tier: '主角', profile: {}, biography: [] }, { id: 'b', name: '阿澄', aliases: [], tier: '配角', personality: '谨慎', profile: {}, biography: [] }];
assert(characterHealth(people, []).some(x => x.code === 'name'));
assert(characterHealth(people, []).some(x => x.code === 'unlinked'));
assert(!characterHealth(people, [{ targetType: 'character', targetId: 'a' }]).some(x => x.code === 'unlinked'));
assert.equal(characterHealth(people, []).find(x => x.code === 'name').fingerprint, characterHealth([...people].reverse(), []).find(x => x.code === 'name' && x.characterId === 'a').fingerprint);

const { Schema } = await import('@tiptap/pm/model');
const { EditorState } = await import('@tiptap/pm/state');
const scenes = await import(await url('src/lib/scenes.ts'));
const schema = new Schema({ nodes: { doc: { content: 'block*' }, paragraph: { group: 'block', content: 'text*' }, text: {}, sceneMark: { group: 'block', atom: true, attrs: { id: { default: null }, title: { default: '' }, summary: { default: '' } } } } });
const oldScene = schema.node('sceneMark', { title: '旧场景' });
const fake = { state: EditorState.create({ schema, doc: schema.node('doc', null, [oldScene]) }), view: { dispatch(tr) { fake.state = fake.state.apply(tr); } } };
const firstKey = scenes.scenesFromEditor(fake)[0].key;
fake.view.dispatch(fake.state.tr.insert(0, schema.node('paragraph', null, schema.text('前插的段落'))));
assert(scenes.updateScene(fake, firstKey, { summary: '不改错目标' }));
assert.equal(scenes.scenesFromEditor(fake)[0].key, firstKey);
assert.equal(scenes.scenesFromEditor(fake)[0].summary, '不改错目标');
assert(scenes.scenesFromEditor(fake)[0].id);
assert.equal(fake.state.doc.child(0).textContent, '前插的段落');
fake.view.dispatch(fake.state.tr.delete(fake.state.doc.child(0).nodeSize, fake.state.doc.content.size));
assert.equal(scenes.updateScene(fake, firstKey, { summary: '不得写到其他块' }), false);
const duplicate = schema.node('sceneMark', { id: 'pasted-id', title: '复制来的场景' });
fake.state = EditorState.create({ schema, doc: schema.node('doc', null, [duplicate, schema.node('sceneMark', duplicate.attrs)]) });
const pasted = scenes.scenesFromEditor(fake);
assert.notEqual(pasted[0].key, pasted[1].key);
assert(scenes.updateScene(fake, pasted[1].key, { summary: '只改第二个' }));
assert.equal(fake.state.doc.child(0).attrs.summary, '');
assert.notEqual(fake.state.doc.child(0).attrs.id, fake.state.doc.child(1).attrs.id);
console.log('PASS: fictional calendars, incomplete date ordering, net session metrics, moving average, character evidence, stable scene identity after insertion/edit/deletion/paste');

const { budgetContext, messageChars } = await import(await url('src/lib/contextBudget.ts'));
const baseMessages = [{ role: 'system', content: '遵守作者原文。' }, { role: 'user', content: '改写：不得删除这段完整选区。\n"转义也计入"' }];
const sources = [{ key: 'tail', label: '最新结尾', required: true, text: '最后一句' }, { key: 'outline', label: '章纲', text: '希望发生的事件'.repeat(1000), priority: 100 }, { key: 'card', label: '人物卡', text: '角色资料'.repeat(1000) }];
for (const maxChars of [250, 1000, 4000]) {
  const result = budgetContext(baseMessages, sources, { maxChars, disabled: [] });
  assert(!result.error); assert(result.chars <= maxChars);
  assert.equal(result.chars, messageChars(result.messages));
  assert(result.messages[0].content.includes('最后一句'));
  assert.equal(result.messages.at(-1).content, baseMessages.at(-1).content);
}
const disabled = budgetContext(baseMessages, sources, { maxChars: 5000, disabled: ['card'] });
assert(!disabled.messages[0].content.includes('角色资料'));
assert.equal(disabled.sources.find(source => source.key === 'card').reason, '已关闭');
assert(budgetContext(baseMessages, sources, { maxChars: 0, disabled: [] }).error);
assert(budgetContext([...baseMessages, { role: 'assistant', content: '历史'.repeat(1000) }], sources, { maxChars: 1000, disabled: [] }).error);
assert(budgetContext(baseMessages, sources, { maxChars: 10, disabled: [] }).messages.at(-1).content.includes('完整选区'));
const emoji = budgetContext([], [{ key: 'emoji', label: 'emoji', text: '😀'.repeat(500), tail: true }], { maxChars: 350, disabled: [] });
assert(emoji.chars <= 350); assert(!/[\uD800-\uDBFF]$/.test(emoji.sources[0].text));
console.log('PASS: exact JSON context budget, labels/escaping/history counted, mandatory selection/tail retained, switches, invalid/tiny budgets and Unicode boundaries');
