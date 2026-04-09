<template>
  <div class="image-uploader">
    <!-- 階段一：初始狀態，顯示拍照按鈕 -->
    <button v-if="currentState === 'idle'" @click="startCamera" class="btn-primary">
      <i class="fas fa-camera"></i> 開啟相機拍照
    </button>

    <!-- 階段二：相機開啟狀態 -->
    <div v-if="currentState === 'streaming'" class="camera-view">
      <video ref="videoPlayer" autoplay playsinline class="video-preview"></video>
      <div class="camera-controls">
        <button @click="captureImage" class="btn-capture" title="拍照">
          <i class="fas fa-circle"></i>
        </button>
        <button @click="stopCamera" class="btn-cancel">取消</button>
      </div>
    </div>

    <!-- 階段三：照片預覽與上傳狀態 -->
    <div v-if="currentState === 'captured' || currentState === 'uploading'" class="preview-view">
      <img :src="capturedImage" alt="Captured image preview" class="image-preview" />
      <div class="preview-controls">
        <button @click="uploadToDrive" :disabled="isUploading" class="btn-success">
          <i v-if="isUploading" class="fas fa-spinner fa-spin"></i>
          {{ isUploading ? '上傳中...' : '確認上傳' }}
        </button>
        <button @click="retakePhoto" :disabled="isUploading" class="btn-secondary">重新拍照</button>
      </div>
    </div>

    <!-- 錯誤訊息顯示 -->
    <div v-if="errorMessage" class="error-message">
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  patient: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['upload-success', 'upload-error'])

const currentState = ref('idle') // 'idle', 'streaming', 'captured', 'uploading'
const videoPlayer = ref(null)
const capturedImage = ref(null)
const stream = ref(null)
const errorMessage = ref('')
const isUploading = ref(false)

/**
 * 啟動相機
 */
async function startCamera() {
  errorMessage.value = ''
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      stream.value = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, // 優先使用後置鏡頭
      })
      currentState.value = 'streaming'
      // nextTick is needed to ensure videoPlayer ref is available
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (videoPlayer.value) {
        videoPlayer.value.srcObject = stream.value
      }
    } catch (error) {
      console.error('相機啟動失敗:', error)
      errorMessage.value = `無法開啟相機: ${error.message}`
      currentState.value = 'idle'
    }
  } else {
    errorMessage.value = '您的瀏覽器不支援相機功能。'
  }
}

/**
 * 停止相機串流
 */
function stopCamera() {
  if (stream.value) {
    stream.value.getTracks().forEach((track) => track.stop())
  }
  currentState.value = 'idle'
  capturedImage.value = null
}

/**
 * 拍攝照片
 */
function captureImage() {
  const canvas = document.createElement('canvas')
  if (videoPlayer.value) {
    canvas.width = videoPlayer.value.videoWidth
    canvas.height = videoPlayer.value.videoHeight
    const context = canvas.getContext('2d')
    context.drawImage(videoPlayer.value, 0, 0, canvas.width, canvas.height)

    capturedImage.value = canvas.toDataURL('image/jpeg')
    stopCamera() // 拍照後先關閉相機
    currentState.value = 'captured'
  }
}

/**
 * 重新拍照
 */
function retakePhoto() {
  capturedImage.value = null
  startCamera()
}

/**
 * 上傳圖片功能 (standalone 模式下不支援 Google Drive)
 */
async function uploadToDrive() {
  if (!capturedImage.value || !props.patient) return

  // Google Drive 上傳功能在 standalone 模式下不可用
  errorMessage.value = 'standalone 模式下暫不支援上傳圖片功能。'
  emit('upload-error', new Error('standalone 模式下暫不支援上傳圖片功能'))
  return
}
</script>

<style scoped>
.image-uploader {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 1rem;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  gap: 1rem;
  background-color: #f9f9f9;
}

.camera-view,
.preview-view {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.video-preview,
.image-preview {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  background-color: #000;
}

.camera-controls,
.preview-controls {
  display: flex;
  gap: 1rem;
  justify-content: center;
}

button {
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  border: none;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #007bff;
  color: white;
}
.btn-primary:hover:not(:disabled) {
  background-color: #0056b3;
}

.btn-capture {
  background-color: #dc3545;
  color: white;
  border-radius: 50%;
  width: 60px;
  height: 60px;
  font-size: 1.5rem;
  justify-content: center;
  border: 4px solid white;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
}
.btn-capture:hover:not(:disabled) {
  background-color: #b02a37;
}

.btn-cancel {
  background-color: #6c757d;
  color: white;
}
.btn-cancel:hover:not(:disabled) {
  background-color: #5a6268;
}

.btn-success {
  background-color: #28a745;
  color: white;
}
.btn-success:hover:not(:disabled) {
  background-color: #218838;
}

.btn-secondary {
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
}
.btn-secondary:hover:not(:disabled) {
  background-color: #e2e6ea;
}

.error-message {
  color: #dc3545;
  font-weight: 500;
  margin-top: 0.5rem;
}
</style>
