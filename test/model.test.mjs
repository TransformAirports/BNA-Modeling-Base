import assert from 'node:assert/strict';
import test from 'node:test';

import blank from '../models/blank.mjs';
import { runModel } from '../src/model.mjs';

function scenario(overrides = {}) {
  return {
    airport: { code: 'BNA', source: 'Reference fixture' },
    gates: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { code: 'B1' },
        geometry: { type: 'Point', coordinates: [-86.67, 36.13] },
      }],
    },
    runways: { type: 'FeatureCollection', features: [] },
    ...overrides,
  };
}

test('the starter exports a blank run without invented metrics', async () => {
  const run = await runModel(blank, scenario());
  assert.match(run.result.summary, /no model logic/i);
  assert.deepEqual(run.result.metrics, []);
  assert.equal(run.scenario.selectedGateCode, null);
  assert.deepEqual(run.scenario.inputs, {});
});

test('a custom async model gets typed inputs and an isolated gate snapshot', async () => {
  const original = scenario({
    scenarioName: '  Fixture run  ',
    selectedGateCode: ' B1 ',
    inputs: { count: 2.5, comment: 'Test' },
  });
  const model = {
    id: 'fixture',
    name: 'Fixture model',
    version: '2.0.0',
    inputs: [
      { key: 'count', label: 'Count', type: 'number', min: 1, step: 0.5 },
      { key: 'flag', label: 'Flag', type: 'boolean', defaultValue: true },
      { key: 'comment', label: 'Comment', type: 'text' },
    ],
    async run({ airport, gates, selectedGate, scenarioName, inputs }) {
      assert.equal(scenarioName, 'Fixture run');
      assert.equal(selectedGate, gates.features[0]);
      assert.notEqual(airport, original.airport);
      assert.throws(() => { selectedGate.geometry.coordinates[0] = 0; }, TypeError);
      assert.throws(() => { inputs.count = 0; }, TypeError);
      return {
        summary: 'Fixture output',
        metrics: [{ label: 'Count', value: inputs.count, unit: 'items' }],
        notes: [inputs.comment],
        data: { flag: inputs.flag, point: selectedGate.geometry.coordinates },
      };
    },
  };

  const run = await runModel(model, original);
  original.gates.features[0].geometry.coordinates[0] = 0;
  assert.deepEqual(run, {
    schemaVersion: 1,
    airport: { code: 'BNA', source: 'Reference fixture' },
    model: { id: 'fixture', name: 'Fixture model', version: '2.0.0' },
    scenario: { name: 'Fixture run', selectedGateCode: 'B1', inputs: { count: 2.5, flag: true, comment: 'Test' } },
    result: {
      summary: 'Fixture output',
      metrics: [{ label: 'Count', value: 2.5, unit: 'items' }],
      notes: ['Test'],
      data: { flag: true, point: [-86.67, 36.13] },
    },
  });
});

test('unknown gates and invalid input are rejected before the model runs', async () => {
  const model = {
    ...blank,
    inputs: [{ key: 'hours', label: 'Hours', type: 'number', min: 1, max: 4, step: 0.5, defaultValue: 2 }],
    run() { assert.fail('Invalid input reached the model.'); },
  };
  await assert.rejects(runModel(model, scenario({ selectedGateCode: 'B999' })), /unknown gate: B999/i);
  await assert.rejects(runModel(model, scenario({ inputs: { hours: '2' } })), /finite number/i);
  await assert.rejects(runModel(model, scenario({ inputs: { hours: 0 } })), /at least 1/i);
  await assert.rejects(runModel(model, scenario({ inputs: { hours: 1.25 } })), /increments of 0.5/i);
  await assert.rejects(runModel(model, scenario({ inputs: { unused: true } })), /unknown scenario input/i);
});

test('model output cannot silently turn nonfinite data into null on export', async () => {
  const model = {
    ...blank,
    run: () => ({ summary: 'Fixture output', metrics: [], data: { invalid: NaN } }),
  };
  await assert.rejects(runModel(model, scenario()), /JSON data only/i);
});
