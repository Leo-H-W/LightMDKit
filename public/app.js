(function () {
  const btnRefresh = document.getElementById('btn-refresh');
  const folderLabel = document.getElementById('folder-label');
  const fileSelect = document.getElementById('file-select');
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

  // { name: string, handle: FileSystemFileHandle }[]
  let currentFiles = [];
  // 当前选中的文件名
  let currentFile = null;
  // 当前文件的原始 markdown 文本
  let currentMarkdownText = '';
  // 标题 id -> markdown 文本中的字符偏移
  let headingOffsets = {};
  // 是否处于编辑模式
  let isEditMode = false;
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
      mode: 'gfm',
      theme: 'github',
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
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

  function renderToc() {
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

  function updateFileSelect() {
    fileSelect.innerHTML = '';

    // disabled placeholder 确保浏览器显示占位文字，不把"加载文件夹..."顶上来
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.textContent = '请先加载文件夹...';
    fileSelect.appendChild(placeholder);

    const loadOpt = document.createElement('option');
    loadOpt.value = '__LOAD_FOLDER__';
    loadOpt.textContent = '\u{1F4C1} 加载文件夹...';
    fileSelect.appendChild(loadOpt);

    if (currentFiles.length === 0) {
      fileSelect.selectedIndex = 0;
      return;
    }

    currentFiles.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.name;
      opt.textContent = f.name;
      fileSelect.appendChild(opt);
    });

    if (currentFile && currentFiles.some(f => f.name === currentFile)) {
      fileSelect.value = currentFile;
    } else {
      fileSelect.selectedIndex = 0;
    }
  }

  function showEmptyState(msg) {
    contentEl.innerHTML = '<div class="empty-state"><p>' + escapeHtml(msg) + '</p></div>';
    tocEl.innerHTML = '<p class="toc-empty">暂无内容</p>';
  }

  async function renderFile(fileEntry) {
    let handle = fileEntry.handle;
    // 如果可能，从目录重新获取句柄，避免句柄级缓存导致读取到旧内容
    if (currentFolderHandle && fileEntry.name) {
      try {
        handle = await currentFolderHandle.getFileHandle(fileEntry.name);
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
    await resolveImages();
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
    renderToc();
    renderMermaid();
  }

  function renderMermaid() {
    if (typeof mermaid === 'undefined') return;
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
        console.warn('[md-view] 图片加载失败:', rel, e);
      }
    }
  }

  async function selectFolder() {
    if (!window.showDirectoryPicker) {
      setStatus('浏览器不支持文件夹选择，请使用 Chrome 或 Edge', 'error');
      updateFileSelect();
      return;
    }
    try {
      setStatus('等待选择文件夹...');
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

      clearImageCache();
      currentFolderHandle = dirHandle;
      folderLabel.textContent = dirHandle.name;
      folderLabel.title = dirHandle.name;

      const files = [];
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file') {
          const ext = name.split('.').pop().toLowerCase();
          if (ext === 'md' || ext === 'markdown') {
            files.push({ name, handle });
          }
        }
      }
      files.sort((a, b) => a.name.localeCompare(b.name));

      currentFiles = files;
      currentFile = null;
      updateFileSelect();

      if (files.length === 0) {
        showEmptyState('该目录下没有找到 Markdown 文件');
        setStatus('目录下无 Markdown 文件');
        return;
      }

      currentFile = files[0].name;
      updateFileSelect();
      await renderFile(files[0]);
      setStatus('加载成功', 'success');
    } catch (e) {
      if (e.name === 'AbortError') {
        setStatus('已取消');
      } else {
        console.error(e);
        setStatus(e.message, 'error');
      }
      updateFileSelect();
    }
  }

  async function loadFile(name) {
    const entry = currentFiles.find(f => f.name === name);
    if (!entry) return;
    setStatus('读取文件...');
    try {
      currentFile = name;
      if (isEditMode) {
        // 切换文件时自动切回浏览模式
        if (cmEditor) cmEditor.getWrapperElement().style.display = 'none';
        contentEl.style.display = '';
        btnEdit.textContent = '编辑';
        btnEdit.title = '编辑当前文件';
        isEditMode = false;
      }
      await renderFile(entry);
      updateFileSelect();
      setStatus('文件已加载', 'success');
    } catch (e) {
      console.error(e);
      setStatus(e.message, 'error');
    }
  }

  async function refreshCurrentFile() {
    if (!currentFile) {
      setStatus('请先加载文件', 'error');
      return;
    }
    if (!currentFolderHandle) {
      setStatus('请先加载文件夹', 'error');
      return;
    }
    setStatus('刷新中...');
    try {
      // 重新扫描文件夹以发现新增/删除的文件
      const files = [];
      for await (const [name, handle] of currentFolderHandle.entries()) {
        if (handle.kind === 'file') {
          const ext = name.split('.').pop().toLowerCase();
          if (ext === 'md' || ext === 'markdown') {
            files.push({ name, handle });
          }
        }
      }
      files.sort((a, b) => a.name.localeCompare(b.name));

      const oldCount = currentFiles.length;

      // 检查当前文件是否仍然存在
      const wasRemoved = !files.some(f => f.name === currentFile);
      currentFiles = files;

      updateFileSelect();

      if (wasRemoved) {
        showEmptyState('当前文件已被移除');
        setStatus('当前文件已被移除', 'error');
        return;
      }

      // 重新加载当前文件
      const entry = currentFiles.find(f => f.name === currentFile);
      if (entry) {
        await renderFile(entry);
      }

      // 检查是否有新文件加入
      const newlyAdded = files.length - oldCount;
      if (newlyAdded > 0) {
        setStatus('文件夹已刷新，发现 ' + newlyAdded + ' 个新文件', 'success');
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

  // 拦截文档中相对路径的 markdown 文件链接，在同目录下时直接在当前页面打开
  contentEl.addEventListener('click', async (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    // 跳过外部链接、锚点、mailto 等
    if (/^(https?:|mailto:|#|\/\/)/i.test(href)) return;
    // 解码并提取文件名（去掉 ./ 前缀）
    const fileName = decodeURIComponent(href.replace(/^\.\//, ''));
    const entry = currentFiles.find(f => f.name === fileName);
    if (entry) {
      e.preventDefault();
      if (currentFile && currentFile !== fileName) {
        fileHistory.push(currentFile);
        updateBackButton();
      }
      await loadFile(fileName);
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

  async function saveCurrentFile() {
    if (!currentFile) return;
    const entry = currentFiles.find(f => f.name === currentFile);
    if (!entry) return;
    try {
      const writable = await entry.handle.createWritable();
      await writable.write(cmEditor ? cmEditor.getValue() : editorEl.value);
      await writable.close();
      currentMarkdownText = cmEditor ? cmEditor.getValue() : editorEl.value;
      setStatus('已保存', 'success');
    } catch (e) {
      console.error(e);
      setStatus('保存失败: ' + e.message, 'error');
      throw e;
    }
  }

  async function toggleEditMode() {
    if (!currentFile) {
      setStatus('请先加载文件', 'error');
      return;
    }
    if (isEditMode) {
      // 从编辑模式切换到浏览模式：先保存
      await saveCurrentFile();
      contentEl.innerHTML = MdRender.renderMarkdown(currentMarkdownText, marked);
      await resolveImages();
      renderToc();
      renderMermaid();
      if (cmEditor) cmEditor.getWrapperElement().style.display = 'none';
      contentEl.style.display = '';
      btnEdit.textContent = '编辑';
      btnEdit.title = '编辑当前文件';
      isEditMode = false;
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

      if (cmEditor) {
        cmEditor.setValue(currentMarkdownText);
        cmEditor.getWrapperElement().style.display = '';
        cmEditor.refresh();
      }
      contentEl.style.display = 'none';
      btnEdit.textContent = '浏览';
      btnEdit.title = '切换回浏览模式并保存';
      isEditMode = true;

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
        editorEl.value = currentMarkdownText;
        editorEl.style.display = '';
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

  btnToggleToc.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    if (isCollapsed) {
      // 收起时清除内联宽高，让 CSS 类的 40px 生效
      sidebar.style.width = '';
      sidebar.style.minWidth = '';
      sidebar.style.maxWidth = '';
    }
    btnToggleToc.innerHTML = isCollapsed ? '&#9654;' : '&#9664;';
    btnToggleToc.title = isCollapsed ? '显示目录' : '隐藏目录';
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

  fileSelect.addEventListener('change', async (e) => {
    const val = e.target.value;
    if (val === '__LOAD_FOLDER__') {
      fileSelect.selectedIndex = 0;
      await selectFolder();
    } else if (val) {
      await loadFile(val);
    }
  });

  let observer = null;
  function setupTocObserver() {
    if (observer) observer.disconnect();
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

  const originalRenderToc = renderToc;
  renderToc = function () {
    originalRenderToc();
    setupTocObserver();
  };

  updateFileSelect();
})();
