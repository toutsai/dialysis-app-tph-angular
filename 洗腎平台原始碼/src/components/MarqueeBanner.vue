<template>
  <div v-if="htmlContent" class="marquee-banner">
    <div class="marquee-icon"><i class="fas fa-bullhorn"></i></div>
    <div class="marquee-content-wrapper">
      <div class="marquee-content">
        <!-- ✨ 核心修改 1: 將兩個 v-html 包裹在一個 div 中 -->
        <div class="content-inner" v-html="htmlContent"></div>
        <div class="content-inner" v-html="htmlContent"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { systemApi } from '@/services/localApiClient'

const htmlContent = ref('')
let pollingInterval = null

async function fetchMarqueeContent() {
  try {
    const config = await systemApi.fetchSiteConfig('marquee_announcements')
    htmlContent.value = config?.configData?.content || config?.content || ''
  } catch (error) {
    console.error('載入跑馬燈內容失敗:', error)
    htmlContent.value = ''
  }
}

onMounted(async () => {
  // Initial fetch
  await fetchMarqueeContent()

  // Set up polling every 30 seconds
  pollingInterval = setInterval(fetchMarqueeContent, 30000)
})

onUnmounted(() => {
  if (pollingInterval) {
    clearInterval(pollingInterval)
  }
})
</script>

<style scoped>
.marquee-banner {
  display: flex;
  align-items: center;
  background-color: #fffbe3;
  color: #b45309;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  overflow: hidden;
  font-weight: 500;
  border: 1px solid #fde68a;
  height: 45px; /* 固定高度以對齊按鈕 */
}

.marquee-icon {
  margin-right: 1rem;
  font-size: 1.2rem;
  flex-shrink: 0; /* 防止圖示被壓縮 */
}

.marquee-content-wrapper {
  flex-grow: 1; /* 佔滿剩餘空間 */
  overflow: hidden; /* 隱藏超出部分的內容 */
}

/* ✨ 核心修改 2: 這裡是新的樣式佈局 */
.marquee-content {
  display: flex; /* 讓兩個 inner div 並排 */
  width: fit-content; /* 讓容器寬度由其內容決定 */
  animation: scroll-left 30s linear infinite;
}

.marquee-content:hover {
  animation-play-state: paused;
}

.content-inner {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  white-space: nowrap; /* 確保內容不換行 */
  flex-shrink: 0; /* 確保內容區塊不被 flex 容器壓縮 */
  padding-right: 3rem; /* 在每個內容區塊後增加間距，確保無縫滾動時有空隙 */
}

/* 針對 v-html 內部的 p 標籤做樣式重置 */
.content-inner > :deep(p) {
  margin: 0;
}

@keyframes scroll-left {
  0% {
    transform: translateX(0);
  }
  100% {
    /* 位移的距離是自身寬度的一半，因為我們有兩個內容區塊 */
    transform: translateX(-50%);
  }
}
</style>
