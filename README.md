# dsh-change-review

A **session change-review plugin** for DeepSeek Harness (DSH): automatically tracks file `write`/`edit` operations inside your session and renders them as line-level diffs with customizable colors — session-isolated, subagent-aggregated, and pushed live via SSE.

> One package carries both the Host logic and the browser UI (`dsh.bundle` + `dsh.client` manifests).

[中文说明](README.zh.md)

## ✨ Features

| Feature | Description |
| --- | --- |
| Auto tracking | Listens to `write` / `edit` tool calls, records before/after content and timestamps |
| Diff view | LCS line-level diff: added (green) / removed (red) / context (gray) lines with both-side line numbers |
| Session isolation | Each session reviews only its own changes; switching sessions switches the review |
| Subagent aggregation | Changes made by subagents are aggregated into the root parent session |
| Live updates | SSE server push — the badge and list refresh instantly when files change (zero polling) |
| Count badge | The 「审查」(Review) tab shows the pending file count; badge background/text colors are customizable |
| Color customization | 8 colors configurable under **Settings → 修改审查** (Review), persisted in localStorage |
| Clean sidebar | Hides the Cordis plugin run indicator (`cordis-panel`) from the left sidebar |

## 📦 Install

### Option A: `dsh plugin add` (after npm publish)

```sh
dsh plugin --profile web add dsh-change-review
```

### Option B: manual deployment

1. Make the package resolvable by the harness (e.g. place it in `node_modules`) and register it in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: diff-review
      name: 'dsh-change-review'
    - id: ui-diff-review
      name: 'dsh-change-review'
```

2. Restart dsh web

> This plugin targets the Web profile (`dsh --profile web`).

## 🚀 Usage

1. Open a session and click the **「审查」(Review)** view tab (after「对话」Chat, before「轨迹」Trajectory)
2. Left: file list (write/edit counts, ~added/~removed stats); right: the selected file's diff
3. The badge increments **in real time** when files change; top bar: **↻** refresh, **清空** clear the current session's records
4. Colors: **Settings → 修改审查** (8 items + light/dark presets + restore defaults), auto-saved, survives refresh

## 🎨 Color Configuration

| Item | Key | Light default | Dark preset |
| --- | --- | --- | --- |
| Added line background | `addBg` | `#e6ffec` | `#10251c` |
| Added line text | `addFg` | `#1a7f37` | `#7ee787` |
| Removed line background | `delBg` | `#ffebe9` | `#2d1415` |
| Removed line text | `delFg` | `#cf222e` | `#ffa198` |
| Context background | `ctxBg` | `#f6f8fa` | `#161b22` |
| Line numbers / markers | `gutter` | `#57606a` | `#8b949e` |
| Badge background | `badgeBg` | `#0969da` | `#4493f8` |
| Badge text | `badgeFg` | `#ffffff` | `#0d1117` |

## 🧠 Behavior Notes

- **Scope**: all `write`/`edit` tool calls in the current process, bucketed per session; subagent changes are aggregated up the owner chain to the root parent session
- **Real time**: the Host pushes via SSE (`/diff-review/events`); the client only processes events for the current session
- **Persistence**: colors persist (localStorage key `dsh.diff-review.colors`); review records are process-local and rebuild from new modifications after a restart
- **Capacity guards**: max 100 ops per file; content truncated at 120KB per op; diff capped at 1500 lines per side

## 🗂 Architecture

```
Host (lib/index.js)
  · tools/result listener → per-session buckets
  · LCS line diff
  · HTTP routes: /diff-review/summary · /file · /clear (all with ?session=)
  · SSE: /diff-review/events
        │  HTTP + SSE (same origin)
Browser UI (lib/client.js, __ModuleLoader__ bundle)
  · hidden session probe syncs the current session
  · 「审查」view tab + badge
  · Settings page「修改审查」color customization
  · EventSource live subscription
```

## ⚖️ Disclaimer

Plugin code runs with the same privileges as your harness process. Review the source before installing; inclusion in community markets is not a security endorsement.

## 📄 License

MIT
