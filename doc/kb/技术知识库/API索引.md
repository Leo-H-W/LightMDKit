# API 索引

> **重要说明**: 当前前端（`LightMDKit/public/app.js`）使用浏览器原生 File System Access API 直接读写本地文件，**未调用**以下后端 `/api/*` 接口。后端 API 作为备用通道存在，可供外部系统调用。

## 概览

- **接口总数**：4
- **服务端口**：3456
- **认证方式**：无（本地服务，无需认证）
- **服务类型**：HTTP RESTful API（Express 框架）

## 接口列表

### 文件夹管理

| 方法 | 路径 | 功能说明 | 认证 | 代码位置 | 主要参数 |
|------|------|----------|------|----------|----------|
| POST | /api/select-folder | 弹出系统文件夹选择对话框，返回用户选择的目录路径 | 否 | `LightMDKit/server.js:19` | 无（请求体为空） |
| POST | /api/load | 扫描指定目录下的 Markdown 文件，可选加载指定文件内容并返回 HTML | 否 | `LightMDKit/server.js:97` | folderPath（必需）, filePath（可选） |

### 文件读取

| 方法 | 路径 | 功能说明 | 认证 | 代码位置 | 主要参数 |
|------|------|----------|------|----------|----------|
| GET | /api/file | 读取单个文件的原始内容和渲染后的 HTML | 否 | `LightMDKit/server.js:171` | path（查询参数，必需） |

### 文件刷新

| 方法 | 路径 | 功能说明 | 认证 | 代码位置 | 主要参数 |
|------|------|----------|------|----------|----------|
| POST | /api/refresh | 重新读取指定文件的最新内容和 HTML | 否 | `LightMDKit/server.js:199` | filePath（必需） |

### 静态资源服务

| 方法 | 路径 | 功能说明 | 认证 | 代码位置 | 主要参数 |
|------|------|----------|------|----------|----------|
| GET | / | 提供前端静态文件服务（HTML/CSS/JS） | 否 | `LightMDKit/server.js:14` | 无 |

## 响应格式

### /api/select-folder

```json
// 成功
{ "path": "C:\\Users\\..." }
// 用户取消
{ "cancelled": true }
// 错误
{ "error": "..." }
```

### /api/load

```json
{
  "folderPath": "绝对路径",
  "files": [{ "name": "文件名.md", "fullPath": "绝对路径" }],
  "currentFile": "当前文件绝对路径",
  "content": "原始 Markdown 文本",
  "html": "渲染后的 HTML"
}
```

### /api/file

```json
{
  "content": "原始文本",
  "html": "渲染后的 HTML",
  "path": "绝对路径"
}
```

### /api/refresh

```json
{
  "content": "原始文本",
  "html": "渲染后的 HTML",
  "path": "绝对路径"
}
```

## 快速查找指南

**修改接口步骤**：
1. 在表格中找到目标接口
2. 查看"代码位置"列，找到文件和行号
3. 打开 `LightMDKit/server.js` 直接修改对应路由处理函数

**要了解接口详细参数**：
1. 找到代码位置
2. 查看路由处理函数中的 `req.body`（POST）或 `req.query`（GET）
3. 查看返回的 `res.json()` 结构

## 常用接口快速链接

- 选择文件夹：`POST /api/select-folder` → `LightMDKit/server.js:19`
- 加载文件夹/文件：`POST /api/load` → `LightMDKit/server.js:97`
- 读取单个文件：`GET /api/file` → `LightMDKit/server.js:171`
- 刷新文件内容：`POST /api/refresh` → `LightMDKit/server.js:199`

---

<!-- 扫描进度 (请勿删除此注释，用于增量更新)
执行次数: 1
扫描时间: 2026-04-30T00:00:00Z
完成状态: 已完成
已扫描目录: / (项目根目录)
已扫描文件数: 2
下次建议: 无（所有核心文件已扫描）
-->
