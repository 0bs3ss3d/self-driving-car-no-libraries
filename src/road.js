/*
 * road.js
 * A straight multi-lane road along the y axis that is long enough to feel
 * endless. Provides lane centres, the two border segments used for sensing and
 * collision, and a draw method that paints only the visible slice.
 */
(function (SDC) {
  "use strict";

  const FAR = 1e9; // the road's ends: about 64 days of driving at top speed
  const SURFACE = "#d3d3d3";
  const PAINT = "#f4f4ef";
  const DASH = 24;
  const GAP = 24;
  const MAX_VIEW = 20000; // px; guards the dash loop against a bad view range

  class Road {
    // options: { centerX, laneCount, laneWidth }
    constructor(options) {
      const o = options || {};
      const lanes = Math.floor(Number(o.laneCount));
      if (!(lanes >= 1)) throw new Error("Road: laneCount must be at least 1");
      if (!(Number(o.laneWidth) > 0)) throw new Error("Road: laneWidth must be a positive number");
      this.centerX = Number(o.centerX) || 0;
      this.laneCount = lanes;
      this.laneWidth = Number(o.laneWidth);
      this.width = lanes * this.laneWidth;
      this.left = this.centerX - this.width / 2;
      this.right = this.centerX + this.width / 2;
      this.top = -FAR;
      this.bottom = FAR;
      this.borders = [
        [{ x: this.left, y: this.top }, { x: this.left, y: this.bottom }],
        [{ x: this.right, y: this.top }, { x: this.right, y: this.bottom }],
      ];
    }

    // x of the centre of lane `index` (0 = leftmost); out-of-range indexes clamp.
    laneCenter(index) {
      const i = SDC.geom.clamp(Math.floor(index), 0, this.laneCount - 1);
      return this.left + this.laneWidth * (i + 0.5);
    }

    // Paints the road between world y = viewTop and y = viewBottom.
    draw(ctx, viewTop, viewBottom) {
      if (!(viewBottom > viewTop)) return;
      const bottom = Math.min(viewBottom, viewTop + MAX_VIEW);
      ctx.fillStyle = SURFACE;
      ctx.fillRect(this.left, viewTop, this.width, bottom - viewTop);

      // Dashes are anchored to world y, so they scroll with the road.
      const period = DASH + GAP;
      const first = Math.floor(viewTop / period) * period;
      ctx.strokeStyle = PAINT;
      ctx.lineCap = "butt";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let lane = 1; lane < this.laneCount; lane++) {
        const x = this.left + lane * this.laneWidth;
        for (let y = first; y < bottom; y += period) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + DASH);
        }
      }
      ctx.stroke();

      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(this.left, viewTop);
      ctx.lineTo(this.left, bottom);
      ctx.moveTo(this.right, viewTop);
      ctx.lineTo(this.right, bottom);
      ctx.stroke();
    }
  }

  SDC.Road = Road;
})((window.SDC = window.SDC || {}));
