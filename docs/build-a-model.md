# Build a model

Start by writing down the question, the inputs and their units, the expected outputs, and how you will check the results. Keep reference locations in `data/` and put topic-specific assumptions and rules in `models/`. For example, pavement inspection staffing, stand maintenance scheduling, and ground equipment staging can each be separate modules that use the same gate inventory.

## Add the module

1. Copy `models/blank.mjs` to `models/your-model.mjs` and give it a unique `id`, a visible `name`, a `version`, and a short `description`.
2. Declare editable scenario inputs. Use an empty `inputs` array if the model has no controls. Add your calculations to `run(context)` and return a summary and metrics.
3. Import the new module in `models/index.mjs` and add it to `models`. Reload the browser and select it in **Model module**. Keep the blank module if you want a starting point for future work.

Here is a small module to illustrate the contract. It estimates inspection time from user inputs; it does not represent BNA procedures or supply defaults for real work.

```js
// models/inspection-budget.mjs
export default {
  id: 'inspection-budget',
  name: 'Inspection time budget',
  version: '0.1.0',
  description: 'Estimate total inspection minutes from an assumed area count and duration.',
  inputs: [
    { key: 'areas', label: 'Inspection areas', type: 'number', min: 1, step: 1 },
    { key: 'minutesPerArea', label: 'Minutes per area', type: 'number', min: 0.1, step: 0.1 },
  ],
  run({ inputs, selectedGate }) {
    const totalMinutes = Math.round(inputs.areas * inputs.minutesPerArea * 10) / 10;
    const notes = ['This estimate excludes travel and setup time.'];
    if (selectedGate) notes.push(`Scenario reference gate: ${selectedGate.properties.code}.`);
    return {
      summary: 'Estimated time from the scenario assumptions.',
      metrics: [{ label: 'Inspection time', value: totalMinutes, unit: 'min' }],
      notes,
    };
  },
};
```

Register it in `models/index.mjs`:

```js
import blank from './blank.mjs';
import inspectionBudget from './inspection-budget.mjs';

export const models = [blank, inspectionBudget];
```

Enter `3` areas and `12.5` minutes per area to check that the result is `37.5 min`. Change the scenario name or an input to start a fresh run.

## Model contract

Each input has a unique `key`, a visible `label`, a `type`, and optional `help`. The workspace creates the form automatically.

| Type | Value supplied to `run` | Options |
| --- | --- | --- |
| `number` | Finite number | `defaultValue`, `min`, `max`, `step`. A step starts at `min` when supplied, otherwise at zero. |
| `boolean` | `true` or `false` | `defaultValue` (otherwise `false`). |
| `text` | String | `defaultValue` (otherwise empty text). |

The runner gives `run(context)` a read-only snapshot containing:

- `airport`: BNA identifiers, IANA time zone (`America/Chicago`), and airport reference point.
- `gates` and `runways`: GeoJSON `FeatureCollection` objects. Join model records by `gate.properties.code`; use `gate.geometry.coordinates` for the original `[lon, lat]` point.
- `selectedGateCode` and `selectedGate`: the optional reference gate code and its full GeoJSON feature. Both are `null` when none is selected. The entire gate inventory remains available regardless of the selection.
- `scenarioName` and `inputs`: the name and validated values for this run.

`run` may return its result directly or return a promise. Return `summary` and a `metrics` array. Each metric has `label`, `value` (a finite number, string, or `null` for unavailable), and an optional `unit`. Use optional `notes` for assumptions and limitations. Use optional `data` for structured JSON such as tables or simulated events. The workspace displays the summary, metrics, and notes; the JSON download also includes `data`.

Keep calculation modules independent of the page so you can exercise them in Node with `runModel` from `src/model.mjs`. Pass parsed airport, gate, and runway files together with the scenario name, selected gate code, and typed inputs. The tests in `test/model.test.mjs` show the invocation and checks for a custom model.

## Keep a run reviewable

The downloaded record includes a schema version, airport code, model ID and version, scenario name, optional gate code, input values, and result. Keep the model version, the reference files, and any additional input datasets alongside a run you need to reproduce. Record assumptions and units; include a seed as an input if the model uses randomness. When you change the calculation or input contract, increment the model version.

Check small cases with known results before using larger datasets. Identify which data came from the airport, which inputs were assumed, and which outputs are estimates. Gate points and runway lines are reference locations; models that depend on taxi paths, stand geometry, surface availability, or operating rules need their own suitable sources.
