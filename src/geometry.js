/*
 * geometry.js
 * Vector helpers, ray/segment intersection and polygon collision tests.
 *
 * COORDINATE AND ANGLE CONVENTION (every file in this project uses it)
 *   - World units are pixels. x grows to the right and y grows DOWNWARD,
 *     exactly like the canvas. Driving forward along the road means y DECREASES.
 *   - Angles are radians. Angle 0 points along +x. Positive angles turn
 *     CLOCKWISE on screen (because y points down). That is also what
 *     ctx.rotate() does, so physics and drawing agree.
 *   - A heading `angle` has direction vector (cos(angle), sin(angle)).
 *     A car driving up the road has angle -PI/2.
 *     Its right-hand side points along (-sin(angle), cos(angle)).
 *   - Steering right increases the angle; steering left decreases it.
 *   - Points are plain objects {x, y}. Polygons are arrays of points listed
 *     around the outline. Segments are two-element arrays [a, b].
 */
(function (SDC) {
  "use strict";

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  // Where segment AB crosses segment CD.
  // Returns {x, y, t} with t in [0, 1] measured along AB, or null.
  // Parallel and collinear pairs count as "no crossing".
  function segmentIntersection(a, b, c, d) {
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const denom = rx * sy - ry * sx;
    if (denom === 0) return null;
    const qx = c.x - a.x;
    const qy = c.y - a.y;
    const t = (qx * sy - qy * sx) / denom;
    if (t < 0 || t > 1) return null;
    const u = (qx * ry - qy * rx) / denom;
    if (u < 0 || u > 1) return null;
    return { x: a.x + rx * t, y: a.y + ry * t, t: t };
  }

  // Even-odd rule: is point p inside polygon poly?
  function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y)) {
        const crossX = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (p.x < crossX) inside = !inside;
      }
    }
    return inside;
  }

  // Does segment AB touch polygon poly (crossing an edge or lying inside it)?
  function polygonIntersectsSegment(poly, a, b) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      if (segmentIntersection(p1, p2, a, b)) return true;
    }
    return pointInPolygon(a, poly);
  }

  // Do two simple polygons overlap (edges cross, or one contains the other)?
  function polygonsIntersect(polyA, polyB) {
    for (let i = 0; i < polyA.length; i++) {
      const a1 = polyA[i];
      const a2 = polyA[(i + 1) % polyA.length];
      for (let j = 0; j < polyB.length; j++) {
        const b1 = polyB[j];
        const b2 = polyB[(j + 1) % polyB.length];
        if (segmentIntersection(a1, a2, b1, b2)) return true;
      }
    }
    return pointInPolygon(polyA[0], polyB) || pointInPolygon(polyB[0], polyA);
  }

  // Corners of a rectangle centred on (cx, cy): `length` along the heading,
  // `width` across it. Order: front-right, front-left, rear-left, rear-right.
  // Pass `out` (an array of four points) to update it in place.
  function orientedRect(cx, cy, angle, length, width, out) {
    const fx = Math.cos(angle);
    const fy = Math.sin(angle);
    const rx = -fy; // right-hand side, see the convention above
    const ry = fx;
    const hl = length / 2;
    const hw = width / 2;
    const pts = out || [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    pts[0].x = cx + fx * hl + rx * hw;
    pts[0].y = cy + fy * hl + ry * hw;
    pts[1].x = cx + fx * hl - rx * hw;
    pts[1].y = cy + fy * hl - ry * hw;
    pts[2].x = cx - fx * hl - rx * hw;
    pts[2].y = cy - fy * hl - ry * hw;
    pts[3].x = cx - fx * hl + rx * hw;
    pts[3].y = cy - fy * hl + ry * hw;
    return pts;
  }

  SDC.geom = {
    lerp: lerp,
    clamp: clamp,
    segmentIntersection: segmentIntersection,
    pointInPolygon: pointInPolygon,
    polygonIntersectsSegment: polygonIntersectsSegment,
    polygonsIntersect: polygonsIntersect,
    orientedRect: orientedRect,
  };
})((window.SDC = window.SDC || {}));
