import { describe, it, expect } from 'vitest';
import { mdToHtml } from '@/lib/markdown';

describe('mdToHtml 富文本渲染', () => {
  it('渲染表格（含表头与分隔行）', () => {
    const html = mdToHtml('| 方法 | 说明 |\n| --- | --- |\n| 词根 | ambi 周围 |\n| 联想 | 俺必胜 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th>方法</th>');
    expect(html).toContain('<td>词根</td>');
    expect(html).toContain('</table>');
  });

  it('渲染任务清单', () => {
    const html = mdToHtml('- [x] 已完成\n- [ ] 待办');
    expect(html).toContain('✅');
    expect(html).toContain('⬜');
    expect(html).toContain('<li>');
  });

  it('渲染分隔线与删除线', () => {
    expect(mdToHtml('上面\n\n---\n\n下面')).toContain('<hr/>');
    expect(mdToHtml('~~旧内容~~')).toContain('<del>旧内容</del>');
  });

  it('表格内容中的加粗仍生效', () => {
    const html = mdToHtml('| 词 | 义 |\n|---|---|\n| **ambition** | 野心 |');
    expect(html).toContain('<td><strong>ambition</strong></td>');
  });

  it('剥离未知 HTML 标签（防 XSS），不显示源码', () => {
    const html = mdToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('&lt;');
    expect(html).toContain('<p>alert(1)</p>');
  });

  it('轻量 HTML 标签转 Markdown，不残留富文本源码', () => {
    const html = mdToHtml('<b>词根</b> <i>port</i><br/>下一行<br/><li>列表项</li>');
    expect(html).toContain('<strong>词根</strong>');
    expect(html).toContain('<em>port</em>');
    expect(html).toContain('<li>列表项</li>');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<br');
  });

  it('引用块 > 渲染为 blockquote', () => {
    const html = mdToHtml('> The porters carried the luggage.');
    expect(html).toContain('<blockquote>');
  });

  it('链接与图片只保留文字，不显示裸 URL', () => {
    const html = mdToHtml('参考 [百度](https://baidu.com) 与 ![图](https://img.com/a.png)');
    expect(html).not.toContain('https://');
    expect(html).toContain('<p>参考 百度 与 图</p>');
  });

  it('下划线式加粗/斜体与粗斜体', () => {
    const html = mdToHtml('__重要__ 和 _斜体_ 以及 ***都重要***');
    expect(html).toContain('<strong>重要</strong>');
    expect(html).toContain('<em>斜体</em>');
    expect(html).toContain('<strong><em>都重要</em></strong>');
  });

  it('缩进嵌套列表拍平为同级列表项，不残留“-”', () => {
    const html = mdToHtml('- 顶层项\n  - 子项一\n  - 子项二');
    expect(html).not.toContain('<p>');
    expect(html).toContain('<li>顶层项</li>');
    expect(html).toContain('<li>子项一</li>');
    expect(html).toContain('<li>子项二</li>');
  });

  it('中文序号列表 1、/1) 渲染为有序列表', () => {
    const html = mdToHtml('1、第一点\n2) 第二点');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>第一点</li>');
    expect(html).toContain('<li>第二点</li>');
  });

  it('连续列表项合并为同一个列表，不拆成多个 ul/ol', () => {
    const html = mdToHtml('- 一\n- 二\n- 三');
    expect((html.match(/<ul>/g) ?? []).length).toBe(1);
    expect(html).toContain('<li>一</li>');
    expect(html).toContain('<li>二</li>');
    expect(html).toContain('<li>三</li>');
  });

  it('空行分隔的两个列表仍拆开', () => {
    const html = mdToHtml('- 一\n\n- 二');
    expect((html.match(/<ul>/g) ?? []).length).toBe(2);
  });
});
