window.__ModuleLoader__.load({
	id: "dsh-change-review",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		// 临时开关：屏蔽“编辑器检测/选择”全系功能（编辑器选择器 UI、/diff-review/editors、
		// open-with-editor、reveal、editor-icon 请求），仅保留“系统默认编辑器打开文件”。
		// 与服务端 lib/index.js 的 EDITOR_FEATURES_DISABLED 成对使用；旧代码保留。
		const EDITOR_FEATURES_DISABLED = true;

		// ── color configuration (persisted to localStorage) ────────────────
		const LS_KEY = "dsh.diff-review.colors";
		const LIGHT = { addBg: "#e6ffec", addFg: "#1a7f37", delBg: "#ffebe9", delFg: "#cf222e", ctxBg: "#f6f8fa", gutter: "#57606a", badgeBg: "#0969da", badgeFg: "#ffffff", turnAdd: "#1a7f37", turnDel: "#cf222e", turnBg: "rgba(255, 183, 77, 0.1)", turnBorder: "#ffb74d" };
		const DARK = { addBg: "#10251c", addFg: "#7ee787", delBg: "#2d1415", delFg: "#ffa198", ctxBg: "#161b22", gutter: "#8b949e", badgeBg: "#4493f8", badgeFg: "#0d1117", turnAdd: "#7ee787", turnDel: "#ffa198", turnBg: "rgba(255, 183, 77, 0.1)", turnBorder: "#ffb74d" };
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
					const parsed = parseColor(obj[k]);
					if (parsed) {
						out[k] = formatRgba(parsed);
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

		// ── color value helpers (hex #rrggbb and rgba(r,g,b,a) both supported) ──
		function parseColor(v) {
			if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) {
				return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16), a: 1 };
			}
			if (typeof v === "string") {
				const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+)\s*)?\)$/);
				if (m) {
					const a = m[4] === undefined ? 1 : Number(m[4]);
					return {
						r: Math.min(255, Math.max(0, parseInt(m[1], 10))),
						g: Math.min(255, Math.max(0, parseInt(m[2], 10))),
						b: Math.min(255, Math.max(0, parseInt(m[3], 10))),
						a: Math.min(1, Math.max(0, a))
					};
				}
			}
			return null;
		}
		function formatRgba(c) {
			return "rgba(" + c.r + ", " + c.g + ", " + c.b + ", " + (Math.round(c.a * 100) / 100) + ")";
		}
		function hexOf(c) {
			const pad = (n) => n.toString(16).padStart(2, "0");
			return "#" + pad(c.r) + pad(c.g) + pad(c.b);
		}

		// ── shared store ───────────────────────────────────────────────────
		const EDITOR_LS_KEY = "dsh.diff-review.editor";
		const store = {
			files: null, loadingFiles: false,
			selected: null, detail: null, loadingDetail: false, error: null,
			colors: Object.assign({}, DEFAULTS), currentSession: null,
			mode: "session", latestTurn: 0, turnData: null,
			mobilePane: "list",
			editors: [], editorLoading: false, selectedEditor: null
		};
		{
			const savedColors = loadSavedColors();
			if (savedColors) store.colors = savedColors;
			try {
				const ed = localStorage.getItem(EDITOR_LS_KEY);
				if (ed) store.selectedEditor = JSON.parse(ed);
			} catch (e) {}
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

		// ── fetch sequencing: every async load stamps a token; a stale response
		// (previous session / superseded file) is dropped instead of clobbering the UI
		let reqSeq = 0

		// ── host file-open helper (chat's openFile equivalent, built from ctx).
		// If the user picked an editor in the header chooser, open through the
		// Host's /diff-review/open-with-editor route; otherwise OS default.
		let ctxRef = null
		let rtApi = null
		try { rtApi = require("@deepseek-ai/dsh-client-runtime/client"); } catch (e) { rtApi = null; }
		function resolveAbsPath(sessionId, path, cwd) {
			try {
				if (!ctxRef) return path
				// Use the provided cwd (from file data) first, then fall back to session's current cwd
				if (!cwd && ctxRef.sessions && ctxRef.sessions.list) {
					const byId = ctxRef.sessions.list.getSnapshot().byId
					cwd = byId && byId[sessionId] && byId[sessionId].cwd
				}
				if (rtApi && rtApi.resolveWorkspacePath) return rtApi.resolveWorkspacePath(cwd, path)
				if (cwd && typeof path === "string" && !path.startsWith("/") && !/^[a-zA-Z]:[\/]/.test(path)) {
					return cwd.replace(/[\/]+$/, "") + "/" + path.replace(/^[\/]+/, "")
				}
				return path
			} catch (e) { return path }
		}
		function openFileFor(sessionId, path, cwd) {
			try {
				if (!ctxRef) return
				const abs = resolveAbsPath(sessionId, path, cwd)
				// 已屏蔽编辑器选择：始终走系统默认编辑器（宿主 workspaces.openPath）。
				const ed = EDITOR_FEATURES_DISABLED ? null : store.selectedEditor
				if (ed && ed.id) {
					apiOpenWithEditor(ed.id, abs).then((v) => {
						if (!(v && v.ok)) openViaWorkspace(abs)
					}).catch(() => openViaWorkspace(abs))
					return
				}
				openViaWorkspace(abs)
			} catch (e) {}
		}
		function openViaWorkspace(abs) {
			try {
				if (ctxRef && ctxRef.workspaces && ctxRef.workspaces.openPath && abs) {
					ctxRef.workspaces.openPath(abs).catch(() => {})
				}
			} catch (e) {}
		}

		// ── host data via HTTP routes ──────────────────────────────────────
		function apiSummary(session) { return fetch("/diff-review/summary?session=" + encodeURIComponent(session)).then((r) => r.json()); }
		function apiFile(session, path) { return fetch("/diff-review/file?session=" + encodeURIComponent(session) + "&path=" + encodeURIComponent(path)).then((r) => r.json()); }
		function apiClear(session) { return fetch("/diff-review/clear?session=" + encodeURIComponent(session), { method: "POST" }).then((r) => r.json()); }
		function apiRevert(session, path, op) {
			return fetch("/diff-review/revert?session=" + encodeURIComponent(session), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: path, op: op === undefined ? null : op })
			}).then((r) => r.json());
		}
		function apiTurn(session, turn) {
			return fetch("/diff-review/turn?session=" + encodeURIComponent(session) + "&turn=" + encodeURIComponent(String(turn))).then((r) => r.json());
		}
		function apiEditors() { return fetch("/diff-review/editors").then((r) => r.json()); }
		function apiOpenWithEditor(editor, path, line, col) {
			return fetch("/diff-review/open-with-editor", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ editor, path, line: line || null, col: col || null })
			}).then((r) => r.json());
		}
		function apiReveal(path) {
			return fetch("/diff-review/reveal", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path })
			}).then((r) => r.json());
		}
		function revealInFinderFor(sessionId, path, cwd) {
			const abs = resolveAbsPath(sessionId, path, cwd);
			apiReveal(abs).catch(() => {});
		}
		function loadEditors() {
			if (EDITOR_FEATURES_DISABLED) return; // 已屏蔽：不请求 /diff-review/editors
			setState({ editorLoading: true });
			apiEditors().then((v) => {
				const editors = (v && v.editors) || [];
				// Never overwrite selectedEditor — it's persisted from localStorage
				// and only changed by the user's explicit selection via selectEditor().
				setState({ editors, editorLoading: false });
			}).catch(() => {
				setState({ editorLoading: false });
			});
		}
		function selectEditor(ed) {
			setState({ selectedEditor: ed });
			try {
				if (ed && ed.id) localStorage.setItem(EDITOR_LS_KEY, JSON.stringify({ id: ed.id, name: ed.name }));
				else localStorage.removeItem(EDITOR_LS_KEY);
			} catch (e) {}
		}

		function loadSummary() {
			const session = store.currentSession;
			if (!session) return;
			const seq = ++reqSeq;
			setState({ loadingFiles: true, error: null });
			apiSummary(session).then((v) => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				setState({ files: (v && v.files) || [], latestTurn: (v && typeof v.latestTurn === "number") ? v.latestTurn : 0, loadingFiles: false });
				if (store.mode === "latest") loadLatest();
			}).catch((e) => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				setState({ error: String((e && e.message) || e), loadingFiles: false });
			});
		}
		// Latest-turn view: files + sections for the most recent recorded turn.
		function loadLatest() {
			const session = store.currentSession;
			const turn = store.latestTurn;
			if (!session || !turn) { setState({ turnData: null }); return; }
			const seq = ++reqSeq;
			apiTurn(session, turn).then((v) => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				setState({ turnData: (v && v.files) ? v : null });
			}).catch(() => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				setState({ turnData: null });
			});
		}
		function setMode(mode) {
			setState({ mode: mode, selected: null, detail: null, mobilePane: "list" });
			if (mode === "latest") loadLatest();
		}
		// Select a file: latest mode shows the turn payload's inline sections.
		function selectFile(f) {
			if (store.mode === "latest") {
				setState({
					selected: f.path,
					detail: { path: f.path, sections: (f && f.sections) || [], revertible: !!(f && f.revertible) },
					loadingDetail: false,
					error: null,
					mobilePane: "detail"
				});
			} else {
				loadDetail(f.path);
				setState({ mobilePane: "detail" });
			}
		}
		function loadDetail(path) {
			const session = store.currentSession;
			if (!session) return;
			const seq = ++reqSeq;
			setState({ selected: path, detail: null, loadingDetail: true, error: null });
			apiFile(session, path).then((v) => {
				if (seq !== reqSeq || store.currentSession !== session || store.selected !== path) return;
				setState({ detail: v, loadingDetail: false });
			}).catch((e) => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				setState({ error: String((e && e.message) || e), loadingDetail: false });
			});
		}
		function refresh() {
			loadSummary();
			if (store.mode === "latest") { loadLatest(); return; }
			if (store.selected) loadDetail(store.selected);
		}
		function refreshFromServer() {
			const session = store.currentSession;
			if (!session) return;
			const seq = ++reqSeq;
			apiSummary(session).then((v) => {
				if (seq !== reqSeq || store.currentSession !== session) return;
				const next = (v && v.files) || [];
				const latestTurn = (v && typeof v.latestTurn === "number") ? v.latestTurn : 0;
				const cur = store.files;
				const hadFiles = cur !== null;
				const curList = cur || [];
				let changed = !hadFiles || next.length !== curList.length;
				if (!changed && hadFiles) {
					for (let i = 0; i < next.length; i++) {
						const a = next[i];
						const b = curList[i];
						if (!b || a.path !== b.path || a.lastTime !== b.lastTime || a.ops !== b.ops) { changed = true; break; }
					}
				}
				if (changed || latestTurn !== store.latestTurn) {
					setState({ files: next, latestTurn: latestTurn, loadingFiles: false });
					if (store.mode === "latest") loadLatest();
				} else if (!hadFiles) {
					setState({ files: [], loadingFiles: false });
				}
			}).catch(() => {});
		}

		function connectEvents() {
			const es = new EventSource("/diff-review/events");
			es.onopen = () => {
				// 重连后重新同步，避免重连期间丢失的变更造成角标/列表不一致
				if (store.currentSession) refreshFromServer();
			};
			es.onmessage = (e) => {
				let matches = true;
				try {
					const d = JSON.parse(e.data);
					if (d && d.session) matches = d.session === store.currentSession;
				} catch (err) {}
				if (matches) refreshFromServer();
			};
			es.onerror = () => {
				// EventSource 会自动重连，onopen 时会重新同步
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

		function Section({ section, onRevert, busy }) {
			const kindLabel = section.kind === "edit" ? "编辑" : "写入";
			const cls = section.kind === "edit" ? "drv-badge-edit" : "drv-badge-new";
			return React.createElement("div", { className: "drv-section" },
				React.createElement("div", { className: "drv-section-head" },
					React.createElement("span", { className: "drv-badge " + cls }, kindLabel),
					React.createElement("span", null, section.kind === "edit" ? "修改对比" : "文件内容（完整写入）"),
					React.createElement("span", { className: "drv-section-time" }, fmtTime(section.at)),
					section.truncated ? React.createElement("span", { className: "drv-section-time" }, "（内容过长已截断）") : null,
					React.createElement("span", { className: "drv-header-spacer" }),
					section.canUndo ? React.createElement("button", {
						className: "drv-btn drv-btn-revert",
						title: "撤回该项修改：文件恢复到该项修改之前的内容，其后无冲突的修改保留",
						disabled: busy,
						onClick: () => onRevert(section.opIndex)
					}, "撤回此项") : null),
				React.createElement("div", { className: "drv-section-body" },
					section.hunks.map((h, i) => React.createElement(Line, { key: i, h }))));
		}

		const COLOR_ROWS = [
			["addBg", "新增行背景"], ["addFg", "新增行文字"],
			["delBg", "删除行背景"], ["delFg", "删除行文字"],
			["ctxBg", "上下文背景"], ["gutter", "行号 / 标记"],
			["badgeBg", "角标背景"], ["badgeFg", "角标文字"],
			["turnAdd", "新增行数（对话底部）"], ["turnDel", "删除行数（对话底部）"],
			["turnBg", "背景色（对话底部）"], ["turnBorder", "边框色（对话底部）"]
		];

		function ColorRows() {
			const colors = useStore((s) => s.colors);
			return COLOR_ROWS.map((row) => {
				const key = row[0];
				const parsed = parseColor(colors[key]) || { r: 128, g: 128, b: 128, a: 1 };
				return React.createElement("label", { key: key, className: "drv-color-row" },
					React.createElement("span", null, row[1]),
					React.createElement("div", { className: "drv-color-controls" },
						React.createElement("input", {
							type: "color",
							value: hexOf(parsed),
							onChange: (e) => setState({ colors: Object.assign({}, store.colors, { [key]: formatRgba(Object.assign({}, parsed, parseColor(e.target.value))) }) })
						}),
						React.createElement("input", {
							type: "range",
							min: 0,
							max: 100,
							value: Math.round(parsed.a * 100),
							title: "透明度",
							onChange: (e) => setState({ colors: Object.assign({}, store.colors, { [key]: formatRgba(Object.assign({}, parsed, { a: Number(e.target.value) / 100 })) }) })
						}),
						React.createElement("span", { className: "drv-color-alpha" }, Math.round(parsed.a * 100) + "%"))
				);
			});
		}

		function PresetButtons() {
			return React.createElement("div", { className: "drv-presets" },
				React.createElement("button", { onClick: () => setState({ colors: Object.assign({}, LIGHT) }) }, "浅色预设"),
				React.createElement("button", { onClick: () => setState({ colors: Object.assign({}, DARK) }) }, "深色预设"),
				React.createElement("button", { onClick: () => setState({ colors: Object.assign({}, DEFAULTS) }) }, "恢复默认"));
		}

		function Detail({ onRevert, onRevertAll, busy }) {
			const selected = useStore((s) => s.selected);
			const detail = useStore((s) => s.detail);
			const loading = useStore((s) => s.loadingDetail);
			const error = useStore((s) => s.error);
			if (loading) return React.createElement("div", { className: "drv-empty" }, "加载中…");
			if (error) return React.createElement("div", { className: "drv-empty" }, "出错：" + error);
			if (!selected) return React.createElement("div", { className: "drv-empty" }, "在左侧选择文件查看修改对比");
			if (!detail || !detail.sections || detail.sections.length === 0) return React.createElement("div", { className: "drv-empty" }, "该文件没有可展示的修改");
			return React.createElement("div", null,
				React.createElement("div", { className: "drv-detail-toolbar" },
					React.createElement("button", { type: "button", className: "drv-btn drv-back-btn", title: "返回文件列表", onClick: () => setState({ mobilePane: "list" }) }, "← 文件列表"),
					React.createElement("span", { className: "drv-detail-path", title: detail.path }, detail.path),
					React.createElement("span", { className: "drv-header-spacer" }),
					React.createElement("button", {
						className: "drv-btn drv-btn-revert drv-btn-danger",
						title: "撤回该文件的全部修改：恢复到本次会话首次修改之前的内容（会话中新建的文件将被删除）",
						disabled: busy || detail.revertible !== true,
						onClick: onRevertAll
					}, "撤回全部修改")),
				detail.sections.map((sec, i) => React.createElement(Section, { key: i, section: sec, onRevert: onRevert, busy: busy })));
		}

		// ── directory tree grouping for the review-pane file list ──────────────────
		// ── context menu (right-click on file rows) ──────────────────────────────
		function CtxMenu({ menu, onClose }) {
			React.useEffect(() => {
				if (!menu) return;
				const handleClick = () => onClose();
				const handleKey = (e) => { if (e.key === "Escape") onClose(); };
				window.addEventListener("click", handleClick);
				window.addEventListener("contextmenu", handleClick);
				window.addEventListener("scroll", handleClick, true);
				window.addEventListener("keydown", handleKey);
				return () => {
					window.removeEventListener("click", handleClick);
					window.removeEventListener("contextmenu", handleClick);
					window.removeEventListener("scroll", handleClick, true);
					window.removeEventListener("keydown", handleKey);
				};
			}, [!!menu, onClose]);
			if (!menu) return null;
			return React.createElement("div", {
				className: "drv-ctx-menu",
				style: { left: Math.min(menu.x, window.innerWidth - 150), top: Math.min(menu.y, window.innerHeight - 80) },
				onClick: (e) => e.stopPropagation()
			}, (menu.items || []).map((it, i) =>
				React.createElement("button", { key: i, className: "drv-ctx-menu-item", onClick: () => { it.run(); onClose(); } }, it.label)));
		}

		function FileList({ openFile }) {
			const mode = useStore((s) => s.mode);
			const files = useStore((s) => s.files);
			const turnData = useStore((s) => s.turnData);
			const selected = useStore((s) => s.selected);
			const loading = useStore((s) => s.loadingFiles);
			const list = mode === "latest" ? (turnData && turnData.files) || [] : (files || []);
			const [menu, setMenu] = React.useState(null);
			if (loading) return React.createElement("div", { className: "drv-empty" }, "加载中…");
			if (!list || list.length === 0) {
				return React.createElement("div", { className: "drv-empty" },
					mode === "latest"
						? "最新一轮没有可展示的修改（该轮无写入/编辑，或记录没有轮次标记）"
						: "暂无修改记录（进程内通过写入/编辑工具产生的文件修改会出现在这里）");
			}
			const fileRow = (f) => {
				const cls = "drv-file" + (f.path === selected ? " drv-selected" : "");
				return React.createElement("button", {
					key: f.path || f.name, className: cls,
					onClick: () => selectFile(f),
					onContextMenu: (e) => {
						e.preventDefault(); e.stopPropagation();
						setMenu({ x: e.clientX, y: e.clientY, items: [
							{ label: "打开文件", run: () => { if (openFile) openFile(f.path, f.cwd); } },
							...(EDITOR_FEATURES_DISABLED ? [] : [{ label: "在 Finder 中展示", run: () => { const sid = store.currentSession; if (sid) revealInFinderFor(sid, f.path, f.cwd); } }])
						]});
					}
				},
					React.createElement("span", { className: "drv-file-name" }, f.name),
					React.createElement("span", { className: "drv-file-meta" },
						(f.writes > 0 ? "写入×" + f.writes + " " : "") + (f.edits > 0 ? "编辑×" + f.edits : ""),
						"  ~+" + f.added + " ~−" + f.removed));
			};
			return React.createElement("div", null,
				list.map(fileRow),
				React.createElement(CtxMenu, { menu, onClose: () => setMenu(null) }));
		}

		function SessionProbe(props) {
			React.useEffect(() => {
				if (props.sessionId && store.currentSession !== props.sessionId) {
					reqSeq++; // 丢弃上一个会话仍在途的请求
					setState({ currentSession: props.sessionId, files: null, selected: null, detail: null, mode: "session", turnData: null, latestTurn: 0, error: null, loadingFiles: true, mobilePane: "list" });
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

		function TurnReview({ matched, sessionId, turn: turnLoc, seq, openFile }) {
			const colors = useStore((s) => s.colors);
			const turnNo = matched && matched.turn;
			const [data, setData] = React.useState(null);
			const [expanded, setExpanded] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [menu, setMenu] = React.useState(null);
			React.useEffect(() => {
				let alive = true;
				setData(null);
				if (sessionId && turnNo != null) {
					apiTurn(sessionId, turnNo).then((v) => {
						if (alive) setData(v);
					}).catch(() => {
						if (alive) setData(null);
					});
				}
				return () => { alive = false; };
			}, [sessionId, turnNo]);
			// This entry wins the turnTail chain, so re-render the shipped
			// "produced files" chips from the deliverables turn data to avoid
			// shadowing that built-in feature.
			const produced = [];
			try {
				const dv = turnLoc && turnLoc.data ? turnLoc.data.get("deliverables") : null;
				if (dv && dv.produced) {
					const seen = new Set();
					for (const item of dv.produced) {
						if (item && typeof item.path === "string" && item.seq <= seq && !seen.has(item.path)) {
							seen.add(item.path);
							produced.push(item.path);
						}
					}
				}
			} catch (e) {}
			const hasFiles = data && data.files && data.files.length > 0;
			if (!hasFiles && produced.length === 0) return null;
			const revertOp = (filePath, opIndex) => {
				if (!sessionId || !filePath) return;
				if (!window.confirm("确定撤回该项修改？此操作会直接改写磁盘上的文件，且不可撤销。")) return;
				setBusy(true);
				apiRevert(sessionId, filePath, opIndex).then((v) => {
					if (v && v.ok) {
						apiTurn(sessionId, turnNo).then((nv) => { if (nv) setData(nv); }).catch(() => {});
						refreshFromServer();
					} else {
						window.alert("撤回失败：" + ((v && v.error) || "未知错误"));
					}
				}).catch((e) => {
					window.alert("撤回失败：" + String((e && e.message) || e));
				}).finally(() => setBusy(false));
			};
			const showCtx = (e, path, cwd) => {
				e.preventDefault(); e.stopPropagation();
				setMenu({ x: e.clientX, y: e.clientY, items: [
					{ label: "打开文件", run: () => { if (sessionId) openFileFor(sessionId, path, cwd); } },
					...(EDITOR_FEATURES_DISABLED ? [] : [{ label: "在 Finder 中展示", run: () => { if (sessionId) revealInFinderFor(sessionId, path, cwd); } }])
				]});
			};
			return React.createElement("div", { className: "drv-turn", style: { background: colors.turnBg, borderColor: colors.turnBorder } },
				React.createElement(CtxMenu, { menu, onClose: () => setMenu(null) }),
				produced.length > 0 ? React.createElement("div", { className: "drv-turn-produced" },
					React.createElement("span", { className: "drv-turn-produced-label" }, "产物"),
					produced.map((path) => React.createElement("button", {
						type: "button",
						key: path,
						className: "drv-turn-produced-chip",
						title: path,
						onClick: () => { if (sessionId) openFileFor(sessionId, path, null); },
						onContextMenu: (e) => showCtx(e, path, null)
					}, String(path).split('/').pop()))) : null,
				hasFiles ? React.createElement(React.Fragment, null,
					React.createElement("div", { className: "drv-turn-head" },
						React.createElement("span", { className: "drv-turn-title" }, "本轮变更审查"),
						React.createElement("span", { className: "drv-count" }, data.files.length + " 个文件"),
						React.createElement("span", { className: "drv-header-spacer" }),
						React.createElement("span", { className: "drv-turn-hint" }, "会话累计变更见「审查」标签")),
					data.files.map((f) => {
						const open = expanded === f.path;
						return React.createElement("div", { key: f.path, className: "drv-turn-file" },
							React.createElement("button", {
								type: "button",
								className: "drv-turn-file-head",
								onClick: () => setExpanded(open ? null : f.path),
								onContextMenu: (e) => showCtx(e, f.path, f.cwd)
							},
								React.createElement("span", { className: "drv-turn-file-name" }, f.name),
								React.createElement("span", { className: "drv-file-meta" },
									(f.writes > 0 ? "写入×" + f.writes + " " : "") + (f.edits > 0 ? "编辑×" + f.edits : ""),
									React.createElement("span", { style: { color: colors.turnAdd } }, "  ~+" + f.added),
									React.createElement("span", { style: { color: colors.turnDel } }, "  ~−" + f.removed)),
								React.createElement("span", { className: "drv-header-spacer" }),
								React.createElement("span", { className: "drv-turn-chevron" }, open ? "▾" : "▸")),
							open ? React.createElement("div", { className: "drv-turn-file-body" },
								f.sections.map((sec, i) => React.createElement(Section, {
									key: i, section: sec,
									onRevert: (opIndex) => revertOp(f.path, opIndex),
									busy: busy
								}))) : null);
					})) : null);
		}

		function ReviewView(props) {
			React.useEffect(() => {
				if (props.sessionId) {
					if (store.currentSession !== props.sessionId) {
						reqSeq++;
						setState({ currentSession: props.sessionId, files: null, selected: null, detail: null, mode: "session", turnData: null, latestTurn: 0, error: null, loadingFiles: true, mobilePane: "list" });
					}
					loadSummary();
				}
			}, [props.sessionId]);
			const files = useStore((s) => s.files);
			const mode = useStore((s) => s.mode);
			const turnData = useStore((s) => s.turnData);
			const pane = useStore((s) => s.mobilePane);
			const count = mode === "latest" ? (((turnData && turnData.files) || []).length) : (files ? files.length : 0);
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState(null);
			const noticeTimer = React.useRef(null);
			const showNotice = (msg) => {
				setNotice(msg);
				if (noticeTimer.current) clearTimeout(noticeTimer.current);
				noticeTimer.current = setTimeout(() => setNotice(null), 4000);
			};
			React.useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
			const doRevert = (op) => {
				const session = store.currentSession;
				const path = store.selected;
				if (!session || !path) return;
				const what = op === null ? "该文件的全部修改" : "该项修改";
				if (!window.confirm("确定撤回" + what + "？此操作会直接改写磁盘上的文件，且不可撤销。")) return;
				setBusy(true);
				apiRevert(session, path, op).then((v) => {
					if (v && v.ok) {
						showNotice(v.message || "已撤回");
						if (op === null) setState({ selected: null, detail: null, mobilePane: "list" });
						refresh();
					} else {
						window.alert("撤回失败：" + ((v && v.error) || "未知错误"));
					}
				}).catch((e) => {
					window.alert("撤回失败：" + String((e && e.message) || e));
				}).finally(() => setBusy(false));
			};
			const revertOp = (opIndex) => doRevert(opIndex);
			const revertAll = () => doRevert(null);
			return React.createElement("div", { className: "drv-view" },
				React.createElement("div", { className: "drv-view-header" },
					React.createElement("span", { className: "drv-title" }, "修改审查"),
					React.createElement("span", { className: "drv-count" }, (mode === "latest" ? "最新一轮 · " : "") + count + " 个文件"),
					React.createElement("div", { className: "drv-mode", role: "group" },
						React.createElement("button", {
							className: "drv-mode-btn" + (mode === "session" ? " drv-mode-active" : ""),
							onClick: () => setMode("session")
						}, "此会话"),
						React.createElement("button", {
							className: "drv-mode-btn" + (mode === "latest" ? " drv-mode-active" : ""),
							onClick: () => setMode("latest")
						}, "最新一轮")),
					React.createElement("span", { className: "drv-header-spacer" }),
					notice ? React.createElement("span", { className: "drv-notice" }, notice) : null,
					React.createElement("button", { className: "drv-btn", title: "刷新", onClick: refresh }, "↻"),
					React.createElement("button", {
						className: "drv-btn", title: "清空记录",
						onClick: () => { apiClear(store.currentSession).then(() => { setState({ files: [], detail: null, selected: null, turnData: null, latestTurn: 0, mobilePane: "list" }); }); }
					}, "清空")),
				React.createElement("div", { className: "drv-view-body drv-pane-" + pane },
					React.createElement("div", { className: "drv-filelist" }, React.createElement(FileList, { openFile: props.openFile })),
					React.createElement("div", { className: "drv-detail" }, React.createElement(Detail, { onRevert: revertOp, onRevertAll: revertAll, busy: busy }))));
		}

		function SettingsPage() {
			return React.createElement("div", { className: "drv-settings-page" },
				React.createElement("p", { className: "drv-settings-desc" },
					"「修改审查」追踪进程内通过写入 / 编辑工具产生的文件修改，并在会话视图标签「审查」中展示修改对比。下方可自定义 diff 展示颜色与标签角标颜色，改动即时生效并自动保存（刷新页面后保留）："),
				React.createElement(ColorRows, null),
				React.createElement(PresetButtons, null));
		}

		// ── editor picker: choose the default code editor for「打开文件」 ──────
		function EditorIcon({ id, size }) {
			return React.createElement("img", {
				src: "/diff-review/editor-icon/" + encodeURIComponent(id),
				style: { width: size || 16, height: size || 16, verticalAlign: "middle", borderRadius: 3, flexShrink: 0 },
				alt: "",
				onError: (e) => { e.target.style.display = "none"; }
			});
		}
		function EditorPicker(props) {
			const editors = useStore((s) => s.editors);
			const editorLoading = useStore((s) => s.editorLoading);
			const selectedEditor = useStore((s) => s.selectedEditor);
			const [open, setOpen] = React.useState(false);
			const rootRef = React.useRef(null);
			React.useEffect(() => { loadEditors(); }, []);
			React.useEffect(() => {
				if (!open) return;
				const onDoc = (e) => {
					if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
				};
				document.addEventListener("mousedown", onDoc, true);
				document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); }, true);
				return () => {
					document.removeEventListener("mousedown", onDoc, true);
					document.removeEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); }, true);
				};
			}, [open]);
			const detected = (editors || []).filter((e) => e.detected);
			const label = selectedEditor ? "用" + selectedEditor.name + "打开" : "编辑器";
			return React.createElement("div", { className: "drv-editor", ref: rootRef },
				React.createElement("button", {
					type: "button",
					className: "drv-editor-btn",
					title: selectedEditor ? "当前默认编辑器：" + selectedEditor.name + "（点击更换）" : "选择打开文件时使用的代码编辑器",
					onClick: () => setOpen(!open)
				},
					React.createElement("span", { className: "drv-editor-label" },
						editorLoading ? "检测中…" : (selectedEditor ? React.createElement(React.Fragment, null,
							React.createElement(EditorIcon, { id: selectedEditor.id, size: 16 }),
							" " + label) : label)),
					React.createElement("span", { className: "drv-editor-caret" }, open ? "▴" : "▾")),
				open ? React.createElement("div", { className: "drv-editor-menu" },
					detected.length === 0 ? React.createElement("div", { className: "drv-editor-empty" }, "未检测到已安装的代码编辑器") : null,
					React.createElement("button", {
						type: "button",
						className: "drv-editor-opt" + (!selectedEditor ? " drv-editor-opt-active" : ""),
						onClick: () => { selectEditor(null); setOpen(false); }
					}, "系统默认"),
					detected.map((ed) => React.createElement("button", {
						type: "button",
						key: ed.id,
						className: "drv-editor-opt" + (selectedEditor && selectedEditor.id === ed.id ? " drv-editor-opt-active" : ""),
						style: { display: "flex", alignItems: "center", gap: 6 },
						onClick: () => { selectEditor(ed); setOpen(false); }
					},
						React.createElement(EditorIcon, { id: ed.id, size: 16 }),
						React.createElement("span", null, ed.name)))) : null);
		}

		// ── better-sidebar tab 图标：两栏 diff 字形，与内置图标同风格
		//（16×16、1.5/1.25px 描边、currentColor；区别于内置 diff tab 的单加单减布局）──
		function ReviewTabIcon(props) {
			return React.createElement("svg", { width: props.size, height: props.size, viewBox: "0 0 16 16", fill: "none" },
				React.createElement("rect", { x: 1.5, y: 1.5, width: 13, height: 13, rx: 2.5, stroke: "currentColor", strokeWidth: 1.5 }),
				React.createElement("path", { d: "M8 3.5v9", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
				React.createElement("path", { d: "M4.25 6.5h2.5M5.5 5.25v2.5", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round" }),
				React.createElement("path", { d: "M9.5 9.5h2.5", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round" }));
		}

		// ── plugin ─────────────────────────────────────────────────────────
		const inject = ["slots"];
		const CSS = `
.drv-view { flex:1 1 0; min-height:0; overflow:hidden; display:flex; flex-direction:column; padding:12px 14px; box-sizing:border-box; font-size:13px; }
.drv-view-header { display:flex; align-items:center; gap:8px; padding:4px 0 10px; border-bottom:1px solid rgba(128,128,128,0.3); }
.drv-title { font-weight:600; }
.drv-count { opacity:0.7; font-size:12px; }
.drv-header-spacer { flex:1; }
.drv-btn { border:none; background:rgba(128,128,128,0.12); color:inherit; cursor:pointer; border-radius:6px; padding:4px 8px; font-size:12px; }
.drv-btn:hover { background:rgba(128,128,128,0.25); }
.drv-view-body { flex:1; display:flex; min-height:0; margin-top:10px; border:1px solid rgba(128,128,128,0.3); border-radius:8px; overflow:hidden; }
.drv-filelist { width:250px; border-right:1px solid rgba(128,128,128,0.3); overflow:auto; overscroll-behavior:contain; flex-shrink:0; padding:6px 0; }
.drv-file { display:flex; align-items:center; gap:6px; width:100%; padding:6px 10px; cursor:pointer; border:none; background:transparent; color:inherit; text-align:left; font-family:inherit; font-size:12.5px; }
.drv-file:hover { background:rgba(128,128,128,0.12); }
.drv-file.drv-selected { background:rgba(80,120,255,0.18); }
.drv-file-name { font-weight:500; word-break:break-all; }
.drv-file-meta { font-size:11px; opacity:0.75; white-space:nowrap; }
.drv-detail { flex:1; overflow:auto; overscroll-behavior:contain; padding:10px; }
.drv-section { margin-bottom:12px; border:1px solid rgba(128,128,128,0.35); border-radius:6px; overflow:hidden; }
.drv-section-head { padding:6px 10px; font-weight:600; background:rgba(128,128,128,0.1); display:flex; gap:8px; align-items:center; }
.drv-section-time { font-weight:400; opacity:0.7; font-size:11px; }
.drv-badge { display:inline-block; padding:0 6px; border-radius:8px; font-size:10px; font-weight:600; }
.drv-badge-new { background:rgba(46,160,67,0.22); color:#1a7f37; }
.drv-badge-edit { background:rgba(9,105,218,0.16); color:#0969da; }
.drv-line { display:flex; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; line-height:1.55; }
.drv-gutter { box-sizing:border-box; flex:0 0 34px; text-align:right; padding:0 4px; user-select:none; opacity:0.9; }
.drv-gutter-sign { box-sizing:border-box; flex:0 0 14px; text-align:center; padding:0; }
.drv-text { flex:1; padding:0 6px; white-space:pre-wrap; word-break:break-word; }
.drv-empty { padding:24px; text-align:center; opacity:0.6; }
.drv-settings { border-top:1px solid rgba(128,128,128,0.3); padding:6px 0 0; margin-top:10px; }
.drv-settings-toggle { border:none; background:transparent; color:inherit; cursor:pointer; font-size:12px; padding:4px 0; }
.drv-settings-body { margin-top:6px; }
.drv-color-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:3px 0; font-size:12px; }
.drv-color-row input[type=color] { width:38px; height:24px; border:none; border-radius:4px; padding:0; background:transparent; cursor:pointer; }
.drv-color-controls { display:flex; align-items:center; gap:6px; }
.drv-color-controls input[type=range] { width:76px; accent-color:var(--dsw-alias-state-business-primary, #4493f8); }
.drv-color-alpha { font-size:11px; opacity:0.7; min-width:34px; text-align:right; }
.drv-presets { display:flex; gap:6px; margin-top:8px; }
.drv-presets button { border:1px solid rgba(128,128,128,0.4); background:transparent; color:inherit; cursor:pointer; border-radius:6px; padding:3px 8px; font-size:11px; }
.drv-presets button:hover { background:rgba(128,128,128,0.15); }
.drv-settings-page { padding:16px; font-size:13px; }
.drv-settings-desc { opacity:0.7; margin:0 0 14px; line-height:1.6; }
.drv-detail-toolbar { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
.drv-detail-path { font-size:12px; opacity:0.8; word-break:break-all; }
.drv-btn-revert { font-size:11px; padding:2px 8px; }
.drv-btn-danger { color:#cf222e; }
.drv-notice { font-size:12px; color:#1a7f37; background:rgba(46,160,67,0.15); border-radius:6px; padding:3px 8px; }
.drv-mode { display:flex; gap:4px; }
.drv-mode-btn { border:1px solid rgba(128,128,128,0.4); background:transparent; color:inherit; cursor:pointer; border-radius:6px; padding:2px 8px; font-size:11px; }
.drv-mode-btn:hover { background:rgba(128,128,128,0.12); }
.drv-mode-btn.drv-mode-active { background:rgba(80,120,255,0.25); border-color:rgba(80,120,255,0.6); }
.drv-turn { border:1px solid rgba(128,128,128,0.3); border-radius:8px; padding:6px 10px; font-size:12px; }
.drv-turn-produced { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:0 0 6px; }
.drv-turn-produced-label { font-size:11px; opacity:0.7; }
.drv-turn-produced-chip { border:1px solid rgba(128,128,128,0.35); background:transparent; color:inherit; cursor:pointer; border-radius:10px; padding:1px 8px; font-size:11px; font-family:inherit; }
.drv-turn-produced-chip:hover { background:rgba(128,128,128,0.12); }
.drv-turn-head { display:flex; align-items:center; gap:8px; padding:2px 0 6px; }
.drv-turn-title { font-weight:600; }
.drv-turn-hint { font-size:11px; opacity:0.6; }
.drv-turn-file { border-top:1px solid rgba(128,128,128,0.15); }
.drv-turn-file-head { display:flex; align-items:center; gap:8px; width:100%; padding:5px 0; border:none; background:transparent; color:inherit; cursor:pointer; font-family:inherit; font-size:12px; text-align:left; }
.drv-turn-file-name { font-weight:500; word-break:break-all; }
.drv-turn-chevron { opacity:0.6; }
.drv-turn-file-body { padding:2px 0 8px; }
.drv-turn-file-body .drv-section { margin-bottom:8px; }
.drv-tab-label { display:inline-flex; align-items:center; gap:6px; }
.drv-tab-badge { display:inline-block; border-radius:8px; padding:0 5px; font-size:10px; line-height:14px; font-weight:600; min-width:16px; text-align:center; }
.drv-ctx-menu { position:fixed; z-index:20000; min-width:150px; padding:4px; border:1px solid rgba(128,128,128,0.45); border-radius:8px; background:var(--dsw-alias-surface-2, #22272e); box-shadow:0 6px 18px rgba(0,0,0,0.35); }
.drv-ctx-menu-item { display:block; width:100%; border:none; background:transparent; color:inherit; text-align:left; padding:6px 10px; border-radius:6px; font-size:12px; font-family:inherit; cursor:pointer; }
.drv-ctx-menu-item:hover { background:rgba(80,120,255,0.28); }
.drv-editor { position:relative; display:inline-flex; }
.drv-editor-btn { display:inline-flex; align-items:center; gap:4px; height:32px; padding:0 10px; border:1px solid rgba(128,128,128,0.35); background:transparent; color:inherit; cursor:pointer; border-radius:18px; font-size:12px; font-family:inherit; }
.drv-editor-btn:hover { background:rgba(128,128,128,0.14); }
.drv-editor-label { max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.drv-editor-caret { opacity:0.7; font-size:10px; flex:none; }
.drv-editor-menu { position:absolute; top:calc(100% + 4px); right:0; z-index:20000; min-width:170px; padding:4px; border:1px solid rgba(128,128,128,0.45); border-radius:8px; background:var(--dsw-alias-surface-2, #22272e); box-shadow:0 6px 18px rgba(0,0,0,0.35); max-height:260px; overflow:auto; }
.drv-editor-opt { display:block; width:100%; border:none; background:transparent; color:inherit; text-align:left; padding:6px 10px; border-radius:6px; font-size:12px; font-family:inherit; cursor:pointer; white-space:nowrap; }
.drv-editor-opt:hover { background:rgba(128,128,128,0.16); }
.drv-editor-opt.drv-editor-opt-active { background:rgba(80,120,255,0.28); }
.drv-editor-empty { padding:6px 10px; font-size:12px; opacity:0.6; }
/* ── 窄屏（≤768px）：清单/详情切换为主从式单栏，清单不再固定 250px 挤占 diff ── */
.drv-back-btn { display:none; flex:none; }
@media (max-width: 768px) {
	.drv-view { padding:8px 10px; }
	.drv-view-header { flex-wrap:wrap; row-gap:6px; }
	.drv-view-body { margin-top:8px; }
	.drv-pane-list .drv-filelist { width:100%; border-right:none; }
	.drv-pane-list .drv-detail { display:none; }
	.drv-pane-detail .drv-filelist { display:none; }
	.drv-back-btn { display:inline-flex; align-items:center; gap:4px; }
	.drv-file { min-height:44px; flex-wrap:wrap; align-content:center; }
	.drv-file-meta { white-space:normal; }
	.drv-detail { padding:8px; }
	.drv-gutter { flex:0 0 30px; }
	.drv-gutter-sign { flex:0 0 12px; }
}
`;
		function apply(ctx) {
			ctxRef = ctx;
			ctx.effect(() => {
				const el = document.createElement("style");
				el.textContent = CSS;
				document.head.appendChild(el);
				return () => el.remove();
			}, "diff-review: styles");
			if (!EDITOR_FEATURES_DISABLED) loadEditors(); // 已屏蔽编辑器检测
			refreshFromServer();
			ctx.effect(connectEvents, "diff-review: live events");
			ctx.slots.inject("conversation.view", () => ctx.slots.register(
				{
					name: "conversation.view", id: "review", order: 5,
					label: () => React.createElement(TabLabel, null),
					inject: (sessionId, _actions) => ({
						openFile: (path, cwd) => openFileFor(sessionId, path, cwd)
					})
				},
				(props) => React.createElement(ReviewView, props)));
			ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register(
				{ name: "conversation.chat.turnTail", priority: -1, select: (owner) => (owner && owner.turn && owner.turn.turn != null ? { turn: owner.turn.turn } : null) },
				(props) => React.createElement(TurnReview, props)));
			// 已屏蔽编辑器选择器：不注入 conversation.session.header.utilities 插槽（代码保留）。
			if (!EDITOR_FEATURES_DISABLED) {
				ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register(
					{ name: "conversation.session.header.utilities", id: "diff-review-editor", order: -1 },
					(props) => React.createElement(EditorPicker, props)));
			}
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register(
				{ name: "conversation.session.header.actions", id: "diff-review-session", order: 100 },
				(props) => React.createElement(SessionProbe, props)));
			ctx.slots.inject("settings.section", () => ctx.slots.register(
				{ name: "settings.section", id: "diff-review", order: 25, label: "修改审查" },
				(props) => React.createElement(SettingsPage, props)));
			// ── better-sidebar 集成（可选软依赖：未安装 dsh-better-sidebar 时静默跳过）──
			// 经 ctx.inject 延迟绑定：better-sidebar 的 client 半提供 'betterSidebar' 服务后
			// 才注册侧边栏「修改审查」tab。不能声明在插件级 inject 上：服务缺失会让整个
			// 插件挂起，进而被 web boot 的激活审计判为启动失败。
			ctx.inject(["betterSidebar"], (sctx) => {
				sctx.effect(() => sctx.betterSidebar.registerTab({
					id: "dsh-change-review:review",
					title: () => "修改审查",
					icon: (size) => React.createElement(ReviewTabIcon, { size: size }),
					order: 60,
					single: true,
					component: ({ scope }) => React.createElement(ReviewView, {
						sessionId: scope.sessionId,
						openFile: (path, cwd) => openFileFor(scope.sessionId, path, cwd)
					})
				}), "diff-review: better-sidebar tab");
			});
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
				{ name: "sidebar.footer.action", id: "diff-review" },
				() => null));
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});