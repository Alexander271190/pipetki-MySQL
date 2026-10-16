'use strict';
const express = require('express');
const router = express.Router();

// Порядок ВАЖЕН: специфичные пути (/bulk-*, /available-for-replacement, /:id/transfer)
// должны матчиться раньше, чем общий GET /:id.

router.use('/', require('./bulk'));         // POST /bulk-create, /bulk-send, /bulk-return, /bulk-change-responsible
router.use('/', require('./calibration'));  // POST/GET /:id/calibration
router.use('/', require('./transfers'));    // GET /available-for-replacement, POST /:id/transfer, POST /:id/cancel-send
router.use('/', require('./crud'));         // GET /, GET /:id, POST /, PUT /:id, DELETE /:id

module.exports = router;
