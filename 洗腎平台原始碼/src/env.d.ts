/// <reference types="vite/client" />

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
    requiresAdmin?: boolean
    requiredAuth?: boolean
    roles?: string[]
  }
}
