// fetchmonre.js
"use strict";
const axios = require('axios');
const db = require("../config/db"); 

const CONFIG = {
    USERNAME: process.env.MONRE_USERNAME,
    PASSWORD: process.env.MONRE_PASSWORD,
    PORTAL_URL: process.env.MONRE_PORTAL_URL,
    DATA_URL: process.env.MONRE_DATA_URL,
    SOURCE: "monre", 
    FETCH_INTERVAL_SECONDS: Number(process.env.MONRE_FETCH_INTERVAL_SECONDS) || 60,
    SAVE_DB_INTERVAL_SECONDS: Number(process.env.MONRE_SAVE_DB_INTERVAL_SECONDS) || 300
};

const PROJECT_FILTER = "(congtrinh='CAPNUOCCAMAU1' OR congtrinh='CONGTYCOPHANCAPNUOCC' OR congtrinh='NHAMAYCAPNUOCSO1' OR congtrinh='CAPNUOCCAMAUSO2')";
const PERMIT_MAPPING = {
    "393/gp-bnnmt 22/09/2025": ["NHAMAYCAPNUOCSO1"],
    "391/gp-bnnmt 19/09/2025": ["CONGTYCOPHANCAPNUOCC"],
    "35/gp-btnmt 15/01/2025": ["CAPNUOCCAMAU1"],
    "36/gp-btnmt 15/01/2025": ["CAPNUOCCAMAUSO2"]
};
const PARAMETER_MAP = {
    "MUCNUOC": "level", "H": "level", "LUULUONG": "flow", "Q": "flow", "TONGLUULUONG": "totalIndex", "V": "totalIndex",
    "PH": "ph", "TDS": "tds", "NO3": "no3", "NH4+": "nh4", "NH4": "nh4", "AMONI": "nh4"  
};

let cachedToken = null; let tokenExpiry = null;
let monreHistoryQueue = []; 

function getCleanPermitNumber(projectName) {
    if (!projectName) return "UNKNOWN";
    const targetProject = projectName.trim().toUpperCase();
    for (const [permit, projects] of Object.entries(PERMIT_MAPPING)) {
        if (projects.some(p => p.trim().toUpperCase() === targetProject)) {
            const match = permit.split(' ')[0].match(/^(\d+)/);
            return match ? match[1] : "UNKNOWN";
        }
    }
    return "UNKNOWN";
}

// 🟢 THÊM MỚI: Hàm làm sạch tên trạm thô (Xóa dấu tiếng Việt, ký tự lạ, chuyển sang viết thường và nối gạch dưới)
function getCleanStationSlug(rawStationName) {
    if (!rawStationName) return "unnamed";
    return String(rawStationName)
        .trim()
        .normalize('NFD')                     // Tách các dấu tiếng Việt ra khỏi chữ gốc
        .replace(/[\u0300-\u036f]/g, '')     // Xóa bỏ toàn bộ các dấu tiếng Việt vừa tách
        .replace(/[đĐ]/g, 'd')                // Chuyển chữ đ/Đ thành d
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')           // Ký tự đặc biệt hoặc khoảng trắng biến thành gạch dưới
        .replace(/_+/g, '_')                  // Gom nhiều dấu gạch dưới liên tiếp thành 1 dấu
        .replace(/^_+|_+$/g, '');             // Cắt bỏ gạch dưới thừa ở đầu/cuối chuỗi
}

function formatTimestampRounded(ts) {
    if (!ts) return null;
    const date = new Date(Number(ts));
    if (Number.isNaN(date.getTime())) return null;
    const pad = (v) => String(v).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00+07`;
}

function getCurrentSystemTimeRounded() {
    const now = new Date(); const pad = (v) => String(v).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00+07`;
}

function normalizeMetricValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isNaN(value) ? null : value;
    let cleaned = String(value).trim();
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
    cleaned = cleaned.replace(/,/g, "");
    return Number.isNaN(Number(cleaned)) ? null : Number(cleaned);
}

async function getToken() {
    if (cachedToken && tokenExpiry && Date.now() < (tokenExpiry - 5 * 60 * 1000)) return cachedToken;
    try {
        const params = new URLSearchParams({ username: CONFIG.USERNAME, password: CONFIG.PASSWORD, referer: 'https://iot.monre.gov.vn', f: 'json', expiration: 60 });
        const response = await axios.post(CONFIG.PORTAL_URL, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 });
        if (response.data && response.data.token) {
            cachedToken = response.data.token;
            tokenExpiry = response.data.expires ? response.data.expires : (Date.now() + 60 * 60 * 1000);
            return cachedToken;
        }
        throw new Error(response.data?.error?.message || 'Invalid token response');
    } catch (error) {
        console.error("❌ [MONRE][TOKEN] Thất bại khi lấy Token:", error.message);
        throw error;
    }
}

