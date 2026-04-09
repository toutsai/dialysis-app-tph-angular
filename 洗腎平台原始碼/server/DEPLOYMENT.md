# 透析系統生產環境部署指南

本文檔說明如何將透析排程系統後端伺服器部署到生產環境。

---

## 📋 部署前檢查清單

- [ ] 已設定所有必要的環境變數
- [ ] 已修改預設管理員密碼
- [ ] 已配置適當的 CORS 來源
- [ ] 資料庫已備份
- [ ] 防火牆已開放必要端口

---

## 🔧 環境變數配置

在生產環境中，必須設定以下環境變數：

### 必要變數

```bash
# JWT 密鑰（必須設定，至少 32 字元的隨機字串）
JWT_SECRET=your-super-secure-random-jwt-secret-key-minimum-32-chars

# 環境模式
NODE_ENV=production

# 伺服器端口
PORT=3000
```

### 可選變數

```bash
# 資料庫路徑（預設為 ./data/dialysis.db）
DB_PATH=/var/data/dialysis/dialysis.db

# 備份目錄
BACKUP_DIR=/var/data/dialysis/backups

# 靜態檔案路徑（前端 dist 目錄）
STATIC_PATH=/var/www/dialysis/dist

# 允許的 CORS 來源（逗號分隔）
ALLOWED_ORIGINS=https://dialysis.example.com,https://admin.example.com
```

---

## 📁 目錄結構

建議的生產環境目錄結構：

```
/var/dialysis/
├── app/                    # 應用程式碼
│   ├── server/             # 後端程式碼
│   └── dist/               # 前端靜態檔案
├── data/                   # 資料目錄
│   ├── dialysis.db         # SQLite 資料庫
│   └── backups/            # 備份目錄
├── logs/                   # 日誌目錄
└── .env                    # 環境變數檔案
```

---

## 🚀 部署步驟

### 1. 準備伺服器

```bash
# 安裝 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安裝 PM2（進程管理器）
sudo npm install -g pm2

# 建立應用目錄
sudo mkdir -p /var/dialysis/{app,data,logs}
sudo chown -R $USER:$USER /var/dialysis
```

### 2. 上傳應用程式

```bash
# 上傳程式碼到伺服器
scp -r ./server user@server:/var/dialysis/app/
scp -r ./dist user@server:/var/dialysis/app/

# 或使用 git
cd /var/dialysis/app
git clone https://your-repo-url.git .
```

### 3. 安裝相依套件

```bash
cd /var/dialysis/app/server
npm ci --production
```

### 4. 建立環境變數檔案

```bash
# 建立 .env 檔案
cat > /var/dialysis/.env << 'EOF'
NODE_ENV=production
PORT=3000
JWT_SECRET=$(openssl rand -hex 32)
DB_PATH=/var/dialysis/data/dialysis.db
BACKUP_DIR=/var/dialysis/data/backups
STATIC_PATH=/var/dialysis/app/dist
EOF

# 設定權限（僅擁有者可讀寫）
chmod 600 /var/dialysis/.env
```

### 5. 初始化資料庫

```bash
cd /var/dialysis/app/server

# 載入環境變數
export $(cat /var/dialysis/.env | xargs)

# 初始化資料庫
npm run init-db
```

### 6. 使用 PM2 啟動應用

建立 PM2 生態系統設定檔 `ecosystem.config.cjs`：

```javascript
module.exports = {
  apps: [
    {
      name: 'dialysis-server',
      script: './src/index.js',
      cwd: '/var/dialysis/app/server',
      instances: 1,
      exec_mode: 'fork',
      env_file: '/var/dialysis/.env',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/var/dialysis/logs/error.log',
      out_file: '/var/dialysis/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_memory_restart: '500M',
      restart_delay: 5000,
      autorestart: true,
      watch: false,
    },
  ],
}
```

啟動應用：

```bash
cd /var/dialysis/app/server
pm2 start ecosystem.config.cjs

# 設定開機自動啟動
pm2 startup
pm2 save
```

---

## 🔒 安全性配置

