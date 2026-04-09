# 透析排程系統 - 本地伺服器

這是透析排程系統的離線/本地版本後端伺服器，使用 SQLite 資料庫替代 Firebase Firestore。

## 🚀 快速開始

### 1. 安裝依賴
```bash
cd server
npm install
```

### 2. 初始化資料庫
```bash
npm run init-db
```
這會建立 SQLite 資料庫並建立預設管理員帳號：
- 使用者名稱: `admin`
- 密碼: `admin123`
- ⚠️ 請在首次登入後立即修改密碼！

### 3. 啟動伺服器
```bash
npm start
```
伺服器會在 `http://localhost:3000` 啟動

## 📦 從 Firebase 遷移資料

如果您有現有的 Firebase 資料：

1. 從 Firebase Console 匯出各集合的資料（JSON 格式）
2. 將 JSON 檔案放到 `server/migrations/data/` 目錄
   - `patients.json`
   - `schedules.json`
   - `base_schedules.json`
   - `users.json`
   - 等等...
3. 執行遷移：
```bash
npm run migrate
```

## 💾 資料備份

### 手動備份
```bash
npm run backup
```

### 自動備份
伺服器會每天午夜自動備份資料庫到 `server/backups/` 目錄

### 備份設定
- 自動備份保留 30 份
- 手動備份保留 10 份

## 📁 目錄結構

```
server/
├── src/
│   ├── db/           # 資料庫相關
│   │   ├── init.js   # 資料庫初始化
│   │   └── schema.sql # 資料表結構
│   ├── middleware/   # 中介軟體
│   │   └── auth.js   # 認證/授權
│   ├── routes/       # API 路由
│   │   ├── auth.js       # 認證 API
│   │   ├── patients.js   # 病人管理
│   │   ├── schedules.js  # 排程管理
│   │   ├── memos.js      # 備忘錄
│   │   ├── orders.js     # 醫囑/報告
│   │   ├── nursing.js    # 護理相關
│   │   └── system.js     # 系統功能
│   ├── utils/        # 工具函式
│   │   └── backup.js # 備份工具
│   └── index.js      # 伺服器入口
├── migrations/       # 資料遷移
│   ├── migrate.js    # 遷移腳本
│   └── data/         # 放置要遷移的 JSON 檔案
├── data/             # SQLite 資料庫檔案
├── backups/          # 資料庫備份
└── package.json
```

## 🔌 API 端點

### 認證
- `POST /api/auth/login` - 登入
- `POST /api/auth/logout` - 登出
- `GET /api/auth/me` - 取得當前使用者
- `POST /api/auth/change-password` - 修改密碼
- `GET /api/auth/users` - 取得使用者列表 (管理員)
- `POST /api/auth/users` - 建立使用者 (管理員)

### 病人
- `GET /api/patients` - 取得病人列表
- `GET /api/patients/with-rules` - 取得病人（含排班規則）
- `GET /api/patients/:id` - 取得單一病人
- `POST /api/patients` - 新增病人
- `PUT /api/patients/:id` - 更新病人
- `DELETE /api/patients/:id` - 刪除病人

### 排程
- `GET /api/schedules` - 取得排程列表
- `GET /api/schedules/:date` - 取得特定日期排程
- `PUT /api/schedules/:date` - 更新排程
- `GET /api/schedules/base/master` - 取得排班總表
- `PUT /api/schedules/base/master` - 更新排班總表

### 其他
詳見各路由檔案

## 🔐 權限說明

| 角色 | 權限層級 | 可執行操作 |
|------|---------|-----------|
| viewer | 1 | 檢視所有資料 |
| contributor | 2 | 新增/編輯病人、醫囑 |
| editor | 3 | 編輯排程、調班 |
| admin | 4 | 所有操作（含用戶管理）|

## 🌐 區域網路部署

要讓其他電腦連線：

1. 確保所有電腦在同一個區域網路
2. 啟動伺服器後，注意終端機顯示的區域網路 IP
3. 其他電腦用瀏覽器開啟 `http://[伺服器IP]:3000`

## ⚠️ 注意事項

- 資料庫檔案位於 `server/data/dialysis.db`
- 請定期備份此檔案
- 建議將 `data/` 和 `backups/` 目錄加入版本控制忽略
