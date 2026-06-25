# 部署流程 (Deploy)

本專案部署在院內 Windows VM，使用 PM2 管理進程。

## 部署前檢查

1. 確認所有變更已 commit
2. 語法檢查：`node --check src/index.js`
3. 確認 `.env` 存在於部署目錄且 `JWT_SECRET` 已設定
4. 確認 `dist/` 前端產出是最新版本

## 部署步驟

### 1. 將檔案複製到部署目錄

部署目錄為 `D:\dialysis-app\`（非 Git repo），結構如下：

```
D:\dialysis-app\
  src/            # 後端原始碼
  dist/           # 前端預建置產出
  data/           # SQLite 資料庫 (dialysis.db) + backups/
  logs/           # PM2 日誌
  node_modules/   # 依賴
  package.json
  ecosystem.config.cjs
  .env            # JWT_SECRET 等敏感設定
```

需要複製的項目：
- `src/` 整個目錄
- `dist/` 整個目錄（如有前端更新）
- `package.json` + `package-lock.json`（如有依賴變更）
- `ecosystem.config.cjs`（如有 PM2 設定變更）

**不要複製**: `data/`、`.env`、`node_modules/`、`.git/`

### 2. 安裝/更新依賴（如有變更）

```bash
cd D:\dialysis-app
npm install --production
```

### 3. 執行資料庫遷移（如有 schema 變更）

```bash
cd D:\dialysis-app
node migrations/migrate.js
```

### 4. 重啟 PM2

```bash
pm2 restart dialysis-server
# 或首次啟動
pm2 start ecosystem.config.cjs
```

### 5. 驗證部署

```bash
# 健康檢查
curl -s http://localhost:3000/api/health

# 檢查 PM2 狀態
pm2 status
pm2 logs dialysis-server --lines 20
```

確認回應包含 `"status": "ok"`。

## 回滾

如果部署出問題：
1. 將備份的 `src/` 複製回去
2. `pm2 restart dialysis-server`
3. 檢查 `D:\dialysis-app\logs\error.log` 排查問題

## 環境變數 (ecosystem.config.cjs)

| 變數 | 說明 |
|------|------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DB_PATH` | `D:\dialysis-app\data\dialysis.db` |
| `BACKUP_DIR` | `D:\dialysis-app\data\backups` |
| `STATIC_PATH` | `D:\dialysis-app\dist` |
| `ALLOWED_ORIGINS` | CORS 白名單（逗號分隔） |
| `JWT_SECRET` | 從 `.env` 載入 |
