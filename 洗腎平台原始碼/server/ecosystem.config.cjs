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
        JWT_SECRET: 'your-jwt-secret-here',
        DB_PATH: 'C:\\dialysis-app\\data\\dialysis.db',
        BACKUP_DIR: 'C:\\dialysis-app\\data\\backups',
        STATIC_PATH: 'C:\\dialysis-app\\dist',
      },
      error_file: 'C:\\dialysis-app\\logs\\error.log',
      out_file: 'C:\\dialysis-app\\logs\\out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '500M',
      restart_delay: 5000,
      autorestart: true,
      watch: true,
    },
  ],
}
