/* 汐站 TideVideo — 首页逻辑。纯本地：无网络请求、无第三方脚本。 */
(function () {
  const { videos } = window.TIDE;
  const { fmtCount, fmtDur, posterCss } = window.TIDEUI;

  /* ---------- 轮播 ---------- */
  const featured = videos.slice(0, 3);
  const track = document.getElementById('heroTrack');
  const dots = document.getElementById('heroDots');
  const hero = track.parentElement;
  let index = 0;
  let timer = null;

  featured.forEach((v, i) => {
    const slide = document.createElement('article');
    slide.className = 'hero-slide';
    slide.style.cssText = posterCss(v.hue);
    slide.innerHTML = `
      <div class="hero-copy">
        <span class="hero-kicker">精选 · ${v.category}</span>
        <h2>${v.title}</h2>
        <p>${v.up.name} · ${fmtCount(v.views)} 次观看 · ${fmtDur(v.duration)}</p>
        <a class="hero-cta" href="watch.html?v=${encodeURIComponent(v.id)}">立即观看</a>
      </div>`;
    track.appendChild(slide);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-selected', String(i === 0));
    dot.setAttribute('aria-label', `第 ${i + 1} 张精选`);
    dot.addEventListener('click', () => go(i));
    dots.appendChild(dot);
  });

  function go(next) {
    index = (next + featured.length) % featured.length;
    track.style.transform = `translateX(${-index * 100}%)`;
    [...dots.children].forEach((d, i) => d.setAttribute('aria-selected', String(i === index)));
    restart();
  }
  function restart() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    clearInterval(timer);
    timer = setInterval(() => go(index + 1), 5200);
  }

  document.getElementById('heroPrev').addEventListener('click', () => go(index - 1));
  document.getElementById('heroNext').addEventListener('click', () => go(index + 1));
  hero.addEventListener('mouseenter', () => clearInterval(timer));
  hero.addEventListener('mouseleave', restart);
  hero.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') go(index - 1);
    if (e.key === 'ArrowRight') go(index + 1);
  });
  restart();

  /* ---------- 分区 chips ---------- */
  const categories = ['全部', ...new Set(videos.map((v) => v.category))];
  const chipBox = document.getElementById('chips');
  let activeCat = '全部';

  categories.forEach((cat) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = cat;
    b.setAttribute('aria-pressed', String(cat === activeCat));
    b.addEventListener('click', () => {
      activeCat = cat;
      [...chipBox.children].forEach((c) => c.setAttribute('aria-pressed', String(c.textContent === cat)));
      render();
    });
    chipBox.appendChild(b);
  });

  /* ---------- 栅格 ---------- */
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const count = document.getElementById('feedCount');
  const search = document.getElementById('q');
  let keyword = '';

  function card(v) {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = `watch.html?v=${encodeURIComponent(v.id)}`;
    a.innerHTML = `
      <div class="card-thumb">
        <div class="card-poster" style="${posterCss(v.hue)}"></div>
        <span class="card-badge">${v.category}</span>
        <span class="card-dur">${fmtDur(v.duration)}</span>
        <div class="card-hover-hint"><span aria-hidden="true">▶</span></div>
      </div>
      <div class="card-body">
        <p class="card-title">${v.title}</p>
        <p class="card-sub">
          <span>${v.up.name}</span><span class="dot">·</span>
          <span>${fmtCount(v.views)} 播放</span><span class="dot">·</span>
          <span>${fmtCount(v.danmaku)} 弹幕</span>
        </p>
      </div>`;
    return a;
  }

  function render() {
    const kw = keyword.trim().toLowerCase();
    const list = videos.filter((v) => {
      const byCat = activeCat === '全部' || v.category === activeCat;
      const byKw =
        !kw ||
        v.title.toLowerCase().includes(kw) ||
        v.up.name.toLowerCase().includes(kw) ||
        v.tags.some((t) => t.toLowerCase().includes(kw));
      return byCat && byKw;
    });
    grid.replaceChildren(...list.map(card));
    empty.hidden = list.length > 0;
    count.textContent = `共 ${list.length} 条（本地演示数据）`;
  }

  search.addEventListener('input', () => {
    keyword = search.value;
    render();
  });

  render();
})();
