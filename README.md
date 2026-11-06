# BNA Airfield Model Starter

This folder is a standalone starting point for building planning models for Nashville International Airport. It ships with BNA reference geography and a blank model. The model defines no operational rules, assumptions, or calculated results.

## Start here

Use Node.js 22 or newer and a current browser. From this folder, run:

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The starter runs locally and needs no install step, credentials, database, map provider, or internet connection. If the port is in use, run `npm start -- 4174` and open the address printed in the terminal. Use the local URL rather than opening `index.html` directly.

1. Open **Terminal** to inspect the gate points, or switch to **Airfield** to see the four runway references. Select a map point or use **Reference gate** to read its coordinates. A reference gate is optional for a model run.
2. Leave **Blank model** selected, give the scenario a name, and click **Run model**. The result confirms that the runner works and that the blank module has no calculations.
3. Click **Download JSON** to save the run. The starter keeps the latest result in the browser until an input changes or you reload the page.
4. Follow [Build a model](docs/build-a-model.md) to add model logic and inputs. Run `npm test` to check the starter’s model runner.

## What to edit

| Location | Purpose |
| --- | --- |
| [`models/blank.mjs`](models/blank.mjs) | The empty model definition. Copy it to start a new model. |
| [`models/index.mjs`](models/index.mjs) | Register modules to make them available in the workspace. |
| [`data/`](data/README.md) | BNA metadata, 52 surveyed gate points, and four schematic runway lines. Source revisions and the optional gate importer are documented here. |
| `src/model.mjs` | Shared runner: checks scenario inputs and wraps each model’s result in a JSON record. |
| `src/app.mjs`, `src/map.mjs`, `index.html` | The browser workspace and reference map. You can add a model without editing these files. |
| `test/` | Tests for the blank run, input handling, and the shared model contract. |

The gate data comes from BNA’s August 11, 2026 operator survey in the Turnarounds airport registry. Coordinates use `[longitude, latitude]` in decimal degrees. Gate points have no stand footprints, and the runway lines only connect published thresholds. Bring your own validated geometry and operating data for models that need routing, availability, or clearance information.

## Share a copy

Zip the entire `bna-airfield-template` folder and extract it before running. From its parent folder on macOS or Linux:

```sh
zip -r bna-airfield-template.zip bna-airfield-template -x '*/.DS_Store'
```

The archive needs only this folder. The source repositories and their dependencies are unnecessary to run it.
