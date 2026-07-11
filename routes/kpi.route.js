// routes/kpi.route.js
const express = require('express');
const router = express.Router();
const kpiController = require('../controllers/kpi.controller');

// Route 1: Tổng lưu lượng tức thời kèm dữ liệu vẽ chart
router.get('/flow-summary', kpiController.getFlowSummaryByGroup);

// Route 2: Công suất tiêu thụ nước m3/ngày và m3/tháng
router.get('/volume-consumption', kpiController.getVolumeConsumptionByGroup);

// Route 3: Báo cáo chỉ số đầu ngày, cuối ngày và chênh lệch từng trạm
router.get('/station-index-report', kpiController.getStationIndexReport);

module.exports = router;