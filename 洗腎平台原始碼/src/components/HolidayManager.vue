<template>
  <div class="holiday-container">
    <h4>2025年國定假日管理</h4>

    <div class="holiday-item">
      <!-- 假日名稱下拉選單 -->
      <select v-model="selectedHolidayName">
        <option disabled value="">請選擇假日</option>
        <option v-for="holiday in holidays2025" :key="holiday.name" :value="holiday.name">
          {{ holiday.name }}
        </option>
        <option value="custom">-- 自訂假日 --</option>
      </select>

      <!-- 如果選擇自訂，才顯示這個輸入框 -->
      <input
        v-if="selectedHolidayName === 'custom'"
        type="text"
        v-model="customHolidayName"
        placeholder="請輸入假日名稱"
      />
    </div>

    <div class="holiday-item">
      <!-- 日期選擇器 -->
      <input type="date" v-model="selectedDate" />
    </div>

    <button @click="addHoliday">新增假日</button>

    <!-- 這裡可以顯示已新增的假日列表 -->
    <!-- ... -->
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

// 2025 國定假日靜態資料
const holidays2025 = [
  { name: '中華民國開國紀念日', date: '2025-01-01' },
  { name: '農曆除夕', date: '2025-01-28' },
  { name: '農曆春節', date: '2025-01-29' },
  { name: '農曆春節', date: '2025-01-30' },
  { name: '農曆春節', date: '2025-01-31' },
  { name: '和平紀念日', date: '2025-02-28' },
  { name: '兒童節', date: '2025-04-04' },
  { name: '民族掃墓節(清明節)', date: '2025-04-05' },
  { name: '端午節', date: '2025-05-31' },
  { name: '中秋節', date: '2025-10-06' },
  { name: '國慶日', date: '2025-10-10' },
]

const selectedHolidayName = ref('')
const customHolidayName = ref('')
const selectedDate = ref('')

// 監聽下拉選單的變化
watch(selectedHolidayName, (newName) => {
  if (newName && newName !== 'custom') {
    // 當使用者從下拉選單選擇一個已知的假日，自動帶入對應的日期
    const foundHoliday = holidays2025.find((h) => h.name === newName)
    if (foundHoliday) {
      selectedDate.value = foundHoliday.date
    }
  } else {
    // 如果是選擇自訂或其他，清空日期
    selectedDate.value = ''
  }
})

function addHoliday() {
  const name =
    selectedHolidayName.value === 'custom' ? customHolidayName.value : selectedHolidayName.value

  if (!name || !selectedDate.value) {
    alert('請輸入完整的假日名稱和日期！')
    return
  }

  // 在這裡處理新增假日的邏輯
  // 例如：發送到父元件、儲存到狀態管理庫 (Pinia/Vuex) 等
  console.log('新增假日:', { name, date: selectedDate.value })

  // 新增後可以清空選項
  selectedHolidayName.value = ''
  customHolidayName.value = ''
  selectedDate.value = ''
}
</script>

<style scoped>
.holiday-container {
  border: 1px solid #ccc;
  padding: 16px;
  margin-top: 20px;
  border-radius: 8px;
}
.holiday-item {
  margin-bottom: 12px;
}
</style>
