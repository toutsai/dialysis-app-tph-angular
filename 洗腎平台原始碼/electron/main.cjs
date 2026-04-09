/**
 * Electron 主程式
 * 負責啟動應用程式視窗和後端伺服器
 * 包含自動更新功能
 */

const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron')
const path = require('path')
const { spawn, fork } = require('child_process')
const fs = require('fs')

// 保持對視窗的引用，避免被垃圾回收
let mainWindow = null
let serverProcess = null

// 判斷是否為開發模式
const isDev = !app.isPackaged

// 自動更新模組 (僅在生產環境載入)
let autoUpdater = null
if (!isDev) {
  try {
    autoUpdater = require('electron-updater').autoUpdater

    // 配置自動更新
    autoUpdater.autoDownload = false // 不自動下載，讓使用者確認
    autoUpdater.autoInstallOnAppQuit = true // 退出時自動安裝

    // 設定更新來源 (可從設定檔覆寫)
    const updateConfigPath = path.join(app.getPath('userData'), 'update-config.json')
    if (fs.existsSync(updateConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(updateConfigPath, 'utf-8'))
        if (config.updateUrl) {
          autoUpdater.setFeedURL({
            provider: 'generic',
            url: config.updateUrl,
          })
          console.log('[AutoUpdater] 使用自訂更新來源:', config.updateUrl)
        }
      } catch (e) {
        console.error('[AutoUpdater] 讀取更新設定失敗:', e)
      }
    }
  } catch (e) {
    console.error('[AutoUpdater] 載入 electron-updater 失敗:', e)
  }
}

// 取得資源路徑
// 打包後所有檔案都在 app 目錄下，所以不管開發或生產環境
// 都使用相對於 electron/main.cjs 的路徑
function getResourcePath(...segments) {
  return path.join(__dirname, '..', ...segments)
}

// 取得使用者資料路徑（用於存放資料庫）
function getUserDataPath(...segments) {
  return path.join(app.getPath('userData'), ...segments)
}