### Nginx 反向代理

建議使用 Nginx 作為反向代理並處理 HTTPS：

```nginx
# /etc/nginx/sites-available/dialysis
server {
    listen 80;
    server_name dialysis.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dialysis.example.com;

    # SSL 憑證
    ssl_certificate /etc/letsencrypt/live/dialysis.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dialysis.example.com/privkey.pem;

    # SSL 設定
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # 安全標頭
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 請求大小限制
    client_max_body_size 10M;

    # 代理設定
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # API 速率限制
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

在 `/etc/nginx/nginx.conf` 的 http 區塊加入速率限制：

```nginx
http {
    # ... 其他設定 ...

    # 速率限制區域
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
}
```

啟用設定：

```bash
sudo ln -s /etc/nginx/sites-available/dialysis /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 防火牆設定

```bash
# 只開放必要端口
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP (重導向到 HTTPS)
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

---

## 📊 監控與維護

### PM2 監控

```bash
# 查看應用狀態
pm2 status

# 查看日誌
pm2 logs dialysis-server

# 監控 CPU/記憶體
pm2 monit
```

### 手動備份

```bash
cd /var/dialysis/app/server
export $(cat /var/dialysis/.env | xargs)
npm run backup
```

### 還原備份

```bash
# 停止應用
pm2 stop dialysis-server

# 還原備份
cp /var/dialysis/data/backups/dialysis_manual_2024-01-01.db /var/dialysis/data/dialysis.db

# 重新啟動
pm2 start dialysis-server
```

### 定期維護

建議的 cron 任務：

```bash
# 編輯 crontab
crontab -e

# 每日額外備份到遠端（可選）
0 4 * * * /usr/local/bin/backup-to-remote.sh

# 每周清理舊日誌
0 5 * * 0 find /var/dialysis/logs -name "*.log" -mtime +30 -delete
```

---

## 🔄 更新應用

```bash
# 1. 備份資料庫
cd /var/dialysis/app/server
export $(cat /var/dialysis/.env | xargs)
npm run backup

# 2. 更新程式碼
git pull origin main
# 或上傳新檔案

# 3. 安裝新相依
npm ci --production

# 4. 執行資料庫遷移（如有）
npm run migrate

# 5. 重新載入應用（零停機）
pm2 reload dialysis-server
```

---

## 🐛 問題排查

### 常見問題

**1. 應用無法啟動**

```bash
# 檢查日誌
pm2 logs dialysis-server --lines 100

# 確認環境變數已載入
pm2 env 0
```

**2. 資料庫鎖定錯誤**

```bash
# 檢查是否有多個進程
lsof /var/dialysis/data/dialysis.db

# 如果有殭屍進程
kill -9 <PID>
```

**3. 記憶體不足**

```bash
# 檢查記憶體使用
pm2 monit

# 調整 PM2 記憶體限制
pm2 restart dialysis-server --max-memory-restart 300M
```

**4. Token 黑名單過大**

```bash
# 手動清理過期記錄
cd /var/dialysis/app/server
node -e "
const { cleanupExpiredBlacklist, cleanupExpiredSessions } = require('./src/middleware/auth.js');
cleanupExpiredBlacklist();
cleanupExpiredSessions();
console.log('清理完成');
"
```

---

## 🪟 Windows 部署指南

本節說明如何在 Windows Server 上部署透析系統。

### Windows 目錄結構

建議的 Windows 環境目錄結構：

```
C:\dialysis\
├── app\                    # 應用程式碼
│   ├── server\             # 後端程式碼
│   └── dist\               # 前端靜態檔案
├── data\                   # 資料目錄
│   ├── dialysis.db         # SQLite 資料庫
│   └── backups\            # 備份目錄
├── logs\                   # 日誌目錄
└── .env                    # 環境變數檔案
```

### Windows 部署步驟

#### 1. 安裝 Node.js

從官網下載並安裝 Node.js 20.x LTS：
https://nodejs.org/

或使用 winget：

```powershell
winget install OpenJS.NodeJS.LTS
```

驗證安裝：

```powershell
node --version
npm --version
```

#### 2. 安裝 PM2

```powershell
npm install -g pm2
npm install -g pm2-windows-startup
```

#### 3. 建立目錄結構

```powershell
# 建立應用目錄
New-Item -ItemType Directory -Force -Path C:\dialysis\app
New-Item -ItemType Directory -Force -Path C:\dialysis\data
New-Item -ItemType Directory -Force -Path C:\dialysis\data\backups
New-Item -ItemType Directory -Force -Path C:\dialysis\logs

