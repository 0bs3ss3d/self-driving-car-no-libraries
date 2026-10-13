/*
 * rng.js
 * A small seeded random number generator (mulberry32) plus a string hash
 * (FNV-1a) for turning text seeds into numbers. The simulation never calls
 * Math.random(), so the same seeds always give the same traffic and the same
 * evolution.
 */
(function (SDC) {
  "use strict";

  // FNV-1a: any value -> 32-bit unsigned integer.
  function hashString(value) {
    const text = String(value);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  class RNG {
    // seed: a number (used as a 32-bit integer) or any string.
    constructor(seed) {
      if (typeof seed === "number" && Number.isFinite(seed)) {
        this.state = seed >>> 0;
      } else {
        this.state = hashString(seed);
      }
    }

    // Uniform float in [0, 1).
    next() {
      this.state = (this.state + 0x6d2b79f5) >>> 0;
      let t = this.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Uniform float in [min, max).
    range(min, max) {
      return min + (max - min) * this.next();
    }

    // Uniform integer in [min, max], both ends included.
    int(min, max) {
      return min + Math.floor(this.next() * (max - min + 1));
    }
  }

  SDC.RNG = RNG;
  SDC.hashString = hashString;
})((window.SDC = window.SDC || {}));
