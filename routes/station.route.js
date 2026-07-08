const express = require('express');
const router = express.Router();
const stationController = require('../controllers/station.controller');

router.post('/mappings', stationController.saveTagMappings);
router.post('/data-ingest', stationController.ingestLoggerData);
router.delete('/:station_id', stationController.deleteStation);

module.exports = router;