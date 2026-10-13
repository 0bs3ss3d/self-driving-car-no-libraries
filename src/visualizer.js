/*
 * visualizer.js
 * Draws a NeuralNetwork onto a canvas: inputs along the bottom, outputs along
 * the top. Neuron fill = current activation (amber positive, blue negative,
 * stronger colour = larger magnitude). Connection colour = weight sign;
 * thickness and opacity = weight magnitude. A dashed ring shows each bias.
 * Also draws plain sensor bars for keyboard driving.
 */
(function (SDC) {
  "use strict";

  const POSITIVE = [242, 183, 5]; // road-sign amber
  const NEGATIVE = [96, 150, 245]; // motorway blue, lifted for the dark panel
  const NODE = "#3b3e42";
  const TEXT = "#f4f4ef";
  const TEXT_DIM = "#b9bcc0";
  const DARK = "#2e3033";
  const FONT = '"Bahnschrift", "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", sans-serif';
  const OUTPUT_LABELS = ["\u2191", "\u2190", "\u2192", "\u2193"]; // forward, left, right, reverse

  function tint(value, alpha) {
    const c = value >= 0 ? POSITIVE : NEGATIVE;
    const a = SDC.geom.clamp(alpha, 0, 1);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")";
  }

  function drawHeader(ctx, x, maxWidth, title, subtitle) {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = TEXT;
    ctx.font = "600 18px " + FONT;
    ctx.fillText(title, x, 36, maxWidth);
    if (subtitle) {
      ctx.fillStyle = TEXT_DIM;
      ctx.font = "14px " + FONT;
      ctx.fillText(subtitle, x, 58, maxWidth);
    }
  }

  // Draws `network` into the box (0, 0)-(width, height), in CSS pixels.
  function drawNetwork(ctx, network, width, height, options) {
    const opts = options || {};
    const levels = network.levels;
    const rows = levels.length + 1;
    const sizes = [levels[0].inputs.length];
    for (let l = 0; l < levels.length; l++) sizes.push(levels[l].outputs.length);
    const widest = Math.max.apply(null, sizes);

    const padX = SDC.geom.clamp(width * 0.1, 24, 80);
    const span = width - padX * 2;
    const top = 104;
    const bottom = height - 100;
    drawHeader(ctx, padX, Math.max(10, span), opts.title || "Network", opts.subtitle || "");
    if (span < 60 || bottom - top < 60) return; // panel too small for a diagram

    const rowGap = (bottom - top) / (rows - 1);
    const radius = SDC.geom.clamp(Math.min(span / (widest * 2.6), rowGap / 3.2), 7, 20);
    const xAt = function (i, n) {
      return n === 1 ? width / 2 : padX + (span * i) / (n - 1);
    };
    const yAt = function (row) {
      return bottom - rowGap * row;
    };

    // Connections
    ctx.lineCap = "round";
    for (let l = 0; l < levels.length; l++) {
      const level = levels[l];
      const nIn = level.inputs.length;
      const nOut = level.outputs.length;
      for (let i = 0; i < nIn; i++) {
        for (let j = 0; j < nOut; j++) {
          const w = level.weights[i][j];
          const strength = Math.min(1, Math.abs(w));
          ctx.strokeStyle = tint(w, 0.12 + 0.7 * strength);
          ctx.lineWidth = 0.5 + 3.5 * strength;
          ctx.beginPath();
          ctx.moveTo(xAt(i, nIn), yAt(l));
          ctx.lineTo(xAt(j, nOut), yAt(l + 1));
          ctx.stroke();
        }
      }
    }

    // Neurons
    for (let r = 0; r < rows; r++) {
      const values = r === 0 ? levels[0].inputs : levels[r - 1].outputs;
      const biases = r === 0 ? null : levels[r - 1].biases;
      const n = values.length;
      const isOutput = r === rows - 1;
      for (let i = 0; i < n; i++) {
        const x = xAt(i, n);
        const y = yAt(r);
        const v = values[i];
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = NODE;
        ctx.fill();
        if (v !== 0) {
          ctx.fillStyle = tint(v, Math.abs(v));
          ctx.fill();
        }
        if (biases) {
          const b = biases[i];
          ctx.beginPath();
          ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
          ctx.strokeStyle = tint(b, 0.25 + 0.7 * Math.min(1, Math.abs(b)));
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (isOutput && n === OUTPUT_LABELS.length) {
          ctx.fillStyle = Math.abs(v) > 0.5 ? DARK : TEXT;
          ctx.font = "700 " + Math.round(radius * 1.15) + "px " + FONT;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(OUTPUT_LABELS[i], x, y + 1);
        }
      }
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "14px " + FONT;
    ctx.fillText("Sensor rays, left to right", width / 2, bottom + radius + 26, span);
    ctx.fillText("Amber is positive, blue is negative. Thicker lines are stronger.", width / 2, height - 22, span);
  }

  function rayLabel(i, n) {
    if (n === 1) return "Ray 1, straight ahead";
    const mid = (n - 1) / 2;
    let side;
    if (i === mid) side = "straight ahead";
    else if (i === 0) side = "far left";
    else if (i === n - 1) side = "far right";
    else side = i < mid ? "left" : "right";
    return "Ray " + (i + 1) + ", " + side;
  }

  // One bar per sensor reading (0 = clear, 1 = touching).
  function drawReadings(ctx, readings, width, height, options) {
    const opts = options || {};
    const padX = SDC.geom.clamp(width * 0.1, 24, 80);
    const span = Math.max(10, width - padX * 2);
    drawHeader(ctx, padX, span, opts.title || "Sensors", opts.subtitle || "");
    const barWidth = Math.min(span, 420);
    const barHeight = 14;
    let y = 108;
    for (let i = 0; i < readings.length; i++) {
      if (y + barHeight > height) break;
      const v = SDC.geom.clamp(Number(readings[i]) || 0, 0, 1);
      ctx.font = "14px " + FONT;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillStyle = TEXT_DIM;
      ctx.fillText(rayLabel(i, readings.length), padX, y, Math.max(10, barWidth - 48));
      ctx.textAlign = "right";
      ctx.fillStyle = TEXT;
      ctx.fillText(v.toFixed(2), padX + barWidth, y);
      ctx.fillStyle = NODE;
      ctx.fillRect(padX, y + 8, barWidth, barHeight);
      if (v > 0) {
        ctx.fillStyle = tint(1, 0.45 + 0.55 * v);
        ctx.fillRect(padX, y + 8, barWidth * v, barHeight);
      }
      y += barHeight + 40;
    }
  }

  SDC.Visualizer = { drawNetwork: drawNetwork, drawReadings: drawReadings };
})((window.SDC = window.SDC || {}));
