# Legacy file-copy deployment is retired. This command is read-only.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
Write-Output 'Angular deployment preflight (read-only)'
Write-Output "Source: $sourceRoot"
Write-Output 'Production: D:\dialysis-app-angular | dialysis-server-angular | port 3000'
Write-Output 'Legacy Vue: D:\dialysis-app | dialysis-server | port 3001 (separate site)'
$required = @('src\index.js', 'dist\browser\index.html', 'package.json', 'package-lock.json', 'vendor\xlsx-0.20.3.tgz', 'ecosystem.config.cjs', '.nvmrc')
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $sourceRoot $_) -PathType Leaf) })
if ($missing.Count -gt 0) { throw ('Incomplete build/package: ' + ($missing -join ', ')) }
$nodeCommand = Get-Command node -ErrorAction Stop
$version = & $nodeCommand.Source --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v22\.') {
    throw 'Use the Node 22 version in .nvmrc and rebuild before deployment.'
}
Push-Location -LiteralPath $sourceRoot
try {
    $configCheck = @'
const c = require("./ecosystem.config.cjs").apps;
const a = c.find(x => x.name === "dialysis-server-angular");
if (c.length !== 1 || !a || a.cwd !== "D:\\dialysis-app-angular" || a.env.PORT !== 3000 || a.env.DB_PATH !== "D:\\dialysis-app-angular\\data\\dialysis.db" || a.env.STATIC_PATH !== "D:\\dialysis-app-angular\\dist\\browser" || a.instances !== 1 || a.exec_mode !== "fork") process.exit(1);
'@
    $configCheck | & $nodeCommand.Source --input-type=commonjs
    if ($LASTEXITCODE -ne 0) { throw 'Angular PM2 configuration mismatch.' }
} finally { Pop-Location }
Write-Output 'Required package files and configured target checks passed.'
Write-Output 'No service stopped, no files copied and no database changed.'
Write-Output 'Follow DEPLOYMENT.md for verification, backup and manual deployment.'
