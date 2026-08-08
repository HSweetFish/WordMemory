# 自定义词表导入格式

背单词应用支持导入自己的词表（如课本生词、专业词汇、个人收藏）。支持 **JSON** 与 **CSV** 两种格式。

## 核心规则（重要）

**多词性的词，释义要带词性前缀，词性列列出全部词性**，格式与内置词库（COCA 2万等）保持一致：

- `pos` 列：所有词性用 `；` 分隔，如 `v.；n.`
- `trans`：每个词性一段，段内以词性标记开头，如 `v.行动,表现；n.行为,行动`

这样应用会自动按词性分组显示（翻转背面每个词性一行、四选一选项带词性、拼写按词性显示），
不会出现「所有释义堆在一起」或「词性与释义对不上」的问题。

✅ 正确示例（多词性）：

```
pos: "v.；n."
trans: "v.行动,表现,表演,起作用；n.行为,行动,法案"
```

❌ 错误示例（词性与释义脱节）：

```
pos: "adj./v."        ← 词性列了两个
trans: "裸体的；裸露的；光秃秃的"  ← 释义却没有标注归属，无法正确分列
```

> 单词性词不受影响：`pos: "n."` + `trans: "活动；活力"` 即可。

---

## JSON 格式

文件为数组，每个元素是一个词条对象：

```json
[
  {
    "name": "act",
    "trans": ["v.行动,表现,表演,起作用", "n.行为,行动,法案"],
    "pos": "v.；n.",
    "usphone": "/ækt/",
    "ukphone": "/ækt/"
  },
  {
    "name": "serendipity",
    "trans": ["意外发现珍宝的运气", "机缘巧合"],
    "pos": "n.",
    "usphone": "/ˌserənˈdɪpəti/",
    "ukphone": "/ˌserənˈdɪpəti/"
  },
  {
    "name": "ephemeral",
    "trans": ["adj.短暂的，瞬息的"],
    "usphone": "/ɪˈfemərəl/",
    "ukphone": "/ɪˈfemərəl/",
    "sentence": "Fame in the internet age is often ephemeral."
  }
]
```

字段说明（`name` 与 `trans` 必填，其余可选）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 单词本身 |
| `trans` | string 或 string[] | ✅ | 释义；多词性时**每段以词性标记开头**（`v.…` / `n.…`） |
| `pos` | string | - | 全部词性，`；` 分隔，如 `n.` / `v.；n.`（可省略，省略时按释义前缀推断） |
| `usphone` | string | - | 美式音标 |
| `ukphone` | string | - | 英式音标 |
| `sentence` | string | - | 例句（英文） |
| `freq` | number | - | 词频排名（越小越靠前学习，可选） |

兼容 qwerty-learner 的词库 JSON 格式（`name`/`trans`/`usphone`/`ukphone`），
可直接使用其 `public/dicts/*.json` 文件（其释义本身带词性前缀，天然符合本格式）。

## CSV 格式

表头固定，编码建议 UTF-8（带 BOM 时 Excel 兼容性更好）：

```csv
name,trans,usphone,ukphone,sentence,pos,freq
act,"v.行动,表现,表演,起作用；n.行为,行动,法案",/ækt/,,,v.；n.,1138
serendipity,"意外发现珍宝的运气；机缘巧合",/ˌserənˈdɪpəti/,/ˌserənˈdɪpəti/,,n.,1
ephemeral,"adj.短暂的，瞬息的",/ɪˈfemərəl/,,Fame in the internet age is often ephemeral.,,2
```

规则：

- 第一行必须是表头 `name,trans,usphone,ukphone,sentence,pos,freq`（`freq` 可省略）
- 只保留 `name` 和 `trans` 两列也能导入
- `trans` 内多条释义用 `；` 分隔；多词性时每段以词性标记开头（如上例 act）
- 释义含逗号时必须用双引号包裹
- 大小写不敏感（导入时统一按小写去重）
- `freq` 为词频排名，越小越先学；留空则排在其他词之后

## 导入规则

1. 导入时按单词小写去重：与已存在词条重复的**更新**其释义/音标/例句，不重复新建；
2. 内置词库（四级/六级/考研/雅思/托福/COCA）与自定义词表存放在同一张单词表，通过 `books` 字段区分归属；
3. 支持多本自定义词书：导入前输入词书名称（留空为默认「我的词库」），**同名导入 = 分批次追加**，不同名 = 新建独立词书；
4. 导入成功后可立即开始学习，自定义词表同样走 FSRS 遗忘曲线复习；
5. 数据全部保存在浏览器本地（IndexedDB），可随时在「设置 → 数据导出」备份。

## 工具

内置词库已按上述「正确格式」生成（`scripts/build-wordbook.mjs`）。
