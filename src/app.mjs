import { models } from '../models/index.mjs';
import { createMap } from './map.mjs';
import { runModel } from './model.mjs';

const byId = (id) => document.getElementById(id);
const gateSelect = byId('gate-select');
const modelSelect = byId('model-select');
const modelForm = byId('model-form');
const modelInputs = byId('model-inputs');
const runButton = byId('run-model');
const runLabel = runButton.querySelector('span');
const exportButton = byId('export-result');
const runStatus = byId('run-status');
const runMetrics = byId('run-metrics');
const runNotes = byId('run-notes');
const viewButtons = [...document.querySelectorAll('[data-view]')];

let reference;
let map;
let selectedGateCode = null;
let gatesByCode = new Map();
let inputControls = new Map();
let activeModel;
let currentRun;
let revision = 0;

async function loadData(file) {
  const response = await fetch(new URL(`../data/${file}`, import.meta.url));
  if (!response.ok) throw new Error(`${file} returned HTTP ${response.status}.`);
  return response.json();
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function setRunStatus(message, isError = false) {
  runStatus.textContent = message;
  runStatus.classList.toggle('error', isError);
}

function clearRun() {
  revision += 1;
  currentRun = undefined;
  exportButton.hidden = true;
  runMetrics.replaceChildren();
  runMetrics.hidden = true;
  runNotes.replaceChildren();
  runNotes.hidden = true;
  setRunStatus('Run a model to see its output here.');
  runButton.disabled = !reference || !activeModel;
  runLabel.textContent = 'Run model';
}

function selectGate(code) {
  if (code === selectedGateCode) return;
  selectedGateCode = code;
  gateSelect.value = code ?? '';
  map.setSelected(code);
  const gate = gatesByCode.get(code);
  let details = 'Select a gate to inspect its coordinates.';
  if (gate) {
    const [lon, lat] = gate.geometry.coordinates;
    const coordinate = (value, positive, negative) =>
      `${Math.abs(value).toFixed(6)}° ${value < 0 ? negative : positive}`;
    details = `${gate.properties.code} · ${coordinate(lat, 'N', 'S')}, ${coordinate(lon, 'E', 'W')}`;
  }
  byId('gate-details').textContent = details;
  clearRun();
}

function setupGates(gates) {
  const ordered = [...gates.features].sort((a, b) =>
    a.properties.concourse.localeCompare(b.properties.concourse)
    || a.properties.code.localeCompare(b.properties.code, 'en', { numeric: true }));
  const groups = new Map();
  for (const gate of ordered) {
    const { code, concourse } = gate.properties;
    gatesByCode.set(code, gate);
    if (!groups.has(concourse)) groups.set(concourse, []);
    groups.get(concourse).push(code);
  }

  const legend = byId('map-legend');
  for (const [concourse, codes] of groups) {
    const name = concourse.length === 1 ? `Concourse ${concourse}` : concourse;
    const group = document.createElement('optgroup');
    group.label = name;
    group.append(...codes.map((code) => new Option(code, code)));
    gateSelect.append(group);

    const item = document.createElement('li');
    item.dataset.concourse = concourse;
    item.append(element('span', 'legend-dot'), document.createTextNode(name));
    legend.append(item);
  }
  const runwayKey = document.createElement('li');
  runwayKey.hidden = true;
  runwayKey.append(element('span', 'legend-runway'), document.createTextNode('Runway thresholds'));
  legend.append(runwayKey);

  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      map.setView(view);
      runwayKey.hidden = view !== 'airfield';
      for (const toggle of viewButtons) toggle.setAttribute('aria-pressed', String(toggle === button));
    });
    button.disabled = false;
  }
  gateSelect.addEventListener('change', () => selectGate(gateSelect.value || null));
  gateSelect.disabled = false;
  byId('gate-count').textContent = String(gates.features.length);
  byId('gate-stat').hidden = false;

  const sources = new Set(gates.features.map((gate) => gate.properties.source));
  const surveyDate = sources.size === 1
    ? /^operator survey (\d{4}-\d{2}-\d{2})$/.exec([...sources][0])?.[1]
    : undefined;
  const date = surveyDate && new Date(`${surveyDate}T00:00:00Z`);
  if (date && Number.isFinite(date.valueOf())) {
    const display = new Intl.DateTimeFormat('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(date);
    byId('reference-subtitle').textContent = `BNA operator gate survey · ${display}`;
  }
}

