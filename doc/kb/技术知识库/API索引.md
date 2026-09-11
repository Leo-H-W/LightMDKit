# API 索引

> **文档信息**：LightMDKit · 分支 `main` · 提交 `8edbf60` · 生成日期 2026-09-11（2026-09-11 核对）

> **重要说明**：当前前端（`LightMDKit/public/app.js`）使用浏览器原生 **File System Access API**（`showDirectoryPicker` / `createWritable`，见 `LightMDKit/public/app.js:1248-1564`）直接读写本地文件，**不调用**本文列出的任何 `/api/*` 接口。前端代码中不存在 `fetch` / `XMLHttpRequest` / `axios` 调用。后端接口属于**服务端提供的替代通道**，供外部脚本、命令行工具或第三方程序调用（详见 `doc/kb/外部接入指南.md`）。

## 概览

- **接口总数**：4（另有 1 条静态资源挂载，非 API，见「静态资源服务」）
- **接口类型**：HTTP RESTful API，请求与响应均为 JSON（Express 4.18）
- **认证方式**：无（本地服务，未实现任何鉴权）
- **服务端口**：3456（固定，硬编码于 `LightMDKit/server.js:11`）
- **服务地址**：`http://localhost:3456`
- **代码位置**：全部路由集中在单文件 `LightMDKit/server.js`，无 controller / service / router 分层
- **平台**：Node.js + Express，跨平台；其中 `/api/select-folder` **仅支持 Windows**

## 接口列表

### 文件夹选择与加载

| 方法 | 路径 | 功能说明 | 认证 | 代码位置 | 主要参数 |
|------|------|----------|------|----------|----------|
| POST | /api/select-folder | 弹出系统文件夹选择对话框，返回用户选中的目录路径（**仅 Windows**） | 否 | `LightMDKit/server.js:19-94` | 无 |
| POST | /api/load | 扫描指定目录下的 Markdown 文件，可选加载其中一个文件并返回渲染后的 HTML | 否 | `LightMDKit/server.js:97-168` | folderPath（必需）、filePath（可选） |

### 文件读取与刷新

| 方法 | 路径 | 功能说明 | 认证 | 代码位置 | 主要参数 |
|------|------|----------|------|----------|----------|
| GET | /api/file | 读取单个文件的原始内容与渲染后的 HTML | 否 | `LightMDKit/server.js:171-196` | path（查询参数，必需） |
| POST | /api/refresh | 重新读取指定文件的最新内容与 HTML（编辑器自动保存/刷新用） | 否 | `LightMDKit/server.js:199-224` | filePath（必需） |

### 静态资源服务

| 方法 | 路径 | 功能说明 | 认证 | 代码位置 | 主要参数 |
|------|------|----------|------|----------|----------|
| GET | / 及 /public 下所有文件 | 由 `express.static` 提供前端页面（index.html / app.js / md-render.js / style.css） | 否 | `LightMDKit/server.js:14` | 无 |

## 接口详情

### 1. POST /api/select-folder

- **用途**：在服务端弹出 Windows 原生「选择文件夹」对话框，把用户选中的绝对路径返回给调用方。
- **平台限制**：**仅 Windows**。非 Windows 平台（macOS / Linux）直接返回 500，不会尝试任何替代方案（`LightMDKit/server.js:16`、`LightMDKit/server.js:21-23`）。
- **实现方式**：以 Base64（UTF-16LE）编码的 PowerShell 脚本启动 `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand`，并用 `FolderBrowserDialog` 弹窗（`LightMDKit/server.js:25-51`）。

#### 请求参数

| 名称 | 类型 | 必填 | 位置 | 说明 |
|------|------|------|------|------|
| （无） | - | - | - | 不读取任何请求体或查询参数；携带 JSON 请求体也不会被解析使用 |

#### 响应字段

| 字段 | 类型 | 出现条件 | 说明 |
|------|------|----------|------|
| path | string | 用户确认选择 | 选中目录的绝对路径 |
| cancelled | boolean | 用户取消对话框 | 固定为 `true`，此时无 `path` 字段 |
| error | string | 出错时 | 错误描述，见下表 |

#### 错误码

