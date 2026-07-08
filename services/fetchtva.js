// fetchtva.js
"use strict";
const axios = require("axios");
const cheerio = require("cheerio");
const db = require("../config/db"); 

const CONFIG = {
  baseUrl: process.env.TVA_URL, 
  loginUrl: process.env.TVA_LOGIN_URL,
  username: process.env.TVA_USERNAME, 
  password: process.env.TVA_PASSWORD,
  loginPath: process.env.TVA_LOGIN_PATH || "/dang-nhap/", 
  timeoutMs: Number(process.env.TVA_TIMEOUT_MS) || 15000,
  maxRetries: Number(process.env.TVA_MAX_RETRIES) || 3, 
  retryDelayMs: Number(process.env.TVA_RETRY_DELAY_MS) || 5000,
  source: "tva", 
  // Đọc cấu hình chu kỳ động từ .env
  FETCH_INTERVAL_SECONDS: Number(process.env.TVA_FETCH_INTERVAL_SECONDS) || 60,
  SAVE_DB_INTERVAL_SECONDS: Number(process.env.TVA_SAVE_DB_INTERVAL_SECONDS) || 300
};

const TVA_PARAMETER_MAP = { mucnuoc: "level", luuluong: "flow", tongluuluong: "totalIndex" };

// Hàng đợi bộ nhớ đệm (RAM Queue) để gom dữ liệu lịch sử theo cấu hình env
let tvaHistoryQueue = []; 

function buildStationId(source, rawId) { return `${source}_${String(rawId).toLowerCase()}`; }
function createHttpClient(config) { return axios.create({ timeout: config.timeoutMs, headers: { "User-Agent": "Mozilla/5.0" } }); }

function buildCookieHeader(cookies) {
  const cookieMap = {};
  cookies.forEach((cookie) => {
    const [nameValue] = cookie.split(";"); const [name, value] = nameValue.split("=");
    if (name && value) cookieMap[name.trim()] = value.trim();
  });
  return Object.entries(cookieMap).map(([name, value]) => `${name}=${value}`).join("; ");
}

// 🔧 FIX: xử lý đúng định dạng số quốc tế lẫn châu Âu.
// Trước đây khi gặp cả dấu "." và "," code luôn giả định kiểu châu Âu
// (chấm = phân cách nghìn, phẩy = thập phân) nên với giá trị totalIndex
// dạng "3,813,278.25" (kiểu quốc tế: phẩy = nghìn, chấm = thập phân)
// bị xóa nhầm dấu chấm thập phân -> ra NaN -> null -> dòng bị loại bỏ.
// Cách sửa: xác định dấu nào đứng SAU CÙNG trong chuỗi, đó mới là dấu thập phân thật.
function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  let cleaned = String(value).trim();
  if (cleaned === "" || cleaned === "-" || cleaned.toLowerCase() === "nan") return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");

  if (lastDot !== -1 && lastComma !== -1) {
    if (lastDot > lastComma) {
      // vd: "3,813,278.25" (kiểu quốc tế: , = nghìn, . = thập phân)
      cleaned = cleaned.replace(/,/g, "");
    } else {
      // vd: "3.813.278,25" (kiểu châu Âu: . = nghìn, , = thập phân)
      cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
    }
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/,/g, ".");
  }

  return Number.isNaN(Number(cleaned)) ? null : Number(cleaned);
}

function parseUpdateTimeRounded(value) {
  if (!value) return null;
  const cleaned = String(value).trim();
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const [, day, month, year, hours = "0", minutes = "0"] = match;
  const pad = (v) => String(v).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:00+07`;
}

function getCurrentSystemTimeRounded(date = new Date()) {
  const pad = (v) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:00+07`;
}

function normalizeStationId(name) {
  const normalized = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const explicitOverrides = { qt3182gpbtnmt: "qt3", qt1nm12186gpbtnmt: "qt1nm1", qt2nm12186gpbtnmt: "qt2nm1" };
  if (explicitOverrides[normalized.replace(/[^a-z0-9]+/g, "")]) return explicitOverrides[normalized.replace(/[^a-z0-9]+/g, "")];
  const compact = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const tramBomMatch = compact.match(/^tram_bom_(\d+)$/); if (tramBomMatch) return `tb${tramBomMatch[1]}`;
  const nhaMayMatch = compact.match(/^nha_may_so_(\d+)_gieng_so_(\d+)$/); if (nhaMayMatch) return `gs${nhaMayMatch[2]}nm${nhaMayMatch[1]}`;
  return compact.replace(/_/g, "");
}

async function loginTVA(config) {
  const client = createHttpClient(config); const loginPageRes = await client.get(config.baseUrl);
  let cookies = loginPageRes.headers["set-cookie"] || [];
  const loginData = new URLSearchParams({ "fields[email]": config.username, "fields[password]": config.password, remember_account: "on", is_dtool_form: cheerio.load(loginPageRes.data)("input[name='is_dtool_form']").val() || "" });
  const loginRes = await client.post(`${config.baseUrl}${config.loginPath}`, loginData.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: buildCookieHeader(cookies) } });
  if (loginRes.headers["set-cookie"]) cookies = [...cookies, ...loginRes.headers["set-cookie"]];
  return { client, cookieHeader: buildCookieHeader(cookies) };
}

