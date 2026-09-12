# SQLite 資料庫備份 (DB Backup)

## 資料庫位置

- **開發**: `data/dialysis.db`（相對於專案根目錄）
- **生產**: `D:\dialysis-app\data\dialysis.db`（由 `DB_PATH` 環境變數指定）
- **備份目錄**: `D:\dialysis-app\data\backups\`（由 `BACKUP_DIR` 環境變數指定）

## 備份方式

### 手動備份

```bash
npm run backup
# 等同於 node src/utils/backup.js
```

### 自動備份

由 `src/services/scheduler.js` 中的 node-cron 定時任務執行，自動備份並清理過期檔案。

備份歷史記錄在 `backup_history` 資料表中：
```sql
SELECT * FROM backup_history ORDER BY created_at DESC LIMIT 10;
```

### 直接複製備份（SQLite WAL mode 安全方式）

因為使用 WAL mode，備份時需要注意 WAL 檔案：

```bash
# 方法 1：使用 SQLite .backup 命令（推薦，保證一致性）
sqlite3 data/dialysis.db ".backup 'data/backups/dialysis-$(date +%Y%m%d-%H%M%S).db'"

# 方法 2：透過 better-sqlite3 的 backup API
node -e "
import Database from 'better-sqlite3';
const db = new Database('data/dialysis.db');
db.backup('data/backups/dialysis-backup.db');
db.close();
"

# 方法 3：先 checkpoint 再複製
sqlite3 data/dialysis.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp data/dialysis.db data/backups/dialysis-backup.db
```

## 還原

```bash
# 1. 停止伺服器
pm2 stop dialysis-server

# 2. 備份當前資料庫（以防萬一）
cp D:\dialysis-app\data\dialysis.db D:\dialysis-app\data\dialysis-before-restore.db

# 3. 還原備份
cp D:\dialysis-app\data\backups\<備份檔名>.db D:\dialysis-app\data\dialysis.db

# 4. 刪除 WAL/SHM 檔案（避免舊的 WAL 與新的 DB 不一致）
rm -f D:\dialysis-app\data\dialysis.db-wal D:\dialysis-app\data\dialysis.db-shm

# 5. 重啟伺服器
pm2 restart dialysis-server
```

## 注意事項

- SQLite 使用 WAL mode，備份時 `.db-wal` 和 `.db-shm` 檔案也是資料庫狀態的一部分
- 生產環境的 `data/` 目錄不在 Git 版控中
- 備份檔名通常帶時間戳，格式由 `backup.js` 決定
- `backup_history` 表記錄了每次備份的檔案路徑、大小和類型 (auto/manual)
