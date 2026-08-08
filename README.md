# 词忆 WordMemory 📚

> 🌐 **在线体验**：https://hsweetfish.github.io/WordMemory/ （无需安装，浏览器打开即用，首次访问后支持离线）

本地优先（local-first）的背单词 Web 应用（PWA）：

- **初学 / 复习严格区分**：每日新词队列 + FSRS 遗忘曲线驱动的多轮复习队列
- **FSRS 排程引擎**：集成官方 `ts-fsrs` v5，四级评分（忘记/模糊/记得/熟练），按记忆稳定性自动安排下次复习；预留 SM-2 备选实现
- **多种可视化**：GitHub 风格打卡热力图、每日趋势折线、掌握度环形图、个人遗忘曲线、词库进度环、薄弱词/词性分布
- **记录系统 + AI 智能分析**：每次答题事件级落库；接入 OpenAI 兼容 API（OpenAI / DeepSeek / 通义 / 智谱），支持学习周报、AI 助记、薄弱词智能分析，**API Key 仅存浏览器本地**

数据全部保存在浏览器 IndexedDB，离线可用，完全属于用户。每日配额、连续打卡与统计按**东八区（Asia/Shanghai）日期**计算，不随设备时区变化。

## 功能一览

| 页面 | 说明 |
|---|---|
| 首页 | 今日新学 / 待复习双入口卡片、连续打卡、概览 |
| 学习 | 翻转卡片（音标/释义/例句/Web TTS 发音）、四选一测试、拼写模式、键盘快捷键 |
| 复习 | FSRS 到期词复习队列，答错立即降级回炉 |
| 统计 | ECharts 仪表盘：热力图 / 趋势 / 掌握度 / 遗忘曲线 / 词库进度 / 薄弱分析（含 AI 周报） |
| 词库 | 6 大内置词库安装/卸载 + JSON/CSV 自定义导入 |
| 设置 | 每日配额、提醒通知、深色模式、AI 配置、数据导出/恢复备份 |

内置词库：**CET4（四级）、CET6（六级）、考研、雅思、托福、COCA 2 万词频**，共 34,150 词条（100% 带词性、97% 带词频、35% 带例句）。

## 技术栈

- **前端**：React 19 + TypeScript + Vite 8 + Tailwind CSS v4
- **路由**：React Router v7（HashRouter，任意静态托管免配置）
- **状态**：Zustand（设置持久化 localStorage）
- **存储**：Dexie.js（IndexedDB）：`words` / `user_words` / `review_logs` / `daily_stats`
- **排程**：ts-fsrs v5（FSRS 算法）
- **图表**：Apache ECharts 6（按需引入 + 路由级代码分割）
- **测试**：Vitest + fake-indexeddb（113 个单测/集成测试）

## 环境要求

- **Node.js ≥ 20.19**（推荐 22 LTS，Vite 8 要求）
- npm（随 Node.js 附带）
- 现代浏览器（Chrome / Edge / Firefox / Safari；本地文件同步需 Chrome/Edge 85+）

