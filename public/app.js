(function () {
  const btnRefresh = document.getElementById('btn-refresh');
  const folderLabel = document.getElementById('folder-label');
  const btnLoadFolder = document.getElementById('btn-load-folder');
  const statusEl = document.getElementById('status');
  const tocEl = document.getElementById('toc');
  const contentEl = document.getElementById('content');
  const btnToggleToc = document.getElementById('btn-toggle-toc');
  const sidebar = document.querySelector('.sidebar');
  const btnEdit = document.getElementById('btn-edit');
  const editorEl = document.getElementById('editor');
  const btnBack = document.getElementById('btn-back');
  const btnNewTab = document.getElementById('btn-new-tab');
  const resizeHandle = document.querySelector('.resize-handle');
  const dropOverlay = document.getElementById('drop-overlay');
  const btnMode = document.getElementById('btn-mode');
  const btnViewFiles = document.getElementById('btn-view-files');
  const btnViewToc = document.getElementById('btn-view-toc');
  const filePanel = document.getElementById('file-panel');
  const tocPanel = document.getElementById('toc-panel');
  const fileListEl = document.getElementById('file-list');
  const fileFilter = document.getElementById('file-filter');

  // { name: string, path: string, handle: FileSystemFileHandle }[]
  //   name = 文件名（文档内链接用 ./xxx.md 这种写法匹配时靠它）
  //   path = 相对当前目录根的路径，用 / 分隔（如「业务知识库/核心业务领域.md」），
  //          递归扫描子目录后 path 才是唯一标识 —— 不同子目录可能有同名文件
  let currentFiles = [];
  // 当前选中文件的相对路径（即 entry.path）
  let currentFile = null;
  // 当前文件的原始 markdown 文本
  let currentMarkdownText = '';
  // 标题 id -> markdown 文本中的字符偏移
  let headingOffsets = {};
  // 重建当前文档目录。这里必须显式声明：函数体在文末才赋值（要包裹视图守卫），
  // 且 app.js 没有 'use strict' —— 少了这个 let，赋值会变成 window.renderToc 这个
  // 全局变量，破坏 IIFE「不污染全局」的前提。
  let renderToc;
  // 是否处于编辑模式
  let isEditMode = false;
  // 界面模式：traditional = 传统模式（编辑/浏览 分离），modern = 现代模式（Typora 式常驻即时渲染）
  const MODE_STORAGE_KEY = 'lightmdkit.mode';
  let currentMode = loadModePreference();

  function loadModePreference() {
    try {
      return localStorage.getItem(MODE_STORAGE_KEY) === 'modern' ? 'modern' : 'traditional';
    } catch (e) {
      // 隐私模式/禁用存储时 localStorage 会抛异常，回退传统模式
      return 'traditional';
    }
  }

  function saveModePreference(mode) {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch (e) {
      // 存不下不影响本次使用
    }
  }

  // 侧边栏视图：files = 文件列表（当前目录下可打开的文件），toc = 当前文档的标题目录
  const SIDEBAR_VIEW_KEY = 'lightmdkit.sidebarView';
  let sidebarView = loadSidebarView();

  function loadSidebarView() {
    try {
      return localStorage.getItem(SIDEBAR_VIEW_KEY) === 'toc' ? 'toc' : 'files';
    } catch (e) {
      // 隐私模式/禁用存储时 localStorage 会抛异常，回退文件列表
      return 'files';
    }
  }

  function saveSidebarView(view) {
    try {
      localStorage.setItem(SIDEBAR_VIEW_KEY, view);
    } catch (e) {
      // 存不下不影响本次使用
    }
  }

  // 递归扫描的边界：避免误选 node_modules 之类的巨型目录时卡死界面。
  // 超过上限时停止深入，而不是报错 —— 已扫到的文件照常可用。
  const SCAN_MAX_DEPTH = 6;
  const SCAN_MAX_FILES = 3000;
  // 这些目录对文档浏览没有意义，直接跳过（同时也能避开 pkg 打包产物等噪声）
  const SCAN_SKIP_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg', '.idea', '.vscode', 'dist', 'build',
  ]);
  // 编辑模式下的自动保存定时器（每 3s 保存一次）
  let autosaveTimer = null;
  const AUTOSAVE_INTERVAL_MS = 3000;
  // 记录切换模式前视口最上方的 heading id，用于切回浏览模式时恢复滚动位置
  let lastViewHeadingId = null;
  // 文件浏览历史栈，用于链接跳转后返回
  let fileHistory = [];
  // 当前已加载的文件夹句柄，用于刷新时重新扫描
  let currentFolderHandle = null;
  // 图片相对路径 -> objectURL，避免同一图片被重复读取
  const imageUrlCache = new Map();

  // CodeMirror 编辑器实例（可选增强，初始化失败时回退到 textarea）
  let cmEditor = null;
  try {
    cmEditor = CodeMirror.fromTextArea(editorEl, {
      // highlightFormatting 让语法标记带上 cm-formatting* class，现代模式靠它隐藏标记。
      // 传统模式没有对应 CSS 规则，所以开启它对现有外观零影响。
      //
      // strikethrough 必须关掉：CM5 自带的删除线把单个 ~ 也当定界符
      // （mode/markdown/markdown.js 里 `ch === '~' && stream.eatWhile(ch)` 后直接切换状态），
      // 于是「1~100、2~5」这种范围写法会被误判成删除线，两个 ~ 还会被当成标记隐藏掉，
      // 直接显示成「1100、25」。真正的 ~~...~~ 改由 markText 单独标注（见 refreshStrikeMarks）。
      // 关掉它不影响传统模式：style.css 本来就没有样式化 cm-strikethrough / cm-formatting-strikethrough。
      mode: { name: 'gfm', highlightFormatting: true, strikethrough: false },
      // 保留 'github'：npm 包里其实没有这个主题（见 index.html 顶部说明），
      // 它的作用是让容器带 cm-s-github 类，从而不启用 cm-s-default 的默认 token 配色。
      // 编辑器实际配色来自 style.css 的 .content-wrapper .cm-* 规则。
      theme: 'github',
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
      // extraKeys 由 applySurface() 按模式动态设置（见 MODERN_EXTRA_KEYS）
      // styleActiveLine 交给 applySurface() 按模式开关。它会给当前行加
      // .CodeMirror-activeline（现代模式据此还原光标所在行源码），但基础样式
      // codemirror.css 里 .CodeMirror-activeline-background{background:#e8f2ff}
      // 会给当前行刷一层蓝色背景 —— 传统模式必须保持原样，所以只允许现代模式开。
      styleActiveLine: false,
    });
    cmEditor.getWrapperElement().style.display = 'none';
    cmEditor.refresh();

    // 初始化 Mermaid
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
      });
    }

    // 监听编辑器内容变化
    cmEditor.on('change', () => {
      currentMarkdownText = cmEditor.getValue();
      scheduleLivePreviewRefresh();
    });

    // 现代模式下目录没有渲染后的 DOM 可观察，改为根据光标位置高亮
    cmEditor.on('cursorActivity', () => {
      if (currentMode !== 'modern') return;
      updateActiveTocItemByCursor();
    });
  } catch (e) {
    console.warn('CodeMirror/Mermaid init failed, falling back to textarea:', e);
    cmEditor = null;
  }

  function setStatus(msg, type = '') {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + type;
    if (!msg) return;
    setTimeout(() => {
      if (statusEl.textContent === msg) {
        statusEl.textContent = '';
        statusEl.className = 'status';
      }
    }, 3000);
  }

  function isMarkdownName(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ext === 'md' || ext === 'markdown';
  }

  // 统一相对路径的比较口径：反斜杠归一成 /，忽略开头的 ./，大小写不敏感。
  // 文档内链接里的 ./sub/a.md、sub/a.md、sub\a.md 都要能对应到同一条记录。
  function normalizePathForMatch(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }

  // 按路径取当前文件记录，取不到再退回按文件名匹配。
  // 退回分支是为兼容 entry.path 缺失的旧结构（例如只加载了单个文件）。
  function findEntryByPath(path) {
    if (!path) return null;
    const byPath = currentFiles.find(f => f.path === path);
    if (byPath) return byPath;
    const target = normalizePathForMatch(path);
    return currentFiles.find(f => f.path === undefined && f.name === path)
      || currentFiles.find(f => normalizePathForMatch(f.path || f.name) === target)
      || null;
  }

  // 把扫描结果铺平成「目录 → 其下文件」的顺序。
  // 不能简单地对整条路径做 localeCompare —— 那样 `sub/deep/d.md`（'/'=0x2F）
  // 会排在 `sub/note.md`（'深'=0x6DF1）前面，子目录和文件交替插花，
  // 渲染分组时同一个目录就被拆成好几段、标题重复出现。
  // 这里按树逐层铺：某个目录自身的文件排完，再进它的子目录。
  function flattenByDirectory(files) {
    const root = { dirs: new Map(), files: [] };
    for (const file of files) {
      const slash = file.path.lastIndexOf('/');
      const segments = slash === -1 ? [] : file.path.slice(0, slash).split('/');
      const baseName = slash === -1 ? file.path : file.path.slice(slash + 1);
      let node = root;
      for (const seg of segments) {
        if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
        node = node.dirs.get(seg);
      }
      node.files.push({ baseName, entry: file });
    }

    const out = [];
    (function walk(node) {
      node.files.sort((a, b) => a.baseName.localeCompare(b.baseName));
      for (const f of node.files) out.push(f.entry);
      const names = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
      for (const name of names) walk(node.dirs.get(name));
    })(root);
    return out;
  }

  // 递归扫描目录句柄，收集所有可打开的 Markdown 文件。
  // 返回 [{ name, path, handle }]；path 是相对当前目录根的 / 分隔路径。
  // 加载文件夹与刷新共用此函数，保证两处扫描口径一致。
  async function collectMarkdownFiles(dirHandle, prefix = '', depth = 0, out = []) {
    if (depth > SCAN_MAX_DEPTH || out.length >= SCAN_MAX_FILES) return out;

    const entries = [];
    for await (const [name, handle] of dirHandle.entries()) {
      entries.push({ name, handle });
    }
    // 让扫描顺序稳定（entries() 的顺序由系统决定），同名排序与旧逻辑一致
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (out.length >= SCAN_MAX_FILES) break;
      const { name, handle } = entry;
      if (handle.kind === 'directory') {
        if (SCAN_SKIP_DIRS.has(name)) continue;
        await collectMarkdownFiles(handle, prefix + name + '/', depth + 1, out);
      } else if (isMarkdownName(name)) {
        out.push({ name, path: prefix + name, handle });
      }
    }

    // 只在最外层收尾，避免每层递归都重排一次
    if (depth === 0) return flattenByDirectory(out);
    return out;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function generateHeadingId(text, usedIds) {
    let baseId = slugify(text) || 'heading';
    let id = baseId;
    let counter = 1;
    while (usedIds.has(id)) {
      id = baseId + '-' + counter;
      counter++;
    }
    usedIds.add(id);
    return id;
  }

  function parseHeadingOffsets(text) {
    const offsets = {};
    const lines = text.split('\n');
    let charOffset = 0;
    const usedIds = new Set();
    lines.forEach(line => {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const title = match[2].trim();
        const id = generateHeadingId(title, usedIds);
        offsets[id] = charOffset;
      }
      charOffset += line.length + 1; // +1 for \n
    });
    return offsets;
  }

  function scrollEditorToOffset(offset) {
    const textBefore = currentMarkdownText.slice(0, offset);
    const lineIndex = textBefore.split('\n').length - 1;
    const lineHeight = parseInt(getComputedStyle(editorEl).lineHeight) || 22;
    editorEl.scrollTop = Math.max(0, lineIndex * lineHeight - editorEl.clientHeight / 3);
  }

  function getTopVisibleHeadingId() {
    const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) return null;
    const wrapper = document.querySelector('.content-wrapper');
    const wrapperTop = wrapper.getBoundingClientRect().top;
    for (const h of headings) {
      const rect = h.getBoundingClientRect();
      if (rect.top >= wrapperTop - 10) {
        return h.id;
      }
    }
    return null;
  }

  // 从 markdown 原文解析标题（现代模式用：那时没有渲染好的 DOM 可查）。
  // id 生成与 parseHeadingOffsets 完全同构 —— 同一个 generateHeadingId + 独立 Set，
  // 按出现顺序遍历 —— 因此两边算出的 id 天然对齐。
  function extractHeadings(text) {
    const usedIds = new Set();
    const result = [];
    let offset = 0;
    for (const line of text.split('\n')) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const title = match[2].trim();
        result.push({
          level: match[1].length,
          text: title,
          offset,
          id: generateHeadingId(title, usedIds),
        });
      }
      offset += line.length + 1; // +1 for \n
    }
    return result;
  }

  // getValue() 是 O(n)，而光标移动很频繁，这里按文本内容缓存解析结果
  let headingCache = { text: null, list: [] };
  function getHeadingsCached(text) {
    if (headingCache.text !== text) {
      headingCache = { text, list: extractHeadings(text) };
    }
    return headingCache.list;
  }

  // 按字符偏移定位光标（现代模式与编辑模式的目录跳转共用）
  function jumpToOffset(offset) {
    if (cmEditor) {
      cmEditor.focus();
      const lineIndex = cmEditor.getValue().slice(0, offset).split('\n').length - 1;
      cmEditor.setCursor(lineIndex, 0);
      cmEditor.scrollIntoView({ line: lineIndex, ch: 0 }, 60);
    } else {
      editorEl.focus();
      editorEl.setSelectionRange(offset, offset);
      scrollEditorToOffset(offset);
    }
  }

  // 现代模式的目录：直接来自编辑器里的 markdown 原文，编辑后可实时反映
  function renderTocFromSource() {
    const text = cmEditor ? cmEditor.getValue() : editorEl.value;
    const headings = getHeadingsCached(text);
    tocEl.innerHTML = '';
    if (headings.length === 0) {
      tocEl.innerHTML = '<p class="toc-empty">当前文件没有标题目录</p>';
      return;
    }
    headings.forEach(h => {
      const item = document.createElement('a');
      item.className = 'toc-item level-' + h.level;
      item.textContent = h.text;
      item.href = '#' + h.id;
      item.dataset.target = h.id;
      item.addEventListener('click', e => {
        e.preventDefault();
        jumpToOffset(h.offset);
        updateActiveTocItem(h.id);
      });
      tocEl.appendChild(item);
    });
  }

  // 现代模式没有可观察的渲染 DOM，改为按光标位置高亮目录项
  function updateActiveTocItemByCursor() {
    if (!cmEditor) return;
    const headings = getHeadingsCached(cmEditor.getValue());
    if (headings.length === 0) return;
    const cursorOffset = cmEditor.indexFromPos(cmEditor.getCursor());
    let currentId = headings[0].id;
    for (const h of headings) {
      if (h.offset <= cursorOffset) currentId = h.id;
      else break;
    }
    updateActiveTocItem(currentId);
  }

  // 现代模式编辑时目录与删除线标注都要跟着更新，防抖避免每个字符都重建
  let livePreviewTimer = null;
  function scheduleLivePreviewRefresh() {
    if (currentMode !== 'modern') return;
    if (livePreviewTimer) clearTimeout(livePreviewTimer);
    livePreviewTimer = setTimeout(() => {
      livePreviewTimer = null;
      if (currentMode !== 'modern') return;
      renderToc();
      refreshStrikeMarks();
      refreshTaskMarks();
      refreshTableMarks();
    }, 300);
  }

  // 只认双波浪线的删除线（与 md-render.js 里 patchStrikethrough 的规则保持一致）。
  // CM5 自带的删除线已关闭，这里用 markText 自己标注，避免「1~100」被误判。
  const REAL_STRIKE_RE = /~~(?=[^\s~])([\s\S]*?[^\s~])~~(?=[^~]|$)/g;
  let strikeMarks = [];

  function clearStrikeMarks() {
    strikeMarks.forEach(m => m.clear());
    strikeMarks = [];
  }

  function refreshStrikeMarks() {
    clearStrikeMarks();
    if (currentMode !== 'modern' || !cmEditor) return;
    const lineCount = cmEditor.lineCount();
    for (let i = 0; i < lineCount; i++) {
      const text = cmEditor.getLine(i);
      if (text.indexOf('~~') === -1) continue;
      REAL_STRIKE_RE.lastIndex = 0;
      let m;
      while ((m = REAL_STRIKE_RE.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        // 内容加删除线；前后两对 ~~ 单独标注以便隐藏（三个区间互不重叠）
        strikeMarks.push(cmEditor.markText(
          { line: i, ch: start + 2 }, { line: i, ch: end - 2 },
          { className: 'cm-md-strike' }));
        strikeMarks.push(cmEditor.markText(
          { line: i, ch: start }, { line: i, ch: start + 2 },
          { className: 'cm-md-strike-mark' }));
        strikeMarks.push(cmEditor.markText(
          { line: i, ch: end - 2 }, { line: i, ch: end },
          { className: 'cm-md-strike-mark' }));
      }
    }
  }

  // 任务框：把 `- [x]` / `- [ ]` 里的方括号标注出来，由 CSS 换成 ☑ / ☐。
  // 不用 CodeMirror 自带的 taskLists：它默认关闭（mode 配置里没开就是 false），
  // 而且开了之后勾没勾只存在内部 state 里、不落到 class 上，CSS 区分不出来。
  // 所以这里自己扫行标注，正则只认「行首列表符号 + 紧跟的 [x]/[ ]」，
  // 与渲染端 marked 的判定口径一致。
  const TASK_RE = /^(\s*[-*+]\s+)\[([ xX])\]/;
  let taskMarks = [];

  function clearTaskMarks() {
    taskMarks.forEach(m => m.clear());
    taskMarks = [];
  }

  function refreshTaskMarks() {
    clearTaskMarks();
    if (currentMode !== 'modern' || !cmEditor) return;
    const lineCount = cmEditor.lineCount();
    for (let i = 0; i < lineCount; i++) {
      const text = cmEditor.getLine(i);
      if (text.indexOf('[') === -1) continue;
      const m = TASK_RE.exec(text);
      if (!m) continue;
      const start = m[1].length;   // '[' 的位置，跳过缩进与列表符号
      taskMarks.push(cmEditor.markText(
        { line: i, ch: start }, { line: i, ch: start + 3 },
        { className: m[2] === ' ' ? 'cm-task-box cm-task-open' : 'cm-task-box cm-task-done' }));
    }
  }

  // ---------------- 表格伪渲染 ----------------
  // CM5 的 markdown mode 完全不认表格（mode 源码里搜不到 table），管道符与单元格
  // 都没有类名可用，CSS 无从下手。这里自己扫块：识别「表头 + 分隔行 + 数据行」，
  // 把每格的字符区间与管道符分别用 markText 打上类名，由 CSS 画格子、藏管道符。
  //
  // 列宽必须自己算：内联 span 不会跨行对齐，只有让同一列的所有格子取相同宽度，
  // 各行才能对齐。宽度按「最长内容 + 内边距」估算后注入一张动态样式表。
  // 全角字符约占两倍宽度，按此折算。
  const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
  const TABLE_SEP_RE = /^\s*\|[\s:|-]+\|\s*$/;
  const TABLE_COL_CLASS_PREFIX = 'cm-tbl-c';
  // 每个表格块一份记录，便于「只重建变化的那张表」而不是全文推倒重来。
  // { sig, marks: [], sepHandle }
  //   sig       —— 该块的内容签名（只含文本，不含行号：插入/删除行会让行号漂移，
  //                带上行号会导致没改过的表也被判定为变化）
  //   sepHandle —— 分隔行的行句柄。用句柄而不是行号，编辑后仍然指向正确的行。
  let tableBlocks = [];

  function dropTableBlock(b) {
    for (const m of b.marks) m.clear();
    b.marks = [];
    if (b.sepHandle && cmEditor) cmEditor.removeLineClass(b.sepHandle, 'text', 'cm-tbl-sep-line');
    b.sepHandle = null;
  }

  function clearTableMarks() {
    for (const b of tableBlocks) dropTableBlock(b);
    tableBlocks = [];
    // 清掉整体签名，避免下次因为「签名没变」跳过重建、留下已被清空的标注
    lastTableSignature = '';
  }

  // 块的内容签名：只取该块各行文本，不含行号
  function blockSignature(from, to) {
    const parts = [];
    for (let n = from; n <= to; n++) parts.push(cmEditor.getLine(n));
    return parts.join('\n');
  }

  function visualWidth(s) {
    let n = 0;
    for (const ch of s) n += ch.codePointAt(0) > 0x2e7f ? 2 : 1;
    return n;
  }

  // `| a | b |` -> 管道符位置数组（跳过被反斜杠转义的）
  function pipePositions(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '|' && text[i - 1] !== '\\') out.push(i);
    }
    return out;
  }

  // 标记出落在代码围栏内的行。围栏里的内容原样展示，不该被当成表格渲染 ——
  // 否则写一段含 `| a | b |` 的示例代码会被硬生生画成表格。
  function computeFenceMask() {
    const n = cmEditor.lineCount();
    const mask = new Array(n);
    let inFence = false;
    for (let i = 0; i < n; i++) {
      const t = cmEditor.getLine(i);
      if (/^\s*(```|~~~)/.test(t)) { mask[i] = true; inFence = !inFence; }
      else mask[i] = inFence;
    }
    return mask;
  }

  let lastTableSignature = '';

  function refreshTableMarks() {
    if (currentMode !== 'modern' || !cmEditor) { clearTableMarks(); return; }

    const lineCount = cmEditor.lineCount();
    const fence = computeFenceMask();
    const isRow = (n) => n < lineCount && !fence[n] && TABLE_ROW_RE.test(cmEditor.getLine(n));

    // 先找出所有表格块：[表头行, ...数据行]，分隔行单独记
    const blocks = [];
    for (let i = 0; i < lineCount; i++) {
      if (!isRow(i) || !(i + 1 < lineCount) || fence[i + 1] || !TABLE_SEP_RE.test(cmEditor.getLine(i + 1))) continue;
      let end = i + 2;
      while (isRow(end)) end++;
      blocks.push({ from: i, to: end - 1, sep: i + 1 });
      i = end - 1;
    }

    const sigs = blocks.map((b) => blockSignature(b.from, b.to));
    const overall = sigs.join('\n');
    if (overall === lastTableSignature) return;
    lastTableSignature = overall;

    // 逐块比对，只重建真正变化的那一块。
    // markText 会随编辑自动位移，所以内容没变的块可以直接复用已有标注；
    // 否则改一张表就要把全文所有表格推倒重来（实测 40 张表时一次编辑要 1.2 秒）。
    const prev = tableBlocks;
    const next = [];
    for (let i = 0; i < blocks.length; i++) {
      const old = prev[i];
      if (old && old.sig === sigs[i]) { next.push(old); continue; }   // 复用
      if (old) dropTableBlock(old);                                   // 内容变了，先摘旧标注
      next.push({ sig: sigs[i], from: blocks[i].from, to: blocks[i].to, sep: blocks[i].sep,
                  marks: [], sepHandle: null, dirty: true });
    }
    for (let i = blocks.length; i < prev.length; i++) dropTableBlock(prev[i]);  // 表格被删掉了
    tableBlocks = next;

    const dirty = next.filter((b) => b.dirty);
    if (dirty.length === 0) return;    // 只是行号漂移，标注无需重建
    for (const b of dirty) b.dirty = false;


    // 统计每列宽度（取所有行里该列最宽的一个）
    const widths = [];
    for (const b of blocks) {
      for (let n = b.from; n <= b.to; n++) {
        if (n === b.sep) continue;
        const text = cmEditor.getLine(n);
        const pipes = pipePositions(text);
        for (let p = 0; p + 1 < pipes.length; p++) {
          // 刻意不 trim：单元格区间含管道符两侧的空格，这些空格同样占宽度，
          // 按 trim 后算会让盒子偏窄、内容折行（实测表头被撑成两行）。
          const w = visualWidth(text.slice(pipes[p] + 1, pipes[p + 1]));
          widths[p] = Math.max(widths[p] || 0, w);
        }
      }
    }

    let st = document.getElementById('cm-table-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'cm-table-style';
      document.head.appendChild(st);
    }
    // 用 em 而不是 ch：ch 是数字 0 的宽度（≈8px），而一个汉字就有 16px，
    // 用 ch 算出来的宽度会把中文单元格挤到换行（实测表头「姓名」被撑成两行）。
    // visualWidth 里 1 个 ASCII 记 1、1 个全角记 2，正好对应 0.5em / 1em；
    // 再加 1.4em 覆盖左右内边距（各 0.5em）与边框、留一点余量。
    // 只有宽度真的变了才写回：重写 <style> 会触发整页样式重算，是这条路径上
    // 最贵的一步，不能每次刷新都做。
    const css = widths
      .map((w, n) => `.live-preview .${TABLE_COL_CLASS_PREFIX}${n}{width:${(w * 0.5 + 1.4).toFixed(2)}em}`)
      .join('\n');
    if (st.textContent !== css) st.textContent = css;

    // 只给需要重建的块打标注；复用中的块由 CodeMirror 自己维护标注位置
    for (const b of dirty) {
      for (let n = b.from; n <= b.to; n++) {
        const text = cmEditor.getLine(n);
        if (n === b.sep) {
          // 分隔行：整行标记 + 行级类名，由 CSS 把它压扁成表格的横线。
          // 行类名挂行句柄而不是行号，编辑导致行号漂移后清理时不会摘错行。
          if (text.length) {
            b.marks.push(cmEditor.markText({ line: n, ch: 0 }, { line: n, ch: text.length },
              { className: 'cm-tbl-sep' }));
          }
          const handle = cmEditor.getLineHandle(n);
          cmEditor.addLineClass(handle, 'text', 'cm-tbl-sep-line');
          b.sepHandle = handle;
          continue;
        }
        const pipes = pipePositions(text);
        pipes.forEach((pos) => {
          b.marks.push(cmEditor.markText({ line: n, ch: pos }, { line: n, ch: pos + 1 },
            { className: 'cm-tbl-pipe' }));
        });
        for (let p = 0; p + 1 < pipes.length; p++) {
          b.marks.push(cmEditor.markText(
            { line: n, ch: pipes[p] + 1 }, { line: n, ch: pipes[p + 1] },
            { className: 'cm-tbl-cell ' + TABLE_COL_CLASS_PREFIX + p + (n === b.from ? ' cm-tbl-head' : '') }));
        }
      }
    }
  }

  // 表格里按 Tab 新增一行，对齐 Typora 的习惯：在表格末尾追加一行空单元格，
  // 光标落到新行第一格。列数取自分隔行，所以增删列后新增的行依然对齐。
  // 不在表格里时返回 CodeMirror.Pass，交回默认行为（正文的 Tab 缩进不受影响）。
  function tableTabKey(cm) {
    const pos = cm.getCursor();
    const lineCount = cm.lineCount();
    const fence = computeFenceMask();
    const isRow = (n) => n < lineCount && !fence[n] && TABLE_ROW_RE.test(cm.getLine(n));
    const isSep = (n) => n < lineCount && !fence[n] && TABLE_SEP_RE.test(cm.getLine(n));

    if (!isRow(pos.line)) return CodeMirror.Pass;

    // 向上、向下扩出包含光标行的表格块
    let from = pos.line;
    while (from > 0 && (isRow(from - 1) || isSep(from - 1))) from--;
    let to = pos.line;
    while (to + 1 < lineCount && isRow(to + 1)) to++;

    // 块里必须有分隔行，才认定这是一张表（避免把普通含 | 的段落当成表格）
    let sep = -1;
    for (let n = from; n <= to; n++) if (isSep(n)) { sep = n; break; }
    if (sep === -1) return CodeMirror.Pass;

    const cols = pipePositions(cm.getLine(sep)).length - 1;
    if (cols < 1) return CodeMirror.Pass;

    const newRow = '|' + new Array(cols).fill('   ').join('|') + '|';
    cm.replaceRange('\n' + newRow, { line: to, ch: cm.getLine(to).length });
    cm.setCursor({ line: to + 1, ch: 2 });   // 落进第一格（跳过 '| '）
    return null;                              // 已处理，不再走默认行为
  }

  // 只负责按当前文档重建目录内容，不关心侧边栏当前展示的是哪个面板。
  // 视图守卫在文末赋值给 renderToc 的那个函数里 —— 调用点仍统一写 renderToc()，
  // 由它决定是否真的重建，否则「读文件 → renderToc」会把文件列表挤掉。
  renderToc = function () {
    // 现代模式下 contentEl 是隐藏的且可能已经过期，目录改从编辑器原文实时解析
    if (currentMode === 'modern') {
      renderTocFromSource();
      return;
    }
    tocEl.innerHTML = '';
    const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) {
      tocEl.innerHTML = '<p class="toc-empty">当前文件没有标题目录</p>';
      return;
    }

    // 统一重新生成 heading id，确保与 parseHeadingOffsets 生成的键一致
    const usedIds = new Set();
    headings.forEach(h => {
      h.id = generateHeadingId(h.textContent || '', usedIds);
    });

    headings.forEach(h => {
      const level = parseInt(h.tagName[1], 10);
      const item = document.createElement('a');
      item.className = 'toc-item level-' + level;
      item.textContent = h.textContent || '';
      item.href = '#' + h.id;
      item.dataset.target = h.id;
      item.addEventListener('click', e => {
        e.preventDefault();
        if (isEditMode) {
          const offset = headingOffsets[h.id];
          if (offset !== undefined) {
            if (cmEditor) {
              cmEditor.focus();
              const textBefore = currentMarkdownText.slice(0, offset);
              const lineIndex = textBefore.split('\n').length - 1;
              cmEditor.setCursor(lineIndex, 0);
              cmEditor.scrollIntoView({ line: lineIndex, ch: 0 }, 60);
            } else {
              editorEl.focus();
              editorEl.setSelectionRange(offset, offset);
              scrollEditorToOffset(offset);
            }
          }
        } else {
          h.scrollIntoView({ behavior: 'smooth', block: 'start' });
          updateActiveTocItem(h.id);
        }
      });
      tocEl.appendChild(item);
    });
  }

  function updateActiveTocItem(activeId) {
    tocEl.querySelectorAll('.toc-item').forEach(item => {
      item.classList.toggle('active', item.dataset.target === activeId);
    });
  }

  // 加载文件夹按钮的状态：没加载过时用「加载」，加载过之后允许换一个目录。
  // 按钮文案不带目录名 —— 目录名已经在顶栏 folder-label 里显示了。
  function updateLoadFolderButton() {
    if (!btnLoadFolder) return;
    btnLoadFolder.textContent = currentFolderHandle ? '\u{1F4C1} 更换文件夹...' : '\u{1F4C1} 加载文件夹...';
    btnLoadFolder.title = currentFolderHandle
      ? '重新选择要浏览的目录'
      : '选择包含 Markdown 文件的目录';
  }

  function updateFileCount() {
    const countEl = document.getElementById('file-count');
    if (countEl) countEl.textContent = String(currentFiles.length);
  }

  // 点击左侧文件列表项：走 loadFile 以便复用其错误处理，
  // 同时维护「返回」历史栈（与文档内链接跳转一致）
  async function openFileFromList(path) {
    if (!path || path === currentFile) return;
    if (currentFile) {
      fileHistory.push(currentFile);
      updateBackButton();
    }
    await loadFile(path);
  }

  // 左侧文件列表：按目录分组展示所有可打开的文件，当前文件高亮。
  // 依赖 currentFiles，因此加载文件夹与刷新之后都要重新渲染。
  async function renderFileList() {
    updateFileCount();
    fileListEl.innerHTML = '';

    if (currentFiles.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'file-empty';
      // 空目录与「还没加载文件夹」是两种处境，提示语不能混用
      empty.textContent = currentFolderHandle
        ? '当前目录下没有找到 Markdown 文件'
        : '暂无内容，请先加载文件夹';
      fileListEl.appendChild(empty);
      return;
    }

    const query = normalizePathForMatch(fileFilter.value.trim());
    const visible = query
      ? currentFiles.filter(f => normalizePathForMatch(f.path || f.name).indexOf(query) !== -1)
      : currentFiles;

    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'file-empty';
      empty.textContent = '没有匹配的文件';
      fileListEl.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    let lastDir = null;

    visible.forEach(entry => {
      const path = entry.path || entry.name;
      const slash = path.lastIndexOf('/');
      const dir = slash === -1 ? '' : path.slice(0, slash);
      const baseName = slash === -1 ? path : path.slice(slash + 1);

      // 过滤后的结果里目录可能变得零散，每换一个目录补一个分组标题，
      // 保证「这个文件在哪个子目录」始终可读
      if (dir !== lastDir) {
        const group = document.createElement('div');
        group.className = 'file-dir';
        group.textContent = dir || '根目录';
        if (dir) group.title = dir;
        fragment.appendChild(group);
        lastDir = dir;
      }

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'file-item' + (path === currentFile ? ' active' : '');
      item.dataset.path = path;
      item.title = path;

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '\u{1F4C4}';

      const label = document.createElement('span');
      label.className = 'file-name';
      label.textContent = baseName;

      item.appendChild(icon);
      item.appendChild(label);
      fragment.appendChild(item);
    });

    fileListEl.appendChild(fragment);
  }

  function showEmptyState(msg) {
    contentEl.innerHTML = '<div class="empty-state"><p>' + escapeHtml(msg) + '</p></div>';
    tocEl.innerHTML = '<p class="toc-empty">暂无内容</p>';
  }

  async function renderFile(fileEntry) {
    let handle = fileEntry.handle;
    // 如果可能，从目录重新获取句柄，避免句柄级缓存导致读取到旧内容。
    // 子目录文件必须按 path 逐级取：只传文件名的话根目录没有同名文件时必然
    // 抛 NotFoundError（静默回退，优化失效），而根目录**有**同名文件时更糟 ——
    // getFileHandle 会成功返回根目录那个文件，于是读、编辑、保存全作用在错文件上。
    const relativePath = fileEntry.path;
    if (currentFolderHandle && typeof relativePath === 'string' && relativePath) {
      try {
        const segments = relativePath.split('/').filter(Boolean);
        let dir = currentFolderHandle;
        for (let i = 0; i < segments.length - 1; i++) {
          dir = await dir.getDirectoryHandle(segments[i]);
        }
        handle = await dir.getFileHandle(segments[segments.length - 1]);
      } catch (e) {
        // 忽略错误，回退到传入的句柄
      }
    }
    const file = await handle.getFile();
    const text = await file.text();
    currentMarkdownText = text;
    headingOffsets = parseHeadingOffsets(text);
    const html = MdRender.renderMarkdown(text, marked);
    contentEl.innerHTML = html;
    // 现代模式下 contentEl 是隐藏的，没必要把图片一张张读进内存；
    // 切回传统模式时 setMode() 会重新渲染并解析图片
    if (currentMode !== 'modern') await resolveImages();
    // 编辑模式下保持编辑器/文本区内容与文件内容一致，并尽量保留当前视图位置
    if (isEditMode) {
      if (cmEditor) {
        const cursor = cmEditor.getCursor();
        const scroll = cmEditor.getScrollInfo();
        cmEditor.setValue(currentMarkdownText);
        cmEditor.setCursor(cursor);
        cmEditor.scrollTo(scroll.left, scroll.top);
        cmEditor.refresh();
        cmEditor.focus();
      } else if (editorEl) {
        const selStart = editorEl.selectionStart;
        const scrollTop = editorEl.scrollTop;
        editorEl.value = currentMarkdownText;
        editorEl.setSelectionRange(selStart, selStart);
        editorEl.scrollTop = scrollTop;
        editorEl.focus();
      }
    }
    applySurface();
    renderToc();
    // 只更新高亮不重建列表：过滤框里正打字时重建会让输入框失焦
    updateActiveFileItem();
    renderMermaid();
  }

  function renderMermaid() {
    if (typeof mermaid === 'undefined') return;
    // 现代模式没有独立的 HTML 渲染表面，图表以源码代码块形式留在编辑器里
    if (currentMode === 'modern') return;
    const mermaidBlocks = contentEl.querySelectorAll('.language-mermaid');
    if (mermaidBlocks.length === 0) return;
    mermaid.run({ querySelector: '.language-mermaid' }).catch(e => {
      console.warn('Mermaid render error:', e);
    });
  }

  function clearImageCache() {
    for (const url of imageUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    imageUrlCache.clear();
  }

  // 把 markdown 里的相对图片路径解析成 object URL，否则浏览器会按页面域名去找，
  // 拿不到磁盘上同目录的图片。跳过 http(s)/data/blob/锚点等绝对引用。
  async function resolveImages() {
    if (!currentFolderHandle) return;
    const imgs = contentEl.querySelectorAll('img');
    for (const img of imgs) {
      const rawSrc = img.getAttribute('src') || '';
      if (/^(https?:|data:|blob:|#|\/\/)/i.test(rawSrc)) continue;
      let rel = rawSrc.replace(/^\.\//, '');
      rel = rel.split(/[?#]/)[0];
      if (!rel) continue;
      try {
        rel = decodeURIComponent(rel);
      } catch (e) {
        // 非法 URL 编码，保持原样
      }

      try {
        let url = imageUrlCache.get(rel);
        if (!url) {
          // 按 / 拆段，支持子目录，逐级 getDirectoryHandle
          const segments = rel.split('/').filter(Boolean);
          let dir = currentFolderHandle;
          let fileHandle = null;
          for (let i = 0; i < segments.length; i++) {
            if (i === segments.length - 1) {
              fileHandle = await dir.getFileHandle(segments[i]);
            } else {
              dir = await dir.getDirectoryHandle(segments[i]);
            }
          }
          const file = await fileHandle.getFile();
          url = URL.createObjectURL(file);
          imageUrlCache.set(rel, url);
        }
        img.src = url;
      } catch (e) {
        // 文件不存在或读取失败时保留原 src，便于排查
        console.warn('[LightMDKit] 图片加载失败:', rel, e);
      }
    }
  }

  // 加载目录句柄：扫描目录中的 Markdown 文件并渲染目标文件。
  // selectFolder（手动选择文件夹）与拖放打开（新标签页）共用此逻辑。
  async function loadFolderHandle(dirHandle, preferredFileName) {
    clearImageCache();
    currentFolderHandle = dirHandle;
    folderLabel.textContent = dirHandle.name;
    folderLabel.title = dirHandle.name;

    const files = await collectMarkdownFiles(dirHandle);

    currentFiles = files;
    currentFile = null;
    updateLoadFolderButton();
    await renderFileList();

    if (files.length === 0) {
      showEmptyState('该目录下没有找到 Markdown 文件');
      setStatus('目录下无 Markdown 文件');
      return;
    }

    // preferredFileName 可能是相对路径（文件列表/拖放传入），
    // 也可能只是文件名（旧调用），两种情况都要能定位
    const target = (preferredFileName && findEntryByPath(preferredFileName)) || files[0];
    currentFile = target.path || target.name;
    await renderFile(target);
    updateActiveFileItem();
  }

  // 弹出系统目录选择框，加载所选目录（手动选择与「加载文件夹」按钮共用）
  async function selectFolder() {
    if (!window.showDirectoryPicker) {
      setStatus('浏览器不支持文件夹选择，请使用 Chrome 或 Edge', 'error');
      return;
    }
    try {
      setStatus('等待选择文件夹...');
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await loadFolderHandle(dirHandle);
      if (currentFile) setStatus('加载成功', 'success');
    } catch (e) {
      if (e.name === 'AbortError') {
        setStatus('已取消');
      } else {
        console.error(e);
        setStatus(e.message, 'error');
      }
      updateLoadFolderButton();
    }
  }

  // path 既可传相对路径（文件列表转过来的），也可传文件名（文档内链接）
  async function loadFile(path) {
    const entry = findEntryByPath(path);
    if (!entry) return;
    setStatus('读取文件...');
    try {
      currentFile = entry.path || entry.name;
      // 传统模式切换文件时自动切回浏览模式；现代模式保持常驻编辑态
      if (isEditMode && currentMode !== 'modern') {
        stopAutosave();
        isEditMode = false;
        applySurface();
      }
      await renderFile(entry);
      updateActiveFileItem();
      setStatus('文件已加载', 'success');
    } catch (e) {
      console.error(e);
      setStatus(e.message, 'error');
    }
  }

  // 刷新：既重新扫描目录刷新侧边栏文件列表，也重新读取当前打开的文档。
  // 两件事互相独立 —— 没有打开任何文件时，仍然会把文件列表刷新一遍
  // （否则加载了空目录、或当前文件被移除后就再也扫不到新增的文件了）。
  async function refreshCurrentFile() {
    // 没有目录句柄（拖入的单个文件）时无从扫描，只能重读该文件本身
    if (!currentFolderHandle) {
      if (!currentFile) {
        setStatus('请先加载文件夹', 'error');
        return;
      }
      setStatus('刷新中...');
      try {
        const entry = findEntryByPath(currentFile);
        if (entry) await renderFile(entry);
        setStatus('已刷新', 'success');
      } catch (e) {
        console.error(e);
        setStatus(e.message, 'error');
      }
      return;
    }

    setStatus('刷新中...');
    try {
      // 重新扫描文件夹以发现新增/删除的文件（含子目录）
      const files = await collectMarkdownFiles(currentFolderHandle);
      const oldCount = currentFiles.length;
      const wasRemoved = currentFile ? !files.some(f => f.path === currentFile) : false;
      currentFiles = files;

      // 无论当前有没有打开文件，文件列表都要刷新
      await renderFileList();

      if (!currentFile) {
        setStatus(files.length ? '文件列表已刷新' : '目录下无 Markdown 文件',
          files.length ? 'success' : 'error');
        return;
      }

      if (wasRemoved) {
        currentFile = null;
        updateActiveFileItem();
        showEmptyState('当前文件已被移除');
        setStatus('当前文件已被移除', 'error');
        return;
      }

      // 重新加载当前文件
      const entry = findEntryByPath(currentFile);
      if (entry) {
        await renderFile(entry);
        updateActiveFileItem();
      }

      const newlyAdded = files.length - oldCount;
      if (newlyAdded > 0) {
        setStatus('文件列表已刷新，发现 ' + newlyAdded + ' 个新文件', 'success');
      } else {
        setStatus('已刷新', 'success');
      }
    } catch (e) {
      console.error(e);
      setStatus(e.message, 'error');
    }
  }

  btnRefresh.addEventListener('click', refreshCurrentFile);

  btnNewTab.addEventListener('click', () => {
    window.open(window.location.href, '_blank');
  });

  // 拦截文档中相对路径的 markdown 文件链接，在同目录下时直接在当前页面打开。
  // 支持子目录：href 中的目录部分相对当前文件所在目录解析（link.md 自然覆盖
  // 了原先「同目录」的语义，因为此时相对路径就等于文件名）。
  contentEl.addEventListener('click', async (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    // 跳过外部链接、锚点、mailto 等
    if (/^(https?:|mailto:|#|\/\/)/i.test(href)) return;

    // 先按「相对当前文件所在目录」解析，再退回「相对根目录」，
    // 两种情况都命中不了才放弃（保持与旧逻辑一致的宽松匹配）。
    // decodeURIComponent 对畸形百分号编码（如 a%zz.md）会抛 URIError，
    // 而这里是 async 处理器 —— 不接住的话异常会变成没人看到的 Promise 拒绝，
    // 表现为「点了链接毫无反应」。解不开就当它不是可拦截的相对链接。
    let hrefPath;
    try {
      hrefPath = normalizePathForMatch(decodeURIComponent(href.split(/[?#]/)[0]));
    } catch (err) {
      console.warn('[LightMDKit] 链接编码无法解析，按普通链接处理:', href);
      return;
    }
    if (!hrefPath) return;
    const currentEntry = findEntryByPath(currentFile);
    const baseDir = currentEntry && currentEntry.path && currentEntry.path.indexOf('/') !== -1
      ? currentEntry.path.slice(0, currentEntry.path.lastIndexOf('/') + 1)
      : '';
    const entry = findEntryByPath(baseDir + hrefPath) || findEntryByPath(hrefPath);
    if (entry) {
      e.preventDefault();
      const targetPath = entry.path || entry.name;
      if (currentFile && currentFile !== targetPath) {
        fileHistory.push(currentFile);
        updateBackButton();
      }
      await loadFile(targetPath);
    }
  });

  function updateBackButton() {
    btnBack.disabled = fileHistory.length === 0;
  }

  btnBack.addEventListener('click', async () => {
    if (fileHistory.length === 0) return;
    const prevFile = fileHistory.pop();
    updateBackButton();
    await loadFile(prevFile);
  });

  async function saveCurrentFile(silent = false) {
    if (!currentFile) return;
    // currentFile 是相对路径，同名文件可能分布在多个子目录，必须按 path 取
    const entry = findEntryByPath(currentFile);
    if (!entry) return;
    if (!entry.handle || typeof entry.handle.createWritable !== 'function') {
      const msg = '当前文件来源不支持写回保存';
      if (!silent) setStatus(msg, 'error');
      throw new Error(msg);
    }
    try {
      const writable = await entry.handle.createWritable();
      await writable.write(cmEditor ? cmEditor.getValue() : editorEl.value);
      await writable.close();
      currentMarkdownText = cmEditor ? cmEditor.getValue() : editorEl.value;
      if (!silent) setStatus('已保存', 'success');
    } catch (e) {
      console.error(e);
      setStatus('保存失败: ' + e.message, 'error');
      throw e;
    }
  }

  function startAutosave() {
    if (autosaveTimer) return;
    autosaveTimer = setInterval(async () => {
      if (!isEditMode) return;
      try {
        await saveCurrentFile(true);
      } catch (e) {
        // 自动保存失败已在 saveCurrentFile 内提示，停止定时器避免反复报错
        stopAutosave();
      }
    }, AUTOSAVE_INTERVAL_MS);
  }

  function stopAutosave() {
    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
  }

  // 现代模式专属的按键映射：
  //   Enter —— 列表自动续行（`-` / `*` / `1.` / `- [ ]`），空列表项再回车则退出列表；
  //            由 CodeMirror 官方 addon continuelist 提供（index.html 里引入）。
  //   Tab   —— 表格里新增一行；不在表格里时 tableTabKey 返回 CodeMirror.Pass，
  //            交回默认的缩进行为。
  // 传统模式不挂这两个，按键行为保持原样。
  // 若 continuelist 没加载成功（CDN 失败），不能把不存在的命令名交给 CodeMirror，
  // 否则按 Enter 会报错，所以这里探测一下再决定。
  const MODERN_EXTRA_KEYS = (typeof CodeMirror !== 'undefined' && CodeMirror.commands
    && CodeMirror.commands.newlineAndIndentContinueMarkdownList)
    ? { Enter: 'newlineAndIndentContinueMarkdownList', Tab: tableTabKey }
    : { Tab: tableTabKey };

  // 三种界面形态（传统-浏览 / 传统-编辑 / 现代）的显隐统一由这里决定，
  // 不再散落在 toggleEditMode、loadFile、renderFile 各处分别写内联 style。
  function applySurface() {
    const isModern = currentMode === 'modern';
    // 未加载文件时始终显示空状态提示，不要露出一个空编辑器
    const editorVisible = (isModern || isEditMode) && !!currentFile;

    contentEl.style.display = editorVisible ? 'none' : '';

    if (cmEditor) {
      const wrapper = cmEditor.getWrapperElement();
      wrapper.style.display = editorVisible ? '' : 'none';
      wrapper.classList.toggle('live-preview', isModern);
      // 现代模式不要行号（贴近 Typora）。用 setOption 让 CodeMirror 自己重算布局，
      // 比用 CSS 隐藏 gutter 可靠 —— 后者会残留 gutter 占位宽度。
      cmEditor.setOption('lineNumbers', !isModern);
      // 当前行高亮只在现代模式开，传统模式保持原样（见构造处的说明）
      cmEditor.setOption('styleActiveLine', isModern);
      // 列表续行 / 表格 Tab 只在现代模式生效，传统模式清空以恢复默认按键
      cmEditor.setOption('extraKeys', isModern ? MODERN_EXTRA_KEYS : {});
      if (editorVisible) cmEditor.refresh();
      // 删除线 / 任务框 / 表格标注只在现代模式需要，离开时清掉避免残留
      if (isModern) {
        refreshStrikeMarks();
        refreshTaskMarks();
        refreshTableMarks();
      } else {
        clearStrikeMarks();
        clearTaskMarks();
        clearTableMarks();
      }
    } else {
      editorEl.style.display = editorVisible ? '' : 'none';
    }

    btnEdit.style.display = isModern ? 'none' : '';
    btnEdit.textContent = isEditMode ? '浏览' : '编辑';
    btnEdit.title = isEditMode ? '切换回浏览模式并保存' : '编辑当前文件';

    if (btnMode) {
      btnMode.textContent = isModern ? '传统模式' : '现代模式';
      btnMode.title = isModern
        ? '切换到传统模式（编辑 / 浏览 分离）'
        : '切换到现代模式（Typora 式即时渲染）';
    }
  }

  // 传统模式 ↔ 现代模式
  async function setMode(mode) {
    const next = mode === 'modern' ? 'modern' : 'traditional';
    if (next === currentMode) return;
    if (next === 'modern' && !cmEditor) {
      setStatus('编辑器未就绪，无法进入现代模式', 'error');
      return;
    }

    // 切走之前把编辑器里的最新内容同步回内存，并尽量落盘
    if (isEditMode && currentFile) {
      currentMarkdownText = cmEditor ? cmEditor.getValue() : editorEl.value;
      try {
        await saveCurrentFile(true);
      } catch (e) {
        // 来源不可写（如拖入的单文件）时忽略，不影响模式切换
      }
    }

    currentMode = next;
    saveModePreference(next);

    if (next === 'modern') {
      // 现代模式 = 常驻编辑态
      if (currentFile && cmEditor && !isEditMode) {
        cmEditor.setValue(currentMarkdownText);
      }
      isEditMode = true;
      startAutosave();
    } else {
      // 回到传统模式：停在浏览态，重新渲染预览
      stopAutosave();
      isEditMode = false;
      if (currentFile) {
        contentEl.innerHTML = MdRender.renderMarkdown(currentMarkdownText, marked);
        await resolveImages();
      }
    }

    applySurface();
    if (currentFile) renderToc();
    if (next === 'traditional') renderMermaid();
    if (next === 'modern' && cmEditor) cmEditor.focus();
  }

  async function toggleEditMode() {
    // 现代模式没有编辑/浏览切换，防御性返回
    if (currentMode === 'modern') return;
    if (!currentFile) {
      setStatus('请先加载文件', 'error');
      return;
    }
    if (isEditMode) {
      // 从编辑模式切换到浏览模式：先保存，再停止自动保存
      stopAutosave();
      try {
        await saveCurrentFile();
      } catch (e) {
        // 来源不可写（如拖入的单文件没有可写句柄）时保存会失败，
        // 但不能因此卡在编辑模式 —— 继续切回浏览，错误已由 saveCurrentFile 提示
      }
      contentEl.innerHTML = MdRender.renderMarkdown(currentMarkdownText, marked);
      await resolveImages();
      isEditMode = false;
      applySurface();
      renderToc();
      renderMermaid();
      // 恢复之前记录的滚动位置
      if (lastViewHeadingId) {
        const target = document.getElementById(lastViewHeadingId);
        if (target) {
          target.scrollIntoView({ block: 'start' });
        }
      }
    } else {
      // 从浏览模式切换到编辑模式
      // 记录当前视口最上方的 heading，以便在编辑器中定位到对应位置
      const topHeadingId = getTopVisibleHeadingId();
      lastViewHeadingId = topHeadingId;

      if (cmEditor) cmEditor.setValue(currentMarkdownText);
      else editorEl.value = currentMarkdownText;

      isEditMode = true;
      applySurface();
      startAutosave();

      if (cmEditor) {
        if (topHeadingId && headingOffsets[topHeadingId] !== undefined) {
          const offset = headingOffsets[topHeadingId];
          const textBefore = currentMarkdownText.slice(0, offset);
          const lineIndex = textBefore.split('\n').length - 1;
          cmEditor.setCursor(lineIndex, 0);
          cmEditor.scrollIntoView({ line: lineIndex, ch: 0 }, 60);
        } else {
          cmEditor.setCursor(0, 0);
        }
        cmEditor.focus();
      } else {
        if (topHeadingId && headingOffsets[topHeadingId] !== undefined) {
          const offset = headingOffsets[topHeadingId];
          editorEl.setSelectionRange(offset, offset);
          scrollEditorToOffset(offset);
        } else {
          editorEl.setSelectionRange(0, 0);
          editorEl.scrollTop = 0;
        }
        editorEl.focus();
      }
    }
  }

  btnEdit.addEventListener('click', toggleEditMode);

  if (btnMode) {
    btnMode.addEventListener('click', () => {
      setMode(currentMode === 'modern' ? 'traditional' : 'modern');
    });
  }

  btnToggleToc.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    if (isCollapsed) {
      // 收起时清除内联宽高，让 CSS 类的 40px 生效
      sidebar.style.width = '';
      sidebar.style.minWidth = '';
      sidebar.style.maxWidth = '';
    }
    btnToggleToc.innerHTML = isCollapsed ? '&#9654;' : '&#9664;';
    btnToggleToc.title = isCollapsed ? '显示侧边栏' : '隐藏侧边栏';
  });

  // ---------------- 侧边栏视图：文件列表 / 当前文档目录 ----------------
  async function setSidebarView(view) {
    const next = view === 'toc' ? 'toc' : 'files';
    const changed = next !== sidebarView;
    sidebarView = next;
    if (changed) saveSidebarView(next);

    const isFiles = next === 'files';
    if (filePanel) filePanel.hidden = !isFiles;
    if (tocPanel) tocPanel.hidden = isFiles;
    if (btnViewFiles) btnViewFiles.classList.toggle('active', isFiles);
    if (btnViewToc) btnViewToc.classList.toggle('active', !isFiles);

    // 目录视图的内容由 renderToc 按模式决定（现代模式从编辑器原文解析），
    // 切回来时重建一次，避免显示的是切走之前的旧内容
    if (isFiles) {
      await renderFileList();
    } else {
      renderToc();
    }
  }

  // 只切换高亮、不重建整个列表 —— 读文件会触发这里，而在过滤框里打字时
  // 重建列表会让输入框失焦
  function updateActiveFileItem() {
    fileListEl.querySelectorAll('.file-item').forEach(item => {
      item.classList.toggle('active', item.dataset.path === currentFile);
    });
  }

  btnViewFiles.addEventListener('click', () => setSidebarView('files'));
  btnViewToc.addEventListener('click', () => setSidebarView('toc'));

  fileListEl.addEventListener('click', (e) => {
    const item = e.target.closest('.file-item');
    if (!item) return;
    openFileFromList(item.dataset.path);
  });

  fileFilter.addEventListener('input', () => {
    renderFileList();
  });
  // 按 Esc 清空过滤条件
  fileFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fileFilter.value) {
      e.stopPropagation();
      fileFilter.value = '';
      renderFileList();
    }
  });

  // 拖动调整 sidebar 宽度
  let isResizing = false;
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
      if (sidebar.classList.contains('collapsed')) return;
      isResizing = true;
      sidebar.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
  }

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    const minWidth = 200;
    const maxWidth = 500;
    if (newWidth >= minWidth && newWidth <= maxWidth) {
      sidebar.style.width = newWidth + 'px';
      sidebar.style.minWidth = newWidth + 'px';
      sidebar.style.maxWidth = newWidth + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    sidebar.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // ---------------- 拖放打开：拖入 .md 文件/文件夹时在新标签页打开 ----------------
  // 句柄通过 IndexedDB 传递给新标签页（FileSystemHandle 可结构化克隆存储）。
  // 注意：浏览器安全限制下，拖入的“文件”拿不到其父目录句柄，因此只有当文件
  // 位于当前已加载的目录（isSameEntry 比对）或直接拖入文件夹时，新标签页才能
  // 把文件列表定位到所在目录；否则只能打开单个文件。
  const DROP_DB_NAME = 'lightmdkit';
  const DROP_STORE = 'drops';
  const DROP_TTL_MS = 24 * 60 * 60 * 1000;

  function openDropDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DROP_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DROP_STORE)) {
          req.result.createObjectStore(DROP_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(key, value) {
    const db = await openDropDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DROP_STORE, 'readwrite');
      tx.objectStore(DROP_STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function idbGet(key) {
    const db = await openDropDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(DROP_STORE, 'readonly').objectStore(DROP_STORE).get(key);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  // 清理过期的拖放记录（句柄权限仅随浏览器会话保留，记录无需长期存在）
  async function idbPurgeExpired() {
    try {
      const db = await openDropDb();
      await new Promise((resolve) => {
        const tx = db.transaction(DROP_STORE, 'readwrite');
        const store = tx.objectStore(DROP_STORE);
        const now = Date.now();
        store.openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const v = cursor.value;
            if (!v || !v.ts || now - v.ts > DROP_TTL_MS) cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      });
    } catch (e) { /* IndexedDB 不可用时忽略 */ }
  }

  function hasDraggedFiles(dataTransfer) {
    return !!dataTransfer && Array.from(dataTransfer.types || []).includes('Files');
  }

  // 判断拖入的文件是否位于当前已加载的文件夹中，
  // 若是，新标签页可以把文件列表直接定位到该目录
  async function matchCurrentFolder(fileHandle) {
    if (!currentFolderHandle || !fileHandle) return false;
    for (const f of currentFiles) {
      try {
        if (await f.handle.isSameEntry(fileHandle)) return f.path || f.name;
      } catch (e) { /* 比较失败时忽略 */ }
    }
    return null;
  }

  // 弹窗被拦截时，在状态栏给一个可点击的链接兜底
  function showNewTabLink(url) {
    statusEl.className = 'status';
    statusEl.textContent = '新标签页被拦截，请 ';
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '点击打开';
    statusEl.appendChild(a);
  }

  async function openDropInNewTab(record) {
    const id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    record.ts = Date.now();
    await idbPut(id, record);
    const url = location.pathname + '?drop=' + encodeURIComponent(id);
    const win = window.open(url, '_blank');
    if (!win) showNewTabLink(url);
  }

  async function handleDroppedItems(dataTransfer) {
    let opened = 0;
    const tasks = [];
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== 'file') continue;
      tasks.push((async () => {
        let handle = null;
        if (item.getAsFileSystemHandle) {
          try {
            handle = await item.getAsFileSystemHandle();
          } catch (e) {
            handle = null;
          }
        }
        // 拖入的是文件夹：新标签页直接加载整个目录
        if (handle && handle.kind === 'directory') {
          await openDropInNewTab({ folderHandle: handle });
          opened++;
          return;
        }
        const file = handle ? await handle.getFile() : item.getAsFile();
        if (!file || !isMarkdownName(file.name)) return;
        // matchCurrentFolder 命中时返回该文件在已加载目录中的相对路径，
        // 新标签页据此把文件列表高亮定位到子目录里的对应文件
        const matchedPath = await matchCurrentFolder(handle);
        const record = {
          fileName: file.name,
          filePath: matchedPath || null,
          fileHandle: handle || null,
          fileBlob: handle ? null : file,
          folderHandle: matchedPath ? currentFolderHandle : null,
        };
        await openDropInNewTab(record);
        opened++;
      })());
    }
    await Promise.all(tasks);
    if (opened === 0) {
      setStatus('仅支持拖入 .md / .markdown 文件或文件夹');
    }
  }

  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth++;
    if (dropOverlay) dropOverlay.classList.remove('hidden');
  });
  // 必须阻止默认行为才允许 drop；仅针对文件拖拽，避免影响编辑器内的文本拖放
  document.addEventListener('dragover', (e) => {
    if (hasDraggedFiles(e.dataTransfer)) e.preventDefault();
  });
  document.addEventListener('dragleave', () => {
    dragDepth--;
    if (dragDepth <= 0) {
      dragDepth = 0;
      if (dropOverlay) dropOverlay.classList.add('hidden');
    }
  });
  document.addEventListener('drop', async (e) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth = 0;
    if (dropOverlay) dropOverlay.classList.add('hidden');
    try {
      await handleDroppedItems(e.dataTransfer);
    } catch (err) {
      console.error(err);
      setStatus('拖放打开失败: ' + err.message, 'error');
    }
  });

  // 新标签页启动时：检查 URL 中的 drop 参数，加载拖入的文件/文件夹
  async function initFromDropParam() {
    const dropId = new URLSearchParams(location.search).get('drop');
    if (!dropId) return;

    let record = null;
    try {
      record = await idbGet(dropId);
    } catch (e) {
      console.error(e);
    }
    if (!record) {
      showEmptyState('拖放数据不存在或已过期，请重新拖入文件');
      return;
    }

    try {
      if (record.folderHandle) {
        // 拿到了目录句柄（拖入文件夹，或文件位于当前已加载目录）：
        // 文件列表定位到该目录，并选中对应文件（优先用相对路径，能定位到子目录）
        await loadFolderHandle(record.folderHandle, record.filePath || record.fileName);
        document.title = record.folderHandle.name + ' - LightMDKit';
        if (record.fileName) {
          setStatus('已在新标签页打开 ' + record.fileName, 'success');
        } else {
          setStatus('已在新标签页打开拖入的文件夹', 'success');
        }
      } else {
        // 浏览器安全限制：无法从拖入的单个文件获取其所在目录，仅打开该文件
        const handle = record.fileHandle || {
          getFile: async () => record.fileBlob,
        };
        currentFolderHandle = null;
        // 单文件没有目录，path 就等于文件名 —— 让文件列表与高亮逻辑
        // 始终有唯一的 path 可用，不必到处判空
        currentFiles = [{ name: record.fileName, path: record.fileName, handle }];
        currentFile = record.fileName;
        await renderFileList();
        folderLabel.textContent = record.fileName;
        folderLabel.title = '浏览器安全限制，无法自动定位到文件所在目录';
        document.title = record.fileName + ' - LightMDKit';
        updateLoadFolderButton();
        await renderFile(currentFiles[0]);
        setStatus('已打开拖入的文件（浏览器限制未定位所在目录，可手动“加载文件夹”）');
      }
    } catch (e) {
      console.error(e);
      setStatus('打开拖入内容失败: ' + e.message, 'error');
    }
  }

  if (btnLoadFolder) {
    btnLoadFolder.addEventListener('click', selectFolder);
  }

  let observer = null;
  function setupTocObserver() {
    if (observer) observer.disconnect();
    // 现代模式没有可见的 contentEl 标题，改由光标位置驱动目录高亮
    if (currentMode === 'modern') return;
    const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) return;
    observer = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) updateActiveTocItem(visible[0].target.id);
    }, {
      root: document.querySelector('.content-wrapper'),
      rootMargin: '-56px 0px -70% 0px',
      threshold: 0
    });
    headings.forEach(h => observer.observe(h));
  }

  // 侧边栏不在「目录」视图时，重建目录毫无意义（还会把文件列表挤掉），
  // 直接返回；只有视图是目录时才重建内容并重建滚动高亮监听。
  const renderTocContent = renderToc;
  renderToc = function () {
    if (sidebarView !== 'toc') return;
    renderTocContent();
    setupTocObserver();
  };

  // 启动时应用持久化的模式：现代模式等价于常驻编辑态
  if (currentMode === 'modern') {
    if (cmEditor) {
      isEditMode = true;
      startAutosave();
    } else {
      // CodeMirror 未初始化成功时现代模式无法实现，退回传统模式
      currentMode = 'traditional';
    }
  }
  applySurface();

  updateLoadFolderButton();
  // 恢复上次使用的侧边栏视图（文件列表 / 目录）
  setSidebarView(sidebarView);
  idbPurgeExpired();
  initFromDropParam();
})();
