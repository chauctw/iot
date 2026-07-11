// test-scada.js
require("dotenv").config(); // Load biến môi trường từ file .env nếu có
const { fetchScadaData } = require("./services/fetchscada");

async function runTest() {
  console.log("=========================================");
  console.log("🚀 Bắt đầu kích hoạt chạy thử Fetch SCADA...");
  console.log("=========================================");
  
  try {
    // Chạy trực tiếp hàm cào dữ liệu và lưu bảng tạm thời logger_latest
    await fetchScadaData(); 
    
    console.log("\n🎉 Chạy hàm Fetch thành công!");
    console.log("👉 Vui lòng kiểm tra database Postgres của bạn tại bảng 'logger_latest':");
    console.log("   - Các dòng có tag_key là 'pH' phải có dạng số lẻ (ví dụ: 7.98)");
    console.log("   - Các dòng có tag_key là 'totalIndex' phải có dạng số nguyên (ví dụ: 929999)");
    
  } catch (error) {
    console.error("❌ Thử nghiệm thất bại với lỗi:", error.message);
  } finally {
    process.exit(0); // Thoát script test
  }
}

runTest();