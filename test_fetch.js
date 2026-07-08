// test-fetch.js
// Mục đích: chỉ test crawl + parse HTML từ Web TVA, KHÔNG đụng tới DB, KHÔNG đọc .env.
// Chạy: node test-fetch.js
"use strict";
const axios = require("axios");
const cheerio = require("cheerio");

// ====== CONFIG HARDCODE (bỏ .env) ======
const CONFIG = {
  baseUrl: "http://camau.dulieuquantrac.com:8906",
  loginPath: "/dang-nhap/",
  username: "ctncamau@quantrac.net",
  password: "123456789",
  timeoutMs: 15000,
};

const TVA_PARAMETER_MAP = { mucnuoc: "level", luuluong: "flow", tongluuluong: "totalIndex" };

function createHttpClient(config) {
  return axios.create({ timeout: config.timeoutMs, headers: { "User-Agent": "Mozilla/5.0" } });
}

function buildCookieHeader(cookies) {
  const cookieMap = {};
  cookies.forEach((cookie) => {
    const [nameValue] = cookie.split(";");
    const [name, value] = nameValue.split("=");
    if (name && value) cookieMap[name.trim()] = value.trim();
  });
  return Object.entries(cookieMap).map(([name, value]) => `${name}=${value}`).join("; ");
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  let cleaned = String(value).trim();
  if (cleaned === "" || cleaned === "-" || cleaned.toLowerCase() === "nan") return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");

  if (lastDot !== -1 && lastComma !== -1) {
    // Có cả 2 dấu -> dấu nào đứng SAU CÙNG mới là dấu thập phân thật,
    // dấu còn lại là phân cách hàng nghìn -> xóa bỏ.
    if (lastDot > lastComma) {
      // vd: "3,813,278.25" (kiểu quốc tế: , = nghìn, . = thập phân)
      cleaned = cleaned.replace(/,/g, "");
    } else {
      // vd: "3.813.278,25" (kiểu châu Âu: . = nghìn, , = thập phân)
      cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
    }
  } else if (cleaned.includes(",")) {
    // Chỉ có dấu phẩy -> coi là dấu thập phân (giữ hành vi cũ cho trường hợp này)
    cleaned = cleaned.replace(/,/g, ".");
  }

  return Number.isNaN(Number(cleaned)) ? null : Number(cleaned);
}

function normalizeStationId(name) {
  const normalized = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const explicitOverrides = { qt3182gpbtnmt: "qt3", qt1nm12186gpbtnmt: "qt1nm1", qt2nm12186gpbtnmt: "qt2nm1" };
  if (explicitOverrides[normalized.replace(/[^a-z0-9]+/g, "")]) return explicitOverrides[normalized.replace(/[^a-z0-9]+/g, "")];
  const compact = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const tramBomMatch = compact.match(/^tram_bom_(\d+)$/);
  if (tramBomMatch) return `tb${tramBomMatch[1]}`;
  const nhaMayMatch = compact.match(/^nha_may_so_(\d+)_gieng_so_(\d+)$/);
  if (nhaMayMatch) return `gs${nhaMayMatch[2]}nm${nhaMayMatch[1]}`;
  return compact.replace(/_/g, "");
}

async function loginTVA(config) {
  const client = createHttpClient(config);
  const loginPageRes = await client.get(config.baseUrl);
  let cookies = loginPageRes.headers["set-cookie"] || [];
  const loginData = new URLSearchParams({
    "fields[email]": config.username,
    "fields[password]": config.password,
    remember_account: "on",
    is_dtool_form: cheerio.load(loginPageRes.data)("input[name='is_dtool_form']").val() || "",
  });
  const loginRes = await client.post(`${config.baseUrl}${config.loginPath}`, loginData.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: buildCookieHeader(cookies) },
  });
  if (loginRes.headers["set-cookie"]) cookies = [...cookies, ...loginRes.headers["set-cookie"]];
  return { client, cookieHeader: buildCookieHeader(cookies) };
}