| HTTP 状态码 | 触发条件 | 响应体示例 | 源码行 |
|------|----------|-----------|--------|
| 500 | 运行平台不是 Windows | `{"error":"Folder dialog is only supported on Windows"}` | `LightMDKit/server.js:21-23` |
| 500 | 对话框 30 秒未返回（超时后子进程被 kill） | `{"error":"Folder dialog timed out"}` | `LightMDKit/server.js:66-69` |
| 500 | PowerShell 退出码非 0（脚本执行失败，stderr 打印到服务端日志） | `{"error":"Failed to open folder dialog"}` | `LightMDKit/server.js:71-76` |
| 400 | 返回路径为空或路径不存在 | `{"error":"Invalid or non-existent path selected"}` | `LightMDKit/server.js:83-85` |
| 400 | 返回路径不是目录 | `{"error":"Selected path is not a directory"}` | `LightMDKit/server.js:87-90` |
| 200 | 成功 | `{"path":"C:\\Users\\..."}` | `LightMDKit/server.js:92` |
| 200 | 用户取消 | `{"cancelled":true}` | `LightMDKit/server.js:79-81` |

#### 备注

- 用户取消的判定依赖 PowerShell 脚本输出的哨兵字符串 `__CANCELLED__`（`LightMDKit/server.js:38`、`LightMDKit/server.js:79`）。
- 超时为 30000 ms 硬编码（`LightMDKit/server.js:66-69`）。
- **边界风险**：超时分支先 `child.kill()` 再返回 500，但子进程的 `close` 回调随后仍会执行；已实测被 kill 后 `code` 为 `null`、`signal` 为 `SIGTERM`，因此 `code !== 0` 成立，会对同一请求尝试第二次响应，服务端日志中可能出现响应头已发送类报错（`LightMDKit/server.js:71-76`）。

---

### 2. POST /api/load

- **用途**：加载一个目录：扫描其下的 Markdown 文件列表，并读取指定文件（未指定则取第一个）的原始内容与渲染结果，一次性返回。
- **请求体格式**：`Content-Type: application/json`。

#### 请求参数

| 名称 | 类型 | 必填 | 位置 | 说明 |
|------|------|------|------|------|
| folderPath | string | 是 | body | 要加载的目录路径，服务端用 `path.resolve` 转为绝对路径 |
| filePath | string | 否 | body | 要加载的具体文件路径；缺省时取扫描结果中的第一个文件。**不校验是否位于 folderPath 之内** |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| folderPath | string | `folderPath` 解析后的绝对路径 |
| files | array | 目录下的 Markdown 文件列表，元素为 `{ name, fullPath }` 对象 |
| files[].name | string | 文件名字（不含目录） |
| files[].fullPath | string | 文件绝对路径 |
| currentFile | string \| null | 实际加载的文件绝对路径；目录下无 Markdown 文件且未传 `filePath` 时为 `null` |
| content | string | 文件原始 Markdown 文本；未加载文件时为 `""` |
| html | string | 由 `renderMarkdown(content, marked)` 渲染的 HTML；未加载文件时为 `""` |

#### 错误码

| HTTP 状态码 | 触发条件 | 响应体示例 | 源码行 |
|------|----------|-----------|--------|
| 400 | 缺少 `folderPath` | `{"error":"folderPath is required"}` | `LightMDKit/server.js:100-102` |
| 404 | 目录不存在 | `{"error":"Directory does not exist: D:\\nope"}` | `LightMDKit/server.js:106-108` |
| 400 | 路径不是目录 | `{"error":"Path is not a directory: ...\\test-sample.md"}` | `LightMDKit/server.js:110-113` |
| 500 | 读取目录失败（权限等） | `{"error":"Failed to read directory: <err.message>"}` | `LightMDKit/server.js:117-130` |
| 404 | 目标文件不存在 | `{"error":"File does not exist: ..."}` | `LightMDKit/server.js:143-145` |
| 400 | 目标路径不是文件 | `{"error":"Path is not a file: ..."}` | `LightMDKit/server.js:147-150` |
| 500 | 读取文件失败 | `{"error":"Failed to read file: <err.message>"}` | `LightMDKit/server.js:156-158` |
| 200 | 成功（含目录下无 Markdown 文件的情况） | 见上方响应字段 | `LightMDKit/server.js:161-167` |

