<#
.SYNOPSIS
  產生「可攜的乾淨原始碼包」(資料夾 + zip),自動排除醫院資料與機密檔,供跨機(到有 GitHub Desktop 的電腦)同步使用。

.DESCRIPTION
  只打包程式碼與設定/文件,排除:
    - data\        病人資料庫 + 備份/快照(醫院資料,絕不外傳)
    - .env         JWT 密鑰等機密
    - logs\ *.log  log 內含病人資訊
    - node_modules\ dist\ .angular\cache  依賴/建置/快取(目標機可重建)
    - _source_backups\ settings.local.json *.tsbuildinfo  舊快照/本機設定
  打包後會做安全稽核:若發現任何 .db / .env / .log 殘留,立即刪除產出並中止。

.PARAMETER OutputDir
  產出位置,預設為專案的「上一層」資料夾(避免包到自己)。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\make-portable.ps1
#>

param(
  [string]$OutputDir
)

$ErrorActionPreference = 'Stop'

# 專案根目錄 = 本腳本所在目錄
$src = $PSScriptRoot
if (-not $src) { $src = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $OutputDir) { $OutputDir = Split-Path -Parent $src }

$stamp   = Get-Date -Format 'yyyyMMdd_HHmmss'
$name    = "angular-sync-$stamp"
$staging = Join-Path $OutputDir $name
$zip     = Join-Path $OutputDir "$name.zip"

Write-Host "專案來源 : $src"
Write-Host "產出位置 : $OutputDir"
Write-Host "暫存資料夾: $staging`n"

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }

# --- 複製(排除敏感/衍生) ---
# /XD 用完整路徑只排頂層特定資料夾;用裸名(node_modules 等)排任何層級的同名資料夾
$excludeDirs  = @("$src\data", "$src\logs", "$src\dist", "$src\_source_backups", 'node_modules', '.angular', '.git')
$excludeFiles = @('.env', '*.db', '*.db-shm', '*.db-wal', '*.log', 'settings.local.json', '*.tsbuildinfo')

$roboArgs = @($src, $staging, '/E') + '/XD' + $excludeDirs + '/XF' + $excludeFiles +
            @('/NFL','/NDL','/NJH','/NP','/R:1','/W:1')
& robocopy @roboArgs | Out-Null
# robocopy: 0-7 = 成功,>=8 = 失敗
if ($LASTEXITCODE -ge 8) { throw "robocopy 失敗 (exit $LASTEXITCODE)" }

# --- 安全稽核:不得有任何病人資料/機密殘留 ---
$leak = Get-ChildItem $staging -Recurse -Force -Include *.db,*.db-shm,*.db-wal,.env,*.log -ErrorAction SilentlyContinue
if ($leak) {
  Write-Host "`n[!] 偵測到敏感檔殘留,已中止並清除產出:" -ForegroundColor Red
  $leak.FullName | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  throw '安全稽核失敗:打包中止。'
}

# --- 壓縮 ---
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$staging\*" -DestinationPath $zip -Force

$sizeMB = [math]::Round(((Get-ChildItem $staging -Recurse -Force | Measure-Object Length -Sum).Sum / 1MB), 1)
$zipMB  = [math]::Round((Get-Item $zip).Length / 1MB, 1)

Write-Host "`n[OK] 安全稽核通過:無任何 .db / .env / .log" -ForegroundColor Green
Write-Host "資料夾: $staging  ($sizeMB MB)"
Write-Host "壓縮檔: $zip  ($zipMB MB)"
Write-Host "`n到目標機:解壓後將內容『覆蓋疊入』現有專案資料夾(勿動目標機的 .git / data / .env),再用 GitHub Desktop 檢視並 commit。"
