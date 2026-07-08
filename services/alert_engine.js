// services/alert_engine.js
"use strict";
const db = require('../config/db');
const axios = require('axios');

async function sendTelegramNotification(text) {
  try {
    const configRes = await db.query(`SELECT * FROM public.telegram_configs WHERE enabled = 1 LIMIT 1;`);
    if (configRes.rows.length === 0) return; 
    
    const config = configRes.rows[0];
    const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
    
    await axios.post(url, { chat_id: config.chat_id, text: text, parse_mode: 'HTML' });
  } catch (error) {
    console.error("❌ [ALERT_ENGINE] Lỗi gửi tín hiệu tới Telegram:", error.message);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildOfflineAlertMessage(alertStations, totalStations, timeoutMinutes) {
  const lines = alertStations.map((station, index) => {
    const parts = [`${index + 1}. <b>${station.name}</b>`];
    if (station.stationId) parts.push(`<code>${station.stationId}</code>`);
    parts.push(`- ${station.detail}`);
    return parts.join(' ');
  });

  return [
    `🔴 <b>CẢNH BÁO TRẠM OFFLINE</b>`,
    `📊 Offline: <b>${alertStations.length}</b>/<b>${totalStations}</b> trạm`,
    `⏱️ Ngưỡng mất kết nối: ${timeoutMinutes} phút`,    
    '',
    ...lines,
  ].join('\n');
}

function buildAllOnlineMessage(totalStations) {
  return [
    `🟢 <b>TOÀN BỘ CÁC TRẠM ĐANG ONLINE</b>`,
    `📊 Online: <b>${totalStations}</b>/<b>${totalStations}</b> trạm`,
  ].join('\n');
}

/**
 * 📡 TIẾN TRÌNH TỰ ĐỘNG QUÉT VÀ GỬI CẢNH BÁO MẤT KẾT NỐI (OFFLINE / ONLINE)
 * 🟢 ĐÃ ĐỒNG BỘ 100% THUẬT TOÁN KHOẢNG LỆCH (CURRENT_TS - DATA_TS) GIỐNG FRONTEND UI
 */
async function checkSystemOfflineAlert() {
  try {
    // 1. Đọc cấu hình dùng chung toàn cục
    const configRes = await db.query(`SELECT alert_interval_minutes, global_offline_timeout_mins, enabled FROM public.telegram_configs LIMIT 1;`);
    if (configRes.rows.length === 0 || configRes.rows[0].enabled === 0) {
      return; // Dừng tiến trình nếu hệ thống cảnh báo bị TẮT
    }
    
    const globalConfig = configRes.rows[0];
    const globalRepeatIntervalSecs = (globalConfig.alert_interval_minutes || 5) * 60; 
    const globalTimeoutMinutes = globalConfig.global_offline_timeout_mins || 5; 

    // 2. 🟢 SQL ĐỒNG BỘ TUYỆT ĐỐI: Gom nhóm mốc thời gian nhận tin (current_ts) và đo gốc (data_ts) từ logger_latest
    const queryStr = `
      WITH latest_metrics AS (
        SELECT 
          logger_id, 
          MAX(current_ts) as max_current_ts,
          MAX(data_ts) as max_data_ts
        FROM public.logger_latest
        GROUP BY logger_id
      )
      SELECT 
        s.station_id, 
        s.display_name, 
        s.last_known_status, 
        s.last_alerted_ts,
        l.max_current_ts,
        l.max_data_ts,
        CASE 
          WHEN l.max_current_ts IS NULL OR l.max_data_ts IS NULL THEN 999999
          ELSE EXTRACT(EPOCH FROM (l.max_current_ts - l.max_data_ts)) / 60
        END as delay_minutes
      FROM public.logger_stations s
      LEFT JOIN latest_metrics l ON s.station_id = l.logger_id;
    `;

    const checkedStations = await db.query(queryStr);
    const totalStations = checkedStations.rows.length;
    const offlineAlertStations = [];
    let offlineStationCount = 0;
    let stationsRecoveredFromOffline = 0;

    for (let station of checkedStations.rows) {
      const delayMinutes = station.delay_minutes !== null ? Math.floor(station.delay_minutes) : 999999;
      
      // So sánh trực tiếp số phút trễ truyền nhận thực tế với ngưỡng Timeout Sập Mạng chung
      const isCurrentlyOffline = (station.max_current_ts === null || station.max_data_ts === null || delayMinutes > globalTimeoutMinutes);

      const stationName = escapeHtml(station.display_name || `Trạm ${station.station_id}`);

      if (isCurrentlyOffline) {
        offlineStationCount += 1;
        const delayDetail = (station.max_current_ts === null || station.max_data_ts === null)
          ? 'Không có dữ liệu'
          : `Trễ ${delayMinutes} phút`;
        const isNewOffline = station.last_known_status !== 'OFFLINE';
        const lastAlerted = station.last_alerted_ts ? new Date(station.last_alerted_ts).getTime() : 0;
        const secondsSinceLastAlert = isNewOffline ? Number.MAX_SAFE_INTEGER : Math.floor((Date.now() - lastAlerted) / 1000);
        const shouldNotifyOffline = isNewOffline || secondsSinceLastAlert >= globalRepeatIntervalSecs;

        if (isNewOffline) {
          await db.query(`
            UPDATE public.logger_stations 
            SET last_known_status = 'OFFLINE', 
                status_changed_ts = NOW(), 
                last_alerted_ts = NOW() 
            WHERE station_id = $1;
          `, [station.station_id]);
        }

        if (shouldNotifyOffline) {
          offlineAlertStations.push({
            name: stationName,
            stationId: station.station_id,
            detail: delayDetail,
          });

          if (!isNewOffline) {
            await db.query(`UPDATE public.logger_stations SET last_alerted_ts = NOW() WHERE station_id = $1;`, [station.station_id]);
          }
        }
      } else {
        if (station.last_known_status === 'OFFLINE') {
          stationsRecoveredFromOffline += 1;
          await db.query(`
            UPDATE public.logger_stations 
            SET last_known_status = 'ONLINE', 
                status_changed_ts = NOW(), 
                last_alerted_ts = NOW() 
            WHERE station_id = $1;
          `, [station.station_id]);
        }
      }
    }

    if (offlineAlertStations.length > 0) {
      await sendTelegramNotification(buildOfflineAlertMessage(offlineAlertStations, totalStations, globalTimeoutMinutes));
    } else if (totalStations > 0 && stationsRecoveredFromOffline > 0 && offlineStationCount === 0) {
      await sendTelegramNotification(buildAllOnlineMessage(totalStations));
    }

  } catch (err) {
    console.error("❌ [ALERT_ENGINE] Lỗi tiến trình quét tự động:", err.message);
  }
}

module.exports = { checkSystemOfflineAlert };