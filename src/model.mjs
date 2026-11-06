const INPUT_TYPES = new Set(['number', 'boolean', 'text']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLabel(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function freezeTree(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeInputs(fields, supplied) {
  if (!Array.isArray(fields)) throw new Error('The model must declare an inputs array.');
  if (!isRecord(supplied)) throw new Error('Scenario inputs must be an object.');

  const keys = new Set();
  const entries = fields.map((field) => {
    if (!isRecord(field) || !isLabel(field.key) || !isLabel(field.label) || !INPUT_TYPES.has(field.type)) {
      throw new Error('Each model input needs a key, label and supported type (number, boolean or text).');
    }
    const { key, label, type, defaultValue, min, max, step } = field;
    if (keys.has(key)) throw new Error(`Duplicate model input key: ${key}.`);
    keys.add(key);

    const value = Object.hasOwn(supplied, key)
      ? supplied[key]
      : defaultValue ?? (type === 'text' ? '' : type === 'boolean' ? false : undefined);

    if (type === 'number') {
      if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
      if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))
        || (min !== undefined && max !== undefined && min > max)) {
        throw new Error(`${label} has invalid model bounds.`);
      }
      if (min !== undefined && value < min) throw new Error(`${label} must be at least ${min}.`);
      if (max !== undefined && value > max) throw new Error(`${label} must be at most ${max}.`);
      if (step !== undefined) {
        if (!Number.isFinite(step) || step <= 0) throw new Error(`${label} has an invalid model step.`);
        const base = min ?? 0;
        const increments = (value - base) / step;
        if (!Number.isFinite(increments) || Math.abs(increments - Math.round(increments)) > 1e-8) {
          throw new Error(`${label} must use increments of ${step} from ${base}.`);
        }
      }
    } else if (typeof value !== (type === 'text' ? 'string' : 'boolean')) {
      throw new Error(`${label} must be ${type === 'text' ? 'text' : 'true or false'}.`);
    }
    return [key, value];
  });

  for (const key of Object.keys(supplied)) {
    if (!keys.has(key)) throw new Error(`Unknown scenario input: ${key}.`);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function normalizeResult(value) {
  if (!isRecord(value) || !isLabel(value.summary) || !Array.isArray(value.metrics)) {
    throw new Error('The model must return a summary and a metrics array.');
  }

  const result = {
    summary: value.summary,
    metrics: value.metrics.map((metric) => {
      if (!isRecord(metric) || !isLabel(metric.label)
        || !(metric.value === null || typeof metric.value === 'string' || Number.isFinite(metric.value))
        || (metric.unit !== undefined && typeof metric.unit !== 'string')) {
        throw new Error('Each metric needs a label and a string, finite number or null value. Its unit is optional text.');
      }
      return {
        label: metric.label,
        value: metric.value,
        ...(metric.unit === undefined ? {} : { unit: metric.unit }),
      };
    }),
  };

  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes) || value.notes.some((note) => typeof note !== 'string')) {
      throw new Error('Model notes must be an array of strings.');
    }
    result.notes = [...value.notes];
  }
  if (Object.hasOwn(value, 'data')) result.data = value.data;
  return result;
}

function jsonSnapshot(value) {
  try {
    return JSON.parse(JSON.stringify(value, (_key, item) => {
      if (item !== null && typeof item !== 'string' && typeof item !== 'boolean'
        && !Number.isFinite(item)
        && !(Array.isArray(item) || (typeof item === 'object'
          && [Object.prototype, null].includes(Object.getPrototypeOf(item))))) {
        throw new Error('Unsupported JSON value.');
      }
      return item;
    }));
  } catch (cause) {
    throw new Error('The run must contain JSON data only. Use plain objects, arrays, strings, finite numbers, booleans or null.', { cause });
  }
}

/** Run one model against a read-only reference snapshot and return a JSON-ready run record. */
export async function runModel(model, {
  airport, gates, runways, scenarioName = '', selectedGateCode = null, inputs = {},
}) {
  if (!isRecord(model) || !isLabel(model.id) || !isLabel(model.name) || !isLabel(model.version)
    || typeof model.run !== 'function') {
    throw new Error('A model must have an id, name, version and run function.');
  }
  if (!isLabel(airport?.code) || gates?.type !== 'FeatureCollection' || !Array.isArray(gates.features)
    || runways?.type !== 'FeatureCollection' || !Array.isArray(runways.features)) {
    throw new Error('Airport metadata and gate and runway GeoJSON collections are required.');
  }
  if (typeof scenarioName !== 'string') throw new Error('The scenario name must be text.');
  if (selectedGateCode !== null && typeof selectedGateCode !== 'string') {
    throw new Error('The selected gate code must be text or null.');
  }

  const normalizedInputs = normalizeInputs(model.inputs, inputs);
  const name = scenarioName.trim() || 'Untitled scenario';
  const code = selectedGateCode?.trim() || null;
  const reference = freezeTree(structuredClone({ airport, gates, runways }));
  const selectedGate = code === null ? null : reference.gates.features.find((gate) => gate.properties?.code === code);
  if (code !== null && !selectedGate) throw new Error(`Unknown gate: ${code}.`);

  const modelIdentity = { id: model.id, name: model.name, version: model.version };
  const result = await model.run(Object.freeze({
    ...reference,
    scenarioName: name,
    selectedGateCode: code,
    selectedGate,
    inputs: normalizedInputs,
  }));

  return jsonSnapshot({
    schemaVersion: 1,
    airport: {
      code: reference.airport.code,
      ...(reference.airport.source === undefined ? {} : { source: reference.airport.source }),
    },
    model: modelIdentity,
    scenario: { name, selectedGateCode: code, inputs: normalizedInputs },
    result: normalizeResult(result),
  });
}
