// fetchmqtt.js
"use strict";
const mqtt = require("mqtt");
const db = require("../config/db"); 

const DEFAULT_CONFIG = {
  host: process.env.MQTT_HOST,
  port: process.env.MQTT_PORT,
  topic: process.env.MQTT_TOPIC,
  source: process.env.MQTT_SOURCE || "mqtt",
  tzOffsetMinutes: 0,
  SAVE_DB_INTERVAL_SECONDS: Number(process.env.MQTT_SAVE_DB_INTERVAL_SECONDS) || 300
};

const TAG_PARAMETER_MAP = { MUCNUOC: "level", LUULUONG: "flow", TONGLUULUONG: "totalIndex" };
let messageQueue = [];
let mqttHistoryQueue = []; // RAM Queue để gom lưu lịch sử readings tách biệt

function buildStationId(source, rawId) { return `${source}_${String(rawId).toLowerCase()}`; }
function normalizeMetricValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  return Number.isNaN(Number(String(value).replace(/,/g, "").trim())) ? null : Number(String(value).replace(/,/g, "").trim());
}

function formatTimestampWithOffsetRounded(ts, offsetMinutes) {
  if (!ts) return null;
  const parsed = new Date(String(ts).trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(parsed.getTime())) return null;
  const adjusted = new Date(parsed.getTime() + (Number(offsetMinutes) || 0) * 60 * 1000);
  const pad = (v) => String(v).padStart(2, "0");
  return `${adjusted.getFullYear()}-${pad(adjusted.getMonth() + 1)}-${pad(adjusted.getDate())} ${pad(adjusted.getHours())}:${pad(adjusted.getMinutes())}:00+07`;
}

