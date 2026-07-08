const axios = require('axios');

// Cấu hình thông tin từ user cung cấp
const HOST = "https://iot.ctn-cantho.com.vn";
const USERNAME = "admin@canthowassco.vn";
const PASSWORD = "Z]yPpa'%@er;YZ[M";
const DEVICE_ID = "0988ed70-0441-11f1-9a54-45e38461f27a";

async function main() {
    console.log("=== [START] Bắt đầu tiến trình lấy và chuyển đổi dữ liệu thành JSON ===");
    
    try {
        // --- BƯỚC 1: ĐĂNG NHẬP LẤY TOKEN ---
        const loginUrl = `${HOST}/api/auth/login`;
        console.log(`[LOG 1] Đang kết nối đến: ${loginUrl}`);
        
        const loginResponse = await axios.post(loginUrl, {
            username: USERNAME,
            password: PASSWORD
        });

        const token = loginResponse.data.token;
        console.log("[LOG 2] Đăng nhập thành công!");

        // --- BƯỚC 2: GỌI API LẤY DỮ LIỆU ---
        console.log("[LOG 3] Đang tải dữ liệu từ ThingsBoard...");
        const [attributesData, telemetryData] = await Promise.all([
            getDeviceAttributes(token),
            getDeviceTelemetry(token)
        ]);

        // --- BƯỚC 3: PHÂN TÍCH VÀ FORMAT SANG JSON KEY:VALUE ---
        const outputJson = {
            attributes: {},
            telemetry: {}
        };

        // Format phần Attributes
        if (attributesData) {
            for (const key in attributesData) {
                // ThingsBoard trả về mảng [{lastUpdateTs, value}], ta chỉ lấy value
                if (attributesData[key] && attributesData[key].length > 0) {
                    outputJson.attributes[key] = attributesData[key][0].value;
                }
            }
        }

        // Format phần Telemetry (Lấy giá trị mới nhất)
        if (telemetryData) {
            for (const key in telemetryData) {
                // ThingsBoard trả về mảng [{ts, value}], ta chỉ lấy value mới nhất
                if (telemetryData[key] && telemetryData[key].length > 0) {
                    outputJson.telemetry[key] = telemetryData[key][0].value;
                }
            }
        }

        // --- BƯỚC 4: IN KẾT QUẢ DẠNG JSON ---
        console.log("\n==================================================");
        console.log("📦 DỮ LIỆU THIẾT BỊ DẠNG JSON (KEY: VALUE)");
        console.log("==================================================");
        console.log(JSON.stringify(outputJson, null, 2));
        console.log("==================================================\n");

    } catch (error) {
        console.log("\n❌ === [LOG ERROR] Có lỗi xảy ra ===");
        if (error.response) {
            console.error(`- HTTP Status: ${error.response.status}`);
            console.error("- Chi tiết lỗi:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("- Lỗi hệ thống/Mạng:", error.message);
        }
    }
}

async function getDeviceAttributes(token) {
    const url = `${HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/attributes`;
    try {
        const res = await axios.get(url, { headers: { 'X-Authorization': `Bearer ${token}` } });
        return res.data;
    } catch (err) {
        console.error("❌ Lỗi tải Attributes:", err.message);
        return null;
    }
}

async function getDeviceTelemetry(token) {
    const url = `${HOST}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/values/timeseries?useStrictDataTypes=true`;
    try {
        const res = await axios.get(url, { headers: { 'X-Authorization': `Bearer ${token}` } });
        return res.data;
    } catch (err) {
        console.error("❌ Lỗi tải Telemetry:", err.message);
        return null;
    }
}

main();













 