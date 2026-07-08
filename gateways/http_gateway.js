// gateways/http_gateway.js
"use strict";
const db = require("../config/db");

function formatTimestampToICT(rawTs) {
  if (!rawTs) return null;
  const cleaned = String(rawTs).trim().replace("T", " ");
  return cleaned.includes("+") ? cleaned : `${cleaned}+07`;
}

exports.handleHttpPush = async (req, res) => {
  const { station_id, display_name, timestamp, metrics } = req.body;

  if (!station_id || !timestamp || !metrics || typeof metrics !== 'object') {
    return res.status(400).json({ success: false, error: "Sai cấu trúc payload." });
  }

  const cleanStationId = String(station_id).trim().toLowerCase();
  const formattedTs = formatTimestampToICT(timestamp);
  const currentSaveTs = new Date().toISOString();

  let dbClient;
  try {
    dbClient = await db.connect();

    // 1. Tự động khởi tạo danh mục trạm mới nếu chưa có
    const finalDisplayName = display_name ? String(display_name).trim() : `Trạm ${cleanStationId.toUpperCase()}`;
    await dbClient.query(`
      INSERT INTO public.logger_stations (station_id, display_name, description) 
      VALUES ($1, $2, $3) 
      ON CONFLICT (station_id) DO UPDATE SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), public.logger_stations.display_name);
    `, [cleanStationId, finalDisplayName, 'Tự động tạo lập từ Cổng HTTP Gateway']);

    // 2. Lưu các chỉ số đo
    const upsertLatestQuery = `
      INSERT INTO public.logger_latest (logger_id, tag_key, data_ts, value, current_ts) 
      VALUES ($1, $2, $3::timestamptz, $4, $5::timestamptz) 
      ON CONFLICT (logger_id, tag_key) DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, current_ts = EXCLUDED.current_ts;
    `;
    const insertReadingsQuery = `
      INSERT INTO public.logger_readings (logger_id, tag_key, data_ts, data_save, value) 
      VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5) ON CONFLICT DO NOTHING;
    `;

    let processedCount = 0;
    for (const [tagKey, rawValue] of Object.entries(metrics)) {
      if (rawValue === null || rawValue === undefined || isNaN(Number(rawValue))) continue;
      const cleanValue = parseFloat(rawValue);
      const cleanTagKey = tagKey.trim().toLowerCase();

      await dbClient.query(upsertLatestQuery, [cleanStationId, cleanTagKey, formattedTs, cleanValue, currentSaveTs]);
      await dbClient.query(insertReadingsQuery, [cleanStationId, cleanTagKey, formattedTs, currentSaveTs, cleanValue]);
      processedCount++;
    }

    return res.status(200).json({
      success: true,
      message: `[HTTP_GATEWAY] Đồng bộ trạm '${cleanStationId}' thành công!`,
      metrics_processed: processedCount
    });
  } catch (error) {
    console.error("❌ [HTTP_GATEWAY][ERROR]", error.message);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    if (dbClient) dbClient.release();
  }
};