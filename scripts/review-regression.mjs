// Execute current production functions with injected fault boundaries; no user files or network.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

async function subject(file, names, env = {}) {
  const source = await fs.readFile(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  function walk(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) declarations.set(node.name.text, node.getText(tree));
    if (ts.isClassDeclaration(node) && names.includes(node.name?.text)) declarations.set(node.name.text, node.getText(tree));
    if (ts.isVariableStatement(node)) for (const item of node.declarationList.declarations) {
      if (names.includes(item.name.getText(tree))) declarations.set(item.name.getText(tree), node.getText(tree));
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  for (const name of names) assert(declarations.has(name), `missing production declaration: ${name}`);
  const js = ts.transpileModule(names.map(name => declarations.get(name).replace(/^export\s+/, '')).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(env), js + '\nreturn {' + names.join(',') + '};')(...Object.values(env));
}
const { SaveCoordinator, SerialQueue } = await subject('src/lib/saveCoordinator.ts', ['SaveCoordinator', 'SerialQueue']);

// R1: missing metadata is recovered BEFORE bookshelf filtering; corrupt journals stay visible.
const book = { id: 'test', title: 'Test', chapters: [], stats: {}, updatedAt: '2026-10-27' };
const data = new Map([
  ['root/gap/.restore-journal.json', {}], ['root/present/.restore-journal.json', {}],
  ['root/present/book.json', book], ['root/bad/.restore-journal.json', {}], ['root/corrupt/book.json', null],
]);
const recovered = [], issues = [];
const { listBooks } = await subject('src/lib/library.ts', ['listBooks'], {
  joinPath: (...parts) => parts.join('/'), listDir: async () => ['gap/', 'present/', 'bad/', 'corrupt/', 'unrelated/'],
  exists: async file => data.has(file), readJson: async file => data.get(file),
  recoverBookRestore: async (_root, dir) => {
    recovered.push(dir);
    if (dir === 'bad') throw Error('damaged journal');
    data.set(`root/${dir}/book.json`, book); data.delete(`root/${dir}/.restore-journal.json`);
  },
});
assert.equal((await listBooks('root', issue => issues.push(issue))).length, 2);
assert.deepEqual(recovered, ['gap', 'present', 'bad']);
assert.deepEqual(issues.map(issue => issue.dirName), ['bad', 'corrupt']);
assert(data.has('root/bad/.restore-journal.json'));

// R2: request completion and durable save are separate; retry never requests the model.
let diskFails = true, modelCalls = 0, mode = 'complete', stored = [], visible = [], saveError = '';
const saver = new SaveCoordinator(), messageRef = { current: [] }, streamRef = { current: '' }, sendingRef = { current: false };
const chat = await subject('src/components/ChatPanel.tsx', ['updateMessages', 'persist', 'requestSend'], {
  useCallback: fn => fn, saver, messageRef, streamRef, sendingRef, loadedRef: { current: true }, input: '',
  props: { root: 'root', dirName: 'test', aiCfg: {}, onNeedSettings: () => assert.fail('configured') },
  sessionRef: { current: { id: 'session-test', title: 'test' } }, draftRef: { current: '' }, contextRef: { current: {} }, setSessions() {},
  saveSession: async (_root, _dir, session) => { if (diskFails) throw Error('disk full'); stored = structuredClone(session.messages); },
  setMsgs: messages => { visible = messages; }, setSaveError: error => { saveError = error; },
  setInput() {}, setSending() {}, setRequestError() {}, setLeaveNotice() {}, setStreamText() {}, buildContext: () => ({ role: 'system', content: 'test' }),
  chatAi: async (_cfg, _messages, _opts, events) => {
    modelCalls++;
    if (mode === 'partial') { events.onContent('retained fragment'); throw Error('connection reset'); }
    if (mode === 'failed') throw Error('request failed');
    events.onContent('complete answer'); return { text: 'complete answer' };
  },
});
const send = text => chat.requestSend(text, [{ role: 'user', content: text }]);
await send('question');
assert.deepEqual(visible.map(m => m.role), ['user', 'assistant']);
assert.equal(visible[1].content, 'complete answer'); assert(saver.dirty); assert.match(saveError, /disk full/);
assert.equal(await chat.persist(), false);
await send('second question'); assert.equal(visible.length, 4);
diskFails = false; assert.equal(await chat.persist(), true); assert.equal(stored.length, 4); assert.equal(modelCalls, 2);
mode = 'partial'; await send('partial question'); assert.equal(stored.at(-1).content, 'retained fragment'); assert(stored.at(-1).incomplete);
mode = 'failed'; await send('failed question'); assert.equal(visible.at(-1).role, 'user');
diskFails = true; chat.updateMessages([]); assert.equal(await chat.persist(), false); assert(saver.dirty);
diskFails = false; assert.equal(await chat.persist(), true); assert.deepEqual(stored, []);
const loadChat = (await subject('src/lib/chat.ts', ['loadChat'], {
  chatPath: () => 'test', exists: async () => true, readJson: async () => ({ malformed: true }),
})).loadChat;
await assert.rejects(loadChat('root', 'test'), /损坏/);
let review, approved;
const session = { current: { id: 'approved-session' } };
const staged = await subject('src/components/ChatPanel.tsx', ['send'], {
  input: 'draft question', sendingRef: { current: false }, loadedRef: { current: true }, sessionBusy: false,
  props: { aiCfg: {} }, buildContext: () => ({ base: { role: 'system', content: 'system' }, sources: [{ key: 'cards', label: 'cards', text: 'offered source' }] }),
  messageRef: { current: [{ role: 'assistant', content: 'history' }] }, sessionRef: session,
  DEFAULT_CONTEXT_POLICY: { maxChars: 12000, disabled: [] }, setReview: value => { review = value; }, saver,
  requestSend: (text, messages) => { approved = { text, messages }; },
});
await staged.send(); assert.equal(approved, undefined); assert.equal(review.base.at(-1).content, 'draft question');
const exactMessages = [{ role: 'user', content: 'approved exact payload' }];
review.onSend(exactMessages, { maxChars: 6000, disabled: ['cards'] });
assert.equal(approved.messages, exactMessages); assert.deepEqual(session.current.budget.disabled, ['cards']);

// R3: deterministic timer/clock verifies rate limiting and manual recovery.
let now = 0, timerId = 0; const timers = new Map();
const { BackupCoordinator } = await subject('src/lib/backupCoordinator.ts', ['BackupCoordinator'], {
  setTimeout: (callback, delay) => { timers.set(++timerId, { callback, at: now + delay }); return timerId; },
  clearTimeout: id => timers.delete(id),
});
async function advance(ms) {
  now += ms;
  const due = [...timers].filter(([, timer]) => timer.at <= now);
  for (const [id, timer] of due) { timers.delete(id); timer.callback(); }
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
const gate = new BackupCoordinator(() => now, 2500);
let attempts = 0, warnings = 0;
const fail = async () => { attempts++; throw Error('backup unavailable'); };
const warn = () => { warnings++; };
gate.schedule('day', undefined, fail, warn); await advance(2500);
assert.equal(attempts, 1);
for (let i = 0; i < 10; i++) { gate.schedule('day', undefined, fail, warn); await advance(1000); }
assert.equal(attempts, 1); assert.equal(warnings, 1);
await advance(50_000); assert.equal(attempts, 2);
await advance(299_999); assert.equal(attempts, 2);
await advance(1); assert.equal(attempts, 3);
assert.equal(await gate.attempt('day', async () => { attempts++; }, warn), true);
gate.schedule('day', undefined, fail, warn); await advance(900_000); assert.equal(attempts, 4);
gate.resetAfterRestore(); gate.schedule('day', undefined, fail, warn); gate.cancelScheduled(); await advance(3000); assert.equal(attempts, 4);
const secondGate = new BackupCoordinator(() => now, 0);
secondGate.schedule('day', undefined, async () => { attempts++; }, warn); await advance(0); assert.equal(attempts, 5);
let release;
const pending = gate.attempt('next', () => new Promise(resolve => { release = resolve; }), warn);
assert.equal(gate.attempt('next', fail, warn), pending); await Promise.resolve(); release(); assert(await pending);

// R5: background-only work is distinguishable; queued user writes still wait in order.
const queue = new SerialQueue(); let resume;
const background = queue.run(() => new Promise(resolve => { resume = resolve; }), true);
assert.equal(queue.hasPendingWrites, false); await Promise.resolve();
let written = false; const foreground = queue.run(async () => { written = true; });
assert.equal(queue.hasPendingWrites, true); assert.equal(written, false);
resume(); await background; await foreground; await queue.idle(); assert(written); assert.equal(queue.hasPendingWrites, false);

// R4: a last content frame survives early completion/error, and typing decorations retain reference semantics.
const { StreamBatch } = await subject('src/lib/streamBatch.ts', ['StreamBatch']);
const content = [], reasoning = []; let frame;
const batch = new StreamBatch({ onContent: text => content.push(text), onReasoning: n => reasoning.push(n) }, callback => { frame = callback; return 1; }, () => {});
batch.pushContent('A'); batch.pushContent('AB'); batch.pushReasoning(20); assert.equal(content.length, 0);
frame(); assert.deepEqual(content, ['AB']); assert.deepEqual(reasoning, [20]);
batch.pushContent('ABC'); batch.flush(); batch.flush(); assert.deepEqual(content, ['AB', 'ABC']);
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
  marks: { entityRef: { attrs: { targetId: {} } } } });
const doc = schema.node('doc', null, [schema.node('paragraph', null, [
  schema.text('人物甲 '), schema.text('人物甲', [schema.mark('entityRef', { targetId: 'known' })]),
  schema.text(' 人物乙', [schema.mark('entityRef', { targetId: 'missing' })]),
])]);
const { buildHints } = await subject('src/extensions/entityRef.ts', ['buildHints'], {
  Decoration, DecorationSet, entityRefMarkName: 'entityRef', profileStart: () => 0, profileEnd() {},
});
const state = EditorState.create({ schema, doc });
const decorations = buildHints(state, [{ id: 'known', name: '人物甲', aliases: [], kind: 'character' }]).find();
assert.equal(decorations.filter(d => d.type.attrs.class === 'ent-hint').length, 1);
assert.equal(decorations.filter(d => d.type.attrs.class === 'dangling').length, 1);
assert.equal(buildHints(state, []).find().filter(d => d.type.attrs.class === 'dangling').length, 2);
// Live counters and saved metadata must use the same scene/list/separator rules.
const wordTools = await subject('src/lib/words.ts', ['countWords', 'docToPlainText', 'docToBlocks', 'inlineToText'], {
  profileStart: () => 0, profileEnd() {},
});
const { words } = await subject('src/components/LiveEditorState.tsx', ['words'], { ...wordTools, counts: new WeakMap() });
const countedDoc = { type: 'doc', content: [
  { type: 'sceneMark', attrs: { title: '场景一' } }, { type: 'horizontalRule' },
  { type: 'paragraph', content: [{ type: 'text', text: '正文测试' }] },
] };
let serializations = 0;
const fakeEditor = { state: { doc: {} }, getJSON: () => { serializations++; return countedDoc; } };
assert.equal(words(fakeEditor), wordTools.countWords(wordTools.docToPlainText(countedDoc)));
assert.equal(words(fakeEditor), words(fakeEditor)); assert.equal(serializations, 1);
fakeEditor.state.doc = {}; words(fakeEditor); assert.equal(serializations, 2);
console.log('PASS: bookshelf recovery, retained replies/retry/partial/clear, strict chat load, backup backoff/dedupe/isolation, foreground writes, final stream frame, hints/dangling, consistent cached scene counts');
