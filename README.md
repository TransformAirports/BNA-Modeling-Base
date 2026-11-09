# BNA Live

A cinematic 3D view of Nashville International Airport (BNA) built on Mapbox GL JS and three.js. It uses Mapbox's 3D map, where BNA's terminal and concourses are already extruded buildings, and paints the airfield on top: runways with markings, taxiways and gate lead-in lines. Press **Play** and watch a full 24-hour day unfold: aircraft fly in from their origin cities, land on the real runways, taxi along the real taxiways, dock nose-in at the surveyed gates, push back, and depart toward their destinations. The sun moves with the clock, so dawn, dusk and night light up the runways, taxiways, aprons and every aircraft's nav lights, strobes and cabin windows.

It's a starter kit: a good-looking, working base meant to be extended, by hand or with an AI coding tool. Architecture notes for AI tools are in [AGENTS.md](AGENTS.md).

## Quick start

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The page live-reloads whenever you save a file.

It works on first run because the repo ships with a **demo Mapbox token**. Before you build on it, switch to your own (next section).

## Use your own Mapbox token

The map tiles come from Mapbox, which needs an access token. The included demo token (`MAPBOX_DEMO_TOKEN` in [`src/config.js`](src/config.js)) exists only so a fresh clone works. It may be rotated or rate-limited at any time, and its usage is billed to whoever owns it. **Replace it with your own.**

