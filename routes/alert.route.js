// routes/alert.route.js
"use strict";

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const axios = require('axios'); // 🟢 KHẮC PHỤC LỖI: Bắt buộc phải thêm dòng này để kích hoạt thư viện axios gửi tin sang Telegram

// 1. API lấy cấu hình Telegram
router.get('/config', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.telegram_configs ORDER BY id DESC LIMIT 1;');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. API cập nhật cấu hình trạng thái, chu kỳ lặp và Timeout Sập Mạng chung
router.post('/config', async (req, res) => {
  const { bot_token, chat_id, alert_interval_minutes, global_offline_timeout_mins, enabled } = req.body;
  const intervalMins = parseInt(alert_interval_minutes, 10) || 30;
  const timeoutMins = parseInt(global_offline_timeout_mins, 10) || 5;
  const isEnabled = parseInt(enabled) === 0 ? 0 : 1;

  try {
    const checkExist = await db.query('SELECT id FROM public.telegram_configs LIMIT 1;');
    
    if (checkExist.rows.length === 0) {
      await db.query(
        `INSERT INTO public.telegram_configs (bot_token, chat_id, alert_interval_minutes, global_offline_timeout_mins, enabled) VALUES ($1, $2, $3, $4, $5);`,
        [bot_token, chat_id, intervalMins, timeoutMins, isEnabled]
      );
    } else {
      await db.query(
        `UPDATE public.telegram_configs 
         SET bot_token = $1, chat_id = $2, alert_interval_minutes = $3, global_offline_timeout_mins = $4, enabled = $5 
         WHERE id = (SELECT id FROM public.telegram_configs LIMIT 1);`,
        [bot_token, chat_id, intervalMins, timeoutMins, isEnabled]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ LỖI POST /config:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. API Test kết nối gửi tin nhắn thử nghiệm (ĐÃ THAY ĐỔI SANG CHẾ ĐỘ HTML AN TOÀN TUYỆT ĐỐI)
router.post('/test-connection', async (req, res) => {
  const { bot_token, chat_id } = req.body;

  if (!bot_token || bot_token.trim() === "" || !chat_id || chat_id.trim() === "") {
    return res.status(400).json({ success: false, error: "Bot Token hoặc Chat ID không được bỏ trống!" });
  }

  try {
    const url = `https://api.telegram.org/bot${bot_token.trim()}/sendMessage`;
    const message = `🔔 <b>KẾT NỐI THÀNH CÔNG</b>\n🤖 Đây là tin nhắn thử nghiệm từ hệ thống <b>Giám Sát IoT Scada</b>.\n✅ Cấu hình kết nối API Telegram Bot hoạt động hoàn hảo!`;
    
    // Gửi HTTP Request tới Telegram bằng thư viện axios đã require ở đầu trang
    const response = await axios.post(url, { 
      chat_id: chat_id.trim(), 
      text: message, 
      parse_mode: 'HTML' // Đổi sang HTML để tránh bị vỡ các ký tự đặc biệt của Markdown
    });

    if (response.data && response.data.ok) {
      return res.status(200).json({ success: true });
    } else {
      return res.status(400).json({ success: false, error: "Telegram API từ chối xử lý yêu cầu." });
    }
  } catch (err) {
    console.error("❌ [API ERROR][TEST-CONNECTION]:");
    
    let detailedError = err.message;
    // Bóc tách chi tiết nguyên nhân lỗi sâu từ phản hồi của máy chủ Telegram
    if (err.response && err.response.data && err.response.data.description) {
      detailedError = err.response.data.description;
      console.error("➡️ Phản hồi chi tiết lỗi từ Telegram Server:", err.response.data);
    }

    return res.status(400).json({ success: false, error: detailedError });
  }
});

module.exports = router;