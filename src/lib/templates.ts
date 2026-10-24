/**
 * 流派模板：新建书时可选，生成一组「带引导问题的占位词条」。
 * 定位是脚手架不是答案——词条内容是写给作者看的填空题，填完 AI 续写/巡检就会遵守。
 */
import type { LoreCategory } from '../types';

export interface StarterLore {
  name: string;
  category: LoreCategory;
  content: string;
}

export interface GenreTemplate {
  id: string;
  label: string;
  goal?: number;
  lores: StarterLore[];
}

export const GENRE_TEMPLATES: GenreTemplate[] = [
  {
    id: 'xuanhuan',
    label: '玄幻',
    goal: 6000,
    lores: [
      { name: '力量体系', category: '规则', content: '（填空：境界如何划分？每一层的代价与瓶颈？突破需要什么？战力上限在哪里？写成一条一问一答的规则，续写与巡检都会遵守它。）' },
      { name: '主要势力', category: '势力', content: '（填空：2~4 个势力。各自立场、底牌、相互的恩怨。人物卡的「所属势力」会引用这里的词条。）' },
      { name: '世界地理', category: '地点', content: '（填空：故事主要发生在哪几处？每处的关键场景与规则禁忌。）' },
      { name: '核心禁忌', category: '规则', content: '（填空：这个世界绝对不能做什么？违反的代价？这是巡检最常抓的冲突点。）' },
    ],
  },
  {
    id: 'dushi',
    label: '都市',
    goal: 5000,
    lores: [
      { name: '城市背景', category: '地点', content: '（填空：故事发生在哪座城市？主角活动的核心区域？）' },
      { name: '金手指规则', category: '规则', content: '（填空：主角的特殊能力/资源是什么？能做什么、不能做什么、代价是什么？把边界写清楚，AI 才不会写出格。）' },
      { name: '对手阵营', category: '势力', content: '（填空：主要对手是谁？实力对比？）' },
    ],
  },
  {
    id: 'kehuan',
    label: '科幻',
    goal: 5000,
    lores: [
      { name: '核心设定', category: '规则', content: '（填空：一项改变世界的技术/异变。原理边界、代价、谁能掌握？）' },
      { name: '世界格局', category: '世界观', content: '（填空：这项设定之后，社会变成了什么样？）' },
      { name: '关键地点', category: '地点', content: '（填空：主要场景。）' },
    ],
  },
  {
    id: 'lishi',
    label: '历史',
    goal: 4000,
    lores: [
      { name: '时代背景', category: '世界观', content: '（填空：朝代/年代、大事年表、与史实的出入（架空程度）。）' },
      { name: '核心冲突', category: '事件', content: '（填空：推动故事的历史事件或阵营冲突。）' },
      { name: '礼制与称谓', category: '规则', content: '（填空：人物如何互相称呼、官制、避讳——这里错最容易被读者抓。）' },
    ],
  },
  {
    id: 'xuanyi',
    label: '悬疑',
    goal: 4000,
    lores: [
      { name: '核心谜团', category: '规则', content: '（填空：真相是什么？谁知道？读者什么时候知道？——只写作者视角，AI 不会剧透给正文，但会帮你守住线索一致性。）' },
      { name: '线索清单', category: '事件', content: '（填空：每条线索埋在哪一章、指向什么。配合「结构」页的伏笔看板使用。）' },
      { name: '主要场景', category: '地点', content: '（填空：案件相关地点与空间关系。）' },
    ],
  },
];