function getCurrentSystemTimeRounded() {
  const now = new Date(); const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00+07`;
}

function parsePayloadTextSecure(text) {
  try {
    if (!text || typeof text !== "string") return null;
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    let cleanedMessage = trimmed
      .replace(/:\s*-?nan\b/gi, ':0').replace(/:\s*-?inf\b/gi, ':0')          
      .replace(/:\s*-\s*([,}\]])/g, ':0$1').replace(/:\s*-\s*$/g, ':0')             
      .replace(/:\s*\.\s*([,}\]])/g, ':0$1').replace(/:\s*-\.\s*([,}\]])/g, ':0$1'); 
    return JSON.parse(cleanedMessage);
  } catch (_) { return null; }
}

// 🌐 TIẾN TRÌNH 1: NHẬN TIN MQTT ĐẾN ĐÂU UPSERT BẢNG LATEST NGAY LẬP TỨC (REALTIME)
setInterval(async () => {
  if (messageQueue.length === 0) return;
  const processingBatch = [...messageQueue]; messageQueue = []; 

  let dbClient;
  try {
    dbClient = await db.connect();
    const currentFetchTs = getCurrentSystemTimeRounded(); 
    const mappingRes = await dbClient.query(`SELECT source_logger_id, source_tag_key, target_station_id FROM logger_tag_mappings`);
    const activeMappings = mappingRes.rows;

    const upsertLatestQuery = `
      INSERT INTO logger_latest (logger_id, tag_key, data_ts, value, current_ts) 
      VALUES ($1, $2, $3::timestamptz, $4, $5::timestamptz) 
      ON CONFLICT (logger_id, tag_key) 
      DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, current_ts = EXCLUDED.current_ts;
    `;

    for (const payload of processingBatch) {
      if (!payload || !Array.isArray(payload.d)) continue;
      const formattedDataTs = formatTimestampWithOffsetRounded(payload.ts, DEFAULT_CONFIG.tzOffsetMinutes) || payload.ts;

      for (const item of payload.d) {
        let value = item.value;
        if (!item || !item.tag || value === undefined || value === null) continue;

        if (typeof value === 'string') {
          if (value.trim() === '' || value.trim() === '-' || value.trim() === '.') value = 0;
          else { const parsed = parseFloat(value); if (!isNaN(parsed) && isFinite(parsed)) value = parsed; }
        }
        const parsedValue = normalizeMetricValue(value);
        if (parsedValue === null) continue;

        const parts = String(item.tag).trim().split('_'); if (parts.length < 2) continue;
        let deviceCode = parts[0]; let parameterTypeRaw = parts.slice(1).join('_');
        if (parts.length > 2 && (parts[0] === 'GS1' || parts[0] === 'GS2' || parts[0] === 'QT1' || parts[0] === 'QT2')) {
          deviceCode = parts[0] + '_' + parts[1]; parameterTypeRaw = parts.slice(2).join('_');
        }

        const parameter = TAG_PARAMETER_MAP[parameterTypeRaw.toUpperCase()]; if (!parameter) continue;
        const rawId = deviceCode.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
        const stationId = buildStationId(DEFAULT_CONFIG.source, rawId);

        // A. Cập nhật latest trạm gốc
        await dbClient.query(upsertLatestQuery, [stationId, parameter, formattedDataTs, parsedValue, currentFetchTs]);
        await dbClient.query(`INSERT INTO public.logger_stations (station_id, display_name, description) VALUES ($1, $2, $3) ON CONFLICT (station_id) DO NOTHING;`, [stationId, `Trạm ${stationId}`, 'Tự động từ MQTT']);

        // Đẩy vào RAM để chờ chu kỳ ghi lịch sử
        mqttHistoryQueue.push({ logger_id: stationId, tag_key: parameter, data_ts: formattedDataTs });

        // B. Cập nhật ma trận chuyển tiếp
        const relatedMaps = activeMappings.filter(m => m.source_logger_id === stationId && m.source_tag_key === parameter);
        for (const mapItem of relatedMaps) {
          await dbClient.query(upsertLatestQuery, [mapItem.target_station_id, parameter, formattedDataTs, parsedValue, currentFetchTs]);
          await dbClient.query(`INSERT INTO public.logger_stations (station_id, display_name, description) VALUES ($1, $2, $3) ON CONFLICT (station_id) DO NOTHING;`, [mapItem.target_station_id, `Trạm ${mapItem.target_station_id}`, 'Tự động qua ma trận MQTT']);
          
          mqttHistoryQueue.push({ logger_id: mapItem.target_station_id, tag_key: parameter, data_ts: formattedDataTs });
        }
      }
    }
  } catch (error) {
    console.error("❌ [MQTT][PROCESS_ERROR] Thất bại xử lý gói tin:", error.message); 
  } finally { 
    if (dbClient) dbClient.release(); 
  }
}, 2000); // Quét mảng xử lý gói tin nhanh mỗi 2 giây

// 💾 CHU KỲ 2: LƯU LỊCH SỬ LOGGER_READINGS ĐỊNH KỲ THEO PHÚT TỪ ENV
async function flushMqttHistory() {
  if (mqttHistoryQueue.length === 0) return;
  const startLogTime = Date.now();
  const cachedItems = [...mqttHistoryQueue]; mqttHistoryQueue = [];
  const currentSaveTs = getCurrentSystemTimeRounded();

  console.log(`\n💾 [MQTT][READINGS] Đến chu kỳ lưu DB (${DEFAULT_CONFIG.SAVE_DB_INTERVAL_SECONDS}s) -> Xả ${cachedItems.length} bản ghi lịch sử MQTT...`);
  let dbClient;
  try {
    dbClient = await db.connect();
    await dbClient.query("BEGIN");
    const insertReadingsQuery = `
    INSERT INTO logger_readings (logger_id, tag_key, data_ts, data_save, value) 
    VALUES (
      $1::text, 
      $2::text, 
      $3::timestamptz, 
      $4::timestamptz, 
      (SELECT value FROM logger_latest WHERE logger_id = $1::text AND tag_key = $2::text LIMIT 1)
    )
    ON CONFLICT DO NOTHING;
  `;
    for (const item of cachedItems) {
      await dbClient.query(insertReadingsQuery, [item.logger_id, item.tag_key, item.data_ts, currentSaveTs]);
    }
    await dbClient.query("COMMIT");
    console.log(`✅ [MQTT][READINGS_SUCCESS] Đã lưu xong +${cachedItems.length} dòng lịch sử MQTT. Thống kê: ${Date.now() - startLogTime}ms`);
  } catch (error) {
    if (dbClient) await dbClient.query("ROLLBACK");
    console.error("❌ [MQTT][READINGS_CRASH] Thất bại khi xả hàng đợi lịch sử:", error.message);
  } finally {
    if (dbClient) dbClient.release();
  }
}

setInterval(async () => { await flushMqttHistory(); }, DEFAULT_CONFIG.SAVE_DB_INTERVAL_SECONDS * 1000);

function connectMQTT() {
  const client = mqtt.connect(`mqtt://${DEFAULT_CONFIG.host}:${DEFAULT_CONFIG.port}`, { clean: true, connectTimeout: 10000, reconnectPeriod: 3000 });
  client.on("connect", () => { 
    console.log(`🟢 [MQTT][CONNECT] Kết nối thành công tới Broker [${DEFAULT_CONFIG.host}:${DEFAULT_CONFIG.port}]. Đang Subscribe topic: "${DEFAULT_CONFIG.topic}"`);
    client.subscribe(DEFAULT_CONFIG.topic); 
  });
  client.on("message", (topic, payload) => {
    const rawStr = payload.toString("utf8");
    const parsed = parsePayloadTextSecure(rawStr);
    if (parsed) { messageQueue.push(parsed); }
  });
  return client;
}

module.exports = { connectMQTT };