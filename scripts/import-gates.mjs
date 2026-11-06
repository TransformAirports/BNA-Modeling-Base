import { readFileSync } from 'node:fs';

const [inputPath, ...extraArgs] = process.argv.slice(2);

function toGateFeatures(gates) {
  if (!Array.isArray(gates) || gates.length === 0) {
    throw new Error('Expected a nonempty gates array in the Turnarounds registry export.');
  }

  const gateCodes = new Set();
  return gates.map((gate, index) => {
    const { code, lon, lat, concourse, source } = gate ?? {};
    if (typeof code !== 'string' || !code.trim() || gateCodes.has(code)) {
      throw new Error(`Gate record ${index + 1} needs a unique, nonempty code.`);
    }
    if (!Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(lat) || Math.abs(lat) > 90) {
      throw new Error(`Gate ${code} needs valid numeric longitude and latitude.`);
    }
    if (typeof concourse !== 'string' || !concourse.trim() || typeof source !== 'string' || !source.trim()) {
      throw new Error(`Gate ${code} needs a concourse and source.`);
    }

    gateCodes.add(code);
    return {
      type: 'Feature',
      id: code,
      properties: { code, concourse, source },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    };
  });
}

try {
  if (!inputPath || extraArgs.length) {
    throw new Error('Usage: node scripts/import-gates.mjs <turnarounds-registry-file>');
  }

  const registry = JSON.parse(readFileSync(inputPath, 'utf8'));
  const collection = { type: 'FeatureCollection', features: toGateFeatures(registry?.gates) };
  process.stdout.write(`${JSON.stringify(collection, null, 2)}\n`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
