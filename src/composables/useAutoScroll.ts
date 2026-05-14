import { nextTick, ref } from 'vue'

/**
 * 封装 feed 主列表与 Manus 步进 `<ol>` 的滚动：双 rAF、跟底节流、步进内层连跟两帧。
 */
export function useAutoScroll() {
  const feedWrap = ref<HTMLElement | null>(null)

  let followScrollRaf = 0

  function cancelFollowScroll() {
    if (followScrollRaf) {
      cancelAnimationFrame(followScrollRaf)
      followScrollRaf = 0
    }
  }

  /** 流式输出时最多每帧跟底一次，避免 setTimeout 防抖导致长时间不滚 */
  function scheduleFollowScroll() {
    if (followScrollRaf) return
    followScrollRaf = requestAnimationFrame(() => {
      followScrollRaf = 0
      void scrollFeedToEnd(false)
    })
  }

  /**
   * 滚到底部。force：发送/结束时强制对齐；非 force：仅当用户仍在底部附近时跟随气泡。
   * 非 force 用双 rAF + 像素容差，减少布局未稳定时的来回微调和轻微抖动。
   */
  function scrollFeedToEnd(force: boolean) {
    const run = () => {
      const el = feedWrap.value
      if (!el) return
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      if (!force && gap > 360) return
      const top = Math.max(0, el.scrollHeight - el.clientHeight)
      const delta = top - el.scrollTop
      if (!force && delta < 6 && gap < 28) return
      el.scrollTop = top
    }

    if (force) {
      cancelFollowScroll()
      void nextTick(() => {
        requestAnimationFrame(run)
      })
      return
    }

    void nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(run)
      })
    })
  }

  /** 步事件主列表 `<ol class="steps">` 内层滚动跟底 */
  const manusStepsOlByMsgId = new Map<string, HTMLOListElement>()

  function setManusStepsOlRef(messageId: string, el: unknown) {
    if (el instanceof HTMLOListElement) manusStepsOlByMsgId.set(messageId, el)
    else manusStepsOlByMsgId.delete(messageId)
  }

  function scrollManusStepsOlToEnd(messageId: string, force: boolean) {
    const el = manusStepsOlByMsgId.get(messageId)
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    if (!force && gap > 72) return
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
  }

  /**
   * 在 Vue 补丁 DOM 之后再滚；长气泡（单条 summary 很高）常见首帧 scrollHeight 未涨满，故连跟两帧 rAF。
   * 步进打字播放阶段传 force=true，避免「假 gap」后永久不再跟底。
   */
  function scheduleManusStepsInnerScroll(messageId: string, force = false) {
    void nextTick(() => {
      requestAnimationFrame(() => {
        scrollManusStepsOlToEnd(messageId, force)
        requestAnimationFrame(() => {
          scrollManusStepsOlToEnd(messageId, force)
        })
      })
    })
  }

  return {
    feedWrap,
    cancelFollowScroll,
    scheduleFollowScroll,
    scrollFeedToEnd,
    setManusStepsOlRef,
    scrollManusStepsOlToEnd,
    scheduleManusStepsInnerScroll,
  }
}