async function fetchMonreData() {
    console.log(`\n☁️  [MONRE][FETCH] Khởi chạy chu kỳ quét API (${CONFIG.FETCH_INTERVAL_SECONDS}s)...`);
    let dbClient;
    try {
        const token = await getToken();
        const currentFetchTs = getCurrentSystemTimeRounded(); 
        
        const params = { f: 'json', where: PROJECT_FILTER, outFields: '*', orderByFields: 'thoigiannhan DESC', resultRecordCount: 5000, token: token };
        const response = await axios.get(CONFIG.DATA_URL, { params, timeout: 25000 });
        if (response.data && response.data.error) throw new Error(response.data.error.message);

        const features = response.data.features || [];
        if (features.length === 0) return;

        const rawLatestMap = {};
        features.forEach(f => {
            const attr = f.attributes;
            if (!attr || !attr.tram || !attr.chiso) return;
            if (!rawLatestMap[attr.tram]) rawLatestMap[attr.tram] = {};
            if (!rawLatestMap[attr.tram][attr.chiso]) rawLatestMap[attr.tram][attr.chiso] = attr;
        });

        const finalizedDataBatch = [];
        for (const rawStationName in rawLatestMap) {
            const firstParamKey = Object.keys(rawLatestMap[rawStationName])[0];
            const sampleAttr = rawLatestMap[rawStationName][firstParamKey];
            
            const cleanPermit = getCleanPermitNumber(sampleAttr.congtrinh);
            // 🟢 THAY ĐỔI: Lấy tên trạm thật từ API (`rawStationName`), đưa qua hàm làm sạch slug
            const cleanStationSlug = getCleanStationSlug(rawStationName);
            
            // Kết quả sinh mã mới dạng: monre_393_gieng_khoan_01 thay vì monre_393_gs01
            const mappedStationName = `${CONFIG.SOURCE}_${cleanPermit}_${cleanStationSlug}`;

            for (const paramName in rawLatestMap[rawStationName]) {
                const targetAttr = rawLatestMap[rawStationName][paramName];
                const standardParam = PARAMETER_MAP[targetAttr.chiso.toUpperCase().trim()];
                if (!standardParam) continue; 

                const parsedValue = normalizeMetricValue(targetAttr.giatri);
                if (parsedValue === null) continue;

                finalizedDataBatch.push({
                    stationId: mappedStationName, 
                    // Giữ lại tên gốc thô để làm display_name khi tạo trạm tự động
                    rawStationName: rawStationName.trim(), 
                    tagKey: standardParam,
                    dataTs: formatTimestampRounded(targetAttr.thoigiando), value: parsedValue
                });
            }
        }

        dbClient = await db.connect();
        const mappingRes = await dbClient.query(`SELECT source_logger_id, source_tag_key, target_station_id FROM logger_tag_mappings`);
        const mappings = mappingRes.rows;

        const upsertLatestQuery = `
            INSERT INTO logger_latest (logger_id, tag_key, data_ts, value, current_ts) 
            VALUES ($1, $2, $3::timestamptz, $4, $5::timestamptz) 
            ON CONFLICT (logger_id, tag_key) 
            DO UPDATE SET data_ts = EXCLUDED.data_ts, value = EXCLUDED.value, current_ts = EXCLUDED.current_ts;
        `;

        for (const record of finalizedDataBatch) {
            await dbClient.query(upsertLatestQuery, [record.stationId, record.tagKey, record.dataTs, record.value, currentFetchTs]);
            
            // 🟢 CẢI TIẾN: Điền thẳng tên gốc tiếng Việt thô (Ví dụ: "Giếng Khoan Số 01") vào trường display_name cho trực quan trên UI
            await dbClient.query(`
                INSERT INTO logger_stations (station_id, display_name, description) 
                VALUES ($1, $2, $3) 
                ON CONFLICT (station_id) DO NOTHING;
            `, [record.stationId, record.rawStationName, 'Khởi tạo tự động từ luồng API MONRE']);

            monreHistoryQueue.push({ logger_id: record.stationId, tag_key: record.tagKey, data_ts: record.dataTs });

            const targetMaps = mappings.filter(m => m.source_logger_id === record.stationId && m.source_tag_key === record.tagKey);
            for (const mapItem of targetMaps) {
                await dbClient.query(upsertLatestQuery, [mapItem.target_station_id, record.tagKey, record.dataTs, record.value, currentFetchTs]);
                await dbClient.query(`INSERT INTO logger_stations (station_id, display_name, description) VALUES ($1, $2, $3) ON CONFLICT (station_id) DO NOTHING;`, [mapItem.target_station_id, `Trạm ${mapItem.target_station_id}`, 'Khởi tạo tự động qua luồng ma trận']);
                
                monreHistoryQueue.push({ logger_id: mapItem.target_station_id, tag_key: record.tagKey, data_ts: record.dataTs });
            }
        }
        console.log(`📥 [MONRE][FETCH_SUCCESS] Cập nhật xong bảng tức thời. Gom ${finalizedDataBatch.length} dòng vào RAM Queue.`);
    } catch (error) {
        console.error('❌ [MONRE][FETCH_ERROR] Thất bại chu kỳ cào:', error.message);
    } finally {
        if (dbClient) dbClient.release();
    }
}

async function flushMonreHistory() {
    if (monreHistoryQueue.length === 0) return;
    const startLogTime = Date.now();
    const cachedItems = [...monreHistoryQueue]; monreHistoryQueue = [];
    const currentSaveTs = getCurrentSystemTimeRounded();

    console.log(`\n💾 [MONRE][READINGS] Đến chu kỳ lưu DB (${CONFIG.SAVE_DB_INTERVAL_SECONDS}s) -> Đang xả ${cachedItems.length} bản ghi lịch sử...`);
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
        console.log(`✅ [MONRE][READINGS_SUCCESS] Đã lưu hoàn tất +${cachedItems.length} dòng lịch sử MONRE. Thời gian: ${Date.now() - startLogTime}ms`);
    } catch (error) {
        if (dbClient) await dbClient.query("ROLLBACK");
        console.error("❌ [MONRE][READINGS_CRASH] Thất bại khi xả hàng đợi lịch sử:", error.message);
    } finally {
        if (dbClient) dbClient.release();
    }
}

setInterval(async () => { await fetchMonreData(); }, CONFIG.FETCH_INTERVAL_SECONDS * 1000);
setInterval(async () => { await flushMonreHistory(); }, CONFIG.SAVE_DB_INTERVAL_SECONDS * 1000);

module.exports = { fetchMonreData };