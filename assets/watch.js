/* 汐站 TideVideo — 观看页逻辑。
 * 播放：优先使用本地 media/demo.mp4（真实 <video>）；缺失或解码失败时自动
 * 退回 Canvas 模拟画面，控件、进度、弹幕功能保持一致。
 * 弹幕/评论只在本机内存与 localStorage，不发起任何网络请求。 */
(function () {
  const { videos, danmakuTimeline, comments: seedComments } = window.TIDE;
  const { fmtCount, fmtDur, posterCss } = window.TIDEUI;

  const params = new URLSearchParams(location.search);
  const video = videos.find((v) => v.id === params.get('v')) || videos[0];

  /* 编排时间轴的跨度（秒）。真实片段更短时按比例压缩弹幕分布。 */
  const TIMELINE_SPAN = 754;

  /* ---------- 页面信息 ---------- */
  document.title = video.title + ' · 汐站 TideVideo';
  document.getElementById('videoTitle').textContent = video.title;
  const metaEl = document.getElementById('videoMeta');
  const sourceLabel = video.sourceLabel || 'CC0 演示片段';
  function renderMeta(realDuration) {
    metaEl.innerHTML = `
      <span>${fmtCount(video.views)} 次观看</span>
      <span>·</span><span>${fmtCount(video.danmaku)} 条弹幕</span>
      <span>·</span><span>${video.days === 0 ? '今天' : video.days + ' 天前'}</span>
      ${realDuration ? `<span>·</span><span>${sourceLabel} ${fmtDur(realDuration)}</span>` : ''}
      <span>·</span><span>弹幕与评论为本地模拟数据</span>`;
  }
  renderMeta(null);

  document.getElementById('upCard').innerHTML = `
    <div class="up-avatar" aria-hidden="true">${video.up.initial}</div>
    <div class="up-info">
      <div class="up-name">${video.up.name}</div>
      <p class="up-desc">${video.up.desc} · ${video.up.followers} 关注</p>
    </div>
    <button class="up-follow" type="button">关注</button>`;

  document.getElementById('description').innerHTML = `
    <p>${video.desc}</p>
    <div class="tags">${video.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>`;

  /* ---------- 侧栏 ---------- */
  const side = document.getElementById('sideList');
  videos.filter((v) => v.id !== video.id).slice(0, 8).forEach((v) => {
    const a = document.createElement('a');
    a.className = 'side-item';
    a.href = `watch.html?v=${encodeURIComponent(v.id)}`;
    a.innerHTML = `
      <div class="side-thumb" style="${posterCss(v.hue)}"></div>
      <div class="side-body">
        <p class="side-title">${v.title}</p>
        <div class="side-sub">${v.up.name} · ${fmtCount(v.views)} 播放</div>
      </div>`;
    side.appendChild(a);
  });

  /* ---------- 评论 ---------- */
  const COMMENT_KEY = 'tide.comments.' + video.id;
  const commentList = document.getElementById('commentList');
  const commentCount = document.getElementById('commentCount');
  const readJson = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback; } catch { return fallback; }
  };
  let comments = readJson(COMMENT_KEY, seedComments);

  function renderComments() {
    commentList.replaceChildren(...comments.map((c) => {
      const li = document.createElement('li');
      li.className = 'comment';
      li.innerHTML = `
        <div class="c-avatar" aria-hidden="true">${c.initial || c.name.slice(0, 1)}</div>
        <div class="c-body">
          <div class="c-name">${c.name}</div>
          <p class="c-text">${c.text}</p>
          <div class="c-time">${c.hours !== undefined ? c.hours + ' 小时前' : '刚刚'} · 本地</div>
        </div>`;
      return li;
    }));
    commentCount.textContent = `${comments.length} 条`;
  }
  renderComments();

  document.getElementById('commentSend').addEventListener('click', () => {
    const input = document.getElementById('commentInput');
    const text = input.value.trim();
    if (!text) return;
    comments = [{ name: '本机访客', initial: '访', text, hours: undefined }, ...comments];
    localStorage.setItem(COMMENT_KEY, JSON.stringify(comments));
    input.value = '';
    renderComments();
  });

  /* ---------- 元素与状态 ---------- */
  const playerEl = document.getElementById('player');
  const videoEl = document.getElementById('video');
  const stage = document.getElementById('stage');
  const ctx = stage.getContext('2d');
  const layer = document.getElementById('danmakuLayer');
  const badge = document.getElementById('playerBadge');
  /* 弹幕参数按播放器宽度自适应：手机上 21px / 8 轨会挤爆并越界。 */
  const compactPlayer = layer.clientWidth > 0 && layer.clientWidth < 560;
  const dm = new window.Danmaku(layer, compactPlayer
    ? { tracks: 5, fontSize: 16, speedFactor: 6 }
    : { tracks: 8, fontSize: 21, speedFactor: 7 });

  const ui = {
    playBtn: document.getElementById('playBtn'),
    bigPlay: document.getElementById('bigPlay'),
    now: document.getElementById('timeNow'),
    total: document.getElementById('timeTotal'),
    fill: document.getElementById('progressFill'),
    buffer: document.getElementById('progressBuffer'),
    progress: document.getElementById('progress'),
    mute: document.getElementById('muteBtn'),
    rate: document.getElementById('rateBtn'),
    dmToggle: document.getElementById('dmToggle'),
    fs: document.getElementById('fsBtn'),
  };

  const state = {
    t: 0, duration: video.duration, playing: false,
    rate: 1, muted: true, dragging: false, real: false, scale: 1,
  };
  ui.total.textContent = fmtDur(state.duration);

  /* ---------- 弹幕时间轴（统一换算到"播放秒"） ---------- */
  const DM_KEY = 'tide.dm.' + video.id;
  const localDm = readJson(DM_KEY, []);   // 用户在片段里的绝对播放秒
  let timeline = [];
  let dmCursor = 0;

  function buildTimeline(scale, duration) {
    state.scale = scale;
    /* 本机视频（seededDanmaku: false）不预置虚构弹幕，只显示用户自己发的。 */
    const seeded = (video.seededDanmaku === false ? [] : danmakuTimeline)
      .map((e) => ({ ...e, t: e.t * scale, seeded: true }));

    /* 片段远短于编排跨度时（例如 5 秒的 CC0 片段），等比压缩会把所有弹幕挤在
     * 开头一瞬间。此时改为在片段时长内均匀铺开，观感接近真实站点的弹幕密度。 */
    const short = duration < TIMELINE_SPAN * 0.5;
    if (short && seeded.length > 1) {
      const span = Math.max(duration - 0.6, 0.6);
      seeded.forEach((e, i) => {
        e.t = 0.3 + (span * i) / (seeded.length - 1);
      });
    }

    const mine = localDm.map((e) => ({ ...e, seeded: false }));
    timeline = [...seeded, ...mine].sort((a, b) => a.t - b.t);
    dmCursor = 0;
  }

  function resetDanmakuTo(t) {
    dm.clear();
    dmCursor = 0;
    while (dmCursor < timeline.length && timeline[dmCursor].t < t) dmCursor += 1;
  }

  /* ---------- Canvas 回退画面 ---------- */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function drawStage(time, playing) {
    const w = stage.width, h = stage.height;
    const hue = video.hue;
    ctx.clearRect(0, 0, w, h);

    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, `hsl(${hue} 42% 16%)`);
    base.addColorStop(1, `hsl(${(hue + 40) % 360} 46% 9%)`);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    const phase = reduceMotion ? 0.35 : (time / 9) % (Math.PI * 2);
    for (let i = 0; i < 3; i += 1) {
      const cx = w * (0.3 + 0.22 * Math.sin(phase + i * 2.1));
      const cy = h * (0.45 + 0.18 * Math.cos(phase * 1.3 + i * 1.7));
      const r = Math.min(w, h) * (0.34 + i * 0.06);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `hsl(${(hue + i * 34) % 360} 88% 60% / .30)`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = `hsl(${hue} 90% 70% / .22)`;
    ctx.lineWidth = 2;
    for (let k = 0; k < 4; k += 1) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 12) {
        const y = h * 0.72 + k * 16 + Math.sin((x / w) * 6 + phase + k) * 9;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(232,236,244,.94)';
    ctx.font = '600 34px "Segoe UI","Microsoft YaHei",sans-serif';
    const title = video.title.length > 26 ? video.title.slice(0, 26) + '…' : video.title;
    ctx.fillText(title, 56, h - 150);

    ctx.fillStyle = 'rgba(150,160,181,.9)';
    ctx.font = '500 20px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.fillText(`${video.up.name} · ${video.category}`, 56, h - 112);

    ctx.fillStyle = `hsl(${hue} 90% 72%)`;
    ctx.font = '700 16px "Segoe UI",sans-serif';
    ctx.fillText('SIMULATED FRAME · 未找到演示片段，使用模拟画面', 56, 64);

    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '600 26px ui-monospace,Consolas,monospace';
    ctx.fillText(fmtDur(time) + ' / ' + fmtDur(state.duration), 56, h - 40);

    if (!playing) {
      ctx.fillStyle = 'rgba(6,8,12,.35)';
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* ---------- 真实 <video> 接入 ---------- */
  /* 媒体来源优先级：视频自带 media → URL 参数 ?media= → 内置 CC0 片段 */
  const customSrc = params.get('media');
  const mediaSrc = video.media || customSrc;
  if (mediaSrc) videoEl.src = mediaSrc;   // 仅接受同源相对路径或 /videos/ 挂载路径
  videoEl.muted = state.muted;

  function useRealVideo() {
    state.real = true;
    state.duration = Number.isFinite(videoEl.duration) && videoEl.duration > 0
      ? videoEl.duration : video.duration;
    ui.total.textContent = fmtDur(state.duration);
    badge.textContent = `${sourceLabel} · ${fmtDur(state.duration)}`;
    stage.hidden = true;
    videoEl.hidden = false;
    renderMeta(state.duration);
    buildTimeline(state.duration / TIMELINE_SPAN, state.duration);
    resetDanmakuTo(videoEl.currentTime || 0);
    setPlaying(!videoEl.paused);

    /* 支持 ?t=秒 深链（分享带时间点的链接） */
    const startAt = Number(params.get('t'));
    if (Number.isFinite(startAt) && startAt > 0) {
      try {
        videoEl.currentTime = Math.min(startAt, state.duration - 0.05);
        resetDanmakuTo(videoEl.currentTime);
      } catch { /* 元数据边界，忽略 */ }
    }
  }

  function useSimulation() {
    state.real = false;
    state.duration = video.duration;
    ui.total.textContent = fmtDur(state.duration);
    badge.textContent = '模拟画面（无媒体文件）';
    videoEl.hidden = true;
    stage.hidden = false;
    buildTimeline(1, state.duration);
    resetDanmakuTo(state.t);
    setPlaying(false);
  }

  videoEl.addEventListener('loadedmetadata', useRealVideo);
  videoEl.addEventListener('play', () => setPlaying(true));
  videoEl.addEventListener('pause', () => setPlaying(false));
  videoEl.addEventListener('seeking', () => resetDanmakuTo(videoEl.currentTime));
  videoEl.addEventListener('error', useSimulation);

  /* 4 秒内拿不到元数据就当没有媒体，退回模拟（file:// 下个别浏览器会静默失败） */
  const metaTimer = setTimeout(() => {
    if (!state.real) {
      const ready = videoEl.readyState >= 1 && videoEl.videoWidth > 0;
      if (ready) useRealVideo(); else useSimulation();
    }
  }, 4000);

  /* ---------- 播放循环 ---------- */
  let last = performance.now();
  let lastT = 0;

  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (state.real) {
      state.t = videoEl.currentTime;
      if (state.t + 0.4 < lastT) resetDanmakuTo(state.t); // 循环/回退
      lastT = state.t;
    } else if (state.playing && !state.dragging) {
      state.t += dt * state.rate;
      if (state.t >= state.duration) { state.t = state.duration; setPlaying(false); }
    }

    while (dmCursor < timeline.length && timeline[dmCursor].t <= state.t) {
      const d = timeline[dmCursor];
      dm.push(d.text, d.color || '#ffffff');
      dmCursor += 1;
    }

    dm.tick(dt, state.real ? videoEl.paused : (!state.playing || state.dragging));
    if (!state.real) drawStage(state.t, state.playing);
    syncProgress();
    requestAnimationFrame(loop);
  }

  function syncProgress() {
    const pct = state.duration ? Math.min(1, state.t / state.duration) * 100 : 0;
    ui.fill.style.width = pct + '%';

    if (state.real) {
      let buffered = 0;
      try {
        for (let i = 0; i < videoEl.buffered.length; i += 1) {
          if (videoEl.buffered.start(i) <= state.t && state.t <= videoEl.buffered.end(i)) {
            buffered = videoEl.buffered.end(i);
          }
        }
      } catch { buffered = state.t; }
      ui.buffer.style.width = Math.min(100, (buffered / (state.duration || 1)) * 100) + '%';
    } else {
      ui.buffer.style.width = Math.min(100, pct + 15) + '%';
    }

    ui.now.textContent = fmtDur(state.t);
    ui.progress.setAttribute('aria-valuenow', String(Math.round(pct)));
    ui.progress.setAttribute('aria-valuetext', `${fmtDur(state.t)} / ${fmtDur(state.duration)}`);
  }

  function setPlaying(flag) {
    state.playing = flag;
    playerEl.classList.toggle('is-playing', flag);
    ui.playBtn.textContent = flag ? '⏸' : '▶';
    ui.playBtn.setAttribute('aria-label', flag ? '暂停' : '播放');
    ui.bigPlay.setAttribute('aria-label', flag ? '暂停' : '播放');
  }

  function togglePlay() {
    if (state.real) {
      if (videoEl.paused) { videoEl.play().catch(() => {}); } else { videoEl.pause(); }
      return;
    }
    setPlaying(!state.playing);
  }

  ui.playBtn.addEventListener('click', togglePlay);
  ui.bigPlay.addEventListener('click', () => {
    if (state.real && videoEl.paused) videoEl.play().catch(() => {});
    else setPlaying(true);
  });
  playerEl.addEventListener('click', (e) => {
    if (e.target.closest('.player-controls') || e.target.closest('.big-play')) return;
    if (e.target.closest('#dmInput, #dmColor, #dmSend')) return;
    togglePlay();
  });

  /* 进度条：拖拽 + 键盘 */
  function seekToClientX(clientX) {
    const rect = ui.progress.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seekTo(ratio * state.duration);
  }
  function seekTo(t) {
    state.t = Math.max(0, Math.min(state.duration, t));
    if (state.real) {
      try { videoEl.currentTime = state.t; } catch { /* 元数据未就绪 */ }
    }
    resetDanmakuTo(state.t);
  }

  ui.progress.addEventListener('pointerdown', (e) => {
    state.dragging = true;
    ui.progress.setPointerCapture(e.pointerId);
    seekToClientX(e.clientX);
  });
  ui.progress.addEventListener('pointermove', (e) => {
    if (state.dragging) seekToClientX(e.clientX);
  });
  ui.progress.addEventListener('pointerup', (e) => {
    state.dragging = false;
    try { ui.progress.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
  });
  ui.progress.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { seekTo(state.t + step); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { seekTo(state.t - step); e.preventDefault(); }
    if (e.key === 'Home') { seekTo(0); e.preventDefault(); }
    if (e.key === 'End') { seekTo(state.duration); e.preventDefault(); }
  });

  ui.mute.addEventListener('click', () => {
    state.muted = !state.muted;
    videoEl.muted = state.muted;
    videoEl.volume = state.muted ? 0 : 1;
    ui.mute.textContent = state.muted ? '🔇' : '🔊';
    ui.mute.setAttribute('aria-label', state.muted ? '取消静音' : '静音');
  });
  /* 片段默认静音（浏览器自动播放策略）；首次交互自动取消静音，更像"能听见"。 */
  playerEl.addEventListener('pointerdown', function unmuteOnce() {
    playerEl.removeEventListener('pointerdown', unmuteOnce);
    if (state.muted) { state.muted = false; videoEl.muted = false; videoEl.volume = 1; ui.mute.textContent = '🔊'; }
  }, { once: true });

  const RATES = [1, 1.25, 1.5, 2, 0.75];
  ui.rate.addEventListener('click', () => {
    state.rate = RATES[(RATES.indexOf(state.rate) + 1) % RATES.length];
    videoEl.playbackRate = state.rate;
    ui.rate.textContent = state.rate.toFixed(2).replace(/0$/, '') + '×';
  });

  ui.dmToggle.addEventListener('click', () => {
    const on = ui.dmToggle.getAttribute('aria-pressed') !== 'true';
    ui.dmToggle.setAttribute('aria-pressed', String(on));
    dm.setVisible(on);
  });

  ui.fs.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else playerEl.requestFullscreen?.();
  });

  /* ---------- 发送弹幕 ---------- */
  const dmInput = document.getElementById('dmInput');
  document.getElementById('dmSend').addEventListener('click', () => {
    const color = document.getElementById('dmColor').value;
    const text = dmInput.value.trim().slice(0, 60);
    if (!text) return;
    dm.push(text, color);
    const entry = { t: Number(state.t.toFixed(2)), text, color };
    const saved = readJson(DM_KEY, []);
    saved.push(entry);
    localStorage.setItem(DM_KEY, JSON.stringify(saved));
    timeline.push({ ...entry, seeded: false });
    timeline.sort((a, b) => a.t - b.t);
    dmInput.value = '';
  });
  dmInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('dmSend').click();
  });

  /* ---------- 快捷键 ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    switch (e.key.toLowerCase()) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'd': ui.dmToggle.click(); break;
      case 'f': ui.fs.click(); break;
      case 'm': ui.mute.click(); break;
      case 'arrowright': seekTo(state.t + 5); break;
      case 'arrowleft': seekTo(state.t - 5); break;
      default: break;
    }
  });

  window.addEventListener('resize', () => dm.resize());

  /* ---------- 启动 ---------- */
  buildTimeline(1, video.duration);
  resetDanmakuTo(0);
  drawStage(0, false);
  requestAnimationFrame(loop);
  /* 静音自动播放：多数浏览器允许；被拒绝就停在首帧等用户点。 */
  videoEl.play().catch(() => setPlaying(false));
  setTimeout(() => { if (!state.real && metaTimer) clearTimeout(metaTimer); }, 6000);
})();
