// fetchscada.js
"use strict";
const axios = require("axios");
const cheerio = require("cheerio");
const db = require("../config/db"); 

const DEFAULT_CONFIG = {
  baseUrl: process.env.SCADA_URL, loginUrl: process.env.SCADA_LOGIN_URL,
  username: process.env.SCADA_USERNAME, password: process.env.SCADA_PASSWORD,
  viewId: Number(process.env.SCADA_VIEW_ID) || 16, timeoutMs: Number(process.env.SCADA_TIMEOUT_MS) || 15000,
  maxRetries: Number(process.env.SCADA_MAX_RETRIES) || 3, retryDelayMs: Number(process.env.SCADA_RETRY_DELAY_MS) || 5000,
  source: "scada", 
  FETCH_INTERVAL_SECONDS: Number(process.env.SCADA_FETCH_INTERVAL_SECONDS) || 60,
  SAVE_DB_INTERVAL_SECONDS: Number(process.env.SCADA_SAVE_DB_INTERVAL_SECONDS) || 300
};

const cnlMapping = {
  2902: ["gs4nm2", "level"], 2904: ["gs4nm2", "flow"], 2905: ["gs4nm2", "totalIndex"],
  2907: ["gs5nm1", "level"], 2909: ["gs5nm1", "flow"], 2910: ["gs5nm1", "totalIndex"],
  2912: ["gs4nm1", "level"], 2914: ["gs4nm1", "flow"], 2915: ["gs4nm1", "totalIndex"],
  2917: ["tb1", "level"],    2919: ["tb1", "flow"],    2920: ["tb1", "totalIndex"],
  2922: ["tb24", "amino"],   2923: ["tb24", "level"],   2925: ["tb24", "nitrat"], 2926: ["tb24", "pH"], 2927: ["tb24", "TDS"],
  2928: ["gs5nm1", "amino"], 2929: ["gs5nm1", "nitrat"], 2930: ["gs5nm1", "pH"], 2931: ["gs5nm1", "TDS"],
  2932: ["gs4nm2", "amino"], 2933: ["gs4nm2", "nitrat"], 2934: ["gs4nm2", "pH"], 2935: ["gs4nm2", "TDS"]
};

let scadaHistoryQueue = []; // RAM Queue gom lưu lịch sử readings

function buildStationId(source, rawId) { return `${source}_${String(rawId).toLowerCase()}`; }
function mapCnlToStationAndParameter(cnlNum) {
  const mapped = cnlMapping[cnlNum];
  return mapped ? { station: mapped[0], parameter: mapped[1] } : { station: null, parameter: null };
}

function createHttpClient(config) {
  return axios.create({ timeout: config.timeoutMs, maxRedirects: 5, headers: { "User-Agent": "Mozilla/5.0" } });
}

function collectCookies(existing, next) {
  return Array.from(new Set([...existing, ...next].map((c) => c.split(";")[0]))).join("; ");
}

function parseScadaValue(textValue, parameter = null) {
  if (textValue === null || textValue === undefined) return null;
  let cleaned = String(textValue).trim();
  if (cleaned === "" || cleaned === "-" || cleaned.toLowerCase() === "nan") return null;

  // Cấu hình riêng cho Chỉ số tổng (totalIndex)
  if (parameter === "totalIndex") {
    // Xóa bỏ tất cả dấu phẩy (phân cách hàng nghìn) và dấu chấm (nếu có) để đưa về số nguyên sạch
    cleaned = cleaned.replace(/,/g, "").replace(/\./g, ""); 
    // Ví dụ: "929,999" -> "929999"
  } else {
    // Cấu hình cho các thông số lẻ (pH, level, flow, amino...)
    // Nếu chuỗi chứa cả chấm và phẩy (Ví dụ chuẩn Anh/Mỹ: 1,234.56)
    if (cleaned.includes(".") && cleaned.includes(",")) {
      cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
    } 
    // Nếu chuỗi chỉ chứa dấu phẩy đóng vai trò là dấu thập phân (Ví dụ: 7,98)
    else if (cleaned.includes(",")) {
      cleaned = cleaned.replace(/,/g, "."); // "7,98" -> "7.98"
    }
  }

  return Number.isNaN(Number(cleaned)) ? null : Number(cleaned);
}

