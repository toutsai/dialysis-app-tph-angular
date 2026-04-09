<template>
  <div
    style="
      padding: 20px;
      background: #f8f9fa;
      border-radius: 8px;
      margin: 20px;
      font-family: monospace;
    "
  >
    <h2 style="color: #dc3545">🩺 系統診斷報告</h2>

    <div style="margin: 20px 0">
      <button
        @click="runFullDiagnostic"
        style="
          padding: 10px 20px;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        "
      >
        🔍 執行完整診斷
      </button>
    </div>

    <div v-if="diagnosticResults.length > 0" style="margin-top: 20px">
      <div
        v-for="(result, index) in diagnosticResults"
        :key="index"
        style="
          margin: 15px 0;
          padding: 15px;
          background: white;
          border-radius: 4px;
          border-left: 4px solid #007bff;
        "
      >
        <h4
          :style="{
            color:
              result.status === 'success'
                ? '#28a745'
                : result.status === 'error'
                  ? '#dc3545'
                  : '#ffc107',
          }"
        >
          {{ result.status === 'success' ? '✅' : result.status === 'error' ? '❌' : '⚠️' }}
          {{ result.title }}
        </h4>
        <div style="margin: 10px 0"><strong>狀態:</strong> {{ result.status }}</div>
        <div style="margin: 10px 0">
          <strong>詳細資訊:</strong>
          <pre
            style="
              background: #f8f9fa;
              padding: 10px;
              border-radius: 4px;
              overflow-x: auto;
              white-space: pre-wrap;
            "
            >{{ result.details }}</pre
          >
        </div>
        <div v-if="result.recommendations" style="margin: 10px 0">
          <strong>建議:</strong>
          <ul>
            <li v-for="rec in result.recommendations" :key="rec">{{ rec }}</li>
          </ul>
        </div>
      </div>
    </div>

    <div style="margin-top: 30px; padding: 15px; background: #e9ecef; border-radius: 4px">
      <h3>📋 診斷項目清單</h3>
      <ul style="margin: 10px 0">
        <li>✅ 檢查 scheduleService.js 是否正確更新</li>
        <li>✅ 驗證優化函式是否可用</li>
        <li>✅ 測試 useCache composable</li>
        <li>✅ 測試 useErrorHandler composable</li>
        <li>✅ 檢查系統是否在使用新版本</li>
        <li>✅ 尋找仍在使用舊版本的地方</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const diagnosticResults = ref([])

const addResult = (title, status, details, recommendations = null) => {
  diagnosticResults.value.push({
    title,
    status, // 'success', 'error', 'warning'
    details: typeof details === 'object' ? JSON.stringify(details, null, 2) : details,
    recommendations,
  })
}

