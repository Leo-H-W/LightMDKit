# md-view

本地 Markdown 查看器，以 GitHub 风格渲染 Markdown 文件。无需上传文件，直接通过浏览器读取本地文件夹，支持目录导航、在线编辑与 Mermaid 图表。

## 功能特性

- **GitHub 风格渲染** — 基于 `github-markdown-css` 与 `marked`，还原 GitHub 上的排版效果
- **本地文件夹加载** — 通过浏览器原生 [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_Access_API)（`showDirectoryPicker`）直接读取本地目录，文件不上传
- **文件列表切换** — 顶部下拉框选择 `.md` / `.markdown` 文件
- **侧边栏目录（TOC）** — 自动提取标题生成目录，随滚动高亮当前章节，支持折叠与拖拽调整宽度
- **在线编辑** — 内置 CodeMirror 编辑器（GFM 模式、GitHub 主题），可编辑后直接写回原文件
- **编辑 ↔ 浏览位置同步** — 切换模式时自动定位到当前标题对应的源码位置
- **Mermaid 图表** — 支持渲染 ` ```mermaid ` 代码块
- **文档内链接跳转** — 拦截相对路径的 Markdown 链接在同目录内打开，并提供「返回」历史栈
- **手动刷新** — 重新扫描文件夹，感知新增 / 删除的文件

## 技术栈

| 组件 | 说明 |
| --- | --- |
| [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/) | 静态服务与后台守护进程 |
| [marked](https://marked.js.org/) | Markdown 解析 |
| [github-markdown-css](https://github.com/sindresorhus/github-markdown-css) | GitHub 排版样式 |
| [CodeMirror 5](https://codemirror.net/5/) | Markdown 编辑器 |
| [Mermaid](https://mermaid.js.org/) | 图表渲染 |

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务（默认端口 3456）
npm start
```

启动后访问 <http://localhost:3456>。

`npm start` 会以守护进程方式在后台运行服务。再次启动时若检测到端口被占用，会提示选择「重新运行」或「显示访问 URL」。

## 使用说明

1. 使用 **Chrome / Edge** 浏览器打开 <http://localhost:3456>（文件夹选择依赖 File System Access API）
2. 点击右上角下拉框中的 **📁 加载文件夹...**，选择包含 Markdown 文件的目录
3. 通过下拉框或侧边栏目录切换、跳转文件
4. 点击 **编辑** 进入编辑模式，修改后点击 **浏览** 保存并返回预览
5. 点击 **刷新** 重新扫描当前文件夹

## 服务端 API

> 前端默认使用浏览器 File System Access API 读取文件，以下接口由服务端提供，可作为替代或扩展使用。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/select-folder` | 打开系统文件夹选择对话框（仅 Windows） |
| `POST` | `/api/load` | 扫描并加载目录中的 Markdown 文件 |
| `GET` | `/api/file` | 读取指定文件并渲染为 HTML |
| `POST` | `/api/refresh` | 刷新指定文件的渲染结果 |

## 项目结构

```
md-view/
├── server.js          # Express 静态服务 + 守护进程 + REST API
├── package.json
├── public/
│   ├── index.html     # 页面结构
│   ├── app.js         # 前端交互逻辑
│   └── style.css      # 自定义样式
├── doc/               # 知识库文档
├── openspec/          # OpenSpec 规范
├── agent-rules/       # Agent 规则提示词
└── test-*.md          # 示例 Markdown 文件
```

## 许可证

[MIT](LICENSE)
