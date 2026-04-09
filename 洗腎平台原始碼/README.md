# 專案名稱: Dialysis App Standalone (透析系統網頁版)

這是一個基於 Vue 3 + Vite 構建的前端，搭配 Node.js Express 後端（使用 better-sqlite3 本地資料庫）的 Web 系統。
目前的運行架構為：將前端專案編譯打包為靜態網頁後，統一由後端伺服器 (Express) 來提供網頁服務及 API 接口。

## 📖 專案架構 (Project Structure)

專案主要分為以下與網頁服務相關的資料夾：

- **`src/`**：前端 (Vue 3) 應用程式原始碼。
- **`server/`**：後端 (Node.js Express) 應用程式原始碼、API 服務與資料庫。它會自動靜態伺服根目錄下的 `dist` 資料夾。
- **`public/`**：靜態資源與 PWA 相關設定。
- **`dist/`**：前端建置完成的發布檔案（執行 `npm run build` 後產生）。

> **💡 詳細說明請參閱 `project-structure.md`**：此檔案提供了專案內部目錄與各模組功能的完整對照。在編輯專案或新增檔案時，請同步更新該文件以保持資訊最新。

## 🛠️ 技術棧 (Tech Stack)

- **前端**：Vue 3, Vite, Pinia, Vue Router
- **後端**：Node.js, Express, better-sqlite3
- **輔助工具**：ESLint, Prettier

## 🚀 環境開發與建置設定 (Development & Build Setup)

在開始開發之前，請確保作業系統已安裝適合本專案的 [Node.js](https://nodejs.org/) 版本。

### 1. 安裝套件
首先安裝目錄的全域相依套件：
```sh
npm install
```

### 2. 初始化後端與資料庫
初次執行或資料庫結構有變時，切換到 `server` 資料夾安裝相依套件，並初始化資料庫與預設資料：
```sh
npm run server:init
```

### 3. 本地開發環境 (前端熱重載開發)
同時開啟前端 Vite 開發伺服器與本地後端 API：
```sh
npm run standalone
```

### 4. 產品應用編譯與正式啟動 (Production)
本系統正式執行的核心概念，是將網頁前台交由後端伺服器同時派發。

**步驟一：編譯前端資源**
```sh
npm run build
```
指令會編譯壓縮所有前端程式，並輸出至專案根目錄下的 `dist/` 目錄。

**步驟二：啟動後端伺服器**
```sh
npm run server:start
```
後端成功啟動後，會在終端機印出伺服器位址（例如 `http://localhost:3000`）。它會一併提供 API 存取與剛打包完成的前端網頁，您可以直接使用瀏覽器或透過區域網路共享來使用本系統。

## 🔧 代碼檢查與格式化工具

```sh
# 使用 ESLint 進行靜態程式碼檢查與修復
npm run lint

# 使用 Prettier 排版格式化前台程式
npm run format
```
