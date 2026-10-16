'use strict';
const pool   = require('./pool');
const schema = require('./schema');
const seed   = require('./seed');

module.exports = {
  // Из pool.js
  pool:          pool.pool,
  query:         pool.query,
  getConnection: pool.getConnection,
  safeParse:     pool.safeParse,

  // Из schema.js
  initSchema:    schema.initSchema,

  // Из seed.js
  seedInitialData:   seed.seedInitialData,
  seedHelpDocs:      seed.seedHelpDocs,
  generatePipetteId: seed.generatePipetteId,
};
