/*
 * traffic.js
 * Endless seeded traffic, generated as ROWS. A row is 1 to (laneCount - 1)
 * cars side by side, so every row leaves at least one lane open. Each row
 * picks its own cruising speed; a faster row that catches up with a slower
 * one ahead slows down and follows it, so traffic never overlaps itself.
 * The first `easyRows` rows hold a single car, and the very first one sits in
 * `firstRowLane` (the start lane), so a new brain first learns to swerve
 * around one car before it meets two-car rows.
 *
 * Rows are created at a "frontier" that starts spawnAhead px ahead of the
 * start line and moves up the road at frontierSpeed (an AI car's top speed),
 * so no car can ever reach traffic that doesn't exist yet. Creation depends
 * only on the seed and the clock, never on the cars, which keeps the layout
 * identical for every car in a generation and for every generation that uses
 * the same seed. Rows far behind the last car still driving are dropped.
 * Traffic ignores the AI cars.
 */
(function (SDC) {
  "use strict";

  const HEADING_UP = -Math.PI / 2;
  const MAX_SPAWNS_PER_UPDATE = 200; // safety net against bad settings

  function requireNumber(options, key) {
    const value = Number(options[key]);
    if (!Number.isFinite(value)) throw new Error('Traffic: option "' + key + '" must be a number');
    return value;
  }

  class Traffic {
    // options: { seed, startY, carWidth, carLength,
    //            minSpeed, maxSpeed (px/s, each row's cruising speed),
    //            minGap, maxGap (px between consecutive rows; minGap is also the following distance),
    //            firstGapMin, firstGapMax (px from the start line to the first row),
    //            spawnAhead (px), frontierSpeed (px/s), disposeBehind (px),
    //            easyRows (count), firstRowLane (lane index, or -1 for random) }
    constructor(road, options) {
      const o = options || {};
      this.road = road;
      this.seed = String(o.seed);
      this.rng = new SDC.RNG(SDC.hashString(this.seed + "|traffic"));
      const carLength = requireNumber(o, "carLength");
      this.carOptions = { kind: "traffic", width: requireNumber(o, "carWidth"), length: carLength };
      this.minSpeed = requireNumber(o, "minSpeed");
      this.maxSpeed = Math.max(this.minSpeed, requireNumber(o, "maxSpeed"));
      this.minGap = Math.max(requireNumber(o, "minGap"), carLength * 2);
      this.maxGap = Math.max(requireNumber(o, "maxGap"), this.minGap);
      this.spawnAhead = requireNumber(o, "spawnAhead");
      this.frontierSpeed = requireNumber(o, "frontierSpeed");
      this.disposeBehind = requireNumber(o, "disposeBehind");
      this.startY = requireNumber(o, "startY");
      const firstGapMin = requireNumber(o, "firstGapMin");
      const firstGapMax = Math.max(firstGapMin, requireNumber(o, "firstGapMax"));
      this.easyRows = Math.max(0, Math.floor(requireNumber(o, "easyRows")));
      const lane = Math.floor(requireNumber(o, "firstRowLane"));
      this.firstRowLane = lane >= 0 && lane < road.laneCount ? lane : -1;
      this.rowsCreated = 0;

      this.rows = []; // ordered back (index 0) to front
      this.cars = []; // every live traffic car, all rows
      this.disposedCars = 0;
      this.time = 0;
      this.anchorY = this.startY; // y of the newest row (the start line before any row exists)
      this.nextGap = this.rng.range(firstGapMin, firstGapMax);
      this.spawnUpTo(this.frontierY(0));
      this.rebuildCarList();
    }

    frontierY(time) {
      return this.startY - this.spawnAhead - this.frontierSpeed * time;
    }

    // Adds rows until the next one would lie beyond the frontier.
    spawnUpTo(frontier) {
      let spawned = 0;
      while (spawned < MAX_SPAWNS_PER_UPDATE) {
        const newest = this.rows.length > 0 ? this.rows[this.rows.length - 1] : null;
        const baseY = newest ? newest.y : this.anchorY;
        const y = baseY - this.nextGap;
        if (y < frontier) break;
        this.rows.push(this.createRow(y));
        this.anchorY = y;
        this.nextGap = this.rng.range(this.minGap, this.maxGap);
        spawned++;
      }
    }

    createRow(y) {
      const laneCount = this.road.laneCount;
      const index = this.rowsCreated++;
      const count = index < this.easyRows ? 1 : this.rng.int(1, Math.max(1, laneCount - 1));
      const lanes = [];
      for (let i = 0; i < laneCount; i++) lanes.push(i);
      for (let i = lanes.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        const tmp = lanes[i];
        lanes[i] = lanes[j];
        lanes[j] = tmp;
      }
      if (index === 0 && this.firstRowLane >= 0) {
        // Put the start lane first so the first row's single car blocks it.
        lanes.splice(lanes.indexOf(this.firstRowLane), 1);
        lanes.unshift(this.firstRowLane);
      }
      const cars = [];
      for (let k = 0; k < count; k++) {
        cars.push(new SDC.Car(this.road.laneCenter(lanes[k]), y, HEADING_UP, this.carOptions));
      }
      const cruise = this.rng.range(this.minSpeed, this.maxSpeed);
      for (let k = 0; k < cars.length; k++) cars[k].speed = cruise;
      return { y: y, cruise: cruise, speed: cruise, cars: cars };
    }

    // Advances traffic to `time` (s) and drops rows more than disposeBehind
    // behind backY (the last car still driving).
    update(time, backY) {
      const dt = time - this.time;
      this.time = time;
      if (dt > 0) {
        // Front to back, so each row already knows the speed of the row ahead.
        for (let k = this.rows.length - 1; k >= 0; k--) {
          const row = this.rows[k];
          const ahead = this.rows[k + 1];
          let speed = row.cruise;
          if (ahead && row.y - ahead.y <= this.minGap) speed = Math.min(speed, ahead.speed);
          row.speed = speed;
          row.y -= speed * dt;
        }
      }
      this.spawnUpTo(this.frontierY(time));
      const disposeLimit = backY + this.disposeBehind;
      while (this.rows.length > 0 && this.rows[0].y > disposeLimit) {
        this.disposedCars += this.rows[0].cars.length;
        this.rows.shift();
      }
      this.rebuildCarList();
    }

    rebuildCarList() {
      this.cars.length = 0;
      for (let k = 0; k < this.rows.length; k++) {
        const row = this.rows[k];
        for (let c = 0; c < row.cars.length; c++) {
          const car = row.cars[c];
          car.speed = row.speed;
          car.setPose(car.x, row.y, HEADING_UP);
          this.cars.push(car);
        }
      }
    }

    // How many traffic cars are behind world y (dropped cars always count).
    countBehind(y) {
      let count = this.disposedCars;
      for (let i = 0; i < this.cars.length; i++) if (this.cars[i].y > y) count++;
      return count;
    }

    draw(ctx, viewTop, viewBottom, color) {
      for (let i = 0; i < this.cars.length; i++) {
        const car = this.cars[i];
        if (car.y + car.length < viewTop || car.y - car.length > viewBottom) continue;
        car.draw(ctx, color);
      }
    }
  }

  SDC.Traffic = Traffic;
})((window.SDC = window.SDC || {}));