## 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器 http://localhost:5173
npm test           # 运行全部测试（113 个）
npm run build      # 类型检查 + 生产构建 → dist/
npm run preview    # 本地预览生产构建
```

> 词库种子数据（`public/dicts/*.json`）已随仓库提供；如需重新生成：
> `npm run wordbook`（下载 qwerty-learner 词库 → 构建词库 JSON（含 COCA 词性回填）→ 拷贝到 public/dicts）。
>
> PWA Service Worker（`dist/sw.js`）由 `npm run build` 自动生成，应用外壳资产清单在构建时静态注入 precache，首次访问后即可完全离线使用。

## 使用说明

1. **首次使用**：进入「词库」页安装至少一个词库（自动加入学习队列）
2. **学习新词**：首页 → 今日新学 → 翻转卡片认识 → 四选一/拼写练习 → 自评
3. **复习**：FSRS 按遗忘曲线自动排程（约 1天 → 3天 → 7天 → 16天 → 35天…），答错立即回炉
4. **AI 分析**：设置页填入 API Key（支持自定义 Base URL 与模型），统计页生成周报/薄弱词清单，单词卡一键 AI 助记
5. **自定义词表**：词库页导入 JSON（qwerty-learner 格式）或 CSV（表头 `name,trans,usphone,ukphone,sentence,pos`），格式详见 [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md)

### 键盘快捷键（学习/复习）

| 键 | 功能 |
|---|---|
| `空格` | 翻转卡片 |
| `1` / `2` / `3` / `4` | 评分（复习：忘记 / 模糊 / 记得 / 熟练；学习：没学会 / 有印象 / 学会了 / 很熟练） |
| `A` / `B` / `C` / `D` | 四选一选择 |
| `回车` | 提交 / 下一题 |

## 部署

应用采用 HashRouter + 相对路径资源引用，**构建产物可直接部署到任意静态托管**，无需路由回退配置。

### Vercel

```bash
npm run build   # 产出 dist/
```

在 Vercel 导入项目：Framework Preset 选 **Vite**，Build Command `npm run build`，Output `dist`。

### Netlify

拖拽 `dist/` 到 Netlify Drop，或配置 Build Command `npm run build`、Publish Directory `dist`（仓库已含 `netlify.toml`）。

### GitHub Pages

```bash
npm run build
# 将 dist/ 内容推送到 gh-pages 分支（或 Actions 部署）
```

### 任意静态服务器

把 `dist/` 整个目录拷到任意 Web 服务器/对象存储/CDN 即可，首页 `/` 即应用入口。

> PWA 已在生产构建中启用：首次访问后离线可用，词库数据缓存优先。桌面/手机浏览器可「添加到主屏幕」。

## 数据与隐私

- 学习数据、设置、AI Key 全部存储在**本浏览器**（IndexedDB + localStorage），无服务端
- 「设置 → 本地文件同步」（Chrome/Edge）可把全部数据自动备份到电脑硬盘文件夹，浏览器被清除站点数据后重新选回文件夹即可一键恢复
- 「设置 → 数据备份」可一键导出/恢复 JSON 备份
- 卸载词库不会删除已学记录

## 常见问题 FAQ

**Q：数据存在哪里？会传到服务器吗？**
A：全部存在你自己的浏览器里（IndexedDB + localStorage），应用没有后端服务器，任何数据都不会上传。AI 分析仅在你点按钮时，把相关学习数据发给你在设置页配置的 API 服务商。

**Q：换电脑 / 清理浏览器数据后学习记录会丢吗？**
A：会的（数据在浏览器本地）。建议定期「设置 → 数据备份」导出 JSON，或使用「设置 → 本地文件同步」自动备份到硬盘文件夹。恢复时选回备份文件/文件夹即可。

**Q：AI 分析怎么用？必须要 API Key 吗？**
A：AI 功能是可选的。需要时在「设置 → AI 配置」选择一个服务商（OpenAI / DeepSeek / 通义 / 智谱 / 自定义），填入你自己的 API Key。Key 只存在浏览器本地，不经过任何中转服务器（基元律动除外，走同源代理）。

**Q：可以离线使用吗？**
A：可以。首次访问（或本地构建后）应用外壳会被 PWA Service Worker 缓存，之后断网也能正常学习，已安装的词库数据存在本地。

**Q：内置词库可以商用吗？**
A：词库数据源自 qwerty-learner（GPL-3.0），本项目整体采用 GPL-3.0 许可证，详见 [LICENSE](LICENSE)。

**Q：如何贡献 / 反馈问题？**
A：欢迎提交 Issue 或 Pull Request。请先阅读 [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md) 了解自定义词表格式。

## 测试

```bash
npm test
```

覆盖：FSRS 排程正确性（状态机流转/间隔递增/遗忘回炉/SM-2 备选）、词库安装与自定义导入合并、学习闭环（队列→评分→落库→复习）、记录系统（事件完整性/聚合/导出恢复）、仪表盘数据服务、AI 模块（多服务商/提示词构造/Key 本地存储）。

## 项目结构

```
src/
├── components/     # 布局、学习组件（卡片/评分/四选一/拼写/会话）、图表封装、AI 组件
├── pages/          # 首页 / 学习 / 复习 / 统计 / 词库 / 设置
├── services/       # 词库、学习会话、统计、记录、仪表盘、AI、数据导入导出
├── fsrs/           # 排程引擎（FSRS + SM-2 抽象层）
├── db/             # Dexie Schema
├── stores/         # Zustand（设置/学习会话）
├── lib/            # TTS、格式化、ECharts 按需注册、Markdown 渲染
└── hooks/          # 提醒通知
```

## 开源致谢

- 词库数据整理自 [RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner)（GPL-3.0，仅取词库数据）
- 排程算法 [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)（MIT）
- 图表 Apache ECharts（Apache-2.0）

## 许可证

本项目采用 [GNU GPL v3.0](LICENSE)。因内置词库数据源自 GPL-3.0 项目（qwerty-learner），采用相同许可证以保持合规。
