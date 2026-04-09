// Service Worker for 臺北醫院洗腎管理平台
const CACHE_NAME = 'dialysis-app-v1'

// 需要快取的靜態資源
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/icon-192x192.png',
  '/icon-512x512.png',
]

// 安裝事件 - 預快取靜態資源
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...')
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets')
        return cache.addAll(STATIC_ASSETS)
      })
      .then(() => {
        // 跳過等待，立即啟用新版本
        return self.skipWaiting()
      }),
  )
})

// 啟用事件 - 清理舊快取
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...')
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name)
              return caches.delete(name)
            }),
        )
      })
      .then(() => {
        // 立即控制所有客戶端
        return self.clients.claim()
      }),
  )
})

// 攔截請求事件 - Network First 策略（適合動態資料應用）
self.addEventListener('fetch', (event) => {
  // 只處理 GET 請求
  if (event.request.method !== 'GET') {
    return
  }

  // 跳過 API 請求的快取（讓它們直接走網路）
  if (event.request.url.includes('/api/')) {
    return
  }

  event.respondWith(
    // 嘗試從網路獲取
    fetch(event.request)
      .then((response) => {
        // 如果成功，複製回應並存入快取
        if (response.status === 200) {
          const responseToCache = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache)
          })
        }
        return response
      })
      .catch(() => {
        // 網路失敗時，從快取中獲取
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse
          }
          // 如果快取中也沒有，返回離線頁面或錯誤
          return new Response('離線中，無法載入資源', {
            status: 503,
            statusText: 'Service Unavailable',
          })
        })
      }),
  )
})
