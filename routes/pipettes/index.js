'use strict';
const express = require('express');
const router = express.Router();

router.use('/', require('./locks'));
router.use('/', require('./bulk'));
router.use('/', require('./calibration'));
router.use('/', require('./transfers'));
router.use('/', require('./crud'));

module.exports = router;
