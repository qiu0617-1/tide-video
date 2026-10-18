/* 汐站 TideVideo — 弹幕引擎（原创实现）。
 * 思路：不使用第三方库。轨道 = 固定条数；能否复用某轨道，取决于该轨道上
 * 最后一条弹幕的「右边缘」是否已经让出足够安全间距。速度与播放速率解耦，
 * 暂停时整体冻结，这样 seek/变速都不会让弹幕堆叠。 */
(function () {
  class Danmaku {
    constructor(layer, { tracks = 8, fontSize = 21, speedFactor = 7 } = {}) {
      this.layer = layer;
      this.tracks = tracks;
      this.fontSize = fontSize;
      this.speedFactor = speedFactor;      // 约 speedFactor 秒横扫一屏
      this.items = [];
      this.lanes = Array.from({ length: tracks }, () => ({ lastRight: -Infinity }));
      this.visible = true;
      this._probe = null;
      this._layerWidth = layer.clientWidth || 1280;
    }

    _measure(text) {
      if (!this._probe) {
        this._probe = document.createElement('span');
        this._probe.className = 'dm';
        this._probe.style.visibility = 'hidden';
        this._probe.style.left = '-9999px';
        this._probe.style.top = '0';
        this.layer.appendChild(this._probe);
      }
      this._probe.textContent = text;
      this._probe.style.fontSize = this.fontSize + 'px';
      return this._probe.offsetWidth;
    }

    _laneTop(lane) {
      return 10 + lane * Math.round(this.fontSize * 1.75);
    }

    /** 试着把一条弹幕放进某条轨道；放不下就丢弃（不排队，避免延迟感）。 */
    push(text, color = '#ffffff') {
      if (!this.visible || !text) return false;
      this._layerWidth = this.layer.clientWidth || this._layerWidth;
      const width = this._measure(text);

      let lane = -1;
      for (let i = 0; i < this.tracks; i += 1) {
        const lastRight = this.lanes[i].lastRight;
        // 轨道为空，或最后一条已经完全进入画面且留出安全间距
        if (lastRight === -Infinity || lastRight < this._layerWidth - 40) { lane = i; break; }
      }
      if (lane === -1) return false;

      const el = document.createElement('span');
      el.className = 'dm';
      el.textContent = text;
      el.style.color = color;
      el.style.fontSize = this.fontSize + 'px';
      el.style.top = this._laneTop(lane) + 'px';
      el.style.transform = `translate3d(${this._layerWidth}px,0,0)`;
      this.layer.appendChild(el);

      /* 恒定速度：若按宽度补偿速度，宽弹幕会追上同轨的窄弹幕造成重叠。
       * 统一速度后，同轨后发的弹幕永远不会追尾，轨道复用判据也就成立。 */
      const speed = this._layerWidth / this.speedFactor; // px/s
      const item = { el, x: this._layerWidth, width, speed, lane };
      this.items.push(item);
      this.lanes[lane].lastRight = this._layerWidth + width;
      return true;
    }

    /** 每帧推进。dt 为秒；paused 时只渲染不前进。 */
    tick(dt, paused) {
      const step = paused ? 0 : dt;

      /* 轨道占用 = 该轨道上所有弹幕右边缘的最大值。
       * （逐条覆盖会写成"最后处理的那条"的边缘，让轨道被误判为空、提前复用。） */
      for (let i = 0; i < this.lanes.length; i += 1) this.lanes[i].lastRight = -Infinity;

      for (let i = this.items.length - 1; i >= 0; i -= 1) {
        const it = this.items[i];
        it.x -= it.speed * step;
        it.el.style.transform = `translate3d(${it.x.toFixed(1)}px,0,0)`;
        const right = it.x + it.width;
        if (right > this.lanes[it.lane].lastRight) this.lanes[it.lane].lastRight = right;

        if (right < -40) {
          it.el.remove();
          this.items.splice(i, 1);
        }
      }
    }

    setVisible(flag) {
      this.visible = flag;
      this.layer.style.display = flag ? '' : 'none';
      if (!flag) this.clear();
    }

    clear() {
      this.items.forEach((it) => it.el.remove());
      this.items = [];
      this.lanes.forEach((l) => { l.lastRight = -Infinity; });
    }

    resize() {
      this._layerWidth = this.layer.clientWidth || this._layerWidth;
    }
  }

  window.Danmaku = Danmaku;
})();
