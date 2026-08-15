# dsh-change-review

DeepSeek Harness（DSH）**会话修改审查**插件：自动追踪会话内的文件写入/编辑操作，在会话视图中以 diff 对比形式展示，支持颜色自定义、实时推送、会话隔离与子代理聚合。

> 一个包同时承载 Host 逻辑与浏览器 UI（`dsh.bundle` + `dsh.client` 双 manifest）。

## ✨ 功能

| 功能 | 说明 |
| --- | --- |
| 自动追踪 | 监听 `write` / `edit` 工具调用，记录修改前后内容与时间 |
| diff 对比 | LCS 行级 diff：新增（绿）/ 删除（红）/ 上下文（灰），含新旧行号 |
| 会话隔离 | 每个会话只展示自己的修改，切换会话即切换审查内容 |
| 子代理聚合 | 子代理（subagent）的修改自动聚合到根父会话 |
| 实时推送 | SSE 服务端推送，修改文件后角标/列表即时刷新（零轮询） |
| 数量角标 | 「审查」标签显示待审文件数，背景/文字颜色可自定义 |
| 颜色自定义 | 8 项颜色在 **设置 → 修改审查** 页调整，localStorage 持久化 |

## 📦 安装

### 方式一：`dsh plugin add`（npm 发布后）

```sh
dsh plugin --profile web add dsh-change-review
```

### 方式二：手动部署

1. 将本仓库（或 `lib/` 内容）放入 harness 可解析的 `node_modules` 并在 profile 的 `cordis.patch.yml` 注册：

```yaml
- insert:
    - id: diff-review
      name: 'dsh-change-review'
    - id: ui-diff-review
      name: 'dsh-change-review'
```

2. 重启 dsh web

> 本插件默认在 Web profile（`dsh --profile web`）下运行。

## 🚀 使用

1. 打开会话，点击会话顶部视图标签 **「审查」**（位于「对话」之后、「轨迹」之前）
2. 左侧文件列表（写入/编辑次数、~新增/~删除统计），右侧选中文件的 diff 对比
3. 文件被修改时角标**实时 +1**；顶部「↻」刷新、「清空」清除当前会话记录
4. 颜色：**设置 → 修改审查**（8 项 + 深浅色预设 + 恢复默认），改动自动保存，刷新保留

## 🎨 颜色配置

| 配置项 | 键名 | 浅色默认 | 深色预设 |
| --- | --- | --- | --- |
| 新增行背景 | `addBg` | `#e6ffec` | `#10251c` |
| 新增行文字 | `addFg` | `#1a7f37` | `#7ee787` |
| 删除行背景 | `delBg` | `#ffebe9` | `#2d1415` |
| 删除行文字 | `delFg` | `#cf222e` | `#ffa198` |
| 上下文背景 | `ctxBg` | `#f6f8fa` | `#161b22` |
| 行号 / 标记 | `gutter` | `#57606a` | `#8b949e` |
| 角标背景 | `badgeBg` | `#0969da` | `#4493f8` |
| 角标文字 | `badgeFg` | `#ffffff` | `#0d1117` |

## 🧠 行为说明

- **追踪范围**：本进程内所有会话的 `write`/`edit` 工具调用；按会话隔离，子代理改动沿 owner 链聚合到根父会话
- **实时性**：Host 记录后经 SSE（`/diff-review/events`）推送，客户端只处理当前会话事件
- **持久性**：颜色持久化（localStorage `dsh.diff-review.colors`）；审查记录为进程内状态，重启后重新累积
- **容量保护**：单文件最多 100 次操作；单次内容截断 120KB；diff 单侧最多 1500 行

## 🗂 架构

```
Host（lib/index.js）
  · tools/result 监听 → 按会话分桶记录
  · LCS 行级 diff
  · HTTP 路由：/diff-review/summary · /file · /clear（均带 ?session=）
  · SSE：/diff-review/events
        │  HTTP + SSE（同源）
Browser UI（lib/client.js，__ModuleLoader__ bundle）
  · 会话头部探针同步当前会话（隐藏）
  · 「审查」视图标签 + 角标
  · 设置页「修改审查」颜色自定义
  · EventSource 实时订阅
```

## ⚖️ 免责声明

插件代码与你的 harness 进程同权限运行。使用前请审阅源码；收录于社区市场不构成安全背书。

## 📄 License

MIT
