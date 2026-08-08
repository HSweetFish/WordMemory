/**
 * 全局类型定义
 */

// FSRS 状态与评分枚举：直接复用 ts-fsrs 定义，避免双枚举类型不兼容
import { State as FsrsState, State, Rating } from 'ts-fsrs';
export { FsrsState, State, Rating };

/** 词条（种子数据格式） */
export interface Word {
  /** 单词 */
  w: string;
  /** 英式音标 */
  uk?: string;
  /** 美式音标 */
  us?: string;
  /** 释义（可多条） */
  m: string[];
  /** 词性（如 n. / vt.） */
  pos?: string;
  /** 例句 */
  ex?: string[];
  /** COCA 词频排名（越小越常用），null 表示未知 */
  freq: number | null;
  /** 所属词库 id 列表 */
  books: string[];
}

/** 词库元信息 */
export interface BookMeta {
  id: string;
  name: string;
  desc: string;
  count: number;
  file: string;
}

/** 用户的单词学习状态（IndexedDB: user_words） */
export interface UserWord {
  /** 主键：小写单词 */
  wordId: string;
  /** 所属词库 */
  bookIds: string[];
  /** FSRS 下次复习时间戳(ms) */
  due: number;
  /** FSRS 记忆稳定性（天） */
  stability: number;
  /** FSRS 难度 */
  difficulty: number;
  /** FSRS 距上次复习天数 */
  elapsedDays: number;
  /** FSRS 本次排程天数 */
  scheduledDays: number;
  /** FSRS 复习次数 */
  reps: number;
  /** FSRS 遗忘次数 */
  lapses: number;
  /** FSRS 卡片状态 */
  state: FsrsState;
  /** FSRS 当前学习步骤索引（Learning/Relearn 状态内部使用，需持久化） */
  learningSteps: number;
  /** 上次复习时间戳(ms) */
  lastReviewAt: number | null;
  /** 创建时间戳(ms) */
  createdAt: number;
  /** 累计答错次数 */
  wrongCount: number;
  /** 最近一次评分 */
  lastRating: Rating | null;
}

/** 答题事件记录（IndexedDB: review_logs） */
export interface ReviewLog {
  id?: number;
  wordId: string;
  rating: Rating;
  /** 答题反应时长(ms) */
  elapsedMs: number;
  /** 答题时间戳(ms) */
  reviewedAt: number;
  /** 本次排程天数 */
  scheduledDays: number;
  /** 答题时的卡片状态 */
  state: FsrsState;
  /** 学习 / 复习 / 随机抽查 */
  mode: 'learn' | 'review' | 'random';
}

/** 每日聚合统计（IndexedDB: daily_stats） */
export interface DailyStat {
  /** 主键：YYYY-MM-DD */
  date: string;
  /** 新学数量 */
  newCount: number;
  /** 复习数量 */
  reviewCount: number;
  /** 答对数量（Good + Easy） */
  correctCount: number;
  /** 答题总数 */
  totalCount: number;
  /** 学习时长(秒) */
  durationSec: number;
}

/** 用户设置（localStorage） */
export interface Settings {
  /** 每日新词上限 */
  dailyNewLimit: number;
  /** 每日复习上限 */
  dailyReviewLimit: number;
  /** 已选词库 id 列表 */
  activeBooks: string[];
  /** AI 服务商 */
  aiProvider: 'openai' | 'deepseek' | 'qwen' | 'zhipu' | 'tokenrhythm' | 'custom';
  /** AI API Key（仅存浏览器本地） */
  aiApiKey: string;
  /** AI 自定义 Base URL */
  aiBaseUrl: string;
  /** AI 模型名 */
  aiModel: string;
  /** 每组新词数量（学习页一次只加载一组，学完可继续下一组） */
  groupSize: number;
  /** 深色模式 */
  darkMode: boolean;
  /** 自动发音 */
  autoSpeak: boolean;
  /** 学习提醒（每日本地提醒时间 HH:mm，空字符串关闭） */
  reminderTime: string;
}
