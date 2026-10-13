/*
 * trainer.js
 * The headless simulation.
 *   World   - road + traffic + cars, advanced one fixed timestep at a time.
 *   Trainer - a World full of AI cars plus the genetic algorithm: each new
 *             generation is the previous best brain kept unchanged (elitism)
 *             and mutated copies of it.
 * No DOM or canvas code lives here, so the same code runs in a browser or Node.
 */
(function (SDC) {
  "use strict";

  const HEADING_UP = -Math.PI / 2;
  const OUTPUT_COUNT = 4; // forward, left, right, reverse
  const HISTORY_LIMIT = 1000;

  function sameSizes(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function cleanInt(value, min, max, fallback) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function cleanNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  class World {
    // config: the CONFIG object from main.js. trafficSeed: string or number.
    constructor(config, trafficSeed) {
      if (!(config.dt > 0)) throw new Error("World: config.dt must be a positive number");
      this.config = config;
      this.dt = config.dt;
      this.road = new SDC.Road(config.road);
      this.startX = this.road.laneCenter(config.startLane);
      this.startY = 0;
      // The spawn frontier moves at the cars' top speed, so no car can outrun it.
      this.traffic = new SDC.Traffic(
        this.road,
        Object.assign({}, config.traffic, {
          seed: trafficSeed,
          startY: this.startY,
          carWidth: config.car.width,
          carLength: config.car.length,
          frontierSpeed: config.car.maxSpeed,
          firstRowLane: config.startLane,
        })
      );
      this.cars = [];
      this.time = 0;
      this.steps = 0;
      // Traffic further than this (vertically) can't touch or be seen by a car.
      this.nearRange = config.sensor.rayLength + config.car.length * 2;
      this.nearby = [];
    }

    // A car on the start line, facing up the road, using the configured physics.
    createCar(options) {
      return new SDC.Car(this.startX, this.startY, HEADING_UP, Object.assign({}, this.config.car, options));
    }

    // Adds a car and gives it a first look around, so its sensors and brain
    // are ready before the first step.
    addCar(car) {
      this.cars.push(car);
      car.sense(this.road.borders, this.obstaclesNear(car));
      return car;
    }

    // Polygons of traffic close enough to matter for `car`. The returned array
    // is reused on the next call, so use it straight away.
    obstaclesNear(car) {
      const list = this.nearby;
      list.length = 0;
      const traffic = this.traffic.cars;
      for (let i = 0; i < traffic.length; i++) {
        if (Math.abs(traffic[i].y - car.y) < this.nearRange) list.push(traffic[i].polygon);
      }
      return list;
    }

    // y of the rear-most car still driving (of all cars if none is); traffic
    // further behind than that can be dropped.
    rearY() {
      let back = -Infinity;
      for (let pass = 0; pass < 2 && back === -Infinity; pass++) {
        for (let i = 0; i < this.cars.length; i++) {
          const car = this.cars[i];
          if (pass === 0 && car.damaged) continue;
          if (car.y > back) back = car.y;
        }
      }
      return Number.isFinite(back) ? back : this.startY;
    }

    step() {
      this.steps += 1;
      this.time = this.steps * this.dt;
      this.traffic.update(this.time, this.rearY());
      const borders = this.road.borders;
      for (let i = 0; i < this.cars.length; i++) {
        const car = this.cars[i];
        if (car.damaged) continue;
        car.update(this.dt, borders, this.obstaclesNear(car));
        if (!car.damaged) car.passed = this.traffic.countBehind(car.y);
      }
    }

    aliveCount() {
      let alive = 0;
      for (let i = 0; i < this.cars.length; i++) if (!this.cars[i].damaged) alive++;
      return alive;
    }
  }

  class Trainer {
    // Network shape for a config: [rayCount, ...hiddenLayers, 4].
    static layerSizesFor(config) {
      return [config.sensor.rayCount].concat(config.network.hiddenLayers, [OUTPUT_COUNT]);
    }

    // options: { populationSize, mutationRate, parentBrain } (all optional)
    constructor(config, options) {
      const o = options || {};
      this.config = config;
      this.layerSizes = Trainer.layerSizesFor(config);
      this.rng = new SDC.RNG(config.evolutionSeed);
      this.populationSize = cleanInt(o.populationSize, 1, 1000, cleanInt(config.population, 1, 1000, 1));
      this.mutationRate = cleanNumber(o.mutationRate, 0, 1, cleanNumber(config.mutationRate, 0, 1, 0));
      this.parentBrain = null;
      if (o.parentBrain && sameSizes(o.parentBrain.layerSizes, this.layerSizes)) {
        this.parentBrain = o.parentBrain.clone();
      }
      this.generation = 0;
      this.history = [];
      this.bestEver = null;
      this.lastRecord = null;
      this.world = null;
      this.startGeneration();
    }

    // Both settings take effect when the next generation starts.
    setPopulationSize(value) {
      this.populationSize = cleanInt(value, 1, 1000, this.populationSize);
      return this.populationSize;
    }

    setMutationRate(value) {
      this.mutationRate = cleanNumber(value, 0, 1, this.mutationRate);
      return this.mutationRate;
    }

    trafficSeedFor(generation) {
      const seed = String(this.config.trafficSeed);
      return this.config.newTrafficEachGeneration ? seed + "|generation|" + generation : seed;
    }

    startGeneration() {
      this.generation += 1;
      const world = new SDC.World(this.config, this.trafficSeedFor(this.generation));
      for (let i = 0; i < this.populationSize; i++) {
        let brain;
        if (this.parentBrain) {
          brain = this.parentBrain.clone();
          if (i > 0) brain.mutate(this.mutationRate, this.rng); // car 0 is the unmutated elite
        } else {
          brain = new SDC.NeuralNetwork(this.layerSizes, this.rng);
        }
        const car = world.createCar({ kind: "agent", sensor: this.config.sensor, brain: brain });
        car.id = i;
        car.checkpoint = 0; // progress at the last time this car counted as gaining ground
        car.checkpointStep = 0;
        world.addCar(car);
      }
      this.world = world;
    }

    // Advances one fixed step. A car that has not gained minProgress px in the
    // last stallSeconds is taken off the road: with the default settings that
    // means it is no faster than the traffic, so it is only following, not
    // overtaking. Returns a summary when the step ended the generation (the
    // next one has already started), otherwise null.
    step() {
      const world = this.world;
      const cfg = this.config;
      const stallSteps = Math.max(1, Math.round(cfg.stallSeconds / world.dt));
      world.step();
      let alive = 0;
      for (let i = 0; i < world.cars.length; i++) {
        const car = world.cars[i];
        if (car.damaged) continue;
        if (car.progress >= car.checkpoint + cfg.minProgress) {
          car.checkpoint = car.progress;
          car.checkpointStep = world.steps;
        } else if (world.steps - car.checkpointStep >= stallSteps) {
          car.retire();
          continue;
        }
        alive++;
      }
      if (alive === 0) return this.endGeneration("out");
      if (cfg.maxGenerationSeconds > 0 && world.time >= cfg.maxGenerationSeconds) return this.endGeneration("time");
      return null;
    }

    // Highest progress in this generation; ties go to a car still driving,
    // then to the lower index (so the elite wins ties).
    bestCar() {
      let best = null;
      const cars = this.world.cars;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        if (
          best === null ||
          car.progress > best.progress ||
          (car.progress === best.progress && best.damaged && !car.damaged)
        ) {
          best = car;
        }
      }
      return best;
    }

    // The car to follow and display: best car still driving, else best overall.
    leader() {
      let lead = null;
      const cars = this.world.cars;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        if (!car.damaged && (lead === null || car.progress > lead.progress)) lead = car;
      }
      return lead || this.bestCar();
    }

    // reason: "out" (every car crashed or stalled) | "time" | "skipped"
    endGeneration(reason) {
      const best = this.bestCar();
      const record = {
        generation: this.generation,
        progress: best ? best.progress : 0,
        passed: best ? best.passed : 0,
        seconds: this.world.time,
        reason: reason,
      };
      this.history.push(record);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      if (this.bestEver === null || record.progress > this.bestEver.progress) this.bestEver = record;
      this.lastRecord = record;
      if (best && best.brain) this.parentBrain = best.brain.clone();
      this.startGeneration();
      return record;
    }
  }

  SDC.World = World;
  SDC.Trainer = Trainer;
  SDC.sameSizes = sameSizes;
})((window.SDC = window.SDC || {}));