// 確保資料目錄存在
function ensureDataDirectory() {
  const dataDir = getUserDataPath('data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}

// 啟動後端伺服器
function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = getResourcePath('server', 'src', 'index.js')
    const dataDir = ensureDataDirectory()

    console.log('啟動伺服器...', serverPath)
    console.log('資料目錄:', dataDir)

    // 檢查伺服器檔案是否存在
    if (!fs.existsSync(serverPath)) {
      const error = new Error(`找不到伺服器檔案: ${serverPath}`)
      console.error(error.message)
      reject(error)
      return
    }

    // 設定環境變數
    // 打包後 dist 目錄在 app 目錄下（與 electron/main.cjs 同層）
    const staticPath = isDev
      ? path.join(__dirname, '..', 'dist')
      : path.join(__dirname, '..', 'dist')

    const env = {
      ...process.env,
      NODE_ENV: 'production',
      DB_PATH: path.join(dataDir, 'dialysis.db'),
      STATIC_PATH: staticPath,
      PORT: '3000',
    }

    // 使用 fork 啟動伺服器
    serverProcess = fork(serverPath, [], {
      env,
      cwd: getResourcePath('server'),
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    })

    serverProcess.stdout.on('data', (data) => {
      console.log(`[Server] ${data}`)
    })

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server Error] ${data}`)
    })

    serverProcess.on('error', (err) => {
      console.error('伺服器啟動失敗:', err)
      reject(err)
    })

    serverProcess.on('exit', (code, signal) => {
      console.log(`[Server] 伺服器結束，代碼: ${code}, 信號: ${signal}`)
      if (code !== 0 && code !== null) {
        console.error(`伺服器異常退出，代碼: ${code}`)
        // 如果伺服器在啟動階段就退出，立即拒絕
        if (attempts === 0) {
          reject(new Error(`伺服器啟動失敗，退出代碼: ${code}`))
        }
      }
    })

    // 等待伺服器啟動 - 使用健康檢查
    const http = require('http')
    let attempts = 0
    const maxAttempts = 60 // 最多等待 60 秒 (首次啟動可能需要較長時間初始化資料庫)

    const checkServer = () => {
      attempts++
      console.log(`[Server] 檢查伺服器狀態... (${attempts}/${maxAttempts})`)

      const req = http.get('http://localhost:3000/api/system/health', (res) => {
        if (res.statusCode === 200) {
          console.log('[Server] 伺服器已就緒')
          resolve()
        } else {
          retryOrFail()
        }
      })

      req.on('error', () => {
        retryOrFail()
      })

      req.setTimeout(1000, () => {
        req.destroy()
        retryOrFail()
      })
    }

    const retryOrFail = () => {
      if (attempts >= maxAttempts) {
        reject(new Error('伺服器啟動逾時'))
      } else {
        setTimeout(checkServer, 1000)
      }
    }

    // 給伺服器一點時間初始化後再開始檢查
    setTimeout(checkServer, 2000)
  })
}

// 停止後端伺服器
function stopServer() {
  if (serverProcess) {
    console.log('停止伺服器...')
    serverProcess.kill()
    serverProcess = null
  }
}

// ========================================
// 自動更新功能
// ========================================

/**
 * 設定自動更新事件處理
 */
function setupAutoUpdater() {
  if (!autoUpdater || isDev) return

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] 正在檢查更新...')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] 發現新版本:', info.version)
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: '發現新版本',
        message: `發現新版本 ${info.version}`,
        detail: `目前版本: ${app.getVersion()}\n新版本: ${info.version}\n\n是否要下載並安裝更新？`,
        buttons: ['立即更新', '稍後提醒'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate()
        }
      })
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] 目前已是最新版本')
  })

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] 更新錯誤:', err)
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent)
    console.log(`[AutoUpdater] 下載進度: ${percent}%`)
    if (mainWindow) {
      mainWindow.setProgressBar(progress.percent / 100)
      mainWindow.setTitle(`透析排程管理系統 - 下載更新中 ${percent}%`)
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] 更新已下載完成')
    if (mainWindow) {
      mainWindow.setProgressBar(-1)
      mainWindow.setTitle('透析排程管理系統')
    }

    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: '更新已準備就緒',
        message: '更新已下載完成',
        detail: `新版本 ${info.version} 已下載完成。\n\n是否立即重新啟動以套用更新？`,
        buttons: ['立即重啟', '稍後重啟'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall(false, true)
        }
      })
  })
}

/**
 * 檢查更新
 * @param {boolean} showNoUpdateDialog - 是否顯示「已是最新版本」對話框
 */
function checkForUpdates(showNoUpdateDialog = false) {
  if (!autoUpdater) {
    if (isDev) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '開發模式',
        message: '開發模式不支援自動更新',
        detail: '請在打包後的應用程式中使用此功能。',
      })
    } else {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '無法檢查更新',
        message: '自動更新功能未正確載入',
        detail: '請檢查 electron-updater 是否已正確安裝。',
      })
    }
    return
  }

  // 如果需要顯示「無更新」對話框，先設定一次性監聽器
  if (showNoUpdateDialog) {
    autoUpdater.once('update-not-available', () => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '已是最新版本',
        message: '目前已是最新版本',
        detail: `目前版本: ${app.getVersion()}`,
      })
    })

    autoUpdater.once('error', (err) => {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: '檢查更新失敗',
        message: '無法檢查更新',
        detail: `錯誤: ${err.message}\n\n請檢查更新來源設定是否正確。`,
      })
    })
  }

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[AutoUpdater] 檢查更新失敗:', err)
  })
}

/**
 * 設定更新來源
 */
async function configureUpdateSource() {
  const updateConfigPath = path.join(app.getPath('userData'), 'update-config.json')

  // 讀取現有設定
  let currentUrl = ''
  if (fs.existsSync(updateConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(updateConfigPath, 'utf-8'))
      currentUrl = config.updateUrl || ''
    } catch (e) {
      // 忽略錯誤
    }
  }

  // 顯示選項對話框
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '設定更新來源',
    message: '請選擇更新來源類型',
    detail: currentUrl ? `目前設定: ${currentUrl}` : '尚未設定更新來源',
    buttons: ['本地資料夾', '網路路徑 (HTTP)', '取消'],
    defaultId: 0,
  })

  if (response === 2) return // 取消

  let newUrl = ''

  if (response === 0) {
    // 選擇本地資料夾
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '選擇更新檔案資料夾',
      properties: ['openDirectory'],
      message: '請選擇放置更新檔案的資料夾 (包含 latest.yml 和安裝檔)',
    })

    if (!result.canceled && result.filePaths.length > 0) {
      newUrl = `file:///${result.filePaths[0].replace(/\\/g, '/')}`
    }
  } else if (response === 1) {
    // 輸入網路路徑
    // 使用簡單的提示對話框
    const { response: inputResponse } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '輸入更新伺服器網址',
      message: '請輸入更新伺服器的 HTTP 網址',
      detail:
        '例如: http://192.168.1.100/updates\n或: http://your-server.com/dialysis-updates\n\n請確保該路徑包含 latest.yml 和安裝檔案。',
      buttons: ['確定 (使用剪貼簿)', '取消'],
    })

    if (inputResponse === 0) {
      // 從剪貼簿讀取
      const { clipboard } = require('electron')
      newUrl = clipboard.readText().trim()

      if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: '無效的網址',
          message: '請輸入有效的 HTTP/HTTPS 網址',
          detail: '請先將網址複製到剪貼簿，然後再次嘗試。',
        })
        return
      }
    }
  }

  if (newUrl) {
    // 儲存設定
    fs.writeFileSync(updateConfigPath, JSON.stringify({ updateUrl: newUrl }, null, 2))

    // 更新 autoUpdater
    if (autoUpdater) {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: newUrl,
      })
    }

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '設定已儲存',
      message: '更新來源已設定完成',
      detail: `新的更新來源: ${newUrl}\n\n您可以點選「檢查更新」來測試設定。`,
    })
  }
}

