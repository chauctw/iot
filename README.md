$h=@{"Content-Type"="application/json"};$b=@{station_id="gw_http_tram_test";display_name="Trạm Đẩy HTTP Gateway";timestamp="2026-07-01 19:45:00";metrics=@{level=4.52;flow=118.4;totalIndex=541200}} | ConvertTo-Json -Compress; Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/gateway/push" -Headers $h -Body $b | Format-List


node -e "const m = require('mqtt'); const c = m.connect('mqtt://14.225.252.85:1883'); c.on('connect', () => { const p = { station_id: 'gw_final_test', display_name: 'Trạm Kết Nối Chuẩn', timestamp: '2026-07-01 19:46:00', metrics: { level: 6.28, flow: 124.5 } }; c.publish('telemetry/push', JSON.stringify(p), { qos: 0 }, () => { console.log('🟢 [TEST] Da day du lieu qua Broker thanh cong!'); c.end(); }); });"


function Show-Tree {
    param(
        [string]$Path = ".",
        [string]$Indent = ""
    )

    Get-ChildItem $Path | Where-Object { $_.Name -ne "node_modules" } | ForEach-Object {
        Write-Output "$Indent|-- $($_.Name)"
        if ($_.PSIsContainer) {
            Show-Tree $_.FullName ($Indent + "|   ")
        }
    }
}

Show-Tree | Out-File structure.txt -Encoding utf8


TVA: 19 trạm
DHG: 05 trạm
TLI: 13 trạm
Tổng 37 trạm




http://localhost:3000/api/kpi/flow-summary?station_ids=tva_tb24,tva_tb25,tva_tb27&tag_key=flow&interval_mins=30
http://localhost:3000/api/kpi/volume-consumption?station_ids=mqtt_gtacvan,mqtt_g31b,mqtt_g30a&tag_key=totalIndex

+---------------------+----------------+--------------------+---------+----------+
| Historical ID       | Realtime ID    | Tên trạm           | Lat     | Lng      |
+---------------------+----------------+--------------------+---------+----------+
| monre_35_clnqt4     | scada_tb24     | CLNQT4 / CLN TB24  | 9.1805  | 105.1545 |
| monre_35_g1         | scada_tb1      | G1 / TRẠM BƠM 1    | 9.1770  | 105.1520 |
| monre_35_g12        | tva_tb12       | G12                | 9.1969  | 105.1602 |
| monre_35_g15        | mqtt_g15       | G15                | 9.1835  | 105.1526 |
| monre_35_g18        | mqtt_g18       | G18                | 9.1757  | 105.1705 |
| monre_35_g2         | tva_tb2        | G2                 | 9.2417  | 105.1345 |
| monre_35_g20        | tva_tb20       | G20                | 9.1527  | 105.1576 |
| monre_35_g22        | tva_tb22       | G22                | 9.1309  | 105.1351 |
| monre_35_g23        | tva_tb23       | G23                | 9.1197  | 105.1416 |
| monre_35_g24        | tva_tb24       | G24                | 9.1087  | 105.1368 |
| monre_35_g25        | tva_tb25       | G25                | 9.1008  | 105.1333 |
| monre_35_g27        | tva_tb27       | G27                | 9.0814  | 105.1327 |
| monre_35_g4         | tva_tb4        | G4                 | 9.2316  | 105.1580 |
| monre_35_qt3        | tva_qt3        | QT3                | 9.1788  | 105.1628 |
| monre_35_qt4        | mqtt_qt4       | QT4                | 9.1805* | 105.1545*|
| monre_35_qt5        | mqtt_qt5       | QT5                | 9.1786  | 105.1543 |
| monre_36_clngs4nm2  | scada_gs4nm2   | CLNGS4NM2          | 9.1801  | 105.1532 |
| monre_36_gs1nm2     | mqtt_gs1nm2    | GS1NM2             | 9.2051  | 105.1320 |
| monre_36_gs2nm2     | tva_gs2nm2     | GS2NM2             | 9.1734  | 105.2098 |
| monre_36_gs3nm2     | tva_gs3nm2     | GS3NM2             | 9.1733  | 105.2099 |
| monre_36_gs4nm2     | scada_gs4nm2   | GS4NM2             | 9.1801  | 105.1532 |
| monre_36_qt1nm2     | mqtt_qt1nm2    | QT1NM2             | 9.2057  | 105.1296 |
| monre_36_qt2nm2     | mqtt_qt2nm2    | QT2NM2             | 9.2033  | 105.1297 |
| monre_391_g21       | tva_tb21       | G21                | 9.1419  | 105.1386 |
| monre_391_g26       | tva_tb26       | G26                | 9.0930  | 105.1332 |
| monre_391_qt2m      | mqtt_qt2       | QT2M               | 9.1792  | 105.1394 |
| monre_393_clngs5nm1 | scada_gs5nm1   | CLNGS5NM1          | 9.1785  | 105.1535 |
| monre_393_gs1nm1    | tva_gs1nm1     | GS1NM1             | 9.2051  | 105.1331 |
| monre_393_gs2nm1    | mqtt_gs2nm1    | GS2NM1             | 9.1734  | 105.2098 |
| monre_393_gs3nm1    | tva_gs3nm1     | GS3NM1             | 9.2051  | 105.1320 |
| monre_393_gs4nm1    | scada_gs4nm1   | GS4NM1             | 9.1794  | 105.1528 |
| monre_393_gs5nm1    | scada_gs5nm1   | GS5NM1             | 9.1785  | 105.1535 |
| monre_393_qt1nm1    | tva_qt1nm1     | QT1NM1             | 9.1735  | 105.2098 |
| monre_393_qt2nm1    | tva_qt2nm1     | QT2NM1             | 9.2052  | 105.1331 |
+---------------------+----------------+--------------------+---------+----------+

