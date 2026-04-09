// 檔案路徑: src/main.ts
// ✨ Standalone 版本

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import overlayCloseDirective from '@/directives/overlayClose.js'
// Quill 編輯器全域樣式
import '@vueup/vue-quill/dist/vue-quill.snow.css'

const app = createApp(App)

app.use(createPinia())
app.directive('overlay-close', overlayCloseDirective)
app.use(router)

app.mount('#app')