// 建立主視窗
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: '透析排程管理系統',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false, // 先隱藏，載入完成後再顯示
  })

  // 處理載入失敗
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`頁面載入失敗: ${errorDescription} (${errorCode}) - ${validatedURL}`)

    // 顯示錯誤頁面
    mainWindow.loadURL(`data:text/html;charset=utf-8,
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>載入失敗</title>
        <style>
          body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
          .error-box { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
          h1 { color: #e74c3c; }
          p { color: #666; }
          button { margin-top: 20px; padding: 12px 24px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; }
          button:hover { background: #2980b9; }
          .details { margin-top: 20px; padding: 15px; background: #f8f8f8; border-radius: 6px; text-align: left; font-size: 12px; color: #888; }
        </style>
      </head>
      <body>
        <div class="error-box">
          <h1>⚠️ 載入失敗</h1>
          <p>無法連線到本地伺服器</p>
          <p>請稍後再試，或重新啟動應用程式</p>
          <button onclick="location.reload()">重新載入</button>
          <div class="details">
            <strong>錯誤代碼:</strong> ${errorCode}<br>
            <strong>錯誤訊息:</strong> ${errorDescription}<br>
            <strong>網址:</strong> ${validatedURL}
          </div>
        </div>
      </body>
      </html>
    `)
  })

  // 載入應用程式
  const loadApp = () => {
    if (isDev) {
      // 開發模式：載入 Vite 開發伺服器
      mainWindow.loadURL('http://localhost:5173')
      mainWindow.webContents.openDevTools()
    } else {
      // 生產模式：載入本地伺服器
      mainWindow.loadURL('http://localhost:3000')
    }
  }

  loadApp()

  // 視窗準備好後顯示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 視窗關閉時清理
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 設定自動更新事件處理
  setupAutoUpdater()

  // 設定選單
  const menuTemplate = [
    {
      label: '檔案',
      submenu: [
        {
          label: '重新整理',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.reload(),
        },
        { type: 'separator' },
        {
          label: '開啟資料目錄',
          click: () => shell.openPath(getUserDataPath()),
        },
        { type: 'separator' },
        {
          label: '結束',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: '檢視',
      submenu: [
        {
          label: '放大',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            const zoomLevel = mainWindow.webContents.getZoomLevel()
            mainWindow.webContents.setZoomLevel(zoomLevel + 0.5)
          },
        },
        {
          label: '縮小',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            const zoomLevel = mainWindow.webContents.getZoomLevel()
            mainWindow.webContents.setZoomLevel(zoomLevel - 0.5)
          },
        },
        {
          label: '重設縮放',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow.webContents.setZoomLevel(0),
        },
        { type: 'separator' },
        {
          label: '全螢幕',
          accelerator: 'F11',
          click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen()),
        },
        { type: 'separator' },
        {
          label: '開發者工具',
          accelerator: 'F12',
          click: () => mainWindow.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: '說明',
      submenu: [
        {
          label: '檢查更新',
          click: () => checkForUpdates(true),
        },
        {
          label: '設定更新來源',
          click: () => configureUpdateSource(),
        },
        { type: 'separator' },
        {
          label: '關於',
          click: () => {
            const version = app.getVersion()
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '關於',
              message: '透析排程管理系統',
              detail: `版本: ${version}\n\n透析排程管理系統\n\n資料目錄: ${getUserDataPath()}`,
            })
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(menuTemplate)
  Menu.setApplicationMenu(menu)
}

// 應用程式準備就緒
app.whenReady().then(async () => {
  try {
    // 啟動伺服器
    await startServer()

    // 建立視窗
    createWindow()

    // 啟動後靜默檢查更新 (延遲 5 秒，避免影響啟動速度)
    if (!isDev && autoUpdater) {
      setTimeout(() => {
        console.log('[AutoUpdater] 啟動背景更新檢查...')
        checkForUpdates(false)
      }, 5000)
    }
  } catch (error) {
    console.error('應用程式啟動失敗:', error)
    dialog.showErrorBox('啟動失敗', `無法啟動應用程式: ${error.message}`)
    app.quit()
  }
})

// 所有視窗關閉時
app.on('window-all-closed', () => {
  stopServer()
  app.quit()
})

// macOS 點擊 dock 圖示時
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// 應用程式退出前
app.on('before-quit', () => {
  stopServer()
})

// 處理未捕獲的錯誤
process.on('uncaughtException', (error) => {
  console.error('未捕獲的錯誤:', error)
  dialog.showErrorBox('錯誤', error.message)
})