#### 备注

- 文件扫描为**单层非递归**，只匹配扩展名 `.md` / `.markdown`（大小写不敏感，`LightMDKit/server.js:118-127`），不包含子目录。
- 未传 `filePath` 时取扫描结果第一项；扫描顺序取决于 `fs.readdirSync` 的返回顺序（NTFS 下实测为文件名字典序），代码未做排序，**不应依赖**（`LightMDKit/server.js:133-136`）。
- 目录下没有 Markdown 文件时仍返回 200，`currentFile` 为 `null`、`content` 与 `html` 为空字符串（`LightMDKit/server.js:138-159`）。
- `filePath` 接受目录之外的任意路径，服务端未做沙箱限制（实测：`folderPath` 为项目根目录、`filePath` 指向 `server.js` 时成功读取并渲染，返回 200）。

---

### 3. GET /api/file

- **用途**：读取单个文件的内容并返回渲染后的 HTML。与 `/api/refresh` 的实现完全相同，区别仅在于取参方式（查询字符串 vs 请求体）。

#### 请求参数

| 名称 | 类型 | 必填 | 位置 | 说明 |
|------|------|------|------|------|
| path | string | 是 | query | 文件路径，服务端用 `path.resolve` 转为绝对路径。需 URL 编码 |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| content | string | 文件原始文本（UTF-8 读取） |
| html | string | `renderMarkdown(content, marked)` 渲染结果 |
| path | string | 解析后的文件绝对路径 |

#### 错误码

| HTTP 状态码 | 触发条件 | 响应体示例 | 源码行 |
|------|----------|-----------|--------|
| 400 | 缺少 `path` 查询参数 | `{"error":"path query parameter is required"}` | `LightMDKit/server.js:174-176` |
| 404 | 文件不存在 | `{"error":"File does not exist: D:\\nope\\none.md"}` | `LightMDKit/server.js:180-182` |
| 400 | 路径不是文件（如传入目录） | `{"error":"Path is not a file: ...\\public"}` | `LightMDKit/server.js:184-187` |
| 500 | 读取失败 | `{"error":"Failed to read file: <err.message>"}` | `LightMDKit/server.js:193-195` |
| 200 | 成功 | 见上方响应字段 | `LightMDKit/server.js:192` |

#### 备注

- 不做扩展名校验，任何可读文件都会被当作 Markdown 渲染。
- 路径同样无沙箱限制（见「安全注意事项」）。

---

### 4. POST /api/refresh

- **用途**：重新读取指定文件的最新内容与 HTML，供「刷新」场景使用（文件被外部修改后重新获取）。
- **请求体格式**：`Content-Type: application/json`。

#### 请求参数

| 名称 | 类型 | 必填 | 位置 | 说明 |
|------|------|------|------|------|
| filePath | string | 是 | body | 要刷新的文件路径，服务端用 `path.resolve` 转为绝对路径 |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| content | string | 文件最新原始文本 |
| html | string | `renderMarkdown(content, marked)` 渲染结果 |
| path | string | 解析后的文件绝对路径 |

#### 错误码

| HTTP 状态码 | 触发条件 | 响应体示例 | 源码行 |
|------|----------|-----------|--------|
| 400 | 缺少 `filePath` | `{"error":"filePath is required"}` | `LightMDKit/server.js:202-204` |
| 404 | 文件不存在 | `{"error":"File does not exist: ..."}` | `LightMDKit/server.js:208-210` |
| 400 | 路径不是文件 | `{"error":"Path is not a file: ...\\public"}` | `LightMDKit/server.js:212-215` |
| 500 | 读取失败 | `{"error":"Failed to read file: <err.message>"}` | `LightMDKit/server.js:221-223` |
| 200 | 成功 | 见上方响应字段 | `LightMDKit/server.js:220` |

#### 备注

- 与 `GET /api/file` 的处理逻辑逐行相同（仅参数来源不同），响应字段集合实测一致：`content` / `html` / `path`。
- 服务端不做任何缓存，每次调用都重新 `fs.readFileSync` 并重新渲染。

## 通用约定

### 错误响应结构

所有接口的**显式**错误均返回标准 HTTP 状态码 + `{"error": "<描述文本>"}`：