# 複製應用程式碼
Copy-Item -Recurse .\server C:\dialysis\app\
Copy-Item -Recurse .\dist C:\dialysis\app\
```

#### 4. 建立環境變數檔案

建立 `C:\dialysis\.env` 檔案：

```powershell
@"
NODE_ENV=production
PORT=3000
JWT_SECRET=your-super-secure-random-jwt-secret-key-minimum-32-chars
DB_PATH=C:\dialysis\data\dialysis.db
BACKUP_DIR=C:\dialysis\data\backups
STATIC_PATH=C:\dialysis\app\dist
"@ | Out-File -FilePath C:\dialysis\.env -Encoding UTF8
```

產生隨機 JWT_SECRET：

```powershell
# 產生 32 位元組的隨機密鑰
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
Write-Host "JWT_SECRET=$secret"
```

#### 5. 安裝相依套件

```powershell
cd C:\dialysis\app\server
npm ci --production
```

#### 6. 初始化資料庫

```powershell
cd C:\dialysis\app\server

# 載入環境變數
Get-Content C:\dialysis\.env | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}

# 初始化資料庫
npm run init-db
```

#### 7. 使用 PM2 啟動應用

建立 Windows 專用的 PM2 設定檔 `ecosystem.config.cjs`：

```javascript
module.exports = {
  apps: [
    {
      name: 'dialysis-server',
      script: './src/index.js',
      cwd: 'C:\\dialysis\\app\\server',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        JWT_SECRET: 'your-jwt-secret-here',
        DB_PATH: 'C:\\dialysis\\data\\dialysis.db',
        BACKUP_DIR: 'C:\\dialysis\\data\\backups',
        STATIC_PATH: 'C:\\dialysis\\app\\dist',
      },
      error_file: 'C:\\dialysis\\logs\\error.log',
      out_file: 'C:\\dialysis\\logs\\out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '500M',
      restart_delay: 5000,
      autorestart: true,
      watch: false,
    },
  ],
}
```

啟動應用：

```powershell
cd C:\dialysis\app\server
pm2 start ecosystem.config.cjs

# 查看狀態
pm2 status
```

#### 8. 設定開機自動啟動

方法一：使用 pm2-windows-startup

```powershell
pm2-startup install
pm2 save
```

方法二：使用 NSSM（推薦用於生產環境）

下載 NSSM：https://nssm.cc/download

```powershell
# 安裝為 Windows 服務
nssm install DialysisServer "C:\Program Files\nodejs\node.exe"
nssm set DialysisServer AppDirectory "C:\dialysis\app\server"
nssm set DialysisServer AppParameters "node_modules\pm2\bin\pm2-runtime start ecosystem.config.cjs"
nssm set DialysisServer DisplayName "Dialysis Scheduling System"
nssm set DialysisServer Description "透析排程系統後端服務"
nssm set DialysisServer Start SERVICE_AUTO_START
nssm set DialysisServer AppStdout "C:\dialysis\logs\service-out.log"
nssm set DialysisServer AppStderr "C:\dialysis\logs\service-error.log"

# 啟動服務
nssm start DialysisServer
```

### Windows 防火牆設定

```powershell
# 開放 3000 端口（內部使用）
New-NetFirewallRule -DisplayName "Dialysis Server" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow

