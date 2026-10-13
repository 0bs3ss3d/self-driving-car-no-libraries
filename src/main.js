/*
 * main.js
 * CONFIG holds every default: tune the simulation here. The rest of the file
 * is the browser app: canvas sizing (HiDPI and resize), UI and keyboard, the
 * fixed-timestep loop, the camera, the HUD, and saving the best brain to
 * localStorage. Under Node only CONFIG is defined, so tools can reuse it.
 */
(function (SDC) {
  "use strict";

  const CONFIG = {
    // Simulation clock
    dt: 1 / 60, // seconds per fixed step
    maxStepsPerFrame: 20, // steps allowed per animation frame; extra time is dropped

    // World
    startLane: 1, // 0 is the leftmost lane
    road: { centerX: 0, laneCount: 3, laneWidth: 60 },
    car: {
      width: 30, // px
      length: 50, // px
      maxSpeed: 180, // px/s
      maxReverseSpeed: 90, // px/s
      acceleration: 720, // px/s^2
      friction: 180, // px/s^2
      steerCurvature: 0.01, // radians of turn per px travelled, wheel fully turned
    },
    sensor: { rayCount: 5, raySpread: Math.PI / 2, rayLength: 150 },
    traffic: {
      minSpeed: 80, // px/s; each row of traffic cruises at a speed in this range
      maxSpeed: 120,
      minGap: 300, // px between consecutive rows (also how close a row follows a slower one)
      maxGap: 550,
      firstGapMin: 250, // px from the start line to the first row
      firstGapMax: 400,
      easyRows: 6, // the first rows hold one car each (the first one in the start lane)
      spawnAhead: 1800, // rows appear this far ahead of the fastest possible car
      disposeBehind: 900, // and are dropped this far behind the last car still driving
    },

    // Learning
    network: { hiddenLayers: [6] }, // inputs = rayCount, outputs = 4
    population: 200,
    mutationRate: 0.25,
    trafficSeed: "sdc", // the traffic layout
    evolutionSeed: "h", // random first brains and mutations; any text works (see README)
    newTrafficEachGeneration: false,
    stallSeconds: 4, // a car that has not gained minProgress px in this many seconds
    minProgress: 520, // is taken off the road. 520 px / 4 s = 130 px/s, just above the
    //                   fastest traffic, so following traffic doesn't count as progress.
    maxGenerationSeconds: 0, // optional cap on a generation's length (0 = no cap)

    // Saving
    storageKey: "sdc.bestBrain.v1",
  };

  SDC.CONFIG = CONFIG;
  if (typeof document === "undefined") return; // Node: config only, no app

  const COLORS = {
    verge: "#a9a9a9",
    agent: "#2563c9",
    focus: "#2563c9",
    focusOutline: "#f4f4ef",
    traffic: "#d64045",
    panel: "#2e3033",
  };
  const CAMERA_ANCHOR = 0.7; // the followed car sits 70% of the way down the road view
  const CAMERA_GLIDE = 0.25; // seconds for the camera to settle when the leader changes
  const HUD_INTERVAL = 200; // ms between readout refreshes
  const NET_INTERVAL = 1000 / 30; // the network panel repaints at most 30 times a second
  const SAVE_FORMAT = "sdc-saved-brain";
  const SAVE_VERSION = 1;
  const END_REASONS = {
    out: "every car crashed or fell behind the traffic",
    time: "time limit reached",
    skipped: "skipped",
  };

  const app = {
    mode: "train",
    paused: false,
    speed: 1,
    populationSize: CONFIG.population,
    mutationRate: CONFIG.mutationRate,
    trainer: null,
    driveWorld: null,
    player: null,
    keyboard: null,
    storageReady: false,
    reduceMotion: false,
    camera: { world: null, target: null, offset: 0, y: 0 },
    acc: 0,
    lastTime: null,
    fps: { frames: 0, since: 0, value: 0 },
    hudAt: -Infinity,
    netAt: -Infinity,
  };

  let dom = null;
  let roadCtx = null;
  let netCtx = null;

  // ---------------------------------------------------------------- storage

  const storage = {
    store: null,

    // localStorage can be missing or throw (privacy settings, some file://
    // setups). Probe once; if that fails, saving is switched off.
    init() {
      try {
        const s = window.localStorage;
        const probe = "sdc.probe";
        s.setItem(probe, "1");
        s.removeItem(probe);
        this.store = s;
      } catch (err) {
        this.store = null;
      }
      return this.store !== null;
    },

    // { status: "ok", brain, meta } or { status: "missing" | "corrupt" | "shape" | "unavailable" }
    load(expectedSizes) {
      if (!this.store) return { status: "unavailable" };
      let raw;
      try {
        raw = this.store.getItem(CONFIG.storageKey);
      } catch (err) {
        return { status: "unavailable" };
      }
      if (raw === null || raw === undefined) return { status: "missing" };
      let data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        return { status: "corrupt" };
      }
      if (!data || data.format !== SAVE_FORMAT || data.version !== SAVE_VERSION) return { status: "corrupt" };
      const brain = SDC.NeuralNetwork.fromJSON(data.brain);
      if (!brain) return { status: "corrupt" };
      if (!SDC.sameSizes(brain.layerSizes, expectedSizes)) return { status: "shape", layerSizes: brain.layerSizes };
      return { status: "ok", brain: brain, meta: cleanMeta(data.meta) };
    },

    save(brain, meta) {
      if (!this.store) return false;
      try {
        const payload = { format: SAVE_FORMAT, version: SAVE_VERSION, brain: brain.toJSON(), meta: meta };
        this.store.setItem(CONFIG.storageKey, JSON.stringify(payload));
        return true;
      } catch (err) {
        return false;
      }
    },

    discard() {
      if (!this.store) return false;
      try {
        this.store.removeItem(CONFIG.storageKey);
        return true;
      } catch (err) {
        return false;
      }
    },
  };

  function cleanMeta(meta) {
    const m = meta && typeof meta === "object" ? meta : {};
    const num = function (v) {
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    return { generation: num(m.generation), progress: num(m.progress), passed: num(m.passed) };
  }

  // ---------------------------------------------------------------- helpers

  function formatPx(value) {
    return Math.round(Math.max(0, value)).toLocaleString("en-US") + " px";
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function setStatus(text) {
    setText(dom.status, text || "");
  }

  function activeWorld() {
    return app.mode === "train" ? app.trainer.world : app.driveWorld;
  }

  function focusCar() {
    return app.mode === "train" ? app.trainer.leader() : app.player;
  }

  function networkShapeText(sizes) {
    const hidden = sizes.slice(1, -1);
    const middle = hidden.length > 0 ? hidden.join(" and ") + " hidden neurons, " : "";
    return sizes[0] + " sensor inputs, " + middle + sizes[sizes.length - 1] + " controls";
  }

  // ---------------------------------------------------------------- sessions

  function startTraining(context) {
    const saved = storage.load(SDC.Trainer.layerSizesFor(CONFIG));
    app.trainer = new SDC.Trainer(CONFIG, {
      populationSize: app.populationSize,
      mutationRate: app.mutationRate,
      parentBrain: saved.status === "ok" ? saved.brain : null,
    });
    showSavedInfo(saved);
    setStatus(trainingMessage(saved, context));
  }

  function trainingMessage(saved, context) {
    const lead = context === "reset" ? "Training reset. " : "";
    if (saved.status === "ok") return lead + "Generation 1 starts from your saved brain.";
    if (saved.status === "corrupt") {
      return lead + "The saved brain could not be read, so training starts from random brains. Discard it to clear the slot.";
    }
    if (saved.status === "shape") {
      return lead + "The saved brain has a different shape (" + saved.layerSizes.join("-") + "), so training starts from random brains.";
    }
    if (saved.status === "unavailable") {
      return lead + "Starting from random brains. This browser blocks local storage for this page, so brains can't be saved.";
    }
    return lead + "Starting from random brains. Save a good one to keep it after a refresh.";
  }

  function showSavedInfo(saved) {
    let text;
    if (saved.status === "ok") {
      const parts = [];
      if (saved.meta.generation !== null) parts.push("generation " + saved.meta.generation);
      if (saved.meta.progress !== null) parts.push(formatPx(saved.meta.progress));
      text = parts.length > 0 ? "Saved brain: " + parts.join(", ") : "Saved brain ready";
    } else if (saved.status === "corrupt") {
      text = "The saved data is unreadable";
    } else if (saved.status === "shape") {
      text = "Saved brain has another shape (" + saved.layerSizes.join("-") + ")";
    } else if (saved.status === "unavailable") {
      text = "Saving is unavailable in this browser";
    } else {
      text = "Nothing saved yet";
    }
    setText(dom.savedInfo, text);
  }

  function refreshSavedInfo() {
    showSavedInfo(storage.load(SDC.Trainer.layerSizesFor(CONFIG)));
  }

  function startDrive() {
    const world = new SDC.World(CONFIG, CONFIG.trafficSeed);
    const player = world.createCar({ kind: "player", sensor: CONFIG.sensor, controls: app.keyboard.controls });
    world.addCar(player);
    app.driveWorld = world;
    app.player = player;
  }

  // ---------------------------------------------------------------- actions

  function setMode(mode, quiet) {
    app.mode = mode === "drive" ? "drive" : "train";
    if (app.mode === "drive" && !app.driveWorld) startDrive();
    app.keyboard.enabled = app.mode === "drive";
    if (app.mode !== "drive") app.keyboard.controls.release();
    app.acc = 0;
    if (!quiet) {
      setStatus(
        app.mode === "drive"
          ? "Drive with the arrow keys or WASD. Training waits until you switch back."
          : "Training. The outlined car is the best one still driving."
      );
    }
    syncControls();
    refreshHud(true);
  }

  function togglePause() {
    app.paused = !app.paused;
    app.acc = 0;
    syncControls();
  }

  function setSpeed(speed) {
    if (speed !== 1 && speed !== 2 && speed !== 5) return;
    app.speed = speed;
    syncControls();
  }

  function resetActive() {
    if (app.mode === "train") {
      startTraining("reset");
    } else {
      startDrive();
      setStatus("New drive, on the same traffic the cars train on.");
    }
    app.acc = 0;
    refreshHud(true);
  }

  function skipGeneration() {
    if (app.mode !== "train") return;
    app.trainer.endGeneration("skipped");
    refreshHud(true);
  }

  function saveBrain() {
    if (app.mode !== "train" || !app.storageReady) return;
    const best = app.trainer.bestCar();
    if (!best || !best.brain) return;
    const meta = { generation: app.trainer.generation, progress: Math.round(best.progress), passed: best.passed };
    if (storage.save(best.brain, meta)) {
      setStatus(
        "Saved the best brain of generation " + meta.generation + " (" + formatPx(meta.progress) +
          "). Reset or refresh to train from it."
      );
    } else {
      setStatus("Could not save: local storage is full or blocked.");
    }
    refreshSavedInfo();
  }

  function discardBrain() {
    if (!app.storageReady) return;
    if (storage.discard()) setStatus("Saved brain discarded. Reset to train from random brains.");
    else setStatus("Could not reach local storage, so nothing was discarded.");
    refreshSavedInfo();
  }

  function onPopulationChange() {
    const raw = dom.population.value.trim();
    const parsed = raw === "" ? NaN : Number(raw);
    const value = app.trainer.setPopulationSize(Number.isFinite(parsed) ? parsed : app.populationSize);
    app.populationSize = value;
    dom.population.value = String(value);
    setStatus("From the next generation: " + value + (value === 1 ? " car." : " cars."));
  }

  function onMutationInput() {
    const value = app.trainer.setMutationRate(dom.mutation.value);
    app.mutationRate = value;
    setText(dom.mutationValue, value.toFixed(2));
  }

  function onShortcut(event) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (SDC.isTextEntry(event.target)) return;
    if (event.code === "KeyP") {
      togglePause();
      event.preventDefault();
    } else if (event.code === "KeyR") {
      resetActive();
      event.preventDefault();
    } else if (event.code === "KeyN" && app.mode === "train") {
      skipGeneration();
      event.preventDefault();
    }
  }

  function syncControls() {
    const training = app.mode === "train";
    dom.btnTrain.setAttribute("aria-pressed", String(training));
    dom.btnDrive.setAttribute("aria-pressed", String(!training));
    setText(dom.btnPause, app.paused ? "Resume" : "Pause");
    dom.btnNext.disabled = !training;
    dom.btnSave.disabled = !training || !app.storageReady;
    dom.btnDiscard.disabled = !app.storageReady;
    for (let i = 0; i < dom.speedButtons.length; i++) {
      const btn = dom.speedButtons[i];
      btn.setAttribute("aria-pressed", String(Number(btn.getAttribute("data-speed")) === app.speed));
    }
  }

  function bindUi() {
    dom.btnTrain.addEventListener("click", function () {
      setMode("train");
    });
    dom.btnDrive.addEventListener("click", function () {
      setMode("drive");
    });
    dom.btnPause.addEventListener("click", togglePause);
    dom.btnReset.addEventListener("click", resetActive);
    dom.btnNext.addEventListener("click", skipGeneration);
    dom.speedButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        setSpeed(Number(btn.getAttribute("data-speed")));
      });
    });
    dom.population.addEventListener("change", onPopulationChange);
    dom.mutation.addEventListener("input", onMutationInput);
    dom.btnSave.addEventListener("click", saveBrain);
    dom.btnDiscard.addEventListener("click", discardBrain);
    window.addEventListener("keydown", onShortcut);
  }

  // ---------------------------------------------------------------- HUD

  function refreshHud(force) {
    const now = performance.now();
    if (!force && now - app.hudAt < HUD_INTERVAL) return;
    app.hudAt = now;
    if (app.mode === "train") {
      const t = app.trainer;
      const best = t.bestCar();
      setText(dom.hudGen, String(t.generation));
      setText(dom.hudAlive, t.world.aliveCount() + " of " + t.world.cars.length);
      setText(dom.hudBest, formatPx(best ? best.progress : 0));
      setText(dom.hudPassed, String(best ? best.passed : 0));
      setText(
        dom.hudRecord,
        t.bestEver
          ? "Record: " + formatPx(t.bestEver.progress) + " in generation " + t.bestEver.generation
          : "Record: none yet"
      );
      setText(
        dom.hudLast,
        t.lastRecord
          ? "Generation " + t.lastRecord.generation + " ended at " + formatPx(t.lastRecord.progress) +
              ": " + END_REASONS[t.lastRecord.reason]
          : "Generation 1 is under way"
      );
    } else {
      const p = app.player;
      setText(dom.hudGen, "\u2013");
      setText(dom.hudAlive, p.damaged ? "Crashed" : "Driving");
      setText(dom.hudBest, formatPx(p.progress));
      setText(dom.hudPassed, String(p.passed));
      setText(dom.hudRecord, "You are driving");
      setText(dom.hudLast, p.damaged ? "Crashed. Press R for a new drive." : "Arrow keys or WASD");
    }
    setText(dom.hudFps, String(app.fps.value));
  }

  function countFrame(now) {
    const f = app.fps;
    if (f.since === 0) f.since = now;
    f.frames += 1;
    if (now - f.since >= 500) {
      f.value = Math.round((f.frames * 1000) / (now - f.since));
      f.frames = 0;
      f.since = now;
    }
  }

  // ---------------------------------------------------------------- rendering

  // Matches the canvas backing store to its box times devicePixelRatio, so
  // drawing stays sharp on HiDPI screens and follows window resizes.
  function fitCanvas(canvas, stage) {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w < 1 || h < 1) return null;
    const dpr = SDC.geom.clamp(window.devicePixelRatio || 1, 0.5, 4);
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    const resized = canvas.width !== bw || canvas.height !== bh;
    if (canvas.width !== bw) canvas.width = bw; // resizing also clears the canvas
    if (canvas.height !== bh) canvas.height = bh;
    return { w: w, h: h, sx: bw / w, sy: bh / h, resized: resized };
  }

  // The camera follows `target`; when the leader changes it glides instead of jumping.
  function followCamera(world, target, frameDt) {
    const cam = app.camera;
    if (!target) return cam.y;
    if (cam.world !== world || cam.target === null) {
      cam.world = world;
      cam.target = target;
      cam.offset = 0;
    } else if (cam.target !== target) {
      cam.offset = cam.y - target.y;
      cam.target = target;
    }
    if (app.reduceMotion) cam.offset = 0;
    else cam.offset *= Math.exp(-frameDt / CAMERA_GLIDE);
    if (Math.abs(cam.offset) < 0.05) cam.offset = 0;
    cam.y = target.y + cam.offset;
    return cam.y;
  }

  function drawRoadView(view, world, focus, camY) {
    const ctx = roadCtx;
    ctx.setTransform(view.sx, 0, 0, view.sy, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.verge;
    ctx.fillRect(0, 0, view.w, view.h);

    const anchor = view.h * CAMERA_ANCHOR;
    const viewTop = camY - anchor;
    const viewBottom = camY + (view.h - anchor);
    ctx.save();
    ctx.translate(view.w / 2 - world.road.centerX, anchor - camY);
    world.road.draw(ctx, viewTop, viewBottom);
    world.traffic.draw(ctx, viewTop, viewBottom, COLORS.traffic);
    if (app.mode === "train") {
      // Every car except the leader, as two see-through shapes (still driving / out).
      // One fill per shape is far cheaper than a draw call per car.
      ctx.globalAlpha = 0.2;
      fillCars(ctx, world.cars, focus, false, COLORS.agent, viewTop, viewBottom);
      fillCars(ctx, world.cars, focus, true, SDC.Car.DAMAGED_FILL, viewTop, viewBottom);
      ctx.globalAlpha = 1;
    }
    if (focus) {
      if (focus.sensor && !focus.damaged) focus.sensor.draw(ctx);
      focus.draw(ctx, COLORS.focus, { outline: COLORS.focusOutline });
    }
    ctx.restore();
  }

  function fillCars(ctx, cars, skip, damaged, color, viewTop, viewBottom) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (car === skip || car.damaged !== damaged) continue;
      if (car.y < viewTop - car.length || car.y > viewBottom + car.length) continue;
      car.traceOutline(ctx);
      any = true;
    }
    if (any) {
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  function drawNetworkView(view, focus) {
    const ctx = netCtx;
    ctx.setTransform(view.sx, 0, 0, view.sy, 0, 0);
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(0, 0, view.w, view.h);
    if (!focus) return;
    if (app.mode === "train" && focus.brain) {
      SDC.Visualizer.drawNetwork(ctx, focus.brain, view.w, view.h, {
        title: "Brain of the leading car",
        subtitle: networkShapeText(focus.brain.layerSizes),
      });
    } else if (focus.sensor) {
      SDC.Visualizer.drawReadings(ctx, focus.sensor.readings, view.w, view.h, {
        title: "Your car's sensors",
        subtitle: "Exactly what an AI car sees: 0 is clear, 1 is touching.",
      });
    }
  }

  function render(now, frameDt) {
    const roadView = fitCanvas(dom.roadCanvas, dom.roadStage);
    const netView = fitCanvas(dom.netCanvas, dom.netStage);
    const world = activeWorld();
    const focus = focusCar();
    const camY = followCamera(world, focus, frameDt);
    if (roadView) drawRoadView(roadView, world, focus, camY);
    if (netView && (netView.resized || now - app.netAt >= NET_INTERVAL)) {
      drawNetworkView(netView, focus);
      app.netAt = now;
    }
  }

  // ---------------------------------------------------------------- loop

  function stepOnce() {
    if (app.mode === "train") app.trainer.step();
    else app.driveWorld.step();
  }

  // Fixed timestep with an accumulator: the simulation always advances in
  // CONFIG.dt steps, so it runs at the same speed on 60, 120 or 144 Hz screens.
  function frame(now) {
    window.requestAnimationFrame(frame);
    let dt = app.lastTime === null ? 0 : (now - app.lastTime) / 1000;
    app.lastTime = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25; // after a hidden tab, don't try to catch up
    countFrame(now);
    if (app.paused) {
      app.acc = 0;
    } else {
      app.acc += dt * app.speed;
      let steps = 0;
      while (app.acc >= CONFIG.dt - 1e-9 && steps < CONFIG.maxStepsPerFrame) {
        stepOnce();
        app.acc -= CONFIG.dt;
        steps += 1;
      }
      if (steps >= CONFIG.maxStepsPerFrame) app.acc = 0;
    }
    render(now, dt);
    refreshHud(false);
  }

  // ---------------------------------------------------------------- boot

  function boot() {
    const byId = function (id) {
      return document.getElementById(id);
    };
    dom = {
      roadStage: byId("roadStage"),
      roadCanvas: byId("roadCanvas"),
      netStage: byId("netStage"),
      netCanvas: byId("networkCanvas"),
      hudGen: byId("hudGen"),
      hudAlive: byId("hudAlive"),
      hudBest: byId("hudBest"),
      hudPassed: byId("hudPassed"),
      hudFps: byId("hudFps"),
      hudRecord: byId("hudRecord"),
      hudLast: byId("hudLast"),
      btnTrain: byId("btnTrain"),
      btnDrive: byId("btnDrive"),
      btnPause: byId("btnPause"),
      btnReset: byId("btnReset"),
      btnNext: byId("btnNext"),
      btnSave: byId("btnSave"),
      btnDiscard: byId("btnDiscard"),
      population: byId("inputPopulation"),
      mutation: byId("inputMutation"),
      mutationValue: byId("mutationValue"),
      savedInfo: byId("savedInfo"),
      status: byId("status"),
      speedButtons: Array.prototype.slice.call(document.querySelectorAll("#speedGroup button[data-speed]")),
    };
    const missing = Object.keys(dom).filter(function (key) {
      return !dom[key];
    });
    if (missing.length > 0 || dom.speedButtons.length === 0) {
      throw new Error("index.html is missing elements: " + (missing.join(", ") || "speed buttons"));
    }
    roadCtx = dom.roadCanvas.getContext("2d");
    netCtx = dom.netCanvas.getContext("2d");
    if (!roadCtx || !netCtx) {
      dom.status.textContent = "This browser can't draw on a canvas, so the simulation can't run.";
      return;
    }
    app.keyboard = new SDC.KeyboardInput();
    app.keyboard.attach(window);
    app.storageReady = storage.init();
    app.reduceMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    dom.population.value = String(app.populationSize);
    dom.mutation.value = String(app.mutationRate);
    setText(dom.mutationValue, app.mutationRate.toFixed(2));
    bindUi();
    startTraining("boot");
    setMode("train", true);
    SDC.app = app; // for poking around in the browser console, e.g. SDC.app.trainer.history
    window.requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})((window.SDC = window.SDC || {}));
