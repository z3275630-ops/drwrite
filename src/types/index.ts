/**
 * Drwrite 核心数据模型（P0 地基）
 * 原则（继承自织境拆解）：
 *  1. 引用存稳定 ID 不存文字 —— 改名不断链
 *  2. 身份型连接与信息型连接分开
 *  3. 时间线/伏笔字段在此预留接口，P1 不做破坏性重构
 *  4. 所有实体带 protocolVersion，格式演进可迁移
 * 存储形态：每本书一个文件夹；章节=Tiptap JSON；实体=JSON；SQLite 仅索引
 */

export const MODEL_VERSION = 1 as const;

/* ---------- 通用 ---------- */

/** 稳定 ID：实体创建时生成，永不复用 */
export type EntityId = string;
export type ChapterId = string;

export interface BaseEntity {
  id: EntityId;
  protocolVersion: number;
  createdAt: string; // ISO
  updatedAt: string;
}

/* ---------- 引用（全项目唯一语法，学织境五元组） ---------- */

/** 引用的目标类型 */
export type RefTargetType =
  | 'character'
  | 'lore'
  | 'chapter'
  | 'scene'      // P1
  | 'timeline'   // P1
  | 'foreshadow' // P1
  | 'external';

/**
 * 内嵌在正文 Tiptap mark / 长文本中的引用。
 * 存身份不存文字；对象删除后引用保留 displayText 并标记 dangling。
 */
export interface EntityRef {
  protocolVersion: number;
  targetType: RefTargetType;
  targetId: EntityId;
  displayText: string;
}

/** refs.json：全书引用倒排索引（派生，可重建） */
export interface RefIndexEntry extends EntityRef {
  /** 引用出现的位置：章节 + 段落序号 */
  chapterId: ChapterId;
  blockIndex: number;
}

/* ---------- 人物 ---------- */

export type CharacterTier = '主角' | '配角' | '闲角' | '过客' | '龙套';

/** 逐卷/逐章变化关键帧（P1 启用，字段先立） */
export interface Keyframe<T = string> {
  /** 生效起始章（按章索引） */
  fromChapterIndex: number;
  value: T | null; // null = 明确清空
}

export interface CharacterRelation {
  targetId: EntityId;
  /** 对称关系共用一词；不对称时各写各的 */
  label: string;
  reverseLabel?: string;
  /** 自定义指标（信任度/爱意…），0-100 */
  metrics?: Record<string, number>;
  note?: string;
}

export interface Character extends BaseEntity {
  type: 'character';
  name: string;
  aliases: string[];
  tier: CharacterTier;
  profile: {
    gender?: string;
    age?: string;
    occupation?: string;
  };
  personality?: string;
  /** 经历：按时间排列的条目 */
  biography: string[];
  /** 所属势力 = lore 实体的引用（身份型连接，改名自动跟） */
  factionIds: EntityId[];
  relations: CharacterRelation[];
  /** 预留：逐章状态轨道（年龄/职业/阶段状态） */
  arcs?: {
    age?: Keyframe[];
    occupation?: Keyframe[];
    status?: Keyframe[];
  };
}

/* ---------- 设定词条 ---------- */

export type LoreCategory = '世界观' | '地点' | '势力' | '规则' | '术语' | '事件';

export interface LoreEntry extends BaseEntity {
  type: 'lore';
  name: string;
  aliases: string[];
  category: LoreCategory;
  /** 正文内容（纯文本 + 内联 EntityRef 列表） */
  content: string;
  inlineRefs: EntityRef[];
  /** 势力类专用：成员人物（身份型连接的真源） */
  memberIds?: EntityId[];
}

/* ---------- 章节（正文 = Tiptap 文档） ---------- */

export interface ChapterMeta {
  id: ChapterId;
  index: number; // 派生：按目录顺序，不存进标题
  title: string;
  /** 本章意图/梗概 —— 手写字段，AI 永不覆盖 */
  synopsis?: string;
  povCharacterId?: EntityId;
  wordCount: number; // 派生缓存
  createdAt: string;
  updatedAt: string;
}

/**
 * 章节文件：chapters/第0001章.json
 * doc 为 Tiptap JSON，自定义 mark：
 *  - entityRef → EntityRef（点击预览、AI 装配上下文）
 *  - sceneAnchor / povMark → P1 结构化标记（先占名）
 */
export interface ChapterFile {
  protocolVersion: number;
  meta: ChapterMeta;
  doc: unknown; // Tiptap JSONDocument
}

/* ---------- 书 ---------- */

export interface DailyStats {
  date: string; // YYYY-MM-DD
  words: number;
}

export interface Book {
  id: string;
  protocolVersion: number;
  title: string;
  /** 流派模板引用（P3）：玄幻/都市/科幻… */
  genreTemplate?: string;
  /** 日更目标字数 */
  dailyGoal?: number;
  createdAt: string;
  updatedAt: string;
  /** 派生统计 */
  stats: {
    totalWords: number;
    streakDays: number; // 连续日更天数
  };
  dailyStats: DailyStats[];
}

/* ---------- P1 预留接口（只定义形状，不实现） ---------- */

export interface TimelineEvent {
  id: string;
  laneId: string;
  title: string;
  /** 锚点：指向章节+段落（信息型连接，只跳转不反写） */
  anchor: { chapterId: ChapterId; blockIndex?: number } | null;
  relatedEntityIds: EntityId[];
}

export type ForeshadowState =
  | '未设伏' | '已设伏' | '待回收' | '已回收' | '埋伏过久';

export interface Foreshadow {
  id: string;
  title: string;
  plantAnchors: { chapterId: ChapterId; blockIndex?: number }[];
  reinforceAnchors: { chapterId: ChapterId; blockIndex?: number }[];
  payoffAnchor: { chapterId: ChapterId; blockIndex?: number } | null;
  /** 状态由锚点推导，不手填 */
  derivedState: ForeshadowState;
}