# 如果使用 IIS 反向代理，開放 80 和 443
New-NetFirewallRule -DisplayName "HTTP" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
```

### IIS 反向代理設定（可選）

如果需要使用 IIS 作為反向代理（支援 HTTPS）：

#### 1. 安裝必要模組

```powershell
# 安裝 URL Rewrite 和 ARR
# 從以下網址下載安裝：
# URL Rewrite: https://www.iis.net/downloads/microsoft/url-rewrite
# ARR: https://www.iis.net/downloads/microsoft/application-request-routing
```

#### 2. 建立 web.config

在 `C:\inetpub\wwwroot\dialysis\` 建立 `web.config`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <system.webServer>
        <rewrite>
            <rules>
                <rule name="ReverseProxyInboundRule" stopProcessing="true">
                    <match url="(.*)" />
                    <action type="Rewrite" url="http://localhost:3000/{R:1}" />
                </rule>
            </rules>
        </rewrite>
        <security>
            <requestFiltering>
                <requestLimits maxAllowedContentLength="10485760" />
            </requestFiltering>
        </security>
    </system.webServer>
</configuration>
```

#### 3. 啟用 ARR Proxy

```powershell
# 在 IIS 管理員中啟用 proxy
# 或使用 appcmd
%windir%\system32\inetsrv\appcmd.exe set config -section:system.webServer/proxy /enabled:"True" /commit:apphost
```

### Windows 監控與維護

#### 查看服務狀態

```powershell
# PM2 狀態
pm2 status
pm2 logs dialysis-server

# 如果使用 NSSM
nssm status DialysisServer
```

#### 手動備份

```powershell
cd C:\dialysis\app\server

# 載入環境變數
Get-Content C:\dialysis\.env | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}

npm run backup
```

#### 還原備份

```powershell
# 停止服務
pm2 stop dialysis-server
# 或
nssm stop DialysisServer

# 還原備份
Copy-Item C:\dialysis\data\backups\dialysis_manual_2024-01-01.db C:\dialysis\data\dialysis.db -Force

# 重新啟動
pm2 start dialysis-server
# 或
nssm start DialysisServer
```

#### 設定排程任務（Windows Task Scheduler）

建立每日備份任務：

```powershell
# 建立備份腳本 C:\dialysis\scripts\backup.ps1
@"
Set-Location C:\dialysis\app\server
Get-Content C:\dialysis\.env | ForEach-Object {
    if (`$_ -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable(`$matches[1], `$matches[2], 'Process')
    }
}
npm run backup
"@ | Out-File -FilePath C:\dialysis\scripts\backup.ps1 -Encoding UTF8

# 建立排程任務（每日凌晨 4 點執行）
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-ExecutionPolicy Bypass -File C:\dialysis\scripts\backup.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 4:00AM
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "DialysisBackup" -Action $action -Trigger $trigger -Principal $principal -Description "每日備份透析系統資料庫"
```

### Windows 問題排查

**1. 服務無法啟動**

```powershell
# 檢查日誌
Get-Content C:\dialysis\logs\error.log -Tail 50

# 檢查端口是否被佔用
netstat -ano | findstr :3000

# 手動測試啟動
cd C:\dialysis\app\server
node src/index.js
```

**2. 權限問題**

```powershell
# 確保服務帳號有權限存取目錄
icacls C:\dialysis /grant "NT AUTHORITY\SYSTEM:(OI)(CI)F"
icacls C:\dialysis /grant "BUILTIN\Administrators:(OI)(CI)F"
```

**3. SQLite 鎖定錯誤**

```powershell
# 檢查檔案鎖定
$file = "C:\dialysis\data\dialysis.db"
$openHandles = Get-Process | ForEach-Object {
    $_.Modules | Where-Object { $_.FileName -eq $file }
}
$openHandles

# 重啟服務
nssm restart DialysisServer
```

**4. 手動清理過期 Token**

```powershell
cd C:\dialysis\app\server
node -e "import('./src/middleware/auth.js').then(m => { m.cleanupExpiredBlacklist(); m.cleanupExpiredSessions(); console.log('清理完成'); })"
```

---

## 📞 緊急聯絡

如遇到無法解決的問題，請聯絡系統管理員：

- Email: admin@example.com
- 電話: 02-1234-5678
