<!-- 檔案路徑: src/views/LoginView.vue -->
<template>
  <div class="login-container">
    <div class="login-box">
      <h1 class="login-title">部北透析管理平台</h1>
      <!-- Session Timeout 提示訊息 -->
      <div v-if="isSessionTimeout" class="timeout-notice">
        <span class="timeout-icon">⏰</span>
        <p>由於長時間未操作，已自動登出。請重新登入。</p>
      </div>

      <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <label for="username">帳號</label>
          <input
            type="text"
            id="username"
            v-model="username"
            required
            autocomplete="username"
            placeholder="請輸入帳號"
            :disabled="isLoading"
          />
        </div>
        <div class="form-group">
          <label for="password">密碼</label>
          <div class="password-wrapper">
            <input
              :type="isPasswordVisible ? 'text' : 'password'"
              id="password"
              v-model="password"
              required
              autocomplete="current-password"
              placeholder="請輸入密碼"
              :disabled="isLoading"
            />
            <span class="password-toggle-icon" @click="togglePasswordVisibility">
              {{ isPasswordVisible ? '🙈' : '👁️' }}
            </span>
          </div>
        </div>
        <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
        <button type="submit" class="login-button" :disabled="isLoading">
          {{ isLoading ? '登入系統中...' : '登入' }}
        </button>
      </form>

      <div class="user-notice">
        <p><strong>使用者須知：</strong></p>
        <ul>
          <li>帳號、密碼：為您的 <strong>HIS 帳密</strong>。</li>
          <!-- <li>帳號：預設為您的 <strong>HIS 帳號</strong>。</li> -->
          <!-- <li>密碼：請使用管理員設定的密碼登入。</li> -->
          <!-- <li>密碼規則：至少 8 個字元，包含大寫、小寫字母和數字。</li> -->
        </ul>
        <p class="forgot-password">若無法登入，請聯繫系統管理員或護理長。</p>
      </div>
    </div>

    <!-- ✨✨✨ 新增：全螢幕 Loading 遮罩 ✨✨✨ -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="spinner"></div>
      <p class="loading-text">正在驗證身分，請稍候...</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const username = ref('')
const password = ref('')
const errorMessage = ref('')
const isLoading = ref(false)
const isPasswordVisible = ref(false)

const router = useRouter()
const route = useRoute()
const { login } = useAuth()

// 檢查是否因 Session Timeout 被登出
const isSessionTimeout = computed(() => route.query.reason === 'timeout')

// 登入後清除 timeout 參數
onMounted(() => {
  if (route.query.reason === 'timeout') {
    // 3 秒後清除 URL 參數
    setTimeout(() => {
      router.replace({ name: 'Login' })
    }, 5000)
  }
})

const togglePasswordVisibility = () => {
  isPasswordVisible.value = !isPasswordVisible.value
}

async function handleLogin() {
  if (isLoading.value) return

  isLoading.value = true
  errorMessage.value = ''

  try {
    // 因為 useAuth.ts 已經修正為會等待狀態更新
    // 所以這裡 await 結束後，代表使用者已經登入且 currentUser 有值了
    await login(username.value, password.value)
  } catch (error) {
    errorMessage.value = error.message || '登入發生錯誤'
    isLoading.value = false // 只有失敗才需要手動關閉 loading，成功的話路由會跳轉
  }
  // 成功時不將 isLoading 設為 false，避免跳轉瞬間畫面閃爍
}
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background-color: #f0f2f5;
  background-image: linear-gradient(120deg, #3498db, #8e44ad);
  position: relative; /* 為遮罩定位做準備 */
}

.login-box {
  background: white;
  padding: 40px;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 450px;
  text-align: center;
  animation: fadeIn 0.5s ease-in-out;
  z-index: 10;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.login-title {
  margin-top: 0;
  margin-bottom: 32px;
  color: #333;
  font-weight: 600;
  font-size: 1.8rem;
}

/* Session Timeout 提示樣式 */
.timeout-notice {
  background-color: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.timeout-icon {
  font-size: 1.5rem;
}

.timeout-notice p {
  margin: 0;
  color: #856404;
  font-weight: 500;
  text-align: left;
  line-height: 1.4;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  text-align: left;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #555;
}

.password-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.password-wrapper input {
  width: 100%;
  padding-right: 3.5rem;
}

.password-toggle-icon {
  position: absolute;
  right: 18px;
  cursor: pointer;
  user-select: none;
  font-size: 1.5rem;
  color: #a0aec0;
  display: flex;
  align-items: center;
  height: 100%;
}

.form-group input {
  width: 100%;
  padding: 14px 18px;
  border: 1px solid #ccc;
  border-radius: 8px;
  font-size: 1.1rem;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: var(--primary-color, #3498db);
  box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.2);
}

.error-message {
  color: #e74c3c;
  margin: -10px 0 0 0;
  font-weight: 500;
}

.login-button {
  padding: 14px;
  background-color: var(--primary-color, #3498db);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1.1rem;
  font-weight: bold;
  transition: background-color 0.2s;
  margin-top: 8px;
}

.login-button:hover:not(:disabled) {
  background-color: var(--primary-color-dark, #2980b9);
}

.login-button:disabled {
  background-color: #bdc3c7;
  cursor: not-allowed;
}

.user-notice {
  margin-top: 24px;
  font-size: 0.95em;
  color: #666;
  text-align: left;
  background: #f8f9fa;
  padding: 15px 20px;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

.user-notice p {
  margin: 0 0 10px 0;
}

.user-notice ul {
  padding-left: 20px;
  margin: 5px 0 15px 0;
  line-height: 1.6;
}

.forgot-password {
  margin-top: 15px;
  text-align: center;
  font-size: 0.9em;
  color: #888;
}

/* ✨✨✨ 新增：Loading 遮罩樣式 ✨✨✨ */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6); /* 半透明黑色背景 */
  z-index: 9999;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  backdrop-filter: blur(4px); /* 模糊背景效果 */
}

.spinner {
  width: 50px;
  height: 50px;
  border: 5px solid #f3f3f3;
  border-top: 5px solid #3498db; /* 轉動的顏色 */
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 15px;
}

.loading-text {
  color: white;
  font-size: 1.2rem;
  font-weight: 500;
  letter-spacing: 1px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .login-container {
    align-items: flex-start;
  }
  .login-box {
    max-width: none;
    width: 100%;
    min-height: 100vh;
    border-radius: 0;
    box-shadow: none;
    padding: 40px 25px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  /* 適當縮小標題字體，使其在手機上更和諧 */
  .login-title {
    font-size: 1.6rem;
    margin-bottom: 24px;
  }

  /* 縮小表單元素之間的間距 */
  .login-form {
    gap: 15px;
  }
}
</style>
