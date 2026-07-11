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
          (
            date_trunc('hour', data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh')
            + (floor(extract(minute from (data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh')) / $1) * $1 || ' minutes')::interval
          ) AS group_ts,
          AVG(value::numeric) AS avg_station_value
        FROM logger_readings 
        WHERE logger_id = ANY($2) 
          AND tag_key = $3 
          AND (data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh') >= $4::timestamp 
          AND (data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh') <= $5::timestamp 
        GROUP BY logger_id, group_ts
      )
      SELECT 
        to_char(group_ts, 'YYYY-MM-DD HH24:MI:SS') AS group_ts,
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
        timestamp: typeof r.group_ts === 'string' ? r.group_ts : new Date(r.group_ts).toISOString().slice(0, 19).replace('T', ' '),
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
          date_trunc('day', data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh') AS group_ts,
          value::numeric AS val,
          ROW_NUMBER() OVER (PARTITION BY logger_id, date_trunc('day', data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh') ORDER BY data_ts ASC) as first_row,
          ROW_NUMBER() OVER (PARTITION BY logger_id, date_trunc('day', data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh') ORDER BY data_ts DESC) as last_row
        FROM logger_readings
        WHERE logger_id = ANY($1::text[])
          AND tag_key = $2
          AND (data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh') >= $3::timestamp AND (data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh') <= $4::timestamp
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
        to_char(group_ts, 'YYYY-MM-DD HH24:MI:SS') AS group_ts,
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
        timestamp: typeof r.group_ts === 'string' ? r.group_ts : new Date(r.group_ts).toISOString().slice(0, 19).replace('T', ' '),
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

/**
 * 3. Báo cáo chỉ số totalIndex có bộ lọc Ngày/Tháng, lọc nhiễu mạng và chống reset đồng hồ
 * API Endpoint: GET /api/kpi/station-index-report
 */
exports.getStationIndexReport = async (req, res) => {
  const { tag_key, report_type, date, month } = req.query;
  const indexTag = tag_key || 'totalIndex'; // Mặc định tag chỉ số tổng là 'totalIndex'
  const type = report_type || 'day';        // Mặc định lọc theo ngày nếu không truyền

  try {
    // Lấy thời gian hiện tại theo GMT+7 để làm giá trị mặc định nếu FE không truyền
    const now = new Date();
    const tzOffset = 7 * 60 * 60 * 1000; // Múi giờ GMT+7
    const localNow = new Date(now.getTime() + tzOffset);
    const todayStr = localNow.toISOString().split('T')[0]; // Định dạng YYYY-MM-DD
    const thisMonthStr = todayStr.substring(0, 7);          // Định dạng YYYY-MM

    let timeFilterSQL = '';
    const queryParams = [indexTag];

    // Xử lý logic lọc động theo Ngày hoặc Tháng
    if (type === 'month') {
      const selectedMonth = month || thisMonthStr;
      timeFilterSQL = `to_char(data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM') = $2`;
      queryParams.push(selectedMonth);
    } else {
      const selectedDate = date || todayStr;
      timeFilterSQL = `(data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $2::date`;
      queryParams.push(selectedDate);
    }

    /**
     * THUẬT TOÁN BẢO VỆ DỮ LIỆU LOG TIÊU THỤ:
     * - CASE 1: val >= prev_val -> Đồng hồ tăng tuyến tính bình thường -> lấy hiệu số.
     * - CASE 2: val < prev_val VÀ val < 100 -> Đồng hồ thực sự bị reset về 0 hoặc thay mới -> lấy val.
     * - CASE 3: val < prev_val nhưng val lớn -> Nhiễu tín hiệu mạng (tụt nhẹ rồi tăng lại) -> gán bằng 0.
     */
    const reportQuery = `
      WITH ordered_readings AS (
        SELECT 
          id,
          logger_id,
          value::numeric AS val,
          data_ts AT TIME ZONE 'Asia/Ho_Chi_Minh' AS local_ts,
          LAG(value::numeric) OVER (PARTITION BY logger_id ORDER BY data_ts ASC, id ASC) AS prev_val,
          ROW_NUMBER() OVER (PARTITION BY logger_id ORDER BY data_ts ASC, id ASC) as row_first,
          ROW_NUMBER() OVER (PARTITION BY logger_id ORDER BY data_ts DESC, id DESC) as row_last
        FROM logger_readings
        WHERE tag_key = $1
          AND logger_id NOT LIKE 'monre_%'
          AND ${timeFilterSQL}
      ),
      step_deltas AS (
        SELECT 
          logger_id,
          val,
          local_ts,
          row_first,
          row_last,
          CASE 
            WHEN prev_val IS NULL THEN 0
            WHEN val >= prev_val THEN val - prev_val
            WHEN val < prev_val AND val < 100 THEN val 
            ELSE 0 
          END AS step_delta
        FROM ordered_readings
      ),
      station_summaries AS (
        SELECT 
          logger_id,
          SUM(step_delta) AS total_station_delta,
          MAX(CASE WHEN row_first = 1 THEN val END) AS start_index,
          MAX(CASE WHEN row_first = 1 THEN to_char(local_ts, 'YYYY-MM-DD HH24:MI:SS') END) AS start_time,
          MAX(CASE WHEN row_last = 1 THEN val END) AS end_index,
          MAX(CASE WHEN row_last = 1 THEN to_char(local_ts, 'YYYY-MM-DD HH24:MI:SS') END) AS end_time
        FROM step_deltas
        GROUP BY logger_id
      ),
      distinct_stations AS (
        SELECT DISTINCT
          lr.logger_id,
          COALESCE(ls.display_name, lr.logger_id) AS display_name
        FROM logger_readings lr
        LEFT JOIN logger_stations ls ON ls.station_id = lr.logger_id
        WHERE lr.tag_key = $1 
          AND lr.logger_id NOT LIKE 'monre_%'
      )
      SELECT 
        s.logger_id AS station_id,
        s.display_name AS station_name,
        ROUND(COALESCE(st.start_index, 0), 2)::float AS start_index,
        st.start_time,
        ROUND(COALESCE(st.end_index, 0), 2)::float AS end_index,
        st.end_time,
        ROUND(COALESCE(st.total_station_delta, 0), 2)::float AS delta_index
      FROM distinct_stations s
      LEFT JOIN station_summaries st ON s.logger_id = st.logger_id
      ORDER BY s.display_name ASC
    `;

    const { rows } = await db.query(reportQuery, queryParams);

    let totalDeltaVolume = 0;

    // Duyệt mảng cấu trúc lại dữ liệu và cộng dồn tổng sản lượng hệ thống
    const reportData = rows.map((row, index) => {
      totalDeltaVolume += (row.delta_index || 0);
      
      return {
        stt: index + 1,
        station_id: row.station_id,
        station_name: row.station_name,
        start_index: row.start_index,
        start_time: row.start_time || "Không có dữ liệu", 
        end_index: row.end_index,
        end_time: row.end_time || "Không có dữ liệu",
        delta_index: row.delta_index
      };
    });
    
    // Trả JSON về kết hợp hàm toFixed native bảo vệ lỗi "ROUND is not defined"
    return res.status(200).json({
      success: true,
      tag_key: indexTag,
      filter_type: type,
      filtered_value: queryParams[1],
      total_stations: reportData.length,
      total_delta_volume: parseFloat(totalDeltaVolume.toFixed(2)), 
      data: reportData
    });
  } catch (error) {
    console.error("❌ [KPI][STATION_INDEX_REPORT_FILTER_ERROR]", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};