// 🌐 CHU KỲ 1: CHỈ CÀO DỮ LIỆU VÀ CẬP NHẬT BẢNG LATEST TỨC THỜI (AUTO-COMMIT TỪNG DÒNG CHỐNG DEADLOCK)
async function fetchTVAData() {
  console.log(`\n🌊 [TVA][FETCH] Bắt đầu cào dữ liệu Web TVA (Chu kỳ: ${CONFIG.FETCH_INTERVAL_SECONDS}s)...`);
  const { client, cookieHeader } = await loginTVA(CONFIG);
  const res = await client.get(CONFIG.baseUrl, { headers: { Cookie: cookieHeader } });
  const $ = cheerio.load(res.data);
  
  const currentFetchTs = getCurrentSystemTimeRounded(); 
  const segments = $(".segmentData").toArray();
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

    for (const segment of segments) {
      const stationName = $(segment).find(".headerChart").first().text().trim();
      const updateTime = $(segment).find(".headerNow").first().text().replace(/Thoi\s*diem:|Thời\s*điểm:/gi, "").trim();

      const stationId = buildStationId(CONFIG.source, normalizeStationId(stationName));
      const ts = parseUpdateTimeRounded(updateTime) || currentFetchTs;

      const rows = $(segment).find(".left .table .row").toArray();
      for (const row of rows) {
        if ($(row).hasClass("header")) continue;
        const cols = $(row).find(".col"); if (cols.length < 4) continue;

        const parameter = TVA_PARAMETER_MAP[normalizeStationId($(cols[1]).text().trim())];
        const parsedValue = normalizeNumber($(cols[3]).text().trim());
        if (!parameter || parsedValue === null) continue;

        // A. Lưu vào logger_latest trạm gốc ngay lập tức
        await dbClient.query(upsertLatestQuery, [stationId, parameter, ts, parsedValue, currentFetchTs]);
        await dbClient.query(`INSERT INTO public.logger_stations (station_id, display_name, description) VALUES ($1, $2, $3) ON CONFLICT (station_id) DO NOTHING;`, [stationId, `Trạm ${stationName}`, 'Tự động từ Web TVA']);

        // 🟢 ĐẨY VÀO HÀNG ĐỢI RAM: Chờ chu kỳ 2 ghi vào lịch sử sau
        tvaHistoryQueue.push({ logger_id: stationId, tag_key: parameter, data_ts: ts });

        // B. Lưu ma trận ánh xạ tức thời cho trạm nhận
        const relatedMaps = activeMappings.filter(m => m.source_logger_id === stationId && m.source_tag_key === parameter);
        for (const mapItem of relatedMaps) {
          await dbClient.query(upsertLatestQuery, [mapItem.target_station_id, parameter, ts, parsedValue, currentFetchTs]);
          await dbClient.query(`INSERT INTO public.logger_stations (station_id, display_name, description) VALUES ($1, $2, $3) ON CONFLICT (station_id) DO NOTHING;`, [mapItem.target_station_id, `Trạm ${mapItem.target_station_id}`, 'Ánh xạ từ TVA']);
          
          // 🟢 ĐẨY VÀO HÀNG ĐỢI RAM: Ghi cả phần nhân bản ma trận vào hàng đợi lịch sử
          tvaHistoryQueue.push({ logger_id: mapItem.target_station_id, tag_key: parameter, data_ts: ts });
        }
      }
    }
    console.log(`📥 [TVA][FETCH_SUCCESS] Đã cập nhật xong bảng ma trận tức thời. Gom thêm ${segments.length} dòng vào RAM Queue.`);
  } catch (err) {
    console.error("❌ [TVA][FETCH_ERROR] Thất bại chu kỳ cào:", err.message);
  } finally {
    if (dbClient) dbClient.release();
  }
}

// 💾 CHU KỲ 2: XẢ HÀNG ĐỢI GHI LỊCH SỬ VÀO LOGGER_READINGS ĐỊNH KỲ (SỬ DỤNG TRANSACTION GOM ĐỂ GIẢM TẢI DB)
async function flushHistoryQueueToPostgres() {
  if (tvaHistoryQueue.length === 0) return;
  
  const startLogTime = Date.now();
  const cachedItems = [...tvaHistoryQueue]; 
  tvaHistoryQueue = []; // Reset queue ngay lập tức tránh trùng lặp dữ liệu
  const currentSaveTs = getCurrentSystemTimeRounded();

  console.log(`\n💾 [TVA][READINGS] Đến chu kỳ lưu DB (${CONFIG.SAVE_DB_INTERVAL_SECONDS}s) -> Đang xả ${cachedItems.length} bản ghi lịch sử vào Postgres...`);
  let dbClient;

  try {
    dbClient = await db.connect();
    // Bắt đầu transaction gom ghi lịch sử tốc độ cao
    await dbClient.query("BEGIN"); 

    // Lấy giá trị tức thời mới nhất của từng cặp trạm-tag trong DB để lưu vào lịch sử
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
    const duration = Date.now() - startLogTime;
    console.log(`✅ [TVA][READINGS_SUCCESS] Đã lưu hoàn tất +${cachedItems.length} dòng lịch sử. Thời gian ghi nhận: ${duration}ms`);
  } catch (error) {
    if (dbClient) await dbClient.query("ROLLBACK");
    console.error("❌ [TVA][READINGS_CRASH] Thất bại khi xả hàng đợi lịch sử:", error.message);
  } finally {
    if (dbClient) dbClient.release();
  }
}

// ĐĂNG KÝ VÒNG LẶP ĐỘNG THEO CONFIG TỪ FILE ENV
let inFlight = false;
setInterval(async () => {
  if (inFlight) return; inFlight = true;
  await fetchTVAData();
  inFlight = false;
}, CONFIG.FETCH_INTERVAL_SECONDS * 1000);

setInterval(async () => {
  await flushHistoryQueueToPostgres();
}, CONFIG.SAVE_DB_INTERVAL_SECONDS * 1000);

module.exports = { fetchTVAData };