```json
{ "error": "folderPath is required" }
```

例外（框架默认行为，非本项目代码）：请求体是非法 JSON 时，`express.json()` 会交给 Express 默认错误处理器，返回 **400 + `text/html`** 的 HTML 错误页而非 JSON；访问未定义的路由返回 **404 + `text/html`**。实测确认。

### 请求体解析

`app.use(express.json())` 全局挂载（`LightMDKit/server.js:13`），两个 POST 接口的 body 必须为 JSON。若 POST 未携带 `Content-Type: application/json`，body 不会被解析，接口会按「缺少必填参数」返回 400。

### 渲染实现

三个返回 HTML 的接口都调用 `renderMarkdown(content, marked)`：
- 调用点：`LightMDKit/server.js:154`、`LightMDKit/server.js:191`、`LightMDKit/server.js:219`
- 实现：`LightMDKit/public/md-render.js:190`（`marked` 在此处被复用/包装），模块引入见 `LightMDKit/server.js:6-7`

### 服务进程模型（与调试相关）

| 项 | 说明 | 源码行 |
|----|------|--------|
| 端口常量 | `PORT = 3456` | `LightMDKit/server.js:11` |
| 守护进程开关 | 环境变量 `LIGHTMDKIT_DAEMON=1` 时进程直接监听端口（后台服务模式） | `LightMDKit/server.js:227`、`LightMDKit/server.js:292-295` |
| 前台启动器 | 端口空闲则 `spawnDaemon()` 派生子进程、打印地址、2 秒后打开浏览器并 `exit(0)` | `LightMDKit/server.js:297-305` |
| 端口已占用 | 打印提示 + 直接打开 `http://localhost:3456`，`exit(0)`（**不杀旧进程、不做交互式选择**） | `LightMDKit/server.js:307-310` |
| 守护进程端口冲突 | 打印 `Port 3456 is already in use.` 并 `process.exit(1)` | `LightMDKit/server.js:280-288` |
| 打开浏览器 | Windows 用 `cmd /c start`，macOS 用 `open`，其他用 `xdg-open` | `LightMDKit/server.js:233-249` |

### 不涉及的接口类型

本项目**不涉及**：RPC（gRPC / Thrift / Dubbo）、GraphQL、WebSocket / SSE、消息队列、鉴权与权限校验、接口版本化（无 `/v1` 前缀）、CORS 跨域配置（响应中不含 `Access-Control-Allow-Origin`，浏览器跨源调用会被拦截）。

### 安全注意事项

- 无鉴权，任何能访问本机 `localhost:3456` 的进程均可调用全部接口。
- `/api/load`、`/api/file`、`/api/refresh` 接受任意文件系统路径，**没有路径沙箱 / 目录白名单**，可读取运行账号有权限访问的任何文件（实测通过）。
- 服务默认监听所有网卡地址（`app.listen(PORT)` 未指定 host），是否可从局域网访问取决于操作系统防火墙策略。

## 快速查找指南

**修改接口步骤**：
1. 在「接口列表」中找到目标接口
2. 查看「代码位置」列，得到 `LightMDKit/server.js:行号范围`
3. 打开该文件，行号范围内即为完整的路由处理函数（`app.post(...)` / `app.get(...)` 到对应的 `});`）

**要了解接口详细参数**：
1. 找到「接口详情」中对应小节
2. POST 接口看源码中的 `req.body` 解构（`const { folderPath, filePath } = req.body;`），GET 接口看 `req.query.path`
3. 返回结构看函数末尾的 `res.json({...})`

**新增接口**：在 `LightMDKit/server.js` 中紧随现有路由追加 `app.<method>('<path>', handler)` 即可——本项目没有路由注册表或中间件分层，不需要改动其他文件。

## 常用接口快速链接

- 选择文件夹（仅 Windows）：`POST /api/select-folder` → `LightMDKit/server.js:19-94`
- 加载文件夹 + 文件列表：`POST /api/load` → `LightMDKit/server.js:97-168`
- 读取单个文件：`GET /api/file` → `LightMDKit/server.js:171-196`
- 刷新文件内容：`POST /api/refresh` → `LightMDKit/server.js:199-224`
- 静态页面入口：`GET /` → `LightMDKit/server.js:14`
