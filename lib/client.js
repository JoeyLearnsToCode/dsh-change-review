window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-diff-review",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		// ── color configuration (persisted to localStorage) ────────────────
		const LS_KEY = "dsh.diff-review.colors";
		const LIGHT = { addBg: "#e6ffec", addFg: "#1a7f37", delBg: "#ffebe9", delFg: "#cf222e", ctxBg: "#f6f8fa", gutter: "#57606a", badgeBg: "#0969da", badgeFg: "#ffffff" };
		const DARK = { addBg: "#10251c", addFg: "#7ee787", delBg: "#2d1415", delFg: "#ffa198", ctxBg: "#161b22", gutter: "#8b949e", badgeBg: "#4493f8", badgeFg: "#0d1117" };
		const DEFAULTS = Object.assign({}, LIGHT);
		const COLOR_KEYS = Object.keys(DEFAULTS);

		function loadSavedColors() {
			try {
				const raw = localStorage.getItem(LS_KEY);
				if (!raw) return null;
				const obj = JSON.parse(raw);
				if (!obj || typeof obj !== "object") return null;
				const out = Object.assign({}, DEFAULTS);
				let ok = false;
				for (const k of COLOR_KEYS) {
					if (typeof obj[k] === "string" && /^#[0-9a-fA-F]{6}$/.test(obj[k])) {
						out[k] = obj[k];
						ok = true;
					}
				}
				return ok ? out : null;
			} catch (e) {
				return null;
			}
		}
		function saveColors(colors) {
			try {
				localStorage.setItem(LS_KEY, JSON.stringify(colors));
			} catch (e) {}
		}

		// ── shared store ───────────────────────────────────────────────────
		const store = {
			files: null, loadingFiles: false,
			selected: null, detail: null, loadingDetail: false, error: null,
			colors: Object.assign({}, DEFAULTS), currentSession: null
		};
		{
			const savedColors = loadSavedColors();
			if (savedColors) store.colors = savedColors;
		}
		const listeners = new Set();
		function setState(patch) {
			Object.assign(store, patch);
			if (patch.colors) saveColors(patch.colors);
			listeners.forEach((fn) => fn());
		}
		function useStore(selector) {
			const [v, setV] = React.useState(() => selector(store));
			React.useEffect(() => {
				const fn = () => setV(selector(store));
				listeners.add(fn);
				return () => listeners.delete(fn);
			}, []);
			return v;
		}

		// ── host data via HTTP routes ──────────────────────────────────────
		function apiSummary(session) { return fetch("/diff-review/summary?session=" + encodeURIComponent(session)).then((r) => r.json()); }
		function apiFile(session, path) { return fetch("/diff-review/file?session=" + encodeURIComponent(session) + "&path=" + encodeURIComponent(path)).then((r) => r.json()); }
		function apiClear(session) { return fetch("/diff-review/clear?session=" + encodeURIComponent(session), { method: "POST" }).then((r) => r.json()); }

		function loadSummary() {
			const session = store.currentSession;
			if (!session) return;
			setState({ loadingFiles: true, error: null });
			apiSummary(session).then((v) => {
				setState({ files: (v && v.files) || [], loadingFiles: false });
			}).catch((e) => {
				setState({ error: String((e && e.message) || e), loadingFiles: false });
			});
		}
		function loadDetail(path) {
			const session = store.currentSession;
			if (!session) return;
			setState({ selected: path, detail: null, loadingDetail: true, error: null });
			apiFile(session, path).then((v) => {
				setState({ detail: v, loadingDetail: false });
			}).catch((e) => {
				setState({ error: String((e && e.message) || e), loadingDetail: false });
			});
		}
		function refresh() {
			loadSummary();
			if (store.selected) loadDetail(store.selected);
		}
		function refreshFromServer() {
			const session = store.currentSession;
			if (!session) return;
			apiSummary(session).then((v) => {
				const next = (v && v.files) || [];
				const cur = store.files || [];
				if (next.length !== cur.length) { setState({ files: next }); return; }
				for (let i = 0; i < next.length; i++) {
					const a = next[i];
					const b = cur[i];
					if (!b || a.path !== b.path || a.lastTime !== b.lastTime || a.ops !== b.ops) { setState({ files: next }); return; }
				}
			}).catch(() => {});
		}

		function connectEvents() {
			const es = new EventSource("/diff-review/events");
			es.onmessage = (e) => {
				let matches = true;
				try {
					const d = JSON.parse(e.data);
					if (d && d.session) matches = d.session === store.currentSession;
				} catch (err) {}
				if (matches) refreshFromServer();
			};
			return () => es.close();
		}

		function fmtTime(t) {
			if (!t) return "";
			const d = new Date(t);
			const p = (x) => String(x).padStart(2, "0");
			return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
		}

		// ── diff line rendering ────────────────────────────────────────────
		function Line({ h }) {
			const colors = useStore((s) => s.colors);
			let bg;
			let fg;
			let cls;
			if (h.type === "add") { bg = colors.addBg; fg = colors.addFg; cls = "drv-add"; }
			else if (h.type === "del") { bg = colors.delBg; fg = colors.delFg; cls = "drv-del"; }
			else { bg = colors.ctxBg; cls = "drv-ctx"; }
			return React.createElement("div", { className: "drv-line " + cls, style: { background: bg, color: fg } },
				React.createElement("span", { className: "drv-gutter", style: { color: colors.gutter } }, h.a != null ? String(h.a) : ""),
				React.createElement("span", { className: "drv-gutter drv-gutter-sign", style: { color: colors.gutter } }, h.type === "add" ? "+" : h.type === "del" ? "−" : " "),
				React.createElement("span", { className: "drv-gutter", style: { color: colors.gutter } }, h.b != null ? String(h.b) : ""),
				React.createElement("span", { className: "drv-text" }, h.text));
		}

		function Section({ section }) {
			const kindLabel = section.kind === "edit" ? "编辑" : "写入";
			const cls = section.kind === "edit" ? "drv-badge-edit" : "drv-badge-new";
			return React.createElement("div", { className: "drv-section" },
				React.createElement("div", { className: "drv-section-head" },
					React.createElement("span", { className: "drv-badge " + cls }, kindLabel),
					React.createElement("span", null, section.kind === "edit" ? "修改对比" : "文件内容（完整写入）"),
					React.createElement("span", { className: "drv-section-time" }, fmtTime(section.at)),
					section.truncated ? React.createElement("span", { className: "drv-section-time" }, "（内容过长已截断）") : null),
				React.createElement("div", { className: "drv-section-body" },
					section.hunks.map((h, i) => React.createElement(Line, { key: i, h }))));
		}

		const COLOR_ROWS = [
			["addBg", "新增行背景"], ["addFg", "新增行文字"],
			["delBg", "删除行背景"], ["delFg", "删除行文字"],
			["ctxBg", "上下文背景"], ["gutter", "行号 / 标记"],
			["badgeBg", "角标背景"], ["badgeFg", "角标文字"]
		];

		function ColorRows() {
			const colors = useStore((s) => s.colors);
			return COLOR_ROWS.map((row) => React.createElement("label", { key: row[0], className: "drv-color-row" },
				React.createElement("span", null, row[1]),
				React.createElement("input", {
					type: "color",
					value: colors[row[0]],
					onChange: (e) => setState({ colors: Object.assign({}, store.colors, { [row[0]]: e.target.value }) })
				})));
		}

		function PresetButtons() {
			return React.createElement("div", { className: "drv-presets" },
				React.createElement("button", { onClick: () => setState({ colors: Object.assign({}, LIGHT) }) }, "浅色预设"),
				React.createElement("button", { onClick: () => setState({ colors: Object.assign({}, DARK) }) }, "深色预设"),
				React.createElement("button", { onClick: () => setState({ colors: Object.assign({}, DEFAULTS) }) }, "恢复默认"));
		}

		function Detail() {
			const selected = useStore((s) => s.selected);
			const detail = useStore((s) => s.detail);
			const loading = useStore((s) => s.loadingDetail);
			const error = useStore((s) => s.error);
			if (loading) return React.createElement("div", { className: "drv-empty" }, "加载中…");
			if (error) return React.createElement("div", { className: "drv-empty" }, "出错：" + error);
			if (!selected) return React.createElement("div", { className: "drv-empty" }, "在左侧选择文件查看修改对比");
			if (!detail || !detail.sections || detail.sections.length === 0) return React.createElement("div", { className: "drv-empty" }, "该文件没有可展示的修改");
			return React.createElement("div", null, detail.sections.map((sec, i) => React.createElement(Section, { key: i, section: sec })));
		}

		function FileList() {
			const files = useStore((s) => s.files);
			const selected = useStore((s) => s.selected);
			const loading = useStore((s) => s.loadingFiles);
			if (loading) return React.createElement("div", { className: "drv-empty" }, "加载中…");
			if (!files || files.length === 0) return React.createElement("div", { className: "drv-empty" }, "暂无修改记录（进程内通过写入/编辑工具产生的文件修改会出现在这里）");
			return React.createElement("div", null,
				files.map((f) => {
					const cls = "drv-file" + (f.path === selected ? " drv-selected" : "");
					return React.createElement("button", { key: f.path, className: cls, onClick: () => loadDetail(f.path) },
						React.createElement("div", { className: "drv-file-name" }, f.name),
						React.createElement("div", { className: "drv-file-meta" },
							(f.writes > 0 ? "写入×" + f.writes + " " : "") + (f.edits > 0 ? "编辑×" + f.edits : ""),
							React.createElement("br", null),
							"~+" + f.added + " ~−" + f.removed));
				}));
		}

		function SessionProbe(props) {
			React.useEffect(() => {
				if (props.sessionId && store.currentSession !== props.sessionId) {
					// 会话切换：清空上一个会话的选中文件与详情预览，避免残留
					setState({ currentSession: props.sessionId, selected: null, detail: null });
					refreshFromServer();
				}
			}, [props.sessionId]);
			return null;
		}

		function TabLabel() {
			const files = useStore((s) => s.files);
			const colors = useStore((s) => s.colors);
			const count = files ? files.length : 0;
			return React.createElement("span", { className: "drv-tab-label" },
				React.createElement("span", null, "审查"),
				count > 0 ? React.createElement("span", {
					className: "drv-tab-badge",
					style: { background: colors.badgeBg, color: colors.badgeFg }
				}, String(count)) : null);
		}

		function ReviewView(props) {
			React.useEffect(() => {
				if (props.sessionId) setState({ currentSession: props.sessionId });
				loadSummary();
			}, []);
			const files = useStore((s) => s.files);
			const count = files ? files.length : 0;
			return React.createElement("div", { className: "drv-view" },
				React.createElement("div", { className: "drv-view-header" },
					React.createElement("span", { className: "drv-title" }, "修改审查"),
					React.createElement("span", { className: "drv-count" }, count + " 个文件"),
					React.createElement("span", { className: "drv-header-spacer" }),
					React.createElement("button", { className: "drv-btn", title: "刷新", onClick: refresh }, "↻"),
					React.createElement("button", {
						className: "drv-btn", title: "清空记录",
						onClick: () => { apiClear(store.currentSession).then(() => { setState({ files: [], detail: null, selected: null }); }); }
					}, "清空")),
				React.createElement("div", { className: "drv-view-body" },
					React.createElement("div", { className: "drv-filelist" }, React.createElement(FileList, null)),
					React.createElement("div", { className: "drv-detail" }, React.createElement(Detail, null))));
		}

		function SettingsPage() {
			return React.createElement("div", { className: "drv-settings-page" },
				React.createElement("p", { className: "drv-settings-desc" },
					"「修改审查」追踪进程内通过写入 / 编辑工具产生的文件修改，并在会话视图标签「审查」中展示修改对比。下方可自定义 diff 展示颜色与标签角标颜色，改动即时生效并自动保存（刷新页面后保留）："),
				React.createElement(ColorRows, null),
				React.createElement(PresetButtons, null));
		}

		// ── plugin ─────────────────────────────────────────────────────────
		const inject = ["slots"];
		const CSS = `
.drv-view { height:100%; display:flex; flex-direction:column; padding:12px 14px; box-sizing:border-box; font-size:13px; }
.drv-view-header { display:flex; align-items:center; gap:8px; padding:4px 0 10px; border-bottom:1px solid rgba(128,128,128,0.3); }
.drv-title { font-weight:600; }
.drv-count { opacity:0.7; font-size:12px; }
.drv-header-spacer { flex:1; }
.drv-btn { border:none; background:rgba(128,128,128,0.12); color:inherit; cursor:pointer; border-radius:6px; padding:4px 8px; font-size:12px; }
.drv-btn:hover { background:rgba(128,128,128,0.25); }
.drv-view-body { flex:1; display:flex; min-height:0; margin-top:10px; border:1px solid rgba(128,128,128,0.3); border-radius:8px; overflow:hidden; }
.drv-filelist { width:250px; border-right:1px solid rgba(128,128,128,0.3); overflow:auto; flex-shrink:0; padding:6px 0; }
.drv-file { display:block; width:100%; padding:8px 10px; cursor:pointer; border:none; background:transparent; color:inherit; text-align:left; font-family:inherit; font-size:12.5px; }
.drv-file:hover { background:rgba(128,128,128,0.12); }
.drv-file.drv-selected { background:rgba(80,120,255,0.18); }
.drv-file-name { font-weight:500; word-break:break-all; }
.drv-file-meta { font-size:11px; opacity:0.75; margin-top:2px; }
.drv-detail { flex:1; overflow:auto; padding:10px; }
.drv-section { margin-bottom:12px; border:1px solid rgba(128,128,128,0.35); border-radius:6px; overflow:hidden; }
.drv-section-head { padding:6px 10px; font-weight:600; background:rgba(128,128,128,0.1); display:flex; gap:8px; align-items:center; }
.drv-section-time { font-weight:400; opacity:0.7; font-size:11px; }
.drv-badge { display:inline-block; padding:0 6px; border-radius:8px; font-size:10px; font-weight:600; }
.drv-badge-new { background:rgba(46,160,67,0.22); color:#1a7f37; }
.drv-badge-edit { background:rgba(9,105,218,0.16); color:#0969da; }
.drv-line { display:flex; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.55; white-space:pre-wrap; word-break:break-all; }
.drv-gutter { flex:0 0 42px; text-align:right; padding:0 6px; user-select:none; opacity:0.9; }
.drv-gutter-sign { flex:0 0 18px; text-align:center; padding:0 2px; }
.drv-text { flex:1; padding:0 6px; }
.drv-empty { padding:24px; text-align:center; opacity:0.6; }
.drv-settings { border-top:1px solid rgba(128,128,128,0.3); padding:6px 0 0; margin-top:10px; }
.drv-settings-toggle { border:none; background:transparent; color:inherit; cursor:pointer; font-size:12px; padding:4px 0; }
.drv-settings-body { margin-top:6px; }
.drv-color-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:3px 0; font-size:12px; }
.drv-color-row input[type=color] { width:44px; height:24px; border:none; border-radius:4px; padding:0; background:transparent; cursor:pointer; }
.drv-presets { display:flex; gap:6px; margin-top:8px; }
.drv-presets button { border:1px solid rgba(128,128,128,0.4); background:transparent; color:inherit; cursor:pointer; border-radius:6px; padding:3px 8px; font-size:11px; }
.drv-presets button:hover { background:rgba(128,128,128,0.15); }
.drv-settings-page { padding:16px; font-size:13px; }
.drv-settings-desc { opacity:0.7; margin:0 0 14px; line-height:1.6; }
.drv-tab-label { display:inline-flex; align-items:center; gap:6px; }
.drv-tab-badge { display:inline-block; border-radius:8px; padding:0 5px; font-size:10px; line-height:14px; font-weight:600; min-width:16px; text-align:center; }
`;
		function apply(ctx) {
			ctx.effect(() => {
				const el = document.createElement("style");
				el.textContent = CSS;
				document.head.appendChild(el);
				return () => el.remove();
			}, "diff-review: styles");
			refreshFromServer();
			ctx.effect(connectEvents, "diff-review: live events");
			ctx.slots.inject("conversation.view", () => ctx.slots.register(
				{ name: "conversation.view", id: "review", order: 5, label: () => React.createElement(TabLabel, null) },
				(props) => React.createElement(ReviewView, props)));
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register(
				{ name: "conversation.session.header.actions", id: "diff-review-session", order: 100 },
				(props) => React.createElement(SessionProbe, props)));
			ctx.slots.inject("settings.section", () => ctx.slots.register(
				{ name: "settings.section", id: "diff-review", order: 25, label: "修改审查" },
				(props) => React.createElement(SettingsPage, props)));
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
				{ name: "sidebar.footer.action", id: "diff-review" },
				() => null));
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
