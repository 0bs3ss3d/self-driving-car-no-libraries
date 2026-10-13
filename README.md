# Self-driving car, no libraries

A 2D simulation in which cars teach themselves to drive through endless traffic.
Each car sees the road through five ray sensors and drives with a small neural
network. A genetic algorithm keeps the best brain of every generation and fills
the next one with mutated copies of it.

Everything is written from scratch in plain JavaScript and the Canvas 2D API:
geometry, collision detection, the neural network, mutation and the seeded
random number generator. No frameworks, no npm, no CDN, no build step.

## Run it

Double-click `index.html`. It runs offline straight from disk, with no server
and no install. It was tested in Chromium; it uses only standard browser
features (Canvas 2D, `requestAnimationFrame`, `localStorage`).

The page opens in **Train** mode with 200 cars learning on their own. Press
**5×** to speed things up, or switch to **Drive** to steer a car yourself.

## Controls

| Control | What it does |
| --- | --- |
| **Train / Drive** | Train: 200 AI cars learn. Drive: you steer one car through the same traffic. Training waits while you drive. |
| **Pause / Resume** (`P`) | Freezes the simulation; the view keeps rendering. |
| **Reset** (`R`) | Train: back to generation 1, starting from your saved brain if there is one, otherwise from random brains. Drive: a fresh car at the start. |
| **Next generation** (`N`) | Ends the current generation now; its best car becomes the parent of the next one. |
| **1× 2× 5×** | Simulation speed. |
| **Cars per generation** | Population size, 1 to 1000. Applies from the next generation. |
| **Mutation** | 0 to 1; how far each copy drifts from its parent. Applies from the next generation. |
| **Save best brain** | Stores the brain of the car with the greatest distance this generation in `localStorage`. After a refresh (or Reset), generation 1 starts from it. |
| **Discard saved brain** | Removes the saved brain. Training in progress carries on. |
| Arrow keys or `W A S D` | Drive in Drive mode. |

Keyboard shortcuts are ignored while you type in the number field, and
Ctrl/Cmd shortcuts (such as Ctrl+R) are left to the browser.

The live readouts show the generation, how many cars are still driving, the
best distance of the current generation, how many traffic cars that car has
passed, and the frame rate. The panel on the right draws the brain of the
leading car as it thinks: neuron colour is the current activation, line colour
the sign of each weight, line thickness its strength.

## How the learning works

1. **Seeing.** Five rays fan out over 90° in front of each car. Each ray reports
   how close the nearest road edge or traffic car is: 0 means nothing within
   150 px, 1 means touching.
2. **Thinking.** The five readings go into a neural network with one hidden
   layer of 6 neurons (tanh) and 4 outputs. Each output is either on or off and
   presses one pedal or key: forward, left, right, reverse (which also brakes).
3. **Trying.** A generation is 200 cars with slightly different brains, all
   starting together on the same road with the same traffic. They pass through
   each other, so each car's run is independent.
4. **Scoring.** A car's fitness is how far up the road it got before crashing.
5. **Ending a generation.** A car that hasn't gained 520 px in the last 4 seconds
   is taken off the road. That is 130 px/s, a little faster than the fastest
   traffic, so a car that just sits behind traffic doesn't count as making
   progress; only overtaking does. When every car has crashed or been taken off,
   the generation ends.
6. **Breeding.** The car that got furthest becomes the parent. The next
   generation is one exact copy of its brain (so the best never gets lost) plus
   199 mutated copies, each weight nudged a random amount toward a fresh random
   value. Because the traffic is the same every generation, the best distance
   can only stay the same or go up.
7. **Keeping it.** Save writes the best brain to `localStorage` under a
   versioned key. On load it is checked thoroughly (format, version, shape,
   every number finite and within range). Missing, unreadable or mismatched
   data is ignored with a message, never a crash.

### Traffic

