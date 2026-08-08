# 开发与发布规范

本文件定义词忆 WordMemory 的版本号规则、提交信息规范与发布流程。所有贡献者（含 AI 协作）应遵循本规范。

## 1. 版本号规则（语义化版本 SemVer）

版本号格式：`v主.次.修订`（如 `v0.1.0`）。

| 段位 | 递增时机 | 示例 |
|---|---|---|
| **主版本 (major)** | 破坏性变更：数据格式不兼容、移除功能、架构重构 | `v1.0.0` → `v2.0.0` |
| **次版本 (minor)** | 新功能、向后兼容的用户可见改进 | `v0.1.0` → `v0.2.0` |
| **修订 (patch)** | Bug 修复、文案/样式微调、性能优化 | `v0.1.0` → `v0.1.1` |

**硬性要求**：每次发版 `package.json` 的版本号必须与 git tag 完全一致（用 `npm version` 自动同步，勿手改）。

## 2. 提交信息规范（Conventional Commits 简化版）

格式：`类型: 简要描述`（描述用中文，动词开头，≤50 字）。

| 类型 | 用途 | 示例 |
|---|---|---|
| `feat` | 新功能 | `feat: 新增拼写模式` |
| `fix` | 修复 Bug | `fix: 修复复习队列重复出词` |
| `docs` | 文档 | `docs: 补充环境要求说明` |
| `refactor` | 重构（不改变行为） | `refactor: 收敛设置项为两个重置按钮` |
| `style` | 样式/UI 调整 | `style: 全站配色统一浅蓝主题` |
| `test` | 测试 | `test: 新增词库查重用例` |
| `ci` | CI / 部署 | `ci: 添加 GitHub Pages 自动部署` |
| `chore` | 杂项（依赖、构建脚本） | `chore: 清理一次性生成脚本` |

不追求每个 commit 原子化到极致，但**一个 commit 只做一件事**，方便回溯与生成变更日志。

## 3. 发布流程 SOP

主干开发：所有改动直接提交 `main` 分支。发版步骤：

```bash
# 1. 质量门槛：测试 + 构建必须通过
npm test
npm run build

# 2. 更新 CHANGELOG.md（把本次改动从 commit 归纳进 Unreleased/新版本条目）

# 3. 升版本号（自动改 package.json + 打 tag，三选一）
npm version patch   # 修订：bug 修复
npm version minor   # 次版本：新功能
npm version major   # 主版本：破坏性变更

# 4. 推送代码与 tag
git push
git push --tags

# 5. 发布 Release（附构建产物，便于自托管用户下载）
npm run build
Compress-Archive -Path dist\* -DestinationPath wordmemory-vX.Y.Z-dist.zip
gh release create vX.Y.Z wordmemory-vX.Y.Z-dist.zip \
  --title "词忆 WordMemory vX.Y.Z" --notes-file release-notes.md

# 6. GitHub Actions 自动重新部署 Pages（推送 main 即触发，无需手动）
```

## 4. 质量门槛

| 阶段 | 要求 |
|---|---|
| 提交前 | `npm test` 全部通过（当前 113 个） |
| 发版前 | 测试 + 构建 + 手动冒烟（重点：学习/复习闭环、数据导出恢复、离线可用） |
| 任何时候 | 不提交任何敏感信息（API Key、个人学习数据，见 `.gitignore`） |

## 5. 变更日志约定（CHANGELOG.md）

- 格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，版本按 SemVer。
- 每个新版本条目分组：`新增` / `修复` / `变更` / `移除`。
- 顶部始终保留 `[Unreleased]` 区块，日常改动记入其中，发版时并入正式版本。
