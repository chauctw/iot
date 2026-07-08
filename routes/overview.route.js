const express = require('express');
const router = express.Router();
const overviewController = require('../controllers/overview.controller');

router.get('/latest', overviewController.getLatestOverview);
router.get('/history-chart', overviewController.getHistoryLog);

module.exports = router;