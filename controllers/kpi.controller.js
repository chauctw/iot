// controllers/kpi.controller.js
"use strict";

const db = require('../config/db');

/**
 * Helper để bóc tách/chuẩn hóa danh sách station_ids từ query string
 */
const parseStationIds = (stationIdsParam) => {
  if (!stationIdsParam) return [];
  if (Array.isArray(stationIdsParam)) return stationIdsParam;
  return String(stationIdsParam).split(',').map(id => id.trim()).filter(Boolean);
};

/**
 * 1. Lấy tổng flow tức thời hiện tại và dữ liệu lịch sử chart (Gộp theo Nhóm Trạm)
 * API Endpoint: GET /api/kpi/flow-summary
 */
exports.getFlowSummaryByGroup = async (req, res) => {
  const { station_ids, tag_key, start_time, end_time, interval_mins } = req.query;
  const stations = parseStationIds(station_ids);
  const flowTag = tag_key || 'flow'; // Mặc định tag lưu lượng là 'flow' nếu FE không truyền

  if (stations.length === 0) {
    return res.status(400).json({ success: false, error: 'Thiếu danh sách station_ids (hoặc truyền chuỗi cách nhau bằng dấu phẩy)' });
  }

  const interval = parseInt(interval_mins, 10) || 5;

  try {
    // 1.1 Tính tổng flow tức thời hiện tại (Latest) của nhóm trạm
    const latestQuery = `
      SELECT COALESCE(SUM(value::numeric), 0) AS total_instant_flow
      FROM logger_latest
      WHERE logger_id = ANY($1) AND tag_key = $2
    `;
    const latestRes = await db.query(latestQuery, [stations, flowTag]);
    const totalInstantFlow = parseFloat(latestRes.rows[0].total_instant_flow);

    // 1.2 Xử lý khoảng thời gian mặc định cho biểu đồ (nếu thiếu)
    let rawStart = start_time;
    let rawEnd = end_time;
    if (!rawStart || !rawEnd) {
      const now = new Date();
      const tz = now.getTimezoneOffset() * 60000;
      const localNow = new Date(now.getTime() - tz);
      if (!rawEnd) rawEnd = localNow.toISOString().replace("T", " ").slice(0, 19);
      if (!rawStart) rawStart = new Date(localNow.getTime() - 86400000).toISOString().replace("T", " ").slice(0, 19); // 24h qua
    }

    // 1.3 Truy vấn biểu đồ lịch sử: Tính tổng lưu lượng trung bình của cả nhóm theo từng khung thời gian
    const chartQuery = `
      WITH station_time_slots AS (
        SELECT 
          logger_id,
          to_timestamp(floor(extract(epoch from data_ts) / ($1 * 60)) * ($1 * 60)) AS group_ts,
          AVG(value::numeric) AS avg_station_value
        FROM logger_readings 
        WHERE logger_id = ANY($2) 
          AND tag_key = $3 
          AND data_ts::timestamp >= $4::timestamp 
          AND data_ts::timestamp <= $5::timestamp 
        GROUP BY logger_id, group_ts
      )
      SELECT 
        group_ts,
        ROUND(SUM(avg_station_value), 2) AS total_group_flow
      FROM station_time_slots
      GROUP BY group_ts
      ORDER BY group_ts ASC
    `;

    const chartRes = await db.query(chartQuery, [interval, stations, flowTag, rawStart, rawEnd]);

    return res.status(200).json({
      success: true,
      group_stations: stations,
      tag_key: flowTag,
      total_instant_flow: totalInstantFlow,
      chart_data: chartRes.rows.map(r => ({
        timestamp: r.group_ts,
        value: parseFloat(r.total_group_flow)
      }))
    });
  } catch (error) {
    console.error("❌ [KPI][FLOW_SUMMARY_ERROR]", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 2. Tính công suất khai thác (m3/ngày, m3/tháng) dựa trên totalIndex (Chỉ số đồng hồ lũy tiến)
 * API Endpoint: GET /api/kpi/volume-consumption
 */
exports.getVolumeConsumptionByGroup = async (req, res) => {
  const { station_ids, tag_key } = req.query;
  const stations = parseStationIds(station_ids);
  const indexTag = tag_key || 'totalIndex'; // Mặc định tag chỉ số tổng là 'totalIndex'

  if (stations.length === 0) {
    return res.status(400).json({ success: false, error: 'Thiếu danh sách station_ids' });
  }

  try {
    /**
     * Thuật toán SQL: 
     * - Tìm chỉ số LỚN NHẤT và NHỎ NHẤT trong Ngày hôm nay (DATE(data_ts) = CURRENT_DATE)
     * - Tìm chỉ số LỚN NHẤT và NHỎ NHẤT trong Tháng này (data_ts thuộc tháng hiện tại)
     * - Lượng tiêu thụ = MAX - MIN
     */
    const consumptionQuery = `
      WITH daily_usage AS (
        SELECT 
          logger_id,
          MAX(value::numeric) - MIN(value::numeric) AS day_volume
        FROM logger_readings
        WHERE logger_id = ANY($1) 
          AND tag_key = $2
          AND data_ts >= CURRENT_DATE
        GROUP BY logger_id
      ),
      monthly_usage AS (
        SELECT 
          logger_id,
          MAX(value::numeric) - MIN(value::numeric) AS month_volume
        FROM logger_readings
        WHERE logger_id = ANY($1) 
          AND tag_key = $2
          AND data_ts >= DATE_TRUNC('month', CURRENT_DATE)
        GROUP BY logger_id
      )
      SELECT 
        COALESCE(SUM(d.day_volume), 0) AS total_cubic_meters_day,
        COALESCE(SUM(m.month_volume), 0) AS total_cubic_meters_month
      FROM (SELECT unnest($1::text[]) AS logger_id) s
      LEFT JOIN daily_usage d ON s.logger_id = d.logger_id
      LEFT JOIN monthly_usage m ON s.logger_id = m.logger_id
    `;

    const { rows } = await db.query(consumptionQuery, [stations, indexTag]);
    
    return res.status(200).json({
      success: true,
      group_stations: stations,
      tag_key: indexTag,
      metrics: {
        daily: {
          value: ROUND(parseFloat(rows[0].total_cubic_meters_day), 2),
          unit: "m3/ngày"
        },
        monthly: {
          value: ROUND(parseFloat(rows[0].total_cubic_meters_month), 2),
          unit: "m3/tháng"
        }
      }
    });
  } catch (error) {
    console.error("❌ [KPI][VOLUME_CONSUMPTION_ERROR]", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Helper làm tròn số cho gọn đẹp kết quả trả về
function ROUND(num, decimalPlaces) {
  return Number(Math.round(num + "e" + decimalPlaces) + "e-" + decimalPlaces);
}