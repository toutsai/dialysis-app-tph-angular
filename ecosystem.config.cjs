// 方案 B：與 tph 版（Vue）並排共存
// - 不同 PM2 name (dialysis-server-angular)
// - 不同 port (3001)
// - 不同安裝資料夾 (D:\dialysis-app-angular)
// - 不同 SQLite DB（避免兩個 backend 同時寫同一個 DB 撞 schema）
// 確認 angular 版穩定後再走方案 A 取代 tph 版
module.exports = {
  apps: [
    {
      name: 'dialysis-server-angular',
      script: './src/index.js',
      cwd: 'D:\\dialysis-app-angular',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        DB_PATH: 'D:\\dialysis-app-angular\\data\\dialysis.db',
        BACKUP_DIR: 'D:\\dialysis-app-angular\\data\\backups',
        STATIC_PATH: 'D:\\dialysis-app-angular\\dist\\browser',
        ALLOWED_ORIGINS: 'http://localhost:3001,http://192.168.x.x:3001',
        // JWT_SECRET 改從 .env 檔案載入，不要寫在這裡
      },
      // 使用 env_file 載入敏感資訊（如 JWT_SECRET）
      env_file: 'D:\\dialysis-app-angular\\.env',
      error_file: 'D:\\dialysis-app-angular\\logs\\error.log',
      out_file: 'D:\\dialysis-app-angular\\logs\\out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '500M',
      restart_delay: 5000,
      autorestart: true,
      // ⚠️ watch 設為 false — 避免複製檔案時觸發重啟導致 "Failed to fetch"
      // 如需重啟請手動執行 pm2 restart dialysis-server-angular
      watch: false,
    },
  ],
}
