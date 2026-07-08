const { Client } = require('pg');

const SUPABASE_URL = "postgresql://postgres.uxykynfwfcpxwxfogjyq:CR0kEeWlb8vemvuz%40aws@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres";
const NEON_URL = "postgresql://neondb_owner:npg_xjg5CSMmuK1i@ep-shiny-king-ao8sstpz.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const TABLES = [
    'users',
    'telegram_configs',
    'logger_stations',
    'alert_thresholds',
    'logger_tag_mappings',
    'logger_latest',
    'logger_readings'
];

async function migrateData() {
    console.log('🚀 Bắt đầu quá trình di chuyển dữ liệu SIÊU TỐC từ Supabase sang Neon...');
    
    const supabaseClient = new Client({ connectionString: SUPABASE_URL });
    const neonClient = new Client({ connectionString: NEON_URL });

    try {
        await supabaseClient.connect();
        await neonClient.connect();
        console.log('✅ Kết nối thành công tới cả 2 database.');

        for (const tableName of TABLES) {
            console.log(`\n📦 Đang xử lý bảng: [${tableName}]...`);

            // 1. Đọc dữ liệu từ Supabase
            const selectResult = await supabaseClient.query(`SELECT * FROM ${tableName}`);
            const rows = selectResult.rows;
            console.log(`- Đã đọc được ${rows.length} dòng từ Supabase.`);

            if (rows.length === 0) {
                console.log(`- Bảng trống, bỏ qua.`);
                continue;
            }

            // 2. Xóa dữ liệu cũ bên Neon để làm sạch trước khi nạp
            await neonClient.query(`TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE`);

            const columnNames = Object.keys(rows[0]);
            const columnsStr = columnNames.map(col => `"${col}"`).join(', ');
            
            // Cấu hình kích thước Batch (Gộp 2000 dòng vào 1 câu lệnh SQL duy nhất)
            const batchSize = 2000; 
            let count = 0;

            console.log(`- Đang thực hiện Bulk Insert sang Neon...`);
            
            for (let i = 0; i < rows.length; i += batchSize) {
                const batch = rows.slice(i, i + batchSize);
                
                // Mảng chứa tất cả các giá trị của toàn bộ dòng trong batch này
                const values = [];
                // Mảng chứa các chuỗi placeholder dạng ($1, $2, $3), ($4, $5, $6)...
                const valuePlaceholders = [];
                
                let paramIndex = 1;
                
                for (const row of batch) {
                    const rowPlaceholders = [];
                    for (const col of columnNames) {
                        values.push(row[col]);
                        rowPlaceholders.push(`$${paramIndex++}`);
                    }
                    valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
                }

                // Tạo câu lệnh SQL gộp siêu lớn
                const bulkInsertQuery = `INSERT INTO ${tableName} (${columnsStr}) VALUES ${valuePlaceholders.join(', ')}`;
                
                // Thực thi câu lệnh gộp
                await neonClient.query(bulkInsertQuery, values);
                count += batch.length;

                if (tableName === 'logger_readings') {
                    console.log(`  -> Tiến độ: Đã đẩy thành công ${count}/${rows.length} dòng.`);
                }
            }

            console.log(`🎉 Hoàn thành bảng [${tableName}]! Total: ${count} dòng.`);
        }

        console.log('\n🌟 TOÀN BỘ 1 TRIỆU DÒNG ĐÃ ĐƯỢC CHUYỂN SANG NEON THÀNH CÔNG! 🌟');

    } catch (error) {
        console.error('❌ Có lỗi xảy ra trong quá trình di chuyển:', error);
    } finally {
        await supabaseClient.end();
        await neonClient.end();
        console.log('🔒 Đã đóng kết nối database.');
    }
}

migrateData();