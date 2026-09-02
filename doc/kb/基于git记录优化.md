# 基于 Git 记录的代码优化分析

> 项目：LightMDKit  
> 分析日期：2026-04-24  
> 文档路径：`LightMDKit/doc/kb/基于git记录优化.md`

---

## 1. Git 历史概览

### 1.1 现状说明

**本项目当前未初始化 Git 仓库**，不存在 `.git` 目录，因此无法通过 `git log` 获取提交历史、贡献者信息或代码变更记录。

### 1.2 文件系统时间线索

通过文件最后修改时间分析，项目开发集中在 **2026-04-24 当天**，属于一次性快速迭代的原型/初版项目：

| 时间 | 文件 | 说明 |
|------|------|------|
| 14:34 | `LightMDKit/public/app.js` | 最新修改，前端核心逻辑 |
| 14:30 | `LightMDKit/public/index.html` | 前端页面结构 |
| 14:30 | `LightMDKit/public/style.css` | 前端样式 |
| 10:31 | `LightMDKit/server.js` | 后端服务入口 |
| 10:35 | `LightMDKit/.claude/settings.local.json` | Claude 配置（非业务代码） |
| 09:15 | `LightMDKit/package-lock.json` | 依赖锁定 |
| 09:14 | `LightMDKit/test-sample.md` | 测试样本文件 |
| 08:57 | `LightMDKit/package.json` | 项目配置 |

**时间跨度**：约 **6 小时**（08:57 ~ 14:34），所有代码在半天内完成。

---

## 2. 代码变更热点分析（基于文件修改时间）

由于无 Git 记录，以下分析基于文件系统时间戳和代码内容推断：

### 2.1 高频修改区域（时间排序）

1. **`LightMDKit/public/app.js`**（14:34 最后修改）
   - 前端核心交互逻辑，包含：文件夹选择、文件加载、目录生成、编辑模式切换、保存、返回历史、侧边栏拖拽调整、TOC 高亮联动等
   - 代码量最大（约 470 行），功能最密集
   - **推断为当前最活跃的修改区域**

2. **`LightMDKit/public/index.html` + `style.css`**（14:30 左右修改）
   - 与 `app.js` 同步迭代，说明前端三件套（HTML/CSS/JS）是协同开发的
   - `index.html` 中缓存版本号 `?v=7` 表明至少经历了 7 轮以上调试迭代

3. **`LightMDKit/server.js`**（10:31 修改，早于前端）
   - 后端 API 服务，提供文件夹对话框（Windows PowerShell）、文件读取、刷新接口
   - 修改时间较早且之后未再更新，**推断后端接口已相对稳定**

### 2.2 潜在不稳定区域

| 模块 | 风险等级 | 原因 |
|------|----------|------|
| `app.js` 编辑模式与浏览模式切换 | 高 | 涉及状态管理（`isEditMode`、`lastViewHeadingId`、`headingOffsets`）、DOM 显隐切换、滚动位置恢复，逻辑复杂 |
| `app.js` TOC 与编辑器联动 | 中 | `IntersectionObserver` 与手动滚动定位并存，边界情况多 |
| `app.js` 文件链接拦截跳转 | 中 | 正则匹配和文件名查找逻辑，可能存在路径解析边界问题 |
| `server.js` PowerShell 文件夹对话框 | 中 | 仅支持 Windows，超时处理（30s）和进程管理需关注 |

---

## 3. 开发模式总结

### 3.1 提交规范现状

- **无 Git 提交规范**：项目未使用 Git，不存在提交信息（commit message）规范
- 无分支管理策略（如 Git Flow、Trunk-Based）
- 无代码审查（Code Review）记录

### 3.2 迭代节奏推断

基于文件时间戳和缓存版本号 `?v=7` 推断：

- **开发模式**：快速原型式开发，前端三件套同步迭代
- **迭代节奏**：约 30~60 分钟一轮（从 10:31 到 14:34 约 4 小时，前端改了约 7+ 轮）
- **技术栈**：Node.js + Express + 原生前端（无框架），依赖 `marked` 做 Markdown 解析

### 3.3 代码结构特点

- **前后端分离**：`server.js` 提供 API，`public/` 下为纯静态前端
- **无构建工具**：直接引用 CDN 资源（`github-markdown-css`、`marked`）
- **无测试框架**：仅有 `test-sample.md` 作为手动测试样本
- **无类型系统**：纯 JavaScript，无 TypeScript

---

## 4. 基于现状的代码优化建议

### 4.1 立即建议：初始化 Git 仓库

由于项目无版本控制，**强烈建议立即执行以下操作**：

```bash
cd LightMDKit
git init
git add .
git commit -m "feat: initial LightMDKit markdown viewer"
```

并建立提交规范，例如：

- `feat:` 新功能
- `fix:` 修复问题
- `style:` 样式调整
- `refactor:` 代码重构
- `docs:` 文档更新

### 4.2 代码结构优化建议

| 优先级 | 建议 | 目标文件 |
|--------|------|----------|
| 高 | 将 `app.js` 按功能拆分为模块（如 `folder.js`、`editor.js`、`toc.js`、`router.js`） | `LightMDKit/public/app.js` |
| 高 | 引入前端构建工具（Vite / Rollup）或至少使用 ES Modules 拆分文件 | `LightMDKit/public/` |
| 中 | `server.js` 中的端口占用检测和守护进程逻辑抽离为独立模块 | `LightMDKit/server.js` |
| 中 | 添加错误边界处理（如 `marked.parse` 失败时的降级展示） | `LightMDKit/public/app.js` |
| 低 | 将内联 PowerShell 脚本抽离为独立 `.ps1` 文件，便于维护 | `LightMDKit/server.js` |

### 4.3 质量保障建议

| 优先级 | 建议 | 说明 |
|--------|------|------|
| 高 | 添加 ESLint + Prettier 配置 | 统一代码风格，当前代码存在混合缩进和格式差异 |
| 高 | 添加基础单元测试（如 `marked` 渲染、API 路由测试） | 项目目前零测试覆盖 |
| 中 | 引入 TypeScript 类型定义 | 尤其 `currentFiles`、`headingOffsets` 等数据结构 |
| 中 | 添加 `nodemon` 或 `pm2` 用于开发/生产进程管理 | 替代手写的守护进程逻辑 |

### 4.4 后续基于 Git 的跟踪建议

一旦建立 Git 仓库，建议定期执行以下分析：

1. **查看变更热点**：
   ```bash
   git log --pretty=format: --name-only | sort | uniq -c | sort -rg | head -20
   ```
2. **查看提交频率**：
   ```bash
   git log --pretty=format:"%h %ad %s" --date=short
   ```
3. **识别频繁修改的函数/模块**：结合 `git blame` 和代码审查

---

## 5. 总结

- **当前状态**：`LightMDKit` 是一个在 2026-04-24 半天内快速完成的原型项目，**未使用 Git 版本控制**
- **核心风险**：所有代码历史丢失风险高，无法回溯、协作或做变更分析
- **最优先行动**：初始化 Git 仓库并建立提交规范，随后对 `app.js` 进行模块化拆分
- **后端稳定性**：`server.js` 修改较早且之后未动，相对成熟；前端 `app.js` 是当前最活跃、最需要关注的区域
