/*
 * car.js
 * One car: kinematics, rotated rectangle hitbox, crash state, and optionally
 * sensors plus a neural-network driver. Three kinds share this class:
 *   "agent"   - driven by its own NeuralNetwork (training)
 *   "player"  - driven by the keyboard (Drive mode)
 *   "traffic" - dummy car; Traffic sets its pose directly every step
 * Units: px, px/s, px/s^2, and rad per px for steering. update() is pure
 * simulation; draw() is the only method that touches a canvas.
 */
(function (SDC) {
  "use strict";

  const TWO_PI = Math.PI * 2;
  const DAMAGED_FILL = "#6e7175";

  function requireNumber(options, key, min) {
    const value = Number(options[key]);
    if (!Number.isFinite(value) || value < min) {
      throw new Error('Car: option "' + key + '" must be a number of at least ' + min);
    }
    return value;
  }

  class Car {
    // x, y: centre in world px. angle: heading in radians (see geometry.js).
    constructor(x, y, angle, options) {
      const o = options || {};
      this.kind = o.kind || "agent";
      this.x = x;
      this.y = y;
      this.angle = angle;
      this.speed = 0;
      this.width = requireNumber(o, "width", 1);
      this.length = requireNumber(o, "length", 1);
      if (this.kind !== "traffic") {
        this.maxSpeed = requireNumber(o, "maxSpeed", 0);
        this.maxReverseSpeed = requireNumber(o, "maxReverseSpeed", 0);
        this.acceleration = requireNumber(o, "acceleration", 0);
        this.friction = requireNumber(o, "friction", 0);
        this.steerCurvature = requireNumber(o, "steerCurvature", 0);
      }
      this.controls = o.controls || new SDC.Controls();
      this.sensor = o.sensor ? new SDC.Sensor(o.sensor) : null;
      this.brain = o.brain || null;
      this.damaged = false; // true once the car is out: crashed, or retired by the trainer
      this.retired = false; // true when taken off the road for not gaining ground
      this.startY = y;
      this.progress = 0; // furthest distance up the road so far (the fitness)
      this.passed = 0; // traffic cars behind this car, frozen when it crashes
      this.polygon = SDC.geom.orientedRect(x, y, angle, this.length, this.width);
    }

    // One fixed simulation step: drive, check for a crash, then look and think.
    update(dt, borders, obstacles) {
      if (this.damaged) return;
      this.move(dt);
      SDC.geom.orientedRect(this.x, this.y, this.angle, this.length, this.width, this.polygon);
      if (this.collides(borders, obstacles)) {
        this.damaged = true;
        this.speed = 0;
        return;
      }
      const travelled = this.startY - this.y;
      if (travelled > this.progress) this.progress = travelled;
      this.sense(borders, obstacles);
    }

    // Reads the sensors and, for AI cars, lets the brain choose the next controls.
    sense(borders, obstacles) {
      if (!this.sensor) return;
      this.sensor.update(this, borders, obstacles);
      if (this.brain) this.controls.setFromOutputs(this.brain.feedForward(this.sensor.readings));
    }

    move(dt) {
      const c = this.controls;
      let speed = this.speed;
      if (c.forward) speed += this.acceleration * dt;
      if (c.reverse) speed -= this.acceleration * dt; // brakes first, then backs up
      const drag = this.friction * dt;
      if (speed > drag) speed -= drag;
      else if (speed < -drag) speed += drag;
      else speed = 0;
      if (speed > this.maxSpeed) speed = this.maxSpeed;
      if (speed < -this.maxReverseSpeed) speed = -this.maxReverseSpeed;
      this.speed = speed;

      // Turn rate is proportional to speed (no turning on the spot) and flips
      // sign when reversing, like a real car.
      const steer = (c.right ? 1 : 0) - (c.left ? 1 : 0);
      if (steer !== 0) {
        this.angle += steer * this.steerCurvature * speed * dt;
        if (this.angle > Math.PI) this.angle -= TWO_PI;
        else if (this.angle < -Math.PI) this.angle += TWO_PI;
      }
      this.x += Math.cos(this.angle) * speed * dt;
      this.y += Math.sin(this.angle) * speed * dt;
    }

    collides(borders, obstacles) {
      const geom = SDC.geom;
      for (let i = 0; i < borders.length; i++) {
        if (geom.polygonIntersectsSegment(this.polygon, borders[i][0], borders[i][1])) return true;
      }
      for (let i = 0; i < obstacles.length; i++) {
        if (geom.polygonsIntersect(this.polygon, obstacles[i])) return true;
      }
      return false;
    }

    // Takes the car off the road without a crash (it keeps its progress).
    retire() {
      this.damaged = true;
      this.retired = true;
      this.speed = 0;
    }

    // Places the car directly (used for traffic, which has no physics).
    setPose(x, y, angle) {
      this.x = x;
      this.y = y;
      this.angle = angle;
      SDC.geom.orientedRect(x, y, angle, this.length, this.width, this.polygon);
    }

    // Adds this car's outline to the current path (for drawing many cars in one fill).
    traceOutline(ctx) {
      const p = this.polygon;
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.closePath();
    }

    // color: body fill. options.outline: optional stroke colour.
    draw(ctx, color, options) {
      const opts = options || {};
      const p = this.polygon;
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.closePath();
      ctx.fillStyle = this.damaged ? DAMAGED_FILL : color;
      ctx.fill();
      if (opts.outline) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = opts.outline;
        ctx.stroke();
      }

      // Windows, drawn in the car's own frame (+x is the nose), show its heading.
      const L = this.length;
      const W = this.width;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      ctx.fillStyle = this.damaged ? "rgba(46, 48, 51, 0.5)" : "rgba(244, 244, 239, 0.62)";
      ctx.fillRect(L * 0.06, -W * 0.38, L * 0.2, W * 0.76); // windscreen
      ctx.fillRect(-L * 0.4, -W * 0.34, L * 0.12, W * 0.68); // rear window
      if (this.damaged && !this.retired) {
        ctx.strokeStyle = "#2e3033";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-L * 0.42, -W * 0.4);
        ctx.lineTo(L * 0.42, W * 0.4);
        ctx.moveTo(-L * 0.42, W * 0.4);
        ctx.lineTo(L * 0.42, -W * 0.4);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  Car.DAMAGED_FILL = DAMAGED_FILL;
  SDC.Car = Car;
})((window.SDC = window.SDC || {}));
