/**
 * 词性解析与展示
 *
 * 种子/导入数据的 pos 字段为单个字符串（如 'vt.'），但真实词典里
 * 一个词常有多个词性（如 record = n.&v.）。展示层支持分隔符拆分，
 * 把 'n.&v.' / 'n./v.' / 'n. / v.' / 'n.,v.' / 'n.、v.' 渲染为多个徽章。
 * 注意：不拆 '.'，避免把 'vt.' 拆坏。
 */
const SPLIT_RE = /[&／/、,，;；·\s]+/;

export function parsePos(pos?: string | null): string[] {
  if (!pos) return [];
  return pos
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}