async function testFetchAndParse() {
  console.log("🌊 [TEST] Bắt đầu login + cào dữ liệu (không DB, không .env)...");
  const { client, cookieHeader } = await loginTVA(CONFIG);
  const res = await client.get(CONFIG.baseUrl, { headers: { Cookie: cookieHeader } });
  const $ = cheerio.load(res.data);

  const segments = $(".segmentData").toArray();
  console.log(`📦 Tìm thấy ${segments.length} segment (trạm).`);

  let totalRowsFound = 0;
  let totalIndexFound = 0;
  let totalIndexMissingRaw = 0; // rows that look like tongluuluong but got filtered/null

  segments.forEach((segment, idx) => {
    const stationNameRaw = $(segment).find(".headerChart").first().text().trim();
    const updateTimeRaw = $(segment).find(".headerNow").first().text().replace(/Thoi\s*diem:|Thời\s*điểm:/gi, "").trim();
    const stationId = normalizeStationId(stationNameRaw);

    console.log(`\n--- [${idx}] Trạm: "${stationNameRaw}" (id=${stationId}) | update: "${updateTimeRaw}" ---`);

    const rows = $(segment).find(".left .table .row").toArray();
    if (rows.length === 0) {
      console.log("  ⚠️  Không tìm thấy dòng nào trong .left .table .row — có thể selector sai hoặc HTML đã đổi cấu trúc.");
    }

    rows.forEach((row, rIdx) => {
      if ($(row).hasClass("header")) return;
      const cols = $(row).find(".col");
      if (cols.length < 4) {
        console.log(`  ⚠️  [row ${rIdx}] Số cột < 4 (${cols.length}), bỏ qua. HTML row: ${$.html(row).slice(0, 200)}`);
        return;
      }

      const rawLabel = $(cols[1]).text().trim();
      const rawValue = $(cols[3]).text().trim();
      const normalizedLabel = normalizeStationId(rawLabel);
      const parameter = TVA_PARAMETER_MAP[normalizedLabel];
      const parsedValue = normalizeNumber(rawValue);

      totalRowsFound++;

      const isTotalIndexLike = normalizedLabel === "tongluuluong" || /tong.*luu.*luong/i.test(rawLabel);

      if (isTotalIndexLike) {
        if (parameter && parsedValue !== null) {
          totalIndexFound++;
          console.log(`  ✅ [row ${rIdx}] totalIndex OK  | label="${rawLabel}" -> normalized="${normalizedLabel}" | value raw="${rawValue}" -> parsed=${parsedValue}`);
        } else {
          totalIndexMissingRaw++;
          console.log(`  ❌ [row ${rIdx}] totalIndex BỊ LOẠI | label="${rawLabel}" -> normalized="${normalizedLabel}" | parameter mapped=${parameter} | value raw="${rawValue}" -> parsed=${parsedValue}`);
        }
      } else {
        console.log(`  •  [row ${rIdx}] label="${rawLabel}" (normalized="${normalizedLabel}", mapped=${parameter || "—"}) value raw="${rawValue}" -> parsed=${parsedValue}`);
      }
    });
  });

  console.log("\n================ TỔNG KẾT ================");
  console.log(`Tổng số dòng đã duyệt: ${totalRowsFound}`);
  console.log(`Số dòng totalIndex parse thành công: ${totalIndexFound}`);
  console.log(`Số dòng totalIndex bị loại (mapped=null hoặc value=null): ${totalIndexMissingRaw}`);
  if (totalIndexMissingRaw > 0) {
    console.log("👉 Có dòng totalIndex bị loại. Xem log ❌ ở trên để biết do label không map được (normalizeStationId) hay do value rỗng/không parse được (normalizeNumber).");
  }
  if (totalIndexFound === 0 && totalIndexMissingRaw === 0) {
    console.log("👉 Không tìm thấy dòng nào có label giống 'tổng lưu lượng' — có thể HTML/selector đã thay đổi, hoặc trang không hiển thị chỉ số này cho tài khoản/trạm hiện tại.");
  }
}

testFetchAndParse().catch((err) => {
  console.error("💥 [TEST_ERROR]", err.message);
  if (err.response) {
    console.error("HTTP status:", err.response.status);
  }
});