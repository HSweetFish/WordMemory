/**
 * 极简 Markdown 渲染（安全子集）
 * 支持：标题、加粗、斜体、删除线、行内代码、代码块、无序/有序列表、任务清单、
 * 表格、分隔线、引用、换行。
 * 先把 AI 偶尔返回的轻量 HTML 标签归一化为 Markdown 语法（避免 `<b>…</b>` 这类
 * 富文本源码直接外露给用户），再转义剩余 HTML、应用转换，避免 XSS。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 把轻量 HTML 标签转成 Markdown 等价语法：
 * <b>/<strong> → **，<i>/<em> → *，<br> → 换行，<li> → 列表项，<h1..6> → # 标题，
 * <blockquote> → 引用，<code> → 行内代码；未知标签（<script>/<img>/<span>…）剥离标签、保留文字。
 * 标签名后用 lookahead（空白/斜杠/右尖括号）限定，避免 <s> 误伤 <script> 这类前缀相同的标签。
 */
const HTML_TO_MD: Record<string, string> = {
  b: '**',
  strong: '**',
  del: '~~',
  s: '~~',
  strike: '~~',
  em: '*',
  i: '*',
  code: '`',
  tt: '`',
};

function softenHtml(text: string): string {
  return text
    // 块级换行类（闭标签名后紧跟 >，用 \s*> 匹配）
    .replace(/<br(?=[\s/>])[^>]*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<p(?=[\s/>])[^>]*>/gi, '')
    .replace(/<h([1-6])(?=[\s/>])[^>]*>/gi, (_m, n: string) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<\/(h[1-6])\s*>/gi, '\n')
    // 列表类
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<li(?=[\s/>])[^>]*>/gi, '- ')
    .replace(/<\/[uo]l\s*>/gi, '\n')
    .replace(/<[uo]l(?=[\s/>])[^>]*>/gi, '\n')
    // 行内样式类
    .replace(/<\/(strong|b|del|s|strike|em|i|code|tt)\s*>/gi, (_m, tag: string) => HTML_TO_MD[tag.toLowerCase()] ?? '')
    .replace(/<(strong|b|del|s|strike|em|i|code|tt)(?=[\s/>])[^>]*>/gi, (_m, tag: string) => HTML_TO_MD[tag.toLowerCase()] ?? '')
    // 引用类
    .replace(/<blockquote(?=[\s/>])[^>]*>/gi, '> ')
    .replace(/<\/blockquote\s*>/gi, '\n')
    // 其余未知标签：剥离标签、保留文字
    .replace(/<[^>]+>/g, '');
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    // 粗斜体 ***x*** 需在 **x** / *x* 之前处理，否则会残留星号
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // 链接/图片只保留文字，去掉 URL（本地应用无跳转需求）
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

/** 是否为表格行（以 | 开头结尾且含分隔符） */
function isTableRow(line: string): boolean {
  return /^\|.+\|$/.test(line) && line.includes('|');
}

/** 拆分表格行单元格 */
function splitRow(line: string): string[] {
  const s = line.trim();
  const body = s.startsWith('|') ? s.slice(1) : s;
  const end = body.endsWith('|') ? body.slice(0, -1) : body;
  return end.split('|').map((c) => c.trim());
}

/** 是否为表格分隔行（--- / :---: 等） */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/** 将 Markdown 文本渲染为安全的 HTML 字符串 */
export function mdToHtml(md: string): string {
  const lines = escapeHtml(softenHtml(md)).split('\n');
  const out: string[] = [];
  let inCode = false;
  let listType: 'ul' | 'ol' | null = null;
  let table: string[][] | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  const closeTable = () => {
    if (!table) return;
    const rows = table;
    table = null;
    const rowHtml = (cells: string[], tag: 'th' | 'td') =>
      `<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`;
    // 两行及以上时首行视为表头
    const header = rows.length >= 2 ? rows[0] : null;
    const body = header ? rows.slice(1) : rows;
    let html = '<table>';
    if (header) html += `<thead>${rowHtml(header, 'th')}</thead>`;
    if (body.length) html += `<tbody>${body.map((r) => rowHtml(r, 'td')).join('')}</tbody>`;
    out.push(html + '</table>');
  };

  const flush = () => {
    closeList();
    closeTable();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith('```')) {
      flush();
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
      } else {
        out.push('<pre><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }

    // 表格行（含分隔行）
    if (isTableRow(line)) {
      const cells = splitRow(line);
      if (isSeparatorRow(cells)) {
        if (!table) table = [];
        continue;
      }
      if (!table) table = [];
      table.push(cells);
      continue;
    }
    // 列表行不提前 flush：连续列表项（- 一 / - 二）合并为同一个 <ul>/<ol>；
    // 标题/段落/引用/空行等其余行先关闭已打开的列表
    if (!/^[-*]\s/.test(line) && !/^\d+[、)]\s?/.test(line) && !/^\d+\.\s/.test(line)) flush();

    // 去除最多 4 个前导空格：AI 常用的缩进嵌套子项会被拍平为同级列表项，
    // 避免显示成带“- ”的裸文本段落
    const trimmed = line.replace(/^ {0,4}/, '');

    if (trimmed.startsWith('### ')) {
      out.push(`<h4>${inline(trimmed.slice(4))}</h4>`);
    } else if (trimmed.startsWith('## ')) {
      out.push(`<h3>${inline(trimmed.slice(3))}</h3>`);
    } else if (trimmed.startsWith('# ')) {
      out.push(`<h2>${inline(trimmed.slice(2))}</h2>`);
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push('<hr/>');
    } else if (/^\d+[、)]\s?/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      // 有序列表：1. / 1、 / 1) 均支持（“、”和“)”后可不带空格；“1.5”这类带小数点的数字不会被误判）
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${inline(trimmed.replace(/^\d+(?:[、)]\s?|\.\s)/, ''))}</li>`);
    } else if (/^[-*]\s+\[[ xX]\]\s+/.test(trimmed)) {
      // 任务清单：- [x] / - [ ]
      const checked = /^[-*]\s+\[[xX]\]\s+/.test(trimmed);
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${checked ? '✅ ' : '⬜ '}${inline(trimmed.replace(/^[-*]\s+\[[ xX]\]\s+/, ''))}</li>`);
    } else if (/^[-*]\s/.test(trimmed)) {
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${inline(trimmed.replace(/^[-*]\s/, ''))}</li>`);
    } else if (trimmed.startsWith('> ')) {
      out.push(`<blockquote>${inline(trimmed.slice(2))}</blockquote>`);
    } else if (trimmed === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(trimmed)}</p>`);
    }
  }
  flush();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
