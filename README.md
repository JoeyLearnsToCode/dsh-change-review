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
| Revert changes | Undo ONE specific change (later non-overlapping changes are kept) or the WHOLE file (restore the pre-session snapshot; a file created in-session is deleted) — writes directly to disk |
| Per-turn review | Each turn's tail shows a card with THIS turn's changed files and expandable diffs (with per-op revert), distinct from the session-wide 「审查」tab |
| Count badge | The 「审查」(Review) tab shows the pending file count; badge background/text colors are customizable |
| Color customization | 12 colors configurable under **Settings → 修改审查** (Review), including the turn-tail card's background, border, and added/removed counts (different defaults); every color has an opacity slider (rgba), persisted in localStorage |
| Clean sidebar | Hides the Cordis plugin run indicator (`cordis-panel`) from the left sidebar |

## 📸 Screenshots

| Review tab — file list + diff preview | Per-turn review card |
|:---:|:---:|
| ![Review tab](assets/screenshots/review-tab.png) | ![Per-turn review card](assets/screenshots/per-turn-card.png) |

| Expanded diff with per-change revert | Color customization (Settings → 修改审查) |
|:---:|:---:|
| ![Diff detail](assets/screenshots/diff-detail.png) | ![Color settings](assets/screenshots/color-settings.png) |

| Installed from the plugin market |
|:---:|
| ![Plugin market](assets/screenshots/plugin-market.png) |

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
2. Left: file list (write/edit counts, ~added/~removed stats); right: the selected file's diff. The two panes **scroll independently** (scrolling the file list never scrolls the diff preview and vice versa), so you can browse files while keeping the preview in place. The header toggle switches the scope: **此会话** (all session changes) or **最新一轮** (the latest turn's changes)
3. The badge increments **in real time** when files change; top bar: **↻** refresh, **清空** clear the current session's records
4. **Revert** (each action asks for confirmation, then writes the file on disk directly):
   - **One change**: the **撤回此项** (revert this) button on each edit/write section header — restores the file to that change's previous content, keeping later changes that do not overlap (overlapping ones are rejected with a hint)
   - **Whole file**: the **撤回全部修改** (revert all) button at the top of the detail pane — restores the file to its state before this session's first recorded change; a file created in this session is deleted
5. **Per-turn review**: after each turn, a **本轮变更审查** card appears at the turn's tail listing the files changed in that turn (write/edit counts, ~added/~removed); click a file to expand its diffs and revert a single change. Session-cumulative changes stay in the 「审查」tab — the two views are independent
6. Colors: **Settings → 修改审查** (8 items + light/dark presets + restore defaults), auto-saved, survives refresh

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
| Added count (turn-tail list) | `turnAdd` | `#1a7f37` | `#7ee787` |
| Removed count (turn-tail list) | `turnDel` | `#cf222e` | `#ffa198` |
| Card background (turn-tail) | `turnBg` | `rgba(255,183,77,.1)` (light orange 10%) | `rgba(255,183,77,.1)` (light orange 10%) |
| Card border (turn-tail) | `turnBorder` | `#ffb74d` (light orange) | `#ffb74d` (light orange) |

## 🧠 Behavior Notes

- **Scope**: all `write`/`edit` tool calls in the current process, bucketed per session; subagent changes are aggregated up the owner chain to the root parent session
- **Real time**: the Host pushes via SSE (`/diff-review/events`); the client only processes events for the current session
- **Persistence**: colors persist (localStorage key `dsh.diff-review.colors`); review records persist to disk (`~/.dsh/profiles/web/diff-review-state.json`, debounced auto-save + sync flush on exit) and are restored automatically after a dsh web restart — delete that file to wipe all history
- **Capacity guards**: max 100 ops per file; content truncated at 120KB per op; diff capped at 1500 lines per side; the 3-way merge used for single-change revert is capped at 2000 lines per side
- **Revert internals**: each op records the full before/after content snapshot reported by the write/edit tool. Reverting the last op restores the exact snapshot; reverting a middle op performs a 3-way line merge (keeps later changes, removes that op) and refuses on overlap; after a successful revert the op and everything after it leave the pending list
- **Upgrade note**: records created before this upgrade (no content snapshots) cannot be reverted (no button is shown); Host-side changes require **restarting dsh web**, browser-side changes only need a page refresh
- **Turn bucketing**: each op records the ROOT session turn it happened in by scanning the session log (`turn/start`/`turn/end`) directly — no event-listener dependency, so resumed sessions and multi-turn sessions are attributed correctly; subagent changes count toward the parent turn. Per-turn cards and the review page's **最新一轮** view show only that turn's ops. Records created before this upgrade carry no turn and never appear in per-turn cards (they still show in the 「审查」tab)

## 📝 Changelog

### v0.2.3 — Independent pane scrolling (2026-08-16)

- **Independent scrolling** — the review page's left file list and the right diff preview now scroll separately (the view fills the available height in every phase and `overscroll-behavior: contain` stops scroll chaining between the panes), making it easier to browse files while reviewing a diff

### v0.2.2 — Fix plugin registration (2026-08-16)

- **Fix plugin load** — the client bundle is now registered under the correct `dsh-change-review` id (was `@deepseek-ai/dsh-client-ui-diff-review`), and the duplicate `ui-diff-review` insert was removed from `cordis.patch.yml`, so the plugin is injected once and loads correctly

### v0.2.0 — Revert & per-turn review (2026-08-15)

- **Revert changes** — undo ONE specific change (3-way merge keeps later non-overlapping changes; overlapping ones are rejected) or the WHOLE file (restore the state before the session's first change; a file created in-session is deleted). Writes directly to disk after confirmation
- **Per-turn review** — each turn's tail shows a **本轮变更审查** card with that turn's changed files and expandable diffs; the 「审查」tab gains a **最新一轮** (latest turn) scope toggle
- **Persistence** — review records now survive dsh web restarts (`~/.dsh/profiles/web/diff-review-state.json`; debounced auto-save + sync flush on exit)
- **Upgrade note** — records created before this version carry no content snapshots or turn tags: they stay visible in the 「审查」tab but cannot be reverted; restart dsh web after upgrading

### v0.1.0 — Initial release

- Session-isolated tracking of `write`/`edit` tool calls with LCS line diffs, subagent aggregation, SSE live updates, customizable colors, count badge

## 🗂 Architecture

```
Host (lib/index.js)
  · tools/result listener → per-session buckets
  · LCS line diff
  · HTTP routes: /diff-review/summary · /file · /clear · /revert · /turn (all with ?session=)
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
