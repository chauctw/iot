// controllers/station.controller.js
"use strict";

const db = require('../config/db');

/**
 * 1. Cấu hình ánh xạ tag, thông tin trạm và ngưỡng cảnh báo
 * API Endpoint: POST /api/stations/mapping
 */
const saveTagMappings = async (req, res) => {
  // 🟢 CẬP NHẬT: Lấy thêm trường offline_timeout_secs và repeat_alert_interval_mins gửi từ UI về
  const { 
    source, 
    source_logger_id, 
    source_tags, 
    target_station_id, 
    display_name, 
    lat, 
    lng, 
    alert_thresholds,
    offline_timeout_secs,
    repeat_alert_interval_mins // <-- Nhận thêm trường chu kỳ lặp lại
  } = req.body;
  
  if (!target_station_id) {
    return res.status(400).json({ success: false, error: 'Thiếu target_station_id' });
  }

  try {
    // Lấy thêm cột repeat_alert_interval_mins cũ trong DB để làm dữ liệu backup
    const nameQuery = await db.query(
      `SELECT display_name, offline_timeout_secs, repeat_alert_interval_mins 
       FROM logger_stations WHERE station_id = $1`, 
      [target_station_id]
    );
    
    // Xử lý lấy tên cũ hoặc tên mặc định
    const oldName = nameQuery.rows.length > 0 ? nameQuery.rows[0].display_name : `Trạm ${target_station_id}`;
    const finalDisplayName = display_name && String(display_name).trim() !== '' ? String(display_name).trim() : oldName;

    // Xử lý ép kiểu tọa độ độ vĩ/kinh
    const finalLat = (lat !== null && lat !== undefined && String(lat).trim() !== '') ? parseFloat(lat) : null;
    const finalLng = (lng !== null && lng !== undefined && String(lng).trim() !== '') ? parseFloat(lng) : null;

    // Xử lý ép kiểu số nguyên cho Timeout. Nếu trống hoặc không phải số, lấy cấu hình cũ trong DB hoặc mặc định 300 giây.
    const oldTimeout = nameQuery.rows.length > 0 ? nameQuery.rows[0].offline_timeout_secs : 300;
    let finalTimeout = offline_timeout_secs !== null && offline_timeout_secs !== undefined && String(offline_timeout_secs).trim() !== '' 
      ? parseInt(offline_timeout_secs, 10) 
      : oldTimeout;
    if (isNaN(finalTimeout)) finalTimeout = 300;

    // 🟢 THÊM MỚI: Xử lý ép kiểu cho chu kỳ lặp lại cảnh báo (Phút). Mặc định 30 phút nếu lỗi/trống.
    const oldRepeatInterval = nameQuery.rows.length > 0 ? nameQuery.rows[0].repeat_alert_interval_mins : 30;
    let finalRepeatInterval = repeat_alert_interval_mins !== null && repeat_alert_interval_mins !== undefined && String(repeat_alert_interval_mins).trim() !== ''
      ? parseInt(repeat_alert_interval_mins, 10)
      : oldRepeatInterval;
    if (isNaN(finalRepeatInterval)) finalRepeatInterval = 30;

    // 🟢 CẬP NHẬT: Thêm trường repeat_alert_interval_mins vào câu lệnh INSERT và mệnh đề DO UPDATE
    await db.query(`
      INSERT INTO logger_stations (station_id, display_name, lat, lng, description, offline_timeout_secs, repeat_alert_interval_mins)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (station_id) DO UPDATE 
      SET display_name = EXCLUDED.display_name, 
          lat = EXCLUDED.lat, 
          lng = EXCLUDED.lng,
          offline_timeout_secs = EXCLUDED.offline_timeout_secs,
          repeat_alert_interval_mins = EXCLUDED.repeat_alert_interval_mins
    `, [
      target_station_id, 
      finalDisplayName, 
      isNaN(finalLat) ? null : finalLat, 
      isNaN(finalLng) ? null : finalLng, 
      'Cập nhật từ ma trận bảng',
      finalTimeout,
      finalRepeatInterval // <-- Giá trị truyền cho tham số $7
    ]);

    // Xử lý bảng ma trận logger_tag_mappings (Giữ nguyên luồng gốc của bạn)
    if (source_logger_id && source_logger_id !== target_station_id) {
      await db.query(`DELETE FROM logger_tag_mappings WHERE source_logger_id = $1 AND target_station_id = $2`, [source_logger_id, target_station_id]);
      if (source_tags && Array.isArray(source_tags) && source_tags.length > 0) {
        const insertQuery = `INSERT INTO logger_tag_mappings (source, source_logger_id, source_tag_key, target_station_id) VALUES ($1, $2, $3, $4)`;
        for (const tag of source_tags) {
          if (tag) await db.query(insertQuery, [source || 'WEB_MATRIX_CONFIG', source_logger_id, tag, target_station_id]);
        }
      }
    } else {
      await db.query(`DELETE FROM logger_tag_mappings WHERE target_station_id = $1`, [target_station_id]);
    }

    // Xử lý bảng ngưỡng cảnh báo alert_thresholds (Giữ nguyên luồng gốc của bạn)
    if (alert_thresholds && Array.isArray(alert_thresholds)) {
      for (const th of alert_thresholds) {
        if (!th.tag_key) continue;
        await db.query(`DELETE FROM alert_thresholds WHERE station_id = $1 AND tag_key = $2`, [target_station_id, th.tag_key]);
        
        const isEnabled = (th.enabled === true || th.enabled === 1 || th.enabled === 'true');
        const pMin = parseFloat(th.min_value);
        const pMax = parseFloat(th.max_value);
        
        const finalMin = (th.min_value !== null && String(th.min_value).trim() !== '' && !isNaN(pMin)) ? pMin : null;
        const finalMax = (th.max_value !== null && String(th.max_value).trim() !== '' && !isNaN(pMax)) ? pMax : null;

        await db.query(`
          INSERT INTO alert_thresholds (station_id, tag_key, min_value, max_value, enabled, last_alerted_ts)
          VALUES ($1, $2, $3, $4, $5, null)
        `, [target_station_id, th.tag_key, finalMin, finalMax, isEnabled ? 1 : 0]);
      }
    }

    return res.status(200).json({ success: true, message: 'Đồng bộ dữ liệu thành công!' });
  } catch (error) {
    console.error("❌ [API][SAVE_MAPPINGS_ERROR]", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 2. Tiếp nhận dữ liệu thô đẩy về từ thiết bị mã hóa JSON
 * API Endpoint: POST /api/stations/ingest
 */
const ingestLoggerData = async (req, res) => {
  const { logger_id, data_ts, tags } = req.body;
  if (!logger_id || !tags || !Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ.' });
  }

  const finalDataTs = data_ts ? new Date(data_ts) : new Date();
  const currentTs = new Date();
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    const upsertLatest = `
      INSERT INTO logger_latest (logger_id, tag_key, value, data_ts, current_ts) 
      VALUES ($1, $2, $3, $4, $5) 
      ON CONFLICT (logger_id, tag_key) DO UPDATE SET value = EXCLUDED.value, data_ts = EXCLUDED.data_ts, current_ts = EXCLUDED.current_ts;
    `;
    
    // 🟢 TỐI ƯU: Ép kiểu dữ liệu tường minh để tránh lỗi inconsistent types khi Postgres bóc tách tham số
    const insertReadings = `
      INSERT INTO logger_readings (logger_id, tag_key, data_ts, data_save, value) 
      VALUES ($1::text, $2::text, $3::timestamptz, $4::timestamptz, $5);
    `;

    for (const tag of tags) {
      if (!tag.tag_key || tag.value === undefined || tag.value === null) continue;
      const val = parseFloat(tag.value);
      if (isNaN(val)) continue;
      await client.query(upsertLatest, [logger_id, tag.tag_key, val, finalDataTs, currentTs]);
      await client.query(insertReadings, [logger_id, tag.tag_key, finalDataTs, currentTs, val]);
    }
    await client.query(`
      INSERT INTO logger_stations (station_id, display_name, description) 
      VALUES ($1, $2, $3) ON CONFLICT (station_id) DO NOTHING;
    `, [logger_id, `Trạm ${logger_id}`, 'Khởi tạo tự động']);
    
    await client.query('COMMIT');
    return res.status(200).json({ success: true, message: 'Ghi log IoT thành công.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ [API][INGEST_DATA_ERROR]", error.message);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
};

/**
 * 3. Xóa trạm và toàn bộ dữ liệu liên quan (Tức thời + Lịch sử)
 * API Endpoint: DELETE /api/stations/:station_id
 */
const deleteStation = async (req, res) => {
  const { station_id } = req.params;

  if (!station_id) {
    return res.status(400).json({ success: false, message: "Thiếu tham số station_id!" });
  }

  const cleanStationId = String(station_id).trim().toLowerCase();
  let dbClient;

  try {
    dbClient = await db.connect();
    await dbClient.query("BEGIN");

    // Khử cấu trúc khóa ngoại: Xóa bảng phụ trước khi xóa danh mục gốc
    await dbClient.query(
      "DELETE FROM public.logger_readings WHERE logger_id = $1::text", 
      [cleanStationId]
    );

    await dbClient.query(
      "DELETE FROM public.logger_latest WHERE logger_id = $1", 
      [cleanStationId]
    );

    await dbClient.query(
      "DELETE FROM public.alert_thresholds WHERE station_id = $1", 
      [cleanStationId]
    );

    await dbClient.query(
      "DELETE FROM public.logger_tag_mappings WHERE target_station_id = $1", 
      [cleanStationId]
    );

    const deleteStationResult = await dbClient.query(
      "DELETE FROM public.logger_stations WHERE station_id = $1 RETURNING *", 
      [cleanStationId]
    );

    if (deleteStationResult.rowCount === 0) {
      await dbClient.query("ROLLBACK");
      return res.status(404).json({ 
        success: false, 
        message: `Không tìm thấy trạm '${cleanStationId}' trên hệ thống!` 
      });
    }

    await dbClient.query("COMMIT");
    console.log(`🗑️ [API] Đã xóa hoàn toàn trạm '${cleanStationId}' khỏi cơ sở dữ liệu.`);

    return res.status(200).json({
      success: true,
      message: `Đã xóa hoàn toàn trạm '${cleanStationId}' và toàn bộ cấu hình liên quan thành công!`
    });

  } catch (error) {
    if (dbClient) await dbClient.query("ROLLBACK");
    console.error("❌ [API][DELETE_STATION_ERROR]", error.message);
    return res.status(500).json({ 
      success: false, 
      message: "Lỗi hệ thống khi xóa trạm!", 
      error: error.message 
    });
  } finally {
    if (dbClient) dbClient.release();
  }
};

// Đóng gói xuất bản tất cả các hàm controller ra ngoài hệ thống
module.exports = {
  saveTagMappings,
  ingestLoggerData,
  deleteStation
};