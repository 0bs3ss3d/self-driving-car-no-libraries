/*
 * network.js
 * A small feed-forward neural network written from scratch.
 * Layer sizes such as [5, 6, 4] mean 5 inputs (sensor readings), one hidden
 * layer of 6 neurons, and 4 outputs (forward, left, right, reverse).
 *   - Hidden neurons: tanh(weighted sum + bias), so values lie in -1..1.
 *   - Output neurons: on (1) when weighted sum + bias > 0, otherwise off (0).
 * Every weight and bias stays inside [-1, 1].
 * Pure logic: no DOM, no canvas, no storage.
 */
(function (SDC) {
  "use strict";

  const FORMAT = "sdc-network";
  const FORMAT_VERSION = 1;
  const MAX_LAYER_SIZE = 256;

  class Level {
    constructor(inputCount, outputCount) {
      this.inputs = new Array(inputCount).fill(0);
      this.outputs = new Array(outputCount).fill(0);
      this.biases = new Array(outputCount).fill(0);
      this.weights = []; // weights[i][j] connects input i to output j
      for (let i = 0; i < inputCount; i++) this.weights.push(new Array(outputCount).fill(0));
    }
  }

  function isValidLayout(sizes) {
    if (!Array.isArray(sizes) || sizes.length < 2) return false;
    for (let i = 0; i < sizes.length; i++) {
      const n = sizes[i];
      if (!Number.isInteger(n) || n < 1 || n > MAX_LAYER_SIZE) return false;
    }
    return true;
  }

  function isUnitArray(values, length) {
    if (!Array.isArray(values) || values.length !== length) return false;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (typeof v !== "number" || !Number.isFinite(v) || v < -1 || v > 1) return false;
    }
    return true;
  }

  class NeuralNetwork {
    // layerSizes: e.g. [5, 6, 4]. rng: an SDC.RNG for random weights, or
    // nothing for an all-zero network (used by clone and fromJSON).
    constructor(layerSizes, rng) {
      if (!isValidLayout(layerSizes)) {
        throw new Error("NeuralNetwork: layerSizes must list at least two whole numbers from 1 to " + MAX_LAYER_SIZE);
      }
      this.layerSizes = layerSizes.slice();
      this.levels = [];
      for (let l = 0; l < layerSizes.length - 1; l++) {
        const level = new Level(layerSizes[l], layerSizes[l + 1]);
        if (rng) {
          for (let j = 0; j < level.biases.length; j++) level.biases[j] = rng.range(-1, 1);
          for (let i = 0; i < level.weights.length; i++) {
            const row = level.weights[i];
            for (let j = 0; j < row.length; j++) row[j] = rng.range(-1, 1);
          }
        }
        this.levels.push(level);
      }
    }

    // Runs inputs through every level. Returns the output level's array
    // (one 0/1 value per control). Missing or non-finite inputs count as 0.
    feedForward(inputs) {
      let values = inputs;
      const last = this.levels.length - 1;
      for (let l = 0; l <= last; l++) {
        const level = this.levels[l];
        const ins = level.inputs;
        const outs = level.outputs;
        for (let i = 0; i < ins.length; i++) {
          const v = values[i];
          ins[i] = typeof v === "number" && Number.isFinite(v) ? v : 0;
        }
        for (let j = 0; j < outs.length; j++) {
          let sum = level.biases[j];
          for (let i = 0; i < ins.length; i++) sum += ins[i] * level.weights[i][j];
          outs[j] = l === last ? (sum > 0 ? 1 : 0) : Math.tanh(sum);
        }
        values = outs;
      }
      return values;
    }

    clone() {
      const copy = new NeuralNetwork(this.layerSizes);
      for (let l = 0; l < this.levels.length; l++) {
        const src = this.levels[l];
        const dst = copy.levels[l];
        for (let j = 0; j < src.biases.length; j++) dst.biases[j] = src.biases[j];
        for (let i = 0; i < src.weights.length; i++) {
          for (let j = 0; j < src.weights[i].length; j++) dst.weights[i][j] = src.weights[i][j];
        }
      }
      return copy;
    }

    // Moves every weight and bias the fraction `amount` (0..1) of the way
    // toward a fresh random value in [-1, 1]. 0 keeps an exact copy; 1 gives a
    // brand-new random brain. Returns this network.
    mutate(amount, rng) {
      const a = SDC.geom.clamp(Number(amount) || 0, 0, 1);
      if (a === 0) return this;
      const lerp = SDC.geom.lerp;
      const clamp = SDC.geom.clamp;
      for (let l = 0; l < this.levels.length; l++) {
        const level = this.levels[l];
        for (let j = 0; j < level.biases.length; j++) {
          level.biases[j] = clamp(lerp(level.biases[j], rng.range(-1, 1), a), -1, 1);
        }
        for (let i = 0; i < level.weights.length; i++) {
          const row = level.weights[i];
          for (let j = 0; j < row.length; j++) row[j] = clamp(lerp(row[j], rng.range(-1, 1), a), -1, 1);
        }
      }
      return this;
    }

    toJSON() {
      return {
        format: FORMAT,
        version: FORMAT_VERSION,
        layerSizes: this.layerSizes.slice(),
        levels: this.levels.map(function (level) {
          return {
            biases: level.biases.slice(),
            weights: level.weights.map(function (row) {
              return row.slice();
            }),
          };
        }),
      };
    }

    // Rebuilds a network from toJSON() data. Returns null for anything malformed.
    static fromJSON(data) {
      if (!data || typeof data !== "object") return null;
      if (data.format !== FORMAT || data.version !== FORMAT_VERSION) return null;
      if (!isValidLayout(data.layerSizes)) return null;
      if (!Array.isArray(data.levels) || data.levels.length !== data.layerSizes.length - 1) return null;
      const net = new NeuralNetwork(data.layerSizes);
      for (let l = 0; l < net.levels.length; l++) {
        const src = data.levels[l];
        const dst = net.levels[l];
        if (!src || typeof src !== "object") return null;
        if (!isUnitArray(src.biases, dst.biases.length)) return null;
        if (!Array.isArray(src.weights) || src.weights.length !== dst.weights.length) return null;
        for (let i = 0; i < dst.weights.length; i++) {
          if (!isUnitArray(src.weights[i], dst.biases.length)) return null;
        }
        for (let j = 0; j < dst.biases.length; j++) dst.biases[j] = src.biases[j];
        for (let i = 0; i < dst.weights.length; i++) {
          for (let j = 0; j < dst.biases.length; j++) dst.weights[i][j] = src.weights[i][j];
        }
      }
      return net;
    }

    static isValidLayout(sizes) {
      return isValidLayout(sizes);
    }
  }

  SDC.NeuralNetwork = NeuralNetwork;
})((window.SDC = window.SDC || {}));
