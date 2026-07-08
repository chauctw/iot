// clean_db.js
"use strict";

const db = require('./config/db');

async function initAndCleanDatabase() {
  console.log('====================================================================');
  console.log('🚀 Khởi động luồng dọn dẹp dữ liệu và tối ưu hóa PostgreSQL...');
  console.log('====================================================================');
  
  try {
    // 🟢 1. ÉP BUỘC ĐÓNG KẾT NỐI RÁC: Ngắt toàn bộ các ứng dụng khác đang truy cập vào bảng để tránh treo lệnh (Lock)
    console.log('🔒 Đang giải phóng các kết nối ngầm đang chiếm dụng bảng...');
    await db.query(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = current_database() AND pid <> pg_backend_pid();
    `).catch(() => {
      console.log('⚠️ Nhắc nhở: Không thể ngắt session khác (Có thể do thiếu quyền superuser), tiến hành chạy thẳng...');
    });
    // Thêm cột timeout nếu chưa có (Mặc định 300 giây = 5 phút)
    await db.query(`
      ALTER TABLE public.logger_stations 
      ADD COLUMN IF NOT EXISTS offline_timeout_secs INT DEFAULT 300;
    `);
    await db.query(`
      ALTER TABLE public.logger_stations 
      ADD COLUMN IF NOT EXISTS repeat_alert_interval_mins INT DEFAULT 30;
    `);

    // 🟢 2. XÓA SẠCH DỮ LIỆU TUYỆT ĐỐI
    console.log('🧹 Đang thực thi TRUNCATE làm sạch trắng toàn bộ dữ liệu...');
    await db.query(`
      TRUNCATE TABLE 
        public.logger_readings, 
        public.logger_latest, 
        public.logger_tag_mappings, 
        public.alert_thresholds, 
        public.logger_stations 
      RESTART IDENTITY CASCADE;
    `);
    console.log('✨ Đã xóa trắng dữ liệu và reset bộ đếm ID về 1 thành công!');

    // 3. Tạo Chỉ mục hiệu năng cao (Composite Index)
    console.log('📊 Đang thiết lập các chỉ mục (Indexes) hiệu năng cao...');
    await db.query(`CREATE INDEX IF NOT EXISTS idx_readings_perf ON public.logger_readings (logger_id, tag_key, data_ts DESC);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_latest_perf ON public.logger_latest (logger_id, tag_key);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_mappings_perf ON public.logger_tag_mappings (target_station_id);`);
    console.log('⚡ Đã cấu trúc xong các chỉ mục tối ưu!');

    // 4. Bảo dưỡng ổ đĩa cứng
    console.log('🗜️ Đang chạy VACUUM ANALYZE thu hồi tài nguyên ổ đĩa...');
    await db.query('VACUUM ANALYZE public.logger_readings;');
    await db.query('VACUUM ANALYZE public.logger_latest;');
    
    console.log('\n✅ HOÀN THÀNH: Database đã trắng tinh khôi và tối ưu 100%!');
    
  } catch (error) {
    console.error('\n❌ Lỗi trong quá trình khởi tạo/dọn dẹp:', error.message);
  } finally {
    // 🟢 5. QUAN TRỌNG: Đóng Connection Pool của chính script này để giải phóng Terminal ngay lập tức
    if (db && typeof db.end === 'function') {
      await db.end();
    }
    process.exit(0);
  }
}

initAndCleanDatabase();