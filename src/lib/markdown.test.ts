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

  it('依旧转义 HTML，防 XSS', () => {
    const html = mdToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
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
});
