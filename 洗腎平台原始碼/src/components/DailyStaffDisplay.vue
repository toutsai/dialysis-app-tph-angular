<!-- 檔案路徑: src/components/DailyStaffDisplay.vue (樣式更新) -->
<template>
  <div class="daily-staff-container">
    <!-- 查房醫師 (固定顯示) -->
    <div class="staff-item shift-early">
      <span class="staff-label">早班</span>
      <div class="staff-details">
        <div class="staff-name">
          <span class="staff-job-title">查房</span>
          {{ dailyPhysicians.early?.name || '--' }}
        </div>
        <span v-if="dailyPhysicians.early" class="staff-contact">
          (員 {{ dailyPhysicians.early.staffId || 'N/A' }} / 電
          {{ dailyPhysicians.early.phone || 'N/A' }})
        </span>
      </div>
    </div>
    <div class="staff-item shift-noon">
      <span class="staff-label">午班</span>
      <div class="staff-details">
        <div class="staff-name">
          <span class="staff-job-title">查房</span>
          {{ dailyPhysicians.noon?.name || '--' }}
        </div>
        <span v-if="dailyPhysicians.noon" class="staff-contact">
          (員 {{ dailyPhysicians.noon.staffId || 'N/A' }} / 電
          {{ dailyPhysicians.noon.phone || 'N/A' }})
        </span>
      </div>
    </div>
    <div class="staff-item shift-late">
      <span class="staff-label">晚班</span>
      <div class="staff-details">
        <div class="staff-name">
          <span class="staff-job-title">查房</span>
          {{ dailyPhysicians.late?.name || '--' }}
        </div>
        <span v-if="dailyPhysicians.late" class="staff-contact">
          (員 {{ dailyPhysicians.late.staffId || 'N/A' }} / 電
          {{ dailyPhysicians.late.phone || 'N/A' }})
        </span>
      </div>
    </div>

    <!-- 會診醫師 (依據時間自動顯示) -->
    <div class="staff-item" :class="`shift-consult-${displayedConsultPhysician.key}`">
      <span class="staff-label">{{ displayedConsultPhysician.shiftLabel }}</span>
      <div class="staff-details">
        <div class="staff-name">
          <span class="staff-job-title">會診</span>
          {{ displayedConsultPhysician.data?.name || '--' }}
        </div>
        <span v-if="displayedConsultPhysician.data" class="staff-contact">
          (員 {{ displayedConsultPhysician.data.staffId || 'N/A' }} / 電
          {{ displayedConsultPhysician.data.phone || 'N/A' }})
        </span>
      </div>
    </div>

    <!-- 專師 -->
    <div class="staff-item shift-specialist">
      <span class="staff-label">專師</span>
      <div class="staff-details">
        <span class="staff-name">賴若蕎</span>
        <span class="staff-contact">(電 665129)</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

// Props 定義不變
const props = defineProps({
  dailyPhysicians: {
    type: Object,
    required: true,
    default: () => ({ early: null, noon: null, late: null }),
  },
  dailyConsultPhysicians: {
    type: Object,
    required: true,
    default: () => ({ morning: null, afternoon: null, night: null }),
  },
})

// Script 邏輯不變
const currentTime = ref(new Date())
let timeUpdateInterval = null
const displayedConsultPhysician = computed(() => {
  const currentHour = currentTime.value.getHours()
  if (currentHour >= 8 && currentHour < 12) {
    return {
      key: 'morning',
      shiftLabel: '上午',
      data: props.dailyConsultPhysicians.morning,
    }
  } else if (currentHour >= 12 && currentHour < 17) {
    return {
      key: 'afternoon',
      shiftLabel: '下午',
      data: props.dailyConsultPhysicians.afternoon,
    }
  } else {
    return {
      key: 'night',
      shiftLabel: '夜間',
      data: props.dailyConsultPhysicians.night,
    }
  }
})
onMounted(() => {
  if (timeUpdateInterval) clearInterval(timeUpdateInterval)
  timeUpdateInterval = setInterval(() => {
    currentTime.value = new Date()
  }, 60000)
})
onUnmounted(() => {
  if (timeUpdateInterval) clearInterval(timeUpdateInterval)
})
</script>

<style scoped>
.daily-staff-container {
  display: flex;
  gap: 8px;
  align-items: center;
}
.staff-item {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: 20px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  min-width: 175px;
  height: 52px;
  box-sizing: border-box;
}
.staff-label {
  font-weight: 700;
  font-size: 0.9rem;
  margin-right: 8px;
  color: white;
}
.staff-details {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  line-height: 1.3;
  flex-grow: 1;
}
.staff-name {
  display: flex;
  align-items: baseline;
  gap: 0.3em;
  font-weight: 600;
  font-size: 1rem;
}
.staff-job-title {
  font-size: 0.8em;
  font-weight: 500;
  opacity: 0.9;
}
.staff-contact {
  font-size: 0.7rem;
  opacity: 0.9;
  white-space: nowrap;
}
.staff-item.shift-early {
  background-color: #28a745;
  color: white;
}
.staff-item.shift-noon {
  background-color: #ffc107;
  color: #212529;
}
.staff-item.shift-noon .staff-label {
  color: #212529;
}
.staff-item.shift-late {
  background-color: #17a2b8;
  color: white;
}

/* === 【核心修改】將所有會診醫師的樣式統一為實心紅底白字 === */
.staff-item.shift-consult-morning,
.staff-item.shift-consult-afternoon,
.staff-item.shift-consult-night {
  background-color: #ef4444; /* 柔和的紅色背景 */
  color: white; /* 內部所有文字都設為白色 */
}
.staff-item.shift-consult-morning .staff-label,
.staff-item.shift-consult-afternoon .staff-label,
.staff-item.shift-consult-night .staff-label {
  color: white; /* 再次確保標籤文字是白色 */
}
/* ======================================================= */

.staff-item.shift-specialist {
  background-color: #e5e7eb;
  color: #1f2937;
}
.staff-item.shift-specialist .staff-label {
  color: #1f2937;
}
</style>
