"use strict";
const axios = require('axios');
const db = require('../config/db');

async function sendTelegramMessage(text) {
  try {
    // 1. Lấy cấu hình hoạt động từ DB
    const configRes = await db.query(`SELECT * FROM public.alert_telegram_config WHERE is_active = 1 LIMIT 1;`);
    if (configRes.rows.length === 0) return;
    
    const config = configRes.rows[0];
    const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
    
    // 2. Gửi request tới Telegram API dưới dạng Markdown để định dạng chữ đậm/nhạt
    await axios.post(url, {
      chat_id: config.chat_id,
      text: text,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error("❌ [TELEGRAM_GW] Lỗi bắn tin nhắn Telegram:", error.message);
  }
}

module.exports = { sendTelegramMessage };