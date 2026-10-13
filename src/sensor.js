/*
 * sensor.js
 * Ray-cast "eyes" for a car. Rays start at the car's centre and fan out
 * symmetrically around its heading, ordered LEFT to RIGHT (ray 0 is the
 * leftmost). Each reading is normalised to 0..1:
 *   0 = nothing within the ray's length, 1 = obstacle at the car's centre.
 * update() is pure simulation; draw() is the only canvas code.
 */
(function (SDC) {
  "use strict";

  class Sensor {
    // options: { rayCount, raySpread (radians, total fan width), rayLength (px) }
    constructor(options) {
      const o = options || {};
      const count = Math.floor(Number(o.rayCount));
      if (!(count >= 1)) throw new Error("Sensor: rayCount must be at least 1");
      if (!(Number(o.rayLength) > 0)) throw new Error("Sensor: rayLength must be a positive number");
      if (!(Number(o.raySpread) >= 0)) throw new Error("Sensor: raySpread must be zero or more");
      this.rayCount = count;
      this.raySpread = Number(o.raySpread);
      this.rayLength = Number(o.rayLength);
      this.rays = [];
      this.hits = [];
      this.readings = [];
      for (let i = 0; i < count; i++) {
        this.rays.push({ start: { x: 0, y: 0 }, end: { x: 0, y: 0 } });
        this.hits.push(null);
        this.readings.push(0);
      }
    }

    // Heading offset of ray i: negative = left of the nose, positive = right.
    rayOffset(i) {
      if (this.rayCount === 1) return 0;
      return SDC.geom.lerp(-this.raySpread / 2, this.raySpread / 2, i / (this.rayCount - 1));
    }

    // borders: array of [a, b] segments. obstacles: array of polygons.
    update(car, borders, obstacles) {
      const intersect = SDC.geom.segmentIntersection;
      for (let i = 0; i < this.rayCount; i++) {
        const ray = this.rays[i];
        const angle = car.angle + this.rayOffset(i);
        ray.start.x = car.x;
        ray.start.y = car.y;
        ray.end.x = car.x + Math.cos(angle) * this.rayLength;
        ray.end.y = car.y + Math.sin(angle) * this.rayLength;

        let closest = null;
        for (let b = 0; b < borders.length; b++) {
          const hit = intersect(ray.start, ray.end, borders[b][0], borders[b][1]);
          if (hit && (closest === null || hit.t < closest.t)) closest = hit;
        }
        for (let p = 0; p < obstacles.length; p++) {
          const poly = obstacles[p];
          for (let k = 0; k < poly.length; k++) {
            const hit = intersect(ray.start, ray.end, poly[k], poly[(k + 1) % poly.length]);
            if (hit && (closest === null || hit.t < closest.t)) closest = hit;
          }
        }
        this.hits[i] = closest;
        this.readings[i] = closest ? 1 - closest.t : 0;
      }
    }

    draw(ctx) {
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      for (let i = 0; i < this.rayCount; i++) {
        const ray = this.rays[i];
        const hit = this.hits[i];
        const reach = hit || ray.end;
        ctx.strokeStyle = "rgba(242, 183, 5, 0.95)";
        ctx.beginPath();
        ctx.moveTo(ray.start.x, ray.start.y);
        ctx.lineTo(reach.x, reach.y);
        ctx.stroke();
        if (hit) {
          ctx.strokeStyle = "rgba(46, 48, 51, 0.35)";
          ctx.beginPath();
          ctx.moveTo(hit.x, hit.y);
          ctx.lineTo(ray.end.x, ray.end.y);
          ctx.stroke();
          ctx.fillStyle = "#2e3033";
          ctx.beginPath();
          ctx.arc(hit.x, hit.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  SDC.Sensor = Sensor;
})((window.SDC = window.SDC || {}));
