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
 * Helper lấy khoảng thời gian bắt đầu và kết thúc theo ngày/giờ được chọn.
 */
const getDateRange = (selectedDate) => {
  const dateStr = selectedDate || new Date().toISOString().slice(0, 10);
  return {
    start: `${dateStr} 00:00:00`,
    end: `${dateStr} 23:59:59`
  };
};

const toTimestampString = (value, isEnd = false) => {
  if (!value) return null;

  const normalized = String(value).trim().replace('T', ' ');
  if (normalized.length === 10) {
    return `${normalized} ${isEnd ? '23:59:59' : '00:00:00'}`;
  }

  if (normalized.length === 16) {
    return `${normalized}:00`;
  }

  return normalized.slice(0, 19);
};

const getRangeFromQuery = (query) => {
  const startTime = toTimestampString(query.start_time, false);
  const endTime = toTimestampString(query.end_time, true);

  if (startTime && endTime) {
    if (startTime > endTime) {
      return { start: endTime, end: startTime };
    }

    return { start: startTime, end: endTime };
  }

  return getDateRange(query.selected_date);
};

/**
 * 1. Lấy tổng flow tức thời hiện tại và dữ liệu lịch sử chart (Gộp theo Nhóm Trạm)
 * API Endpoint: GET /api/kpi/flow-summary
 */
exports.getFlowSummaryByGroup = async (req, res) => {
  const { station_ids, tag_key, interval_mins } = req.query;
  const stations = parseStationIds(station_ids);
  const flowTag = tag_key || 'flow';

  if (stations.length === 0) {
    return res.status(400).json({ success: false, error: 'Thiếu danh sách station_ids' });
  }

  const interval = parseInt(interval_mins, 10) || 30;
  const range = getRangeFromQuery(req.query);

  try {
    // 1.1 Tính tổng flow tức thời hiện tại (Latest) của nhóm trạm
    const latestQuery = `
      SELECT COALESCE(SUM(value::numeric), 0) AS total_instant_flow
      FROM logger_latest
      WHERE logger_id = ANY($1::text[]) AND tag_key = $2
    `;
    const latestRes = await db.query(latestQuery, [stations, flowTag]);
    const totalInstantFlow = parseFloat(latestRes.rows[0].total_instant_flow);

    // 1.2 Truy vấn biểu đồ lịch sử lưu lượng tức thời theo ngày chọn
    const chartQuery = `
      WITH station_time_slots AS (
        SELECT 
          logger_id,
          to_timestamp(floor(extract(epoch from data_ts) / ($1 * 60)) * ($1 * 60)) AS group_ts,
          AVG(value::numeric) AS avg_station_value
        FROM logger_readings 
        WHERE logger_id = ANY($2) 
          AND tag_key = $3 
          AND data_ts >= $4::timestamp 
          AND data_ts <= $5::timestamp 
        GROUP BY logger_id, group_ts
      )
      SELECT 
        group_ts,
        ROUND(SUM(avg_station_value), 2) AS total_group_flow
      FROM station_time_slots
      GROUP BY group_ts
      ORDER BY group_ts ASC
    `;
    const chartRes = await db.query(chartQuery, [interval, stations, flowTag, range.start, range.end]);

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
  const { station_ids, tag_key, interval_mins } = req.query;
  const stations = parseStationIds(station_ids);
  const indexTag = tag_key || 'totalIndex'; 

  if (stations.length === 0) {
    return res.status(400).json({ success: false, error: 'Thiếu danh sách station_ids' });
  }

  const interval = parseInt(interval_mins, 10) || 30;
  const range = getRangeFromQuery(req.query);

  try {
    // 2.1 Tính tổng sản lượng tiêu thụ trong khoảng chọn và tháng tương ứng của mốc đầu khoảng chọn
    const consumptionQuery = `
      WITH selected_usage AS (
        SELECT 
          logger_id,
          COALESCE(MAX(value::numeric) - MIN(value::numeric), 0) AS day_volume
        FROM logger_readings
        WHERE logger_id = ANY($1::text[]) 
          AND tag_key = $2
          AND data_ts >= $3::timestamp AND data_ts <= $4::timestamp
        GROUP BY logger_id
      ),
      monthly_usage AS (
        SELECT 
          logger_id,
          COALESCE(MAX(value::numeric) - MIN(value::numeric), 0) AS month_volume
        FROM logger_readings
        WHERE logger_id = ANY($1::text[]) 
          AND tag_key = $2
          AND data_ts >= DATE_TRUNC('month', $3::timestamp) AND data_ts <= $4::timestamp
        GROUP BY logger_id
      )
      SELECT 
        COALESCE(SUM(su.day_volume), 0) AS total_cubic_meters_selected,
        COALESCE(SUM(m.month_volume), 0) AS total_cubic_meters_month
      FROM (SELECT unnest($1::text[]) AS logger_id) s
      LEFT JOIN selected_usage su ON s.logger_id = su.logger_id
      LEFT JOIN monthly_usage m ON s.logger_id = m.logger_id
    `;
    const consumptionRes = await db.query(consumptionQuery, [stations, indexTag, range.start, range.end]);

    // 2.2 Tổng hợp sản lượng theo từng ngày trong khoảng chọn[cite: 1]
    const chartQuery = `
      WITH ordered_readings AS (
        SELECT 
          logger_id,
          date_trunc('day', data_ts) AS group_ts,
          value::numeric AS val,
          ROW_NUMBER() OVER (PARTITION BY logger_id, date_trunc('day', data_ts) ORDER BY data_ts ASC) as first_row,
          ROW_NUMBER() OVER (PARTITION BY logger_id, date_trunc('day', data_ts) ORDER BY data_ts DESC) as last_row
        FROM logger_readings
        WHERE logger_id = ANY($1::text[])
          AND tag_key = $2
          AND data_ts >= $3::timestamp AND data_ts <= $4::timestamp
      ),
      slot_volumes AS (
        SELECT 
          group_ts,
          logger_id,
          MAX(CASE WHEN last_row = 1 THEN val END) - MIN(CASE WHEN first_row = 1 THEN val END) AS volume
        FROM ordered_readings
        GROUP BY group_ts, logger_id
      )
      SELECT 
        group_ts,
        ROUND(COALESCE(SUM(volume), 0), 2) AS total_group_volume
      FROM slot_volumes
      GROUP BY group_ts
      ORDER BY group_ts ASC
    `;
    const chartRes = await db.query(chartQuery, [stations, indexTag, range.start, range.end]);
    const selectedTotal = localRound(parseFloat(consumptionRes.rows[0].total_cubic_meters_selected || 0), 2);
    
    return res.status(200).json({
      success: true,
      group_stations: stations,
      tag_key: indexTag,
      metrics: {
        selected: {
          value: selectedTotal,
          unit: "m3"
        },
        daily: {
          value: selectedTotal,
          unit: "m3/ngày"
        },
        monthly: {
          value: localRound(parseFloat(consumptionRes.rows[0].total_cubic_meters_month || 0), 2),
          unit: "m3/tháng"
        }
      },
      chart_data: chartRes.rows.map(r => ({
        timestamp: r.group_ts,
        value: parseFloat(r.total_group_volume)
      }))
    });
  } catch (error) {
    console.error("❌ [KPI][VOLUME_CONSUMPTION_ERROR]", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};

function localRound(num, decimalPlaces) {
  return Number(Math.round(num + "e" + decimalPlaces) + "e-" + decimalPlaces);
}