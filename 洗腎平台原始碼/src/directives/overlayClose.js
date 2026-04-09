const overlayCloseDirective = {
  mounted(el, binding) {
    let isPointerDownOnOverlay = false

    const isEventOnOverlay = (event) => event.target === el

    const onPointerDown = (event) => {
      if (isEventOnOverlay(event)) {
        isPointerDownOnOverlay = true
      }
    }

    const onPointerUp = (event) => {
      if (isPointerDownOnOverlay && isEventOnOverlay(event)) {
        if (typeof binding.value === 'function') {
          binding.value(event)
        }
      }
      isPointerDownOnOverlay = false
    }

    const onPointerCancel = () => {
      isPointerDownOnOverlay = false
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointerleave', onPointerCancel)
    el.addEventListener('pointercancel', onPointerCancel)

    el.__overlayCloseCleanup__ = () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointerleave', onPointerCancel)
      el.removeEventListener('pointercancel', onPointerCancel)
    }
  },
  beforeUnmount(el) {
    if (typeof el.__overlayCloseCleanup__ === 'function') {
      el.__overlayCloseCleanup__()
      delete el.__overlayCloseCleanup__
    }
  }
}

export default overlayCloseDirective
