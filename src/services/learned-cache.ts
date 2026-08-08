/**
 * 已学单词集合的内存缓存
 *
 * getNewWordQueue / getPosDistribution 每次都需要「已学单词全集」来排除已学词，
 * 全表扫描 primaryKeys 在词量上万后有明显开销。这里维护一个模块级缓存：
 * - 首次查询时全量加载
 * - recordRating 新建卡片时增量更新
 * - resetDatabase / restoreBackup 等批量写操作后失效
 */

let cache: Set<string> | null = null;

/** 读取缓存（可能为 null 表示尚未加载） */
export function getLearnedCache(): Set<string> | null {
  return cache;
}

/** 写入缓存（全量） */
export function setLearnedCache(ids: Set<string>): void {
  cache = ids;
}

/** 失效缓存（数据被批量改动后调用） */
export function invalidateLearnedCache(): void {
  cache = null;
}

/** 增量加入一个新学单词（仅在缓存已加载时更新） */
export function addLearnedWord(wordId: string): void {
  cache?.add(wordId);
}
