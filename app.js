// app.js
"use strict";
require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session'); // Quản lý phiên đăng nhập (session)
const app = express();

const stationRoutes = require('./routes/station.route');
const overviewRoutes = require('./routes/overview.route'); 
const alertRoutes = require('./routes/alert.route'); 
const kpiRoutes = require('./routes/kpi.route');
const userRoutes = require('./routes/user.route'); // Route Auth & CRUD User
const { handleHttpPush } = require('./gateways/http_gateway');
const { startMqttGatewayListener } = require('./gateways/mqtt_gateway');

// Tích hợp Alert Engine quản lý tự động quét lỗi mạng ngầm
const { checkSystemOfflineAlert } = require('./services/alert_engine');

// Các luồng fetch dữ liệu chu kỳ ngầm cũ
const { fetchMonreData } = require('./services/fetchmonre');
const { fetchScadaData } = require('./services/fetchscada');
const { fetchTVAData } = require('./services/fetchtva');
const { connectMQTT } = require('./services/fetchmqtt');

// ==========================================
// 🛡️ 1. CẤU HÌNH MIDDLEWARE CORE & SESSION
// ==========================================
app.use(express.json());

// BẬT TIN CẬY PROXY: Bắt buộc phải có khi chạy sau Reverse Proxy của Fly.io để nhận biết HTTPS
app.set('trust proxy', 1);

// Tự động kiểm tra xem ứng dụng đang chạy trên Production (Fly.io) hay Local bắng biến môi trường
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.FLY_APP_NAME;

app.use(session({
  secret: process.env.SESSION_SECRET || 'CAWACO_SECRET_KEY_KEYBOARD_CAT', 
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: isProduction, // Tự động bật true khi chạy HTTPS trên Fly.io, giữ false ở localhost để test ổn định
    httpOnly: true,       // Ngăn chặn XSS tấn công đánh cắp cookie định danh session
    maxAge: 24 * 60 * 60 * 1000 // Phiên đăng nhập tồn tại 1 ngày
  }
}));

// ==========================================
// 🔓 2. ĐĂNG KÝ CÁC ENDPOINT API CÔNG KHAI / AUTH
// ==========================================
app.post('/api/gateway/push', handleHttpPush);
app.use('/api/users', userRoutes); // Đăng ký API Route xử lý Login/Logout trước

// Định tuyến giao diện đăng nhập công khai (Không chặn)
app.get('/login', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'login.html');
  res.sendFile(filePath, (err) => {
    if (err) res.status(404).send("Hệ thống thiếu file login.html tại public/");
  });
});

// ==========================================
// 🔐 3. BẢO VỆ GIAO DIỆN CHÍNH & PHÂN QUYỀN TRANG CON
// ==========================================
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// Vô hiệu hóa index.html, trỏ mặc định hệ thống / về trang /layout
app.get('/', (req, res) => {
  res.redirect('/layout');
});

// Route layout chính bắt buộc phải qua bộ lọc kiểm tra đăng nhập
app.get('/layout', requireAuth, (req, res) => {
  const filePath = path.join(__dirname, 'public', 'layout.html');
  res.sendFile(filePath, (err) => {
    if (err) res.status(404).send("Hệ thống thiếu file layout.html tại public/");
  });
});

// Bộ lọc bảo vệ ngăn truy cập file tĩnh trực tiếp và phân quyền trang cấu hình hệ thống
app.use((req, res, next) => {
  // Chặn hoàn toàn việc cố tình gõ trực tiếp đuôi .html của layout chính hoặc index cũ
  if (req.path === '/layout.html' || req.path === '/index.html') {
    return res.redirect('/login');
  }

  // Phân quyền nghiêm ngặt các file trang con nằm trong thư mục /pages/
  if (req.path.startsWith('/pages/')) {
    // Nếu chưa đăng nhập, đá văng về màn hình login
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }

    // CHỈ CÓ ADMIN MỚI ĐƯỢC SYSTEM-CONFIG.HTML
    if (req.path === '/pages/system-config.html' && req.session.user.role !== 'Admin') {
      return res.status(430).send(`
        <div style="font-family:sans-serif; text-align:center; padding-top:50px; color:#dc2626;">
          <h2>⚠️ Từ chối truy cập!</h2>
          <p>Bạn không có quyền hạn Quản trị viên (Admin) để cấu hình phân hệ này.</p>
        </div>
      `);
    }
  }
  next();
});

app.use('/api/stations', requireAuth, stationRoutes);
app.use('/api/overview', requireAuth, overviewRoutes); 
app.use('/api/alerts', requireAuth, alertRoutes); 
app.use('/api/kpi', requireAuth, kpiRoutes);

// ==========================================
// 📁 4. CẤU HÌNH THƯ MỤC TĨNH (STATIC FILES)
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ==========================================
// ⚠️ 5. BẪY LỖI TOÀN CỤC (GLOBAL ERROR HANDLING)
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [PROCESS] Phát hiện lời hứa (Promise) chưa được xử lý lỗi:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('❌ [PROCESS] Phát hiện lỗi nghiêm trọng chưa được bắt:', error.message);
});


// 📡 1. Kích hoạt nhận dữ liệu qua cổng TCP 1885 độc lập (Mới)
try {
  startMqttGatewayListener();
} catch (err) {
  console.error("❌ [GATEWAY] Lỗi khởi động MQTT TCP Gateway mới:", err.message);
}
// 🔄 2. Khởi động các luồng fetch cào quét dữ liệu cũ của bạn
try { 
  connectMQTT(); 
} catch (err) {
  console.error("❌ [FETCH] Lỗi kết nối luồng MQTT Fetch cũ:", err.message);
}  
fetchMonreData().catch(err => console.error("❌ [FETCH] Lỗi chu kỳ mồi MONRE:", err.message)); 
fetchScadaData().catch(err => console.error("❌ [FETCH] Lỗi chu kỳ mồi SCADA:", err.message)); 
fetchTVAData().catch(err => console.error("❌ [FETCH] Lỗi chu kỳ mồi TVA:", err.message)); 

// ==========================================
// 🚀 6. KHỞI CHẠY SERVER & WORKERS
// ==========================================
const PORT = process.env.PORT || 3000; 
app.listen(PORT, () => {
  console.log(`====================================================================`);
  console.log(`🚀 API SERVER CHẠY TẠI PORT: http://localhost:${PORT}`);
  console.log(`Múi Giờ Cấu Hình Hệ Thống: ${process.env.TZ || 'Asia/Ho_Chi_Minh'}`); 
  console.log(`====================================================================\n`);

  console.log("📟 [WORKER] Tiến trình giám sát Cảnh báo ngầm Telegram đã khởi động thành công!");
  checkSystemOfflineAlert().catch(err => console.error("❌ [WORKER] Lỗi khởi động quét mồi Telegram:", err.message));

  setInterval(async () => {
    try {
      await checkSystemOfflineAlert();
    } catch (err) {
      console.error("❌ [WORKER] Lỗi trong chu kỳ quét cảnh báo Telegram ngầm:", err.message);
    }
  }, 60000); 
});