async function loginScada(config) {
  const client = createHttpClient(config); const loginPage = await client.get(config.loginUrl);
  const initialCookies = loginPage.headers["set-cookie"] || []; const initialHeader = collectCookies([], initialCookies);
  const $ = cheerio.load(loginPage.data);
  const loginData = new URLSearchParams({
    __VIEWSTATE: $("input[name='__VIEWSTATE']").val(), __VIEWSTATEGENERATOR: $("input[name='__VIEWSTATEGENERATOR']").val() || "",
    __EVENTVALIDATION: $("input[name='__EVENTVALIDATION']").val() || "", txtUsername: config.username, txtPassword: config.password, btnLogin: "Login"
  });
  const loginResponse = await client.post(config.loginUrl, loginData.toString(), { 
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: initialHeader, Referer: config.loginUrl } 
  });
  return { client, sessionCookie: collectCookies(initialCookies, loginResponse.headers["set-cookie"] || []) };
}

function getFormattedTimestampRounded() {
  const now = new Date(); const pad = (v) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00+07`;
}

// 🌐 CHU KỲ 1: CÀO WEB VÀ CẬP NHẬT TRẠM MẠ TRẬN TỨC THỜI (LATEST)
async function fetchScadaData() {
  console.log(`\n⚙️  [SCADA][FETCH] Khởi chạy chu kỳ cào dữ liệu Scada (${DEFAULT_CONFIG.FETCH_INTERVAL_SECONDS}s)...`);
  const { client, sessionCookie } = await loginScada(DEFAULT_CONFIG);
  let rawData = []; const timestamp = Date.now();
  const apiUrl = `${DEFAULT_CONFIG.baseUrl}/Scada/ClientApiSvc.svc/GetCurCnlDataExt`;

  try {
    const response = await client.get(apiUrl, { params: { cnlNums: '', viewIDs: '', viewID: DEFAULT_CONFIG.viewId, _: timestamp }, headers: { 'Cookie': sessionCookie } });
    if (response.data && response.data.d) { const parsedRes = JSON.parse(response.data.d); if (parsedRes.Success) rawData = parsedRes.Data; }
  } catch (err) {
    const channelNums = Object.keys(cnlMapping).map(k => parseInt(k, 10));
    const response = await client.get(apiUrl, { params: { cnlNums: JSON.stringify(channelNums), viewIDs: '[]', _: timestamp }, headers: { 'Cookie': sessionCookie } });
    if (response.data && response.data.d) { const parsedRes = JSON.parse(response.data.d); if (parsedRes.Success) rawData = parsedRes.Data; }
  }

  if (!rawData || rawData.length === 0) return;

  const currentFetchTs = getFormattedTimestampRounded(); 
  let dbClient;

  try {
    dbClient = await db.connect();
    const mappingRes = await dbClient.query(`SELECT source_logger_id, source_tag_key, target_station_id FROM logger_tag_mappings`);
    const activeMappings = mappingRes.rows;

    const upsertLatestQuery = `
      INSERT INTO logger_latest (logger_id, tag_key, data_ts, value, current_ts) 
      VALUES ($1, $2, $3::timestamptz, $4, $5::timestamptz) 
      ON CONFLICT (logger_id, tag_key) 
      DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, current_ts = EXCLUDED.current_ts;
    `;

    for (const item of rawData) {
      const { station, parameter } = mapCnlToStationAndParameter(item.CnlNum);
      if (!station || !parameter) continue;

      const stationId = buildStationId(DEFAULT_CONFIG.source, String(station).toLowerCase());
      // const parsedValue = item.Text ? parseScadaValue(item.Text) : null;
      const parsedValue = item.Text ? parseScadaValue(item.Text, parameter) : null;
      if (parsedValue === null) continue;

      await dbClient.query(upsertLatestQuery, [stationId, parameter, currentFetchTs, parsedValue, currentFetchTs]);
      await dbClient.query(`INSERT INTO public.logger_stations (station_id, display_name, description) VALUES ($1, $2, $3) ON CONFLICT (station_id) DO NOTHING;`, [stationId, `Trạm ${stationId}`, 'Khởi tạo từ SCADA']);

      scadaHistoryQueue.push({ logger_id: stationId, tag_key: parameter, data_ts: currentFetchTs });

      const relatedMaps = activeMappings.filter(m => m.source_logger_id === stationId && m.source_tag_key === parameter);
      for (const mapItem of relatedMaps) {
        await dbClient.query(upsertLatestQuery, [mapItem.target_station_id, parameter, currentFetchTs, parsedValue, currentFetchTs]);
        await dbClient.query(`INSERT INTO public.logger_stations (station_id, display_name, description) VALUES ($1, $2, $3) ON CONFLICT (station_id) DO NOTHING;`, [mapItem.target_station_id, `Trạm ${mapItem.target_station_id}`, 'Ánh xạ qua SCADA']);
        
        scadaHistoryQueue.push({ logger_id: mapItem.target_station_id, tag_key: parameter, data_ts: currentFetchTs });
      }
    }
    console.log(`📥 [SCADA][FETCH_SUCCESS] Cập nhật xong bảng tức thời. Gom dữ liệu vào RAM Queue.`);
  } catch (err) {
    console.error("❌ [SCADA][FETCH_ERROR] Thất bại chu kỳ cào Scada:", err.message); 
  } finally { 
    if (dbClient) dbClient.release(); 
  }
}

// 💾 CHU KỲ 2: XẢ HÀNG ĐỢI LƯU LỊCH SỬ LOGGER_READINGS
async function flushScadaHistory() {
  if (scadaHistoryQueue.length === 0) return;
  const startLogTime = Date.now();
  const cachedItems = [...scadaHistoryQueue]; scadaHistoryQueue = [];
  const currentSaveTs = getFormattedTimestampRounded();

  console.log(`\n💾 [SCADA][READINGS] Đến chu kỳ lưu DB (${DEFAULT_CONFIG.SAVE_DB_INTERVAL_SECONDS}s) -> Đang xả ${cachedItems.length} bản ghi lịch sử SCADA...`);
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
    console.log(`✅ [SCADA][READINGS_SUCCESS] Đã lưu xong +${cachedItems.length} dòng lịch sử SCADA. Thời gian: ${Date.now() - startLogTime}ms`);
  } catch (error) {
    if (dbClient) await dbClient.query("ROLLBACK");
    console.error("❌ [SCADA][READINGS_CRASH] Thất bại khi xả hàng đợi lịch sử:", error.message);
  } finally {
    if (dbClient) dbClient.release();
  }
}

let inFlight = false;
setInterval(async () => {
  if (inFlight) return; inFlight = true;
  for (let attempt = 1; attempt <= DEFAULT_CONFIG.maxRetries; attempt++) {
    try { await fetchScadaData(); break; } catch (e) { 
      if (attempt < DEFAULT_CONFIG.maxRetries) await new Promise(r => setTimeout(r, DEFAULT_CONFIG.retryDelayMs)); 
    }
  }
  inFlight = false;
}, DEFAULT_CONFIG.FETCH_INTERVAL_SECONDS * 1000);

setInterval(async () => { await flushScadaHistory(); }, DEFAULT_CONFIG.SAVE_DB_INTERVAL_SECONDS * 1000);

module.exports = { fetchScadaData };