1. **Get a token.** Sign in at [account.mapbox.com](https://account.mapbox.com/access-tokens/) (free tier) and copy your **Default public token**, or create a new one. Public tokens start with `pk.`. Never use a secret `sk.` token in a web app.
2. **Add it to `.env.local`** in the project root. The file is gitignored, so your token never gets committed:

   ```bash
   cp .env.example .env.local
   ```

   Then edit `.env.local`:

   ```
   VITE_MAPBOX_TOKEN=pk.your_token_here
   ```

3. **Restart the dev server.** Stop it with `Ctrl+C`, then run `npm run dev` again. Vite reads `.env.local` only at startup.

That's it: a token in `.env.local` always wins over the demo token.

**Optional: remove the demo token entirely.** Set `MAPBOX_DEMO_TOKEN = ''` in `src/config.js`. If no token is found, the app shows a prompt where you can paste one; it's saved in that browser only.

**Deploying publicly?** In your Mapbox account, add URL restrictions to the token (for example `https://your-site.example/*`) so nobody else can reuse it from your page source.

Where the app looks for a token, first match wins:

| Order | Source | Use it for |
| --- | --- | --- |
| 1 | `VITE_MAPBOX_TOKEN` in `.env.local` | Your own token. Recommended. |
| 2 | A token pasted into the in-app prompt (saved in that browser) | Quick tests |
| 3 | `MAPBOX_DEMO_TOKEN` in `src/config.js` | Demo only. Works out of the box. |

If Mapbox rejects a token, the app clears any browser-saved token and asks for a new one.

## Using it

| Control | What it does |
| --- | --- |
| ▶ / `Space` | Play or pause the day |
| `1×` … `600×` / `[` `]` | Playback speed (simulated seconds per real second) |
| Timeline | Click or drag to jump anywhere in the day. Amber bars are arrivals, cyan bars are departures (per 15 min). The background is the real sky colour for that time. |
| `←` `→` | Jump 5 minutes (hold `Shift` for 30) |
| **Airfield / Terminal / Runways** (`1` `2` `3`) | Camera presets |
| **Orbit** (`O`) | Slowly circle the airport |
| **Follow** (`F`) | Chase cam behind an aircraft. Picks the selected flight, or something interesting. Drag the map to stop. |
| Click an aircraft or a board row | Flight card: route, phase, speed, altitude, runway |
| **3D Map / Satellite** | Mapbox's 3D map (default: extruded buildings, painted airfield) or satellite imagery. Both follow the day/night lighting. |
| **Tags** (`T`) | Floating labels over moving aircraft |

Open the browser console and use `window.bna` (`world`, `clock`, `map`, `view`, `aircraftLayer`) to poke at things live, for example `bna.clock.seek(17 * 3600)`.

## What's real and what's made up

**Real**
- Runway thresholds, from the FAA AIP ([`data/runways.geojson`](data/runways.geojson))
- Gate positions, from BNA's operator survey of August 11, 2026 ([`data/gates.geojson`](data/gates.geojson)): 52 nose-wheel stop marks
- Taxiways, gate lead-in lines, aprons and terminals, from OpenStreetMap ([`data/osm/bna-airfield.geojson`](data/osm/bna-airfield.geojson)). Aircraft route over this real taxiway graph, and the 3D map paints it.
- Terminal and concourse buildings: Mapbox's own 3D building data.
- Sun position for Nashville on today's date. Light presets switch at the actual dawn and dusk.

**Synthetic**
- The flight schedule. It's generated from a seed: about 400 departures and 400 arrivals, with carriers assigned per concourse. It looks plausible, but **it is not BNA's real schedule**. Swap in real data whenever you have it (see below).
- Aircraft models and liveries. Models are generated in code from real dimensions. Liveries follow each airline's colour layout and titles, but tail logos are replaced with simple shapes rather than the trademarked artwork.
- Runway markings. They're drawn to the standard FAA pattern for a 150 ft runway, not surveyed from BNA.
- Ground traffic control. Runway use is de-conflicted (spacing, hold-short waits), but aircraft don't yet avoid each other on taxiways.

## Project layout

```
index.html                 HUD markup (clock, stats, board, flight card, timeline)
src/
  config.js                ← start here: token, camera shots, runway flow, schedule knobs
  main.js                  wires everything together; render loop, controls, keyboard
  sim/                     pure JavaScript, no DOM: runs in the browser and in Node tests
    geo.js                 local metric frame (x east, y north, metres), paths, curves
    airfield.js            taxi graph from OSM, gate stands, runway entries/exits, routing
    schedule.js            synthetic 24h schedule → "visits" (one aircraft at one gate)
    simulation.js          plans each visit's approach/landing/taxi/pushback/takeoff/climb
    motion.js              speed profiles and timed legs (time → position)
    fleet.js               aircraft types (dimensions) and carriers (colours, routes)
    airports.js            destination coordinates
    sun.js, clock.js       sun position and the playback clock
  render/                  three.js inside a Mapbox custom layer
    aircraftLayer.js       the custom layer: scene, lighting, shadows, picking
    aircraftModels.js      procedural airliners (geometry + materials)
    liveries.js            per-airline paint schemes: fuselage, titles, tail, engines
    glowPoints.js          GPU glow sprites for every light
    airfieldLights.js      runway, approach, taxiway and apron lighting
  map/mapView.js           Mapbox map, overlay layers, light presets, cameras
  ui/                      HUD and timeline
  styles/app.css
data/                      reference data (see data/README.md)
scripts/fetch-osm.mjs      refresh the OpenStreetMap snapshot
models/, src/model.mjs     planning-model contract (see docs/build-a-model.md)
test/                      node --test suites
```

## Common changes

- **A different day.** Change `SIMULATION.seed` in `src/config.js`.
- **North flow.** Set `RUNWAY_FLOW.active = 'north'`, or edit which runways each flow uses.
- **Busier or quieter.** Tune `SCHEDULE.gateGap` and `overnightShare`, and `turnMinutes` per type in `src/sim/fleet.js`.
- **The look of the 3D map.** `MAP.basemap` in `src/config.js` passes options straight to Mapbox Standard. Try `theme: 'monochrome'` for a white architectural-model look, or turn off `show3dTrees` / `show3dFacades`. The airfield paint (runway, taxiway and apron colours) lives in `pavementData()` and `addOverlays()` in `src/map/mapView.js`.
- **The opening shot.** `MAP.intro` is where the camera starts; it then flies to `CAMERA_PRESETS.overview`.
- **Different airlines at a concourse.** Edit `SCHEDULE.concourseCarriers`.
- **A new aircraft type or carrier.** Add it to `src/sim/fleet.js`. The 3D model is generated from its dimensions automatically. Give a new carrier a paint scheme in `src/render/liveries.js`.
- **Tweak a livery.** Each airline in `src/render/liveries.js` has a `body` painter (colours, stripes, titles in metres along the fuselage) and a `fin` painter (tail). Check your work with `bna.inspect('DAL')` in the browser console, which pauses and flies to a parked aircraft. `bna.inspect('SWA', 'B38M', 270)` shows a Southwest 737 MAX from its left side.
- **New camera shots.** Add to `CAMERA_PRESETS` in `src/config.js`, then add a button in `index.html`.
- **A real schedule.** Produce the same visit objects that `generateSchedule` returns and pass them as `config.visits` to `createWorld` (see `src/sim/schedule.js` for the shape). Everything else (routing, runway slots, animation, board, timeline) works from that.

## Data refresh

```bash
npm run fetch:osm
```

This re-downloads the OpenStreetMap airfield snapshot. Review the diff before committing. To import an updated gate survey, see [`data/README.md`](data/README.md).

## Tests and build

```bash
npm test
```

```bash
npm run build
```

`npm test` runs the simulation checks: schedule determinism, no double-booked gates, runway separation, motion continuity, the midnight loop and lighting, plus the planning-model contract. `npm run build` writes a static site to `dist/`. Host it anywhere, and remember to URL-restrict your token.

## Attribution

Map data © Mapbox and © OpenStreetMap contributors. Airfield geometry from OpenStreetMap is licensed under the [ODbL](https://www.openstreetmap.org/copyright). The FAA AIP and BNA's gate survey are documented in [`data/README.md`](data/README.md). Airline names and colour schemes identify carriers in the synthetic schedule. Liveries are approximations painted in code, not official artwork, and contain no airline logos.
