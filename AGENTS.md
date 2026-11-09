# AGENTS.md: notes for AI coding tools

BNA Live is a Vite + vanilla-JavaScript app. Mapbox GL JS v3 provides the basemap and camera; three.js renders the aircraft inside a Mapbox custom layer. There's no framework and no TypeScript. Keep it that way unless the user asks.

## Commands

```bash
npm install
npm run dev     # http://127.0.0.1:5173 with live reload
npm test        # node --test: simulation + model-contract checks (no browser needed)
npm run build   # static site in dist/
```

After a change, run `npm test`. If you touched anything visual, load the page and check the browser console for errors.

## How it fits together

```
data files ──► sim/world.js ──► airfield (graph, stands, runways)
                              ├► schedule (visits)
                              └► simulation (tracks: timed legs per visit)
                                        │  stateAt(track, t) / activeAt(t)
main.js render loop ── clock.time ──────┤
   ├► render/aircraftLayer.js  (three.js meshes, lights, shadows)
   ├► map/mapView.js           (light preset, gate states, route line, cameras)
   └► ui/hud.js, ui/timeline.js
```

- **Everything is a pure function of sim time.** `simulation.stateAt(track, t)` returns position, heading, pitch, roll, speed, phase and light flags for any `t`. Never accumulate state frame to frame; that's what makes scrubbing free. If you add behaviour (vehicles, jet bridges, weather), give it the same "time → state" shape.
- **Time.** Seconds after local midnight in `America/Chicago`, from 0 to 86400. The day loops; the schedule parks the same aircraft overnight so midnight is seamless.
- **Space.** A local, right-handed metric frame: `x` east, `y` north, `z` up, origin at the airport reference point (`src/sim/geo.js`). Convert with `frame.toLocal([lng, lat])` and `frame.toLngLat([x, y])`. Headings are compass degrees (0 = north, clockwise).
- **Aircraft model frame.** `x` right wing, `y` nose, `z` up, origin on the ground under mid-fuselage. Rotation is `Euler(pitch, roll, -heading, 'ZXY')`.
- **`src/sim/` stays DOM-free** so it runs in Node tests. Browser-only code goes in `render/`, `map/` and `ui/`.

## Key files

| File | Responsibility |
| --- | --- |
| `src/config.js` | Token, map styles, camera presets, runway flow, schedule knobs |
| `src/sim/airfield.js` | Builds the taxi graph from OSM ways (shared node ids = connections), matches surveyed gates to OSM lead-in lines for stand headings, finds runway entries/exits, Dijkstra trees per stand |
| `src/sim/schedule.js` | Synthetic visits. Replace or bypass with real data via `createWorld(data, { visits })` |
| `src/sim/simulation.js` | Plans each visit (approach path, rollout, exit, taxi, lead-in, pushback, hold-short, lineup, takeoff, climb), de-conflicts runway slots, samples states, builds board/histogram data |
| `src/sim/motion.js` | Speed profiles along paths (accel/decel + curvature limits) and leg timing |
| `src/render/aircraftLayer.js` | Mapbox custom layer. Shares Mapbox's GL context, recovers the eye position from the MVP so PBR lighting is right, pools meshes per type+carrier |
| `src/render/aircraftModels.js` | Procedural airliners from `fleet.js` dimensions; geometry merged by material (~9 draw calls per aircraft); clear-coat paint materials |
| `src/render/lighting.js` | Aircraft lights copied from Mapbox Standard's per-preset ambient + directional lights (plus warm apron fill at night), so jets match the buildings' brightness, colour cast and shadow direction |
| `src/render/liveries.js` | One painter per airline. `body(p)` paints in (metres from nose, elevation angle) and handles both sides plus text orientation; `fin(f)` paints in (chord fraction, height fraction) on the real fin outline |
| `src/render/glowPoints.js` | One shader for all point lights (size in metres, clamped in pixels, GPU blink patterns) |
| `src/map/mapView.js` | Map creation, airfield paint and overlay layers (re-added on every `style.load`), light presets, camera modes (intro, presets, orbit, follow) |

## Conventions and gotchas

- **Mapbox Standard styles:** add overlay layers with a `slot` (`bottom` / `middle` / `top`) and set `*-emissive-strength: 1` on anything that should stay bright at night.
- **The default basemap is Mapbox Standard (the 3D map).** Its options come from `MAP.basemap` in `src/config.js` and are re-applied on every style load. The airfield paint (`bna-apron`, `bna-taxiway`, `bna-runway`, `bna-runway-markings`, `bna-lead-ins`) sits in the `bottom` slot so Mapbox's 3D buildings stand on top of it. It's hidden in satellite mode, where the imagery already shows the pavement.
- **Switching styles** (`map.setStyle`) removes sources, layers and the custom layer. `addOverlays()` runs on every `style.load`; add new layers there, not once at startup.
- **Day and night.** `createDayLighting()` in `sim/sun.js` provides `{ sunAzimuth, sunElevation, night, day, preset }` each frame. Drive anything time-of-day from it. Aircraft *shading* deliberately follows the Mapbox preset (`render/lighting.js`), not the true sun angle, so it stays consistent with the 3D buildings. Keep `renderer.toneMapping` at `NeutralToneMapping`: ACES makes the liveries dark and tinted.
- **Liveries:** keep tail motifs generic. Don't recreate trademarked airline logos unless the user supplies licensed artwork. To check a change, run `bna.inspect('<ICAO>', '<type>', side)` in the browser console.
- **Materials are shared** across aircraft of the same type and carrier. Never set per-aircraft properties on them. The body material is cloned per instance only because cabin windows light up individually.
- **Performance budget:** about 80 aircraft visible, roughly 1,000 draw calls. Prefer merging geometry or extending `glowPoints` over adding meshes.
- **The token.** `MAPBOX_DEMO_TOKEN` in `src/config.js` is a deliberate, committed demo token. Don't remove or rotate it unless asked. Personal tokens belong in `.env.local` (gitignored); never commit `.env.local`.
- **Reference data.** Don't hand-edit `data/osm/*.geojson`; regenerate it with `npm run fetch:osm`. Gate codes (`properties.code`) are the join key everywhere.
- **Planning models.** `models/` and `src/model.mjs` hold a separate, tested contract for planning calculations (`docs/build-a-model.md`). The 3D view doesn't surface it yet.

## Good next steps

- Taxi conflict avoidance: reserve graph edges over time in `simulation.js`, and hold aircraft at nodes.
- Ground support: pushback tugs, fuel trucks, baggage carts and jet bridges, all as time → state functions.
- Real schedules: an importer that turns a CSV or API feed into visits.
- Weather: a wind-driven runway flow that can change mid-day, and fog or rain through Mapbox `setFog` / `setRain`.
- Shareable URLs: encode the time, camera and selected flight in `location.hash`.
- A model panel: run `models/*.mjs` against the simulated day and show the results in the HUD.