Các trạm realtime không có dữ liệu lịch sử tương ứng:

+---------------+------------------+--------+----------+
| Realtime ID   | Tên trạm         | Lat    | Lng      |
+---------------+------------------+--------+----------+
| mqtt_g29a     | G29A             | 9.1465 | 105.1393 |
| mqtt_g30a     | G30A             | 9.1654 | 105.1570 |
| mqtt_g31b     | G31B             | 9.2064 | 105.1665 |
| mqtt_gtacvan  | GTACVAN          | 9.1634 | 105.2515 |
| tva_tb16      | TRẠM BƠM 16      | 9.1812 | 105.0882 |
+---------------+------------------+--------+----------+



16/28 trạm có chỉ số total index


fa-regular fa-clock



{
  "amino": "Amino",
  "flow": "Lưu lượng",
  "level": "Mực nước",
  "nh4": "Amoni",
  "nitrat": "Nitrat",
  "no3": "Nitrat",
  "ph": "Độ pH",
  "pH": "Độ pH",
  "tds": "TDS",
  "TDS": "TDS",
  "totalIndex": "TổngLL"
}


scada_tb24
scada_gs5nm1
scada_gs4nm2




FlyV1 fm2_lJPECAAAAAAAFf43xBDqEeyBjZshW+Ah2MqaHihQwrVodHRwczovL2FwaS5mbHkuaW8vdjGUAJLOABr/lR8Lk7lodHRwczovL2FwaS5mbHkuaW8vYWFhL3YxxDxKYM/AUTfjfTm35D7lYRjGPgPn+/PhVRHBIRjBLxq0y+1Cewen+Quu9iMkWNhJtNO2Fp2dZI4+LOTkUMrETnLlS3LgTXlLItlVvuAzNolu8k5Cezq6Ka1+exABTCKBSUBq6PxAIDIqQBy0wORhutGTPsQt2js+7LsS2AQlai5J2kLEtvnzwJ8ImbelNsQgbn+5qv1XkldT31LdQBMqivdcqhME/xg106NvsjJtmM4=,fm2_lJPETnLlS3LgTXlLItlVvuAzNolu8k5Cezq6Ka1+exABTCKBSUBq6PxAIDIqQBy0wORhutGTPsQt2js+7LsS2AQlai5J2kLEtvnzwJ8ImbelNsQQQRQIg2DfeNPJDaSnh6t5SMO5aHR0cHM6Ly9hcGkuZmx5LmlvL2FhYS92MZgEks5qTj4hzwAAAAEmRlw/F84AGdhpCpHOABnYaQzEEAIUA14wQAYHUEtzBC8qiDbEIHAU5kGm0wFNGPR3rJ5iEVfNjeEKImHxQVBaUQkxE4yp




-- 1. Tạo một dãy số tự động tăng (Sequence) mới cho bảng nếu chưa có
CREATE SEQUENCE IF NOT EXISTS alert_thresholds_id_seq;

-- 2. Ép cột "id" nhận giá trị tăng dần mặc định khi lệnh INSERT không truyền id vào
ALTER TABLE alert_thresholds 
ALTER COLUMN id SET DEFAULT nextval('alert_thresholds_id_seq');

-- 3. Đồng bộ lại giá trị hiện tại của dãy số trùng với số lớn nhất hiện tại trong bảng (tránh lỗi trùng id)
SELECT setval('alert_thresholds_id_seq', COALESCE(MAX(id), 1)) FROM alert_thresholds;