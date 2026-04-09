<template>
  <div class="ward-badge" @click.stop="startEdit" :title="title">
    <span v-if="!editing">{{ value || '+' }}</span>
    <input
      v-else
      ref="inp"
      v-model.trim="local"
      @keyup.enter="save"
      @blur="save"
      :placeholder="placeholder"
      class="ward-input"
      :maxlength="16"
    />
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'

const props = defineProps({
  value: { type: String, default: '' }, // 目前的床號
  placeholder: { type: String, default: '床號' }, // 例如 5B12 / ICUA-3
})
const emit = defineEmits(['update'])

const editing = ref(false)
const local = ref(props.value)
const inp = ref(null)

watch(
  () => props.value,
  (v) => (local.value = v),
)

const title = computed(() => (props.value ? `床號：${props.value}（點擊編輯）` : '新增床號'))

function startEdit() {
  editing.value = true
  nextTick(() => inp.value?.focus())
}

function save() {
  if (!editing.value) return
  editing.value = false

  // 容忍常見的床號格式（英數與連字號）；空字串代表清空
  const ok = /^[-A-Z0-9]+$/i.test(local.value) || local.value === ''
  if (!ok) {
    local.value = props.value
    return
  }

  if (local.value !== props.value) emit('update', local.value || null)
}
</script>

<style scoped>
.ward-badge {
  min-width: 28px;
  height: 22px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  border: 1px dashed #bbb;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.ward-badge:hover {
  border-color: #888;
}
.ward-input {
  width: 76px;
  height: 20px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 12px;
  padding: 0 4px;
}
</style>
