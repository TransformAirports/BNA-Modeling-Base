export default {
  id: 'blank',
  name: 'Blank model',
  version: '0.1.0',
  description: 'Start with a planning question, define its inputs, and add your calculation here.',

  // Declare fields here. The workspace builds the form from these definitions.
  inputs: [],

  // Use context.airport, .gates, .runways, .selectedGate and .inputs as needed.
  // Return a summary, metrics, and optional notes or JSON data.
  run(_context) {
    return {
      summary: 'No model logic is implemented yet.',
      metrics: [],
      notes: ['Edit models/blank.mjs or register a new model to calculate results.'],
    };
  },
};
