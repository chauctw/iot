// gateways/mqtt_gateway.js
"use strict";
const mqtt = require("mqtt");
const db = require("../config/db"); 

const CONFIG = {
  host: process.env.MQTT_HOST || "14.225.252.85",
  port: Number(process.env.MQTT_PORT) || 1883,
  topic: "telemetry/push" // Topic riêng biệt cho Gateway mới, không lo trùng luồng fetch cũ
};

function formatTimestampToICT(rawTs) {
  if (!rawTs) return null;
  const cleaned = String(rawTs).trim().replace("T", " ");
  return cleaned.includes("+") ? cleaned : `${cleaned}+07`;
}

async function handleMqttGatewayPush(payload) {
  const { station_id, display_name, timestamp, metrics } = payload;
  if (!station_id || !timestamp || !metrics || typeof metrics !== 'object') return;

  const cleanStationId = String(station_id).trim().toLowerCase();
  const formattedTs = formatTimestampToICT(timestamp);
  const currentSaveTs = new Date().toISOString();

  let dbClient;
  try {
    dbClient = await db.connect();

    const finalDisplayName = display_name ? String(display_name).trim() : `Trạm ${cleanStationId.toUpperCase()}`;
    await dbClient.query(`
      INSERT INTO public.logger_stations (station_id, display_name, description) 
      VALUES ($1, $2, $3) ON CONFLICT (station_id) DO NOTHING;
    `, [cleanStationId, finalDisplayName, 'Tự động tạo từ Gateway MQTT Client']);

    const upsertLatestQuery = `
      INSERT INTO public.logger_latest (logger_id, tag_key, data_ts, value, current_ts) 
      VALUES ($1, $2, $3::timestamptz, $4, $5::timestamptz) 
      ON CONFLICT (logger_id, tag_key) DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, current_ts = EXCLUDED.current_ts;
    `;
    const insertReadingsQuery = `
      INSERT INTO public.logger_readings (logger_id, tag_key, data_ts, data_save, value) 
      VALUES ($1::text, $2::text, $3::timestamptz, $4::timestamptz, $5) ON CONFLICT DO NOTHING;
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
    console.log(`📥 [MQTT_GATEWAY_NEW] Đồng bộ trạm thành công: '${cleanStationId}' (+${processedCount} số)`);
  } catch (error) {
    console.error("❌ [MQTT_GATEWAY_NEW][ERROR]", error.message);
  } finally {
    if (dbClient) dbClient.release();
  }
}

function startMqttGatewayListener() {
  // Tạo Client kết nối ra Broker ngoài ổn định tuyệt đối
  const client = mqtt.connect(`mqtt://${CONFIG.host}:${CONFIG.port}`, { 
    clean: true, 
    connectTimeout: 10000, 
    reconnectPeriod: 4000,
    clientId: `gateway_client_push_${Math.random().toString(16).substr(2, 6)}`
  });
  
  client.on("connect", () => { 
    console.log(`📡 [MQTT_GATEWAY_NEW] Kênh hứng dữ liệu độc lập đã online. Trực sẵn kênh: "${CONFIG.topic}"`);
    client.subscribe(CONFIG.topic); 
  });

  client.on("message", async (topic, message) => {
    if (topic !== CONFIG.topic) return;
    try {
      const rawStr = message.toString("utf8").trim();
      if (rawStr.startsWith("{")) {
        await handleMqttGatewayPush(JSON.parse(rawStr));
      }
    } catch (err) {}
  });

  client.on("error", (err) => {
    console.error("❌ [MQTT_GATEWAY_NEW] Lỗi Client:", err.message);
  });
}

module.exports = { startMqttGatewayListener };