Traffic comes in seeded rows of one or two cars, so every row leaves at least
one lane open. Each row cruises at its own speed (80 to 120 px/s against the AI
car's 180 px/s); a faster row that catches up with a slower one slows down and
follows it, so traffic never overlaps. The first six rows hold one car each,
and the very first one sits directly in front of the start line, so new brains
learn to swerve before they meet two-car rows.

Rows are created at a frontier that runs ahead of the start at the AI car's top
speed, so no car can ever reach traffic that doesn't exist yet, and they are
dropped once far behind every car still driving. Creation depends only on the
seed and the clock, never on the cars, so the layout is identical for every car
in a generation and for every generation that uses the same seed.

## Results at the default settings

These are measured in headless runs of the exact shipped code. Training is
deterministic, so Chrome reproduces them exactly; other browsers may round a
few math functions differently, so their runs can differ in detail.

| Generation | Best car passed | Best distance | Simulated time so far |
| --- | --- | --- | --- |
| 1 | 6 cars | 6,822 px | 0.6 min |
| 3 | 13 cars | 10,453 px | 2.3 min |
| 20 | 21 cars | 15,988 px | 19.4 min |
| 60 | 75 cars | 52,404 px | 111 min |

At 5× speed, simulated time runs five times faster than real time.

On 10 traffic layouts it never trained on, the generation-60 brain passed 13.7
cars on average in 90 seconds (between 2 and 22), so it learns general habits
but is clearly best on the road it trained on.

The default `evolutionSeed` is one of the faster learners I measured. Across 10
different evolution seeds, 9 got a car past 10 traffic cars within 60
generations (anywhere from generation 3 to 57, median about 18), and one never
did. After 60 generations the best car passed between 0 and 75 cars, with half
the seeds at 21 or more. If a run stalls, change `evolutionSeed` and Reset.

## Architecture

```
index.html loads these plain scripts, in this order:
  geometry -> rng -> controls -> sensor -> car -> road -> traffic
  -> network -> visualizer -> trainer -> main

+--------------------------------------------------------------+
| main.js (browser only)                                       |
|   CONFIG, buttons and keys, fixed-timestep loop, camera,     |
|   HUD, canvas sizing, localStorage save/load                 |
+-----------+------------------------------------+-------------+
            | step()                             | draw
            v                                    v
+-----------------------------+        +-----------------------+
| trainer.js                  |        | visualizer.js         |
|   Trainer: generations,     |        |   network diagram,    |
|   elitism, mutation,        |        |   sensor bars         |
|   taking stalled cars off   |        +-----------------------+
|   World: one fixed step of  |
|   road + traffic + cars     |
+----+-----------+--------+---+
     |           |        |
     v           v        v
  road.js   traffic.js  car.js ----+----> sensor.js
                 |        |        |
                 v        |        +----> controls.js
              rng.js      v
                      network.js

geometry.js (intersections, collision) is used by everything with a shape.
```

| File | Its one job |
| --- | --- |
| `src/geometry.js` | Coordinate convention, segment intersection, polygon collision |
| `src/rng.js` | Seeded random numbers (mulberry32) and string hashing |
| `src/controls.js` | The four driving inputs and keyboard binding |
| `src/sensor.js` | Ray casting and normalised readings |
| `src/car.js` | Car physics, hitbox, crash state, drawing |
| `src/road.js` | Lanes, borders, road drawing |
| `src/traffic.js` | Seeded rows of traffic, created ahead and dropped behind |
| `src/network.js` | Feed-forward network, mutation, safe JSON round trip |
| `src/visualizer.js` | Drawing the network and sensor bars |
| `src/trainer.js` | The headless world step and the genetic algorithm |
| `src/main.js` | Settings and the browser app |

Everything lives under one global, `window.SDC`. The simulation (`trainer.js`
and everything it uses) never touches the DOM or a canvas; drawing happens only
in separate `draw` methods, so the whole simulation also runs in Node. The
running app is available in the browser console as `SDC.app`, for example
`SDC.app.trainer.history`.

**Coordinates:** pixels, x to the right, y down (like the canvas). Angle 0
points along +x and positive angles turn clockwise on screen; cars drive up the
screen at -π/2. See the top of `src/geometry.js`.

## Tunable parameters

All defaults live in `CONFIG` at the top of `src/main.js`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `dt` | 1/60 s | Length of one fixed simulation step |
| `maxStepsPerFrame` | 20 | Most steps per animation frame; extra time is dropped so a slow machine never spirals |
| `startLane` | 1 | Lane the cars start in (0 is leftmost) |
| `road.laneCount`, `road.laneWidth` | 3, 60 px | Road shape |
| `car.width`, `car.length` | 30, 50 px | Car size and hitbox |
| `car.maxSpeed` | 180 px/s | Top speed (traffic is created ahead of a car at this speed) |
| `car.maxReverseSpeed` | 90 px/s | Top speed backwards |
| `car.acceleration` | 720 px/s² | Throttle and brake strength |
| `car.friction` | 180 px/s² | Slowdown with no pedal pressed |
| `car.steerCurvature` | 0.01 rad/px | Turn per px travelled with the wheel fully turned, so turning scales with speed |
| `sensor.rayCount` | 5 | Number of rays, which is also the number of network inputs |
| `sensor.raySpread` | π/2 | Total width of the ray fan |
| `sensor.rayLength` | 150 px | Ray reach |
| `traffic.minSpeed`, `traffic.maxSpeed` | 80, 120 px/s | Range of row cruising speeds |
| `traffic.minGap`, `traffic.maxGap` | 300, 550 px | Distance between rows; `minGap` is also the following distance |
| `traffic.firstGapMin`, `traffic.firstGapMax` | 250, 400 px | Start line to the first row |
| `traffic.easyRows` | 6 | Single-car rows at the start |
| `traffic.spawnAhead`, `traffic.disposeBehind` | 1800, 900 px | Where traffic is created and dropped |
| `network.hiddenLayers` | `[6]` | Hidden layer sizes, for example `[8, 6]` |
| `population` | 200 | Cars per generation (also in the panel) |
| `mutationRate` | 0.25 | 0 copies exactly, 1 is a brand-new random brain (also in the panel) |
| `trafficSeed` | `"sdc"` | Traffic layout; any text works |
| `evolutionSeed` | `"h"` | First random brains and all mutations; any text works |
| `newTrafficEachGeneration` | `false` | `true` gives every generation a fresh layout: more variety, but the record no longer only goes up |
| `stallSeconds`, `minProgress` | 4 s, 520 px | A car that hasn't gained `minProgress` in `stallSeconds` is taken off the road. Keep their ratio above `traffic.maxSpeed` |
| `maxGenerationSeconds` | 0 | Optional cap on a generation's length; 0 means none |
| `storageKey` | `"sdc.bestBrain.v1"` | Where the saved brain lives |

Changing `sensor.rayCount` or `network.hiddenLayers` changes the brain's shape.
A saved brain of a different shape is skipped with a message; discard it or
change the setting back.

## Known limitations

- The road is straight. The world editor from the second course (road graph,
  buildings, minimap) is not included.
- A 5-6-4 network that only reacts to what it sees right now plateaus; long
  runs improve in jumps, with long flat stretches in between.
- Brains do best on the layout they trained on (see Results).
- Traffic ignores the AI cars, and AI cars pass through each other.
- The simulation advances in whole 1/60 s steps without interpolation, so
  motion can look slightly uneven on 120 or 144 Hz screens. Speed is unaffected.
- Some privacy settings block `localStorage` for pages opened from disk; the
  page then says so and the save buttons are disabled.

## Credits

Inspired by two freeCodeCamp courses by Radu Mariescu-Istodor: *Self-driving car
in JavaScript with no libraries* and *Build a virtual world filled with
self-driving cars*. The scope and architecture follow the first course; the
code here is written independently.

## License

MIT. See [LICENSE](LICENSE).
