module.exports = {
  apps: [
    {
      name: 'dialysis-server',
      script: './src/index.js',
      cwd: 'C:\\dialysis-app',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        DB_PATH: 'D:\\dialysis-app\\data\\dialysis.db',
        BACKUP_DIR: 'D:\\dialysis-app\\data\\backups',
        STATIC_PATH: 'D:\\dialysis-app\\dist',
        ALLOWED_ORIGINS: 'http://localhost:3000,http://192.168.x.x:3000',
        // JWT_SECRET 改從 .env 檔案載入，不要寫在這裡
      },
      // 使用 env_file 載入敏感資訊（如 JWT_SECRET）
      env_file: 'D:\\dialysis-app\\.env',
      error_file: 'D:\\dialysis-app\\logs\\error.log',
      out_file: 'D:\\dialysis-app\\logs\\out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '500M',
      restart_delay: 5000,
      autorestart: true,
      // ⚠️ watch 設為 false — 避免複製檔案時觸發重啟導致 "Failed to fetch"
      // 如需重啟請手動執行 pm2 restart dialysis-server
      watch: false,
    },
  ],
}
