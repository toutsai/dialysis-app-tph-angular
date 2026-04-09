<!-- 檔案路徑: src/App.vue (整合 Pinia 數據觸發邏輯後的新版本) -->
<template>
  <!--
    App.vue 保持簡潔，只包含 router-view。
    新增的 script setup 邏輯會在應用程式的生命週期早期，
    以非阻塞的方式觸發全局數據的獲取。
  -->
  <router-view />
</template>

<script setup>
import { onMounted, watch } from 'vue' // ✨ 新增 watch
import { usePatientStore } from '@/stores/patientStore' // ✨ 1. 引入 Patient Store
import { useAuth } from '@/composables/useAuth' // ✨ 2. 引入 useAuth 以監聽登入狀態

const patientStore = usePatientStore() // ✨ 3. 實例化 Store
const { isLoggedIn } = useAuth() // ✨ 4. 獲取 isLoggedIn 響應式狀態

// ✨ 5. 監聽登入狀態的變化
watch(
  isLoggedIn,
  (loggedIn) => {
    if (loggedIn) {
      // 如果使用者登入了，就觸發 Pinia Store 獲取病人數據。
      // Action 內部的 'hasFetched' 旗標會防止重複的 API 請求。
      console.log('[App.vue] User is logged in, triggering patient data fetch if needed.')
      patientStore.fetchPatientsIfNeeded()
    }
  },
  { immediate: true }, // immediate: true 確保應用程式載入時就會立即檢查一次登入狀態
)

// 下方的廣告攔截器檢測邏輯保持不變
function detectAdBlocker() {
  const testAd = document.createElement('div')
  testAd.innerHTML = '&nbsp;'
  testAd.className = 'adsbox'
  document.body.appendChild(testAd)

  window.setTimeout(() => {
    if (testAd.offsetHeight === 0) {
      console.warn('偵測到廣告攔截器，可能影響系統功能')
    }
    testAd.remove()
  }, 100)
}

// 在 onMounted 中執行檢測
onMounted(() => {
  detectAdBlocker()
})

// 錯誤處理邏輯也保持不變
try {
  // 這裡可以放置可能受廣告攔截器影響的 Firebase 初始化代碼
} catch (error) {
  if (error.message.includes('message channel closed')) {
    console.warn('連接被中斷，可能是廣告攔截器影響')
  }
}
</script>

<style>
/*
  全局樣式保持不變
*/

/* CSS 基礎重置 */
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: 'Segoe UI', 'Microsoft JhengHei', 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow: hidden; /* 防止 body 自身出現滾動條 */
}

/* 全局 CSS 變數，方便統一管理顏色 */
:root {
  --primary-color: #1abc9c;
  --primary-color-dark: #16a085;
  --secondary-color: #2c3e50;
  --success-color: #28a745;
  --info-color: #17a2b8;
  --warning-color: #ffc107;
  --danger-color: #dc3545;
  --light-gray: #f8f9fa;

  /* 應用程式中各種狀態的背景色 */
  --green-bg: #e8f5e9;
  --red-bg: #ffebee;
  --blue-bg: #e3f2fd;
  --orange-bg: #fff3e0;
  --grey-bg: #f5f5f5;
  --grey-text: #6c757d;
  --hepatitis-bg: #fffde7;
}

/* 一些通用的頁面佈局 class */
.page-container {
  padding: 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.page-title {
  font-size: 2rem;
  font-weight: 600;
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #343a40;
}
</style>
