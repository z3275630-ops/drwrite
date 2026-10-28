import * as lib from './library';
import * as ent from './entities';
import * as structure from './structure';
import { writeJson, joinPath, isDesktop } from './fs';
import { countWords, docToPlainText } from './words';
import type { JsonValue } from './json';
import { acquireBookLease } from './bookLease';
const SAMPLE_KEY = 'lantern-river-v1';
/** A separate, deliberately fictional work. Existing samples are never overwritten. */
export async function openSampleBook(root: string) {
  const existing = (await lib.listBooks(root)).find(entry => entry.book.sampleKey === SAMPLE_KEY);
  if (existing) return existing;
  const entry = await lib.createBook(root, '示例书·灯河档案');
  const release = await acquireBookLease(root, entry.dirName);
  try {
  const characters = ['林澄', '周砚', '阿渡'].map(ent.newCharacter);
  characters[0].tier = '主角'; characters[0].personality = '谨慎、好奇，想查清河灯的来源。';
  characters[1].profile.occupation = '修灯匠'; characters[2].biography = ['在渡口长大，认得每一条摆渡船。'];
  for (const character of characters) await ent.saveCharacter(root, entry.dirName, character);
  const titles = ['渡口来信', '修灯人的秘密', '雨夜旧仓', '灯河重逢'];
  const paragraphs = [
    ['林澄在渡口捡到一封没有署名的信。信封里夹着半张灯纹，边缘沾着新泥。', '“天黑以后，别去旧仓。”阿渡低声说。林澄把灯纹收进口袋，决定先去找修灯匠。'],
    ['周砚认出了灯纹，却不肯说出它的主人。他从柜底取出一枚铜扣，放到林澄面前。', '“如果你真要查，就记住这枚铜扣。”远处的船铃响了三声。'],
    ['雨水从旧仓屋檐落下。林澄沿着泥地上的轮印，找到一盏尚未熄灭的河灯。', '灯座缺了一枚铜扣，内侧刻着与信封相同的纹路。周砚没有骗她，但也没有把话说完。'],
    ['阿渡撑船穿过灯河，将失散的两半灯纹重新拼在一起。林澄终于读到信纸背面的名字。', '“这不是告别。”周砚把修好的河灯推向水面，“是请你明年再来。”'],
  ];
  const volume = { id: lib.genId(), title: '第一卷·渡口' };
  entry.book.volumes = [volume]; entry.book.chapters = [];
  for (let index = 0; index < titles.length; index++) {
    const meta = { id: lib.genId(), index, title: titles[index], volumeId: volume.id, wordCount: 0, createdAt: lib.nowIso(), updatedAt: lib.nowIso(),
      outline: ['引出匿名信与禁地，留下灯纹线索。', '让修灯匠隐瞒部分真相，交出铜扣。', '把两条线索联系起来。', '回收灯纹与铜扣，留下下一年的约定。'][index],
      synopsis: paragraphs[index][0], workflow: 'draft' as const };
    const doc: JsonValue = { type: 'doc', content: [
      { type: 'sceneMark', attrs: { id: lib.genId(), title: titles[index], summary: meta.outline } },
      ...paragraphs[index].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    ] };
    meta.wordCount = countWords(docToPlainText(doc)); entry.book.chapters.push(meta);
    await writeJson(joinPath(root, entry.dirName, 'chapters', meta.id + '.json'), { protocolVersion: 1, meta, doc } as unknown as JsonValue);
  }
  const [first, second, third, fourth] = entry.book.chapters;
  await structure.saveForeshadows(root, entry.dirName, [
    { id: lib.genId(), title: '半张灯纹', plantAnchors: [{ chapterId: first.id }], reinforceAnchors: [{ chapterId: third.id }], payoffAnchor: { chapterId: fourth.id }, derivedState: '已回收' },
    { id: lib.genId(), title: '铜扣背面的刻字', plantAnchors: [{ chapterId: second.id }], reinforceAnchors: [], payoffAnchor: null, derivedState: '已设伏' },
  ]);
  entry.book.stats.totalWords = entry.book.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  entry.book.sampleKey = SAMPLE_KEY;
  await lib.saveBook(root, entry.dirName, entry.book);
  if (isDesktop) await lib.createSnapshot(root, entry.dirName, false);
  return entry;
  } finally { await release(); }
}
