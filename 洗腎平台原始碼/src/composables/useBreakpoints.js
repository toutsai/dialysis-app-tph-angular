import { computed } from 'vue'
import { useWindowSize } from '@vueuse/core'

export function useBreakpoints() {
  const { width } = useWindowSize()

  const isMobile = computed(() => width.value < 768)
  const isTablet = computed(() => width.value >= 768 && width.value < 992)
  const isDesktop = computed(() => width.value >= 992)

  return {
    isMobile,
    isTablet,
    isDesktop,
  }
}