function setupModel() {
  activeModel = models.find((model) => model.id === modelSelect.value);
  byId('model-description').textContent = activeModel?.description ?? 'Register a model in models/index.mjs.';
  modelInputs.replaceChildren();
  inputControls = new Map();
  for (const [index, field] of (activeModel?.inputs ?? []).entries()) {
    const wrap = element('div', 'field');
    const input = document.createElement('input');
    const label = element('label', '', field.label);
    input.id = `model-field-${index}`;
    label.htmlFor = input.id;

    if (field.type === 'boolean') {
      input.type = 'checkbox';
      input.checked = field.defaultValue ?? false;
      label.classList.add('checkbox-label');
      label.prepend(input);
      wrap.append(label);
    } else {
      input.type = field.type;
      if (field.type === 'number') {
        input.required = true;
        input.step = field.step ?? 'any';
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
      }
      input.value = field.defaultValue ?? '';
      wrap.append(label, input);
    }

    if (field.help) {
      const help = element('p', 'field-help', field.help);
      help.id = `${input.id}-help`;
      input.setAttribute('aria-describedby', help.id);
      wrap.append(help);
    }
    modelInputs.append(wrap);
    inputControls.set(field.key, input);
  }
  clearRun();
}

function showResult(record) {
  const { summary, metrics, notes = [] } = record.result;
  setRunStatus(summary);
  runMetrics.replaceChildren(...metrics.map(({ label, value, unit }) => {
    const row = document.createElement('div');
    const display = value === null ? 'Unavailable' : `${value}${unit ? ` ${unit}` : ''}`;
    row.append(element('dt', '', label), element('dd', '', display));
    return row;
  }));
  runMetrics.hidden = metrics.length === 0;
  runNotes.replaceChildren(...notes.map((note) => element('li', '', note)));
  runNotes.hidden = notes.length === 0;
  exportButton.hidden = false;
}

modelSelect.addEventListener('change', setupModel);
modelForm.addEventListener('input', clearRun);
modelForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!reference || !activeModel) return;

  clearRun();
  const runRevision = revision;
  runButton.disabled = true;
  runLabel.textContent = 'Running…';
  setRunStatus('Running model…');
  const inputs = Object.fromEntries([...inputControls].map(([key, control]) => [
    key,
    control.type === 'checkbox' ? control.checked
      : control.type === 'number' ? control.valueAsNumber : control.value,
  ]));

  try {
    const record = await runModel(activeModel, {
      ...reference,
      scenarioName: byId('scenario-name').value,
      selectedGateCode,
      inputs,
    });
    if (runRevision === revision) {
      currentRun = record;
      showResult(record);
    }
  } catch (error) {
    if (runRevision === revision) setRunStatus(error instanceof Error ? error.message : 'The model could not run.', true);
  } finally {
    if (runRevision === revision) {
      runButton.disabled = false;
      runLabel.textContent = 'Run model';
    }
  }
});

exportButton.addEventListener('click', () => {
  if (!currentRun) return;
  const text = `${JSON.stringify(currentRun, null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const name = `${currentRun.airport.code}-${currentRun.model.id}-${currentRun.scenario.name}`
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name || 'model-run'}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function initialize() {
  const [airport, gates, runways] = await Promise.all([
    loadData('airport.json'), loadData('gates.geojson'), loadData('runways.geojson'),
  ]);
  map = createMap(byId('airfield-map'), { gates, runways, referencePoint: airport.referencePoint, onSelect: selectGate });
  reference = { airport, gates, runways };
  byId('map-placeholder').hidden = true;
  byId('airport-timezone').textContent = airport.timezone;
  setupGates(gates);
  modelSelect.append(...models.map((model) => new Option(model.name, model.id)));
  modelSelect.disabled = models.length === 0;
  setupModel();
}

initialize().catch((error) => {
  byId('map-placeholder').textContent = 'Reference map unavailable.';
  const status = byId('load-status');
  status.textContent = 'The workspace could not start. Run npm start from the template folder and check the browser console for details.';
  status.classList.add('error');
  status.hidden = false;
  console.error(error);
});