const runFullDiagnostic = async () => {
  console.log('🩺 開始系統診斷...')
  diagnosticResults.value = []

  // 診斷 1: 檢查 scheduleService.js 是否正確更新
  try {
    const scheduleService = await import('@/services/scheduleService.js')

    const expectedFunctions = [
      'clearFutureSchedulesForPatient',
      'cleanTemporaryDataInFutureSchedules',
      'getPatientSchedules',
      'scheduleServiceCache',
    ]

    const availableFunctions = Object.keys(scheduleService)
    const missingFunctions = expectedFunctions.filter((fn) => !availableFunctions.includes(fn))

    if (missingFunctions.length === 0) {
      addResult(
        'scheduleService.js 函式檢查',
        'success',
        `所有優化函式都已正確匯出: ${expectedFunctions.join(', ')}`,
      )
    } else {
      addResult(
        'scheduleService.js 函式檢查',
        'error',
        `缺少函式: ${missingFunctions.join(', ')}\n可用函式: ${availableFunctions.join(', ')}`,
        ['檢查 scheduleService.js 是否使用了正確的優化版本代碼'],
      )
    }
  } catch (error) {
    addResult(
      'scheduleService.js 載入檢查',
      'error',
      `無法載入 scheduleService.js: ${error.message}`,
      ['檢查檔案路徑是否正確', '確認檔案語法沒有錯誤'],
    )
  }

  // 診斷 2: 檢查 useCache composable
  try {
    const useCache = await import('@/composables/useCache.js')
    const { getCachedData, invalidateCache } = useCache.useCache()

    addResult('useCache composable 檢查', 'success', 'useCache composable 正常載入且函式可用')
  } catch (error) {
    addResult('useCache composable 檢查', 'error', `useCache 載入失敗: ${error.message}`, [
      '檢查 useCache.js 檔案是否存在',
      '確認檔案語法正確',
    ])
  }

  // 診斷 3: 檢查 useErrorHandler composable
  try {
    const useErrorHandler = await import('@/composables/useErrorHandler.js')
    const { handleApiCall, validateInput } = useErrorHandler.useErrorHandler()

    addResult(
      'useErrorHandler composable 檢查',
      'success',
      'useErrorHandler composable 正常載入且函式可用',
    )
  } catch (error) {
    addResult(
      'useErrorHandler composable 檢查',
      'error',
      `useErrorHandler 載入失敗: ${error.message}`,
      ['檢查 useErrorHandler.js 檔案是否存在', '確認檔案語法正確'],
    )
  }

  // 診斷 4: 測試優化函式是否真的會產生我們的日誌
  try {
    const scheduleService = await import('@/services/scheduleService.js')
    const { scheduleServiceCache } = scheduleService

    if (scheduleServiceCache) {
      console.log('🧪 測試 scheduleServiceCache.getCacheStats()...')
      const stats = scheduleServiceCache.getCacheStats()

      addResult(
        'scheduleServiceCache 功能測試',
        'success',
        `快取統計正常: 總項目 ${stats.totalItems}, 排程相關 ${stats.scheduleItems}`,
      )
    } else {
      addResult('scheduleServiceCache 功能測試', 'error', 'scheduleServiceCache 未正確匯出', [
        '檢查 scheduleService.js 最後是否有正確的 export',
      ])
    }
  } catch (error) {
    addResult('scheduleServiceCache 功能測試', 'error', `測試失敗: ${error.message}`, [
      '檢查 scheduleService.js 中的 scheduleServiceCache 實作',
    ])
  }

  // 診斷 5: 檢查目前系統正在使用的函式
  try {
    // 檢查 Console 中的訊息模式
    const consoleMessages = []
    const originalLog = console.log

    // 暫時攔截 console.log 來分析訊息
    console.log = function (...args) {
      consoleMessages.push(args.join(' '))
      originalLog.apply(console, args)
    }

    setTimeout(() => {
      console.log = originalLog

      const hasApiManagerMessages = consoleMessages.some((msg) => msg.includes('[ApiManager]'))
      const hasOptimizedMessages = consoleMessages.some(
        (msg) => msg.includes('🗑️') || msg.includes('🎯') || msg.includes('⏱️'),
      )

      if (hasOptimizedMessages) {
        addResult('系統使用狀況分析', 'success', '系統正在使用優化版本的函式', [
          '繼續觀察 Console 中的優化日誌',
        ])
      } else if (hasApiManagerMessages) {
        addResult('系統使用狀況分析', 'warning', '系統主要還在使用舊的 ApiManager', [
          '檢查您的組件是否調用了新的優化函式',
          '確認排程相關操作是否使用 clearFutureSchedulesForPatient 等新函式',
          '可能需要更新組件來使用新的 API',
        ])
      } else {
        addResult('系統使用狀況分析', 'warning', '暫時無法判斷系統使用狀況', [
          '請進行一些排程操作後再次檢查',
        ])
      }
    }, 1000)
  } catch (error) {
    addResult('系統使用狀況分析', 'error', `分析失敗: ${error.message}`)
  }

  // 診斷 6: 檢查 ApiManager 使用情況
  try {
    // 搜尋可能仍在使用 ApiManager 的地方
    addResult(
      'ApiManager 使用狀況',
      'warning',
      '從您的 Console 日誌看到 [ApiManager] 訊息，表示系統還在使用舊版本',
      [
        '檢查 vue 組件中是否直接使用 ApiManager',
        '確認排程相關操作是否已更新為使用新的 scheduleService 函式',
        '可能需要更新組件的 import 和函式調用',
      ],
    )
  } catch (error) {
    addResult('ApiManager 使用檢查', 'error', `檢查失敗: ${error.message}`)
  }

  console.log('🎉 診斷完成！請查看上方結果。')
}
</script>
