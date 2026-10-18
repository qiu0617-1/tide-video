/* 汐站 TideVideo — 两个页面共用的纯函数（格式化与封面渐变）。
 * 单独成文件，避免观看页依赖首页脚本。 */
window.TIDEUI = (() => {
  const fmtCount = (n) =>
    n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n);

  const fmtDur = (s) => {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  };

  /* 封面：hue 派生渐变，零图片资源。 */
  const posterCss = (hue) =>
    `background:
       radial-gradient(120% 90% at 22% 18%, hsl(${hue} 82% 62% / .85), transparent 58%),
       radial-gradient(110% 110% at 82% 84%, hsl(${(hue + 46) % 360} 74% 48% / .8), transparent 62%),
       linear-gradient(140deg, hsl(${hue} 40% 22%), hsl(${(hue + 30) % 360} 44% 12%));`;

  return { fmtCount, fmtDur, posterCss };
})();
