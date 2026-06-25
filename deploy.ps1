# ============================================
# 透析系統部署腳本
# 用法: 右鍵 → 以 PowerShell 執行
# ============================================

$ErrorActionPreference = "Stop"
$TARGET = "D:\dialysis-app"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  透析排程系統 - 自動部署" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "來源: $SCRIPT_DIR"
Write-Host "目標: $TARGET"
Write-Host ""

# 確認目標目錄存在
if (-not (Test-Path $TARGET)) {
    Write-Host "[ERROR] 目標目錄不存在: $TARGET" -ForegroundColor Red
    Write-Host "請確認路徑是否正確" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    exit 1
}

# 確認來源有 src 目錄
if (-not (Test-Path "$SCRIPT_DIR\src")) {
    Write-Host "[ERROR] 找不到 src/ 目錄，請確認腳本放在 repo 根目錄" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    exit 1
}

# Step 1: 停止 PM2 伺服器
Write-Host "[1/4] 停止伺服器..." -ForegroundColor Yellow
try {
    pm2 stop dialysis-server 2>$null
    Write-Host "  OK - 伺服器已停止" -ForegroundColor Green
} catch {
    Write-Host "  SKIP - PM2 未執行或伺服器未啟動" -ForegroundColor Gray
}

# Step 2: 備份目前的 src (以防萬一)
$backupDir = "$TARGET\src_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
if (Test-Path "$TARGET\src") {
    Write-Host "[2/4] 備份目前的 src/ ..." -ForegroundColor Yellow
    Copy-Item -Path "$TARGET\src" -Destination $backupDir -Recurse
    Write-Host "  OK - 備份到 $backupDir" -ForegroundColor Green
} else {
    Write-Host "[2/4] 跳過備份 (目標沒有 src/)" -ForegroundColor Gray
}

# Step 3: 複製檔案
Write-Host "[3/4] 複製檔案..." -ForegroundColor Yellow

# 複製 src/ (核心程式碼)
Write-Host "  複製 src/ ..."
if (Test-Path "$TARGET\src") {
    Remove-Item -Path "$TARGET\src" -Recurse -Force
}
Copy-Item -Path "$SCRIPT_DIR\src" -Destination "$TARGET\src" -Recurse
Write-Host "    OK" -ForegroundColor Green

# 複製 dist/ (前端)
if (Test-Path "$SCRIPT_DIR\dist") {
    Write-Host "  複製 dist/ ..."
    if (Test-Path "$TARGET\dist") {
        Remove-Item -Path "$TARGET\dist" -Recurse -Force
    }
    Copy-Item -Path "$SCRIPT_DIR\dist" -Destination "$TARGET\dist" -Recurse
    Write-Host "    OK" -ForegroundColor Green
}

# 複製根目錄設定檔
$configFiles = @(
    "package.json",
    "package-lock.json",
    "ecosystem.config.cjs"
)

foreach ($file in $configFiles) {
    if (Test-Path "$SCRIPT_DIR\$file") {
        Write-Host "  複製 $file ..."
        Copy-Item -Path "$SCRIPT_DIR\$file" -Destination "$TARGET\$file" -Force
        Write-Host "    OK" -ForegroundColor Green
    }
}

# 不要覆蓋 .env (裡面有 JWT_SECRET 等機敏資訊)
if (-not (Test-Path "$TARGET\.env")) {
    if (Test-Path "$SCRIPT_DIR\.env.example") {
        Write-Host "  複製 .env.example -> .env ..."
        Copy-Item -Path "$SCRIPT_DIR\.env.example" -Destination "$TARGET\.env"
        Write-Host "    OK (請記得編輯 .env 設定 JWT_SECRET)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  .env 已存在，跳過 (不覆蓋機敏設定)" -ForegroundColor Gray
}

# Step 4: 驗證關鍵檔案
Write-Host "[4/4] 驗證檔案完整性..." -ForegroundColor Yellow

$requiredFiles = @(
    "src\index.js",
    "src\db\init.js",
    "src\db\schema.sql",
    "src\middleware\auth.js",
    "src\middleware\rateLimit.js",
    "src\middleware\validate.js",
    "src\routes\auth.js",
    "src\routes\patients.js",
    "src\routes\schedules.js",
    "src\routes\orders.js",
    "src\routes\medications.js",
    "src\routes\nursing.js",
    "src\routes\system.js",
    "src\routes\memos.js",
    "src\services\scheduler.js",
    "src\services\scheduleSync.js",
    "src\services\exceptionHandler.js",
    "src\services\kiditSync.js",
    "src\utils\backup.js",
    "src\utils\dateUtils.js",
    "src\utils\scheduleUtils.js",
    "ecosystem.config.cjs",
    "package.json"
)

$missing = @()
foreach ($file in $requiredFiles) {
    if (-not (Test-Path "$TARGET\$file")) {
        $missing += $file
    }
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "  [WARNING] 缺少以下檔案:" -ForegroundColor Red
    foreach ($m in $missing) {
        Write-Host "    - $m" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "請檢查來源是否完整" -ForegroundColor Red
} else {
    Write-Host "  OK - 全部 $($requiredFiles.Count) 個關鍵檔案都到位" -ForegroundColor Green
}

# 啟動伺服器
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  部署完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "請執行以下指令啟動伺服器:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  cd $TARGET" -ForegroundColor White
Write-Host "  pm2 delete dialysis-server" -ForegroundColor White
Write-Host "  pm2 start ecosystem.config.cjs" -ForegroundColor White
Write-Host "  pm2 logs dialysis-server --lines 20" -ForegroundColor White
Write-Host ""

$startNow = Read-Host "要現在啟動嗎? (Y/N)"
if ($startNow -eq "Y" -or $startNow -eq "y") {
    Write-Host ""
    Write-Host "重新啟動伺服器..." -ForegroundColor Yellow
    Set-Location $TARGET
    try {
        pm2 delete dialysis-server 2>$null
    } catch {}
    pm2 start ecosystem.config.cjs
    Start-Sleep -Seconds 3
    pm2 status
    Write-Host ""
    Write-Host "最近 log:" -ForegroundColor Yellow
    pm2 logs dialysis-server --lines 10 --nostream
}

Write-Host ""
Read-Host "按 Enter 結束"
