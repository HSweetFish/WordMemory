# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)（SemVer），格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。开发与发布规范见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## [Unreleased]

### 新增

### 修复

### 变更

### 移除

## [0.1.0] - 2026-08-08

首个公开版本。

### 新增

- 初学 / 复习严格区分：每日新词队列 + FSRS 遗忘曲线驱动的多轮复习队列
- FSRS 排程引擎（ts-fsrs v5）：四级评分（忘记 / 模糊 / 记得 / 熟练），答错立即回炉；预留 SM-2 备选实现
- 可视化仪表盘：GitHub 风格打卡热力图、每日趋势折线、掌握度环形图、个人遗忘曲线、词库进度环、薄弱词 / 词性分布
- AI 智能分析（可选）：学习周报 / 月报、AI 助记、薄弱词分析；支持 OpenAI / DeepSeek / 通义 / 智谱 / 自定义端点，API Key 仅存浏览器本地
- 6 大内置词库：CET4、CET6、考研、雅思、托福、COCA 2 万词频（34,150 词条，100% 带词性）
- 自定义词表导入（JSON / CSV），格式详见 [docs/IMPORT_FORMAT.md](docs/IMPORT_FORMAT.md)
- PWA 离线支持：Service Worker 预缓存应用外壳，首次访问后断网可用
- 数据备份：JSON 一键导出 / 恢复 + 本地文件夹自动同步（Chrome / Edge，File System Access API）
- 词表页：词书浏览、已学词回顾、全局搜索、记忆历史时间线
- 113 个单元 / 集成测试（Vitest + fake-indexeddb）

### 变更

- 学习页支持翻转卡片、四选一测试、拼写模式、键盘快捷键
- 东八区（Asia/Shanghai）日期计算每日配额与连续打卡，不随设备时区变化
