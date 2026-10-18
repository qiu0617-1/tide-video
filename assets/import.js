/* 汐站 TideVideo — 本地视频导入。
 * 纯前端：用 <input type=file> 或拖拽选片，经 URL.createObjectURL 在页面内播放。
 * 文件不会上传到任何服务器（无 fetch / XHR / WebSocket），刷新页面即释放。
 */
(function () {
  const MAX_ITEMS = 20;
  const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 单个文件 2 GB 上限（仅提示，不阻断）

  const state = { items: [], nextId: 1 };

  const els = {};
  let dialogVideo = null;

  const fmtMB = (n) => (n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + ' GB' : (n / 1024 ** 2).toFixed(1) + ' MB');
  const fmtDur = (s) => {
    if (!Number.isFinite(s)) return '—';
    const m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  };

  /** 只读元数据：能否解码、时长、分辨率。不下载、不上传。 */
  function probe(url) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.playsInline = true;
      let settled = false;
      const finish = (playable) => {
        if (settled) return;
        settled = true;
        resolve({
          playable,
          duration: Number.isFinite(v.duration) ? v.duration : null,
          width: v.videoWidth,
          height: v.videoHeight,
        });
        v.removeAttribute('src');
        v.load();
      };
      v.addEventListener('loadedmetadata', () => {
        // 有画面尺寸才算真的能解码（HEVC 等会给出 0×0）
        if (v.videoWidth > 0) finish(true);
        else v.addEventListener('loadeddata', () => finish(v.videoWidth > 0), { once: true });
      });
      v.addEventListener('error', () => finish(false));
      setTimeout(() => finish(v.videoWidth > 0), 6000);
      v.src = url;
    });
  }

  /* 提示层必须有兜底隐藏：浏览器事件顺序不可靠（拖到 iframe、被其他窗口抢走时
     可能收不到 dragleave），否则会一直挡住整页。放在模块级，供 addFiles 调用。 */
  let hideTimer = null;
  function showHint() {
    if (!els.dropHint) return;
    els.dropHint.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideHint, 8000);
  }
  function hideHint() {
    clearTimeout(hideTimer);
    if (els.dropHint) els.dropHint.hidden = true;
  }

  /** 抓一帧当封面：解码不了（HEVC 等）就返回 null，卡片保持渐变占位。 */
  function grabPoster(url, duration) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.playsInline = true;
      let done = false;
      const finish = (val) => { if (!done) { done = true; resolve(val); v.removeAttribute('src'); v.load(); } };
      v.addEventListener('loadeddata', () => {
        try { v.currentTime = Math.min(1, Math.max(0.1, (duration || 1) * 0.1)); } catch { finish(null); }
      });
      v.addEventListener('seeked', () => {
        try {
          const c = document.createElement('canvas');
          c.width = 480;
          c.height = Math.max(1, Math.round(480 * v.videoHeight / v.videoWidth));
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          finish(c.toDataURL('image/jpeg', 0.72));
        } catch { finish(null); }
      }, { once: true });
      v.addEventListener('error', () => finish(null));
      setTimeout(() => finish(null), 5000);
      v.src = url;
    });
  }

  async function addFiles(fileList) {
    hideHint();
    const files = [...fileList].filter((f) => f.type.startsWith('video/') || /\.(mp4|webm|m4v|mov|mkv)$/i.test(f.name));
    if (!files.length) return { added: 0, skipped: fileList.length };

    let added = 0;
    for (const file of files) {
      if (state.items.length >= MAX_ITEMS) break;
      const url = URL.createObjectURL(file);
      const meta = await probe(url);
      const poster = meta.playable ? await grabPoster(url, meta.duration) : null;
      state.items.push({
        id: state.nextId++,
        name: file.name,
        size: file.size,
        url,
        poster,
        ...meta,
        oversized: file.size > MAX_BYTES,
      });
      added += 1;
    }
    render();
    if (added) els.section.hidden = false;
    return { added, skipped: fileList.length - files.length };
  }

  function remove(item) {
    URL.revokeObjectURL(item.url);
    state.items = state.items.filter((x) => x.id !== item.id);
    if (!state.items.length) els.section.hidden = true;
    render();
  }

  function openPlayer(item) {
    els.dlgTitle.textContent = item.name;
    els.dlgMeta.textContent =
      `${fmtDur(item.duration)} · ${item.width}×${item.height} · ${fmtMB(item.size)}` +
      (item.playable ? ' · 本地播放，未上传' : ' · 该编码浏览器无法解码（HEVC 等需先转 H.264）');
    dialogVideo.src = item.url;
    els.dialog.showModal();
    dialogVideo.play().catch(() => {});
  }

  function render() {
    els.grid.replaceChildren(...state.items.map((item) => {
      const card = document.createElement('div');
      card.className = 'card import-card';

      const thumb = document.createElement('div');
      thumb.className = 'card-thumb import-thumb';
      const posterStyle = item.poster
        ? `background:url(${item.poster}) center/cover no-repeat`
        : 'background:linear-gradient(140deg,#1d2733,#0e1418)';
      thumb.innerHTML = `<div class="card-poster" style="${posterStyle}"></div>
        <span class="card-badge">${item.playable ? '本机导入' : '编码不支持'}</span>
        <span class="card-dur">${fmtDur(item.duration)}</span>
        <div class="card-hover-hint"><span aria-hidden="true">${item.playable ? '▶' : '!'}</span></div>`;
      thumb.addEventListener('click', () => openPlayer(item));

      const body = document.createElement('div');
      body.className = 'card-body';
      body.innerHTML = `<p class="card-title" title="${item.name}">${item.name}</p>
        <p class="card-sub"><span>${item.width}×${item.height}</span><span class="dot">·</span>
        <span>${fmtMB(item.size)}</span></p>`;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'import-del';
      del.textContent = '✕';
      del.setAttribute('aria-label', '移除 ' + item.name);
      del.addEventListener('click', (e) => { e.stopPropagation(); remove(item); });

      card.append(thumb, body, del);
      return card;
    }));
    els.count.textContent = state.items.length ? `${state.items.length} 个（仅本机，刷新即消失）` : '';
  }

  function init() {
    els.btn = document.getElementById('importBtn');
    els.picker = document.getElementById('filePicker');
    els.section = document.getElementById('importedSection');
    els.grid = document.getElementById('importedGrid');
    els.count = document.getElementById('importedCount');
    els.clear = document.getElementById('clearImports');
    els.dialog = document.getElementById('playerDialog');
    els.dlgTitle = document.getElementById('dlgTitle');
    els.dlgMeta = document.getElementById('dlgMeta');
    els.dlgClose = document.getElementById('dlgClose');
    els.dropHint = document.getElementById('dropHint');
    dialogVideo = document.getElementById('dlgVideo');
    if (!els.btn) return;

    els.btn.addEventListener('click', () => els.picker.click());
    els.picker.addEventListener('change', async () => {
      await addFiles(els.picker.files);
      els.picker.value = '';
    });

    els.clear.addEventListener('click', () => {
      state.items.forEach((i) => URL.revokeObjectURL(i.url));
      state.items = [];
      els.section.hidden = true;
      render();
    });

    els.dlgClose.addEventListener('click', () => els.dialog.close());
    els.dialog.addEventListener('close', () => { dialogVideo.pause(); dialogVideo.removeAttribute('src'); });

    /* 拖拽导入 */
    let depth = 0;

    window.addEventListener('dragenter', (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      depth += 1;
      showHint();
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) hideHint();
    });
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      hideHint();
      await addFiles(e.dataTransfer.files);
    });
    window.addEventListener('dragend', hideHint);
    window.addEventListener('blur', hideHint);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
