import { nextTick, ref, type Ref } from 'vue'
import type { ChatMessage } from '../types/chat'
import { getChatSseModeStrategy, type ChatSseModeOps } from '../chat/chatSseStrategies'
import { manusStepsMainEntries } from '../utils/manusStepDisplay'
import type { SseMessage } from '../utils/sse'

export interface TypewriterScrollApi {
  scheduleFollowScroll: () => void
  scrollFeedToEnd: (force: boolean) => void
  scheduleManusStepsInnerScroll: (messageId: string, force?: boolean) => void
  scrollManusStepsOlToEnd: (messageId: string, force: boolean) => void
}

export function useTypewriter(
  messages: Ref<ChatMessage[]>,
  streamingAssistantIndex: Ref<number>,
  scroll: TypewriterScrollApi,
) {
  /** 流式阶段逐字显示长度；完成后整段转 Markdown */
  const revealShown = ref(0)
  let revealRafId = 0

  function stopRevealRaf() {
    if (revealRafId) {
      cancelAnimationFrame(revealRafId)
      revealRafId = 0
    }
  }

  function streamingAssistant(): ChatMessage | null {
    const list = messages.value
    const m = list[streamingAssistantIndex.value]
    if (m && m.role === 'assistant') return m
    return null
  }

  function revealTick() {
    const a = streamingAssistant()
    if (!a) {
      revealRafId = 0
      return
    }

    const full = a.content.length
    revealShown.value = Math.min(revealShown.value, full)

    if (revealShown.value < full) {
      const behind = full - revealShown.value
      // DeepSeek 感：近尾端基本一字一顿；缓冲较大时温和加速；/102 较 /120 约快 15%
      const step = Math.max(1, Math.min(3, Math.ceil(behind / 102)))
      revealShown.value = Math.min(revealShown.value + step, full)
      scroll.scheduleFollowScroll()
    }

    if (finalizePendingMarkdownIfCaughtUp(a)) {
      return
    }

    if (revealShown.value < a.content.length) {
      revealRafId = requestAnimationFrame(revealTick)
    } else {
      revealRafId = 0
    }
  }

  function finalizePendingMarkdownIfCaughtUp(a: ChatMessage | null): boolean {
    if (!a?.pendingMarkdown) return false
    if (revealShown.value < a.content.length) return false
    a.pendingMarkdown = false
    a.streamComplete = true
    stopRevealRaf()
    scroll.scrollFeedToEnd(true)
    return true
  }

  function bumpRevealPump() {
    if (revealRafId) return
    revealRafId = requestAnimationFrame(() => {
      revealTick()
    })
  }

  let manusStepRafId = 0

  function stopManusStepRaf() {
    if (manusStepRafId) {
      cancelAnimationFrame(manusStepRafId)
      manusStepRafId = 0
    }
  }

  function syncManusRevealLens(a: ChatMessage) {
    if (a.mode !== 'manus') return
    const n = manusStepsMainEntries(a.manusSteps).length
    if (!a.manusMainRowRevealChars) a.manusMainRowRevealChars = []
    const arr = a.manusMainRowRevealChars
    while (arr.length < n) arr.push(0)
  }

  function allMainManusRowsTyped(a: ChatMessage): boolean {
    const entries = manusStepsMainEntries(a.manusSteps)
    const lens = a.manusMainRowRevealChars || []
    for (let i = 0; i < entries.length; i++) {
      const cap = (entries[i].step.summary || '').length
      if ((lens[i] ?? 0) < cap) return false
    }
    return true
  }

  /**
   * Manus 步进面板收口（折叠）。
   * - `done`：**必须**调用，作为保守兜底（`manusStepsHasRunFinishedMeta` 不可信为唯一条件）。
   * - 日后若在 RUN_FINISHED·META 播完时提前收口，仍须在 `done` 再调一次（幂等），确保漏事件时也能收起。
   */
  function collapseManusStepPanel(a: ChatMessage) {
    if (a.mode === 'manus') {
      a.manusPanelExpanded = false
      void nextTick(() => scroll.scrollManusStepsOlToEnd(a.id, true))
    }
  }

  function tryCollapseManusPanel(a: ChatMessage): boolean {
    if (a.mode !== 'manus' || a.manusPanelExpanded === false) return false
    const entries = manusStepsMainEntries(a.manusSteps)
    if (!entries.length) {
      if (a.manusDone) {
        collapseManusStepPanel(a)
        return true
      }
      return false
    }
    if (!allMainManusRowsTyped(a)) return false
    const last = entries[entries.length - 1].step
    const lastIsRf = last.phase === 'RUN_FINISHED' && last.messageType === 'META'
    if (lastIsRf) {
      collapseManusStepPanel(a)
      return true
    }
    if (a.manusDone) {
      collapseManusStepPanel(a)
      return true
    }
    return false
  }

  function maybeStartManusFinalReveal(a: ChatMessage) {
    if (a.mode !== 'manus' || a.manusFinalRevealStarted) return
    if (a.manusPanelExpanded !== false) return
    if (!a.manusDone) return
    if (a.manusPendingFinalSummary === undefined) return

    stopManusStepRaf()
    a.manusFinalRevealStarted = true
    const text = a.manusPendingFinalSummary
    a.manusPendingFinalSummary = undefined
    a.content = text
    revealShown.value = 0
    a.pendingMarkdown = true
    a.streamComplete = false
    bumpRevealPump()
    scroll.scheduleFollowScroll()
    void nextTick(() => scroll.scrollFeedToEnd(true))
  }

  function tryManusCollapseAndFinalReveal(a: ChatMessage) {
    if (a.mode !== 'manus') return
    tryCollapseManusPanel(a)
    maybeStartManusFinalReveal(a)
  }

  function manusStepTick() {
    manusStepRafId = 0
    const a = streamingAssistant()
    if (!a || a.mode !== 'manus' || a.manusFinalRevealStarted) return

    syncManusRevealLens(a)
    const entries = manusStepsMainEntries(a.manusSteps)
    const lens = a.manusMainRowRevealChars!
    let i = 0
    for (; i < entries.length; i++) {
      const cap = (entries[i].step.summary || '').length
      if ((lens[i] ?? 0) < cap) break
    }

    if (i < entries.length) {
      const cap = (entries[i].step.summary || '').length
      const cur = lens[i] ?? 0
      const behind = cap - cur
      const step = Math.max(1, Math.min(3, Math.ceil(behind / 102)))
      lens[i] = Math.min(cap, cur + step)
      scroll.scheduleManusStepsInnerScroll(a.id, true)
      tryManusCollapseAndFinalReveal(a)
      manusStepRafId = requestAnimationFrame(manusStepTick)
    } else {
      tryManusCollapseAndFinalReveal(a)
    }
  }

  function bumpManusStepPump() {
    const a = streamingAssistant()
    if (!a || a.mode !== 'manus' || a.manusFinalRevealStarted) return
    if (manusStepRafId) return
    manusStepRafId = requestAnimationFrame(manusStepTick)
  }

  function applyManusPayload(a: ChatMessage, payload: Record<string, unknown>) {
    if (!a.manusSteps) a.manusSteps = []
    const messageType =
      typeof payload.messageType === 'string' ? payload.messageType : undefined
    const summary = typeof payload.summary === 'string' ? payload.summary : undefined
    const phase = typeof payload.phase === 'string' ? payload.phase : undefined

    a.manusSteps.push({
      phase,
      summary,
      messageType,
      raw: JSON.stringify(payload),
    })

    if (messageType === 'MODEL' && summary && a.mode !== 'manus') {
      a.content = summary
    }

    syncManusRevealLens(a)
    bumpManusStepPump()
  }

  function applyManusRawFallback(a: ChatMessage, data: string) {
    if (!a.manusSteps) a.manusSteps = []
    a.manusSteps.push({
      raw: data,
      summary: data.slice(0, 200),
    })
    syncManusRevealLens(a)
    bumpManusStepPump()
  }

  const sseOps: ChatSseModeOps = {
    bumpRevealPump,
    bumpManusStepPump,
    applyManusPayload,
    applyManusRawFallback,
    scheduleFollowScroll: scroll.scheduleFollowScroll,
    tryManusCollapseAndFinalReveal,
  }

  function handleSseMessage(msg: SseMessage) {
    const a = streamingAssistant()
    if (!a) return
    const strategy = getChatSseModeStrategy(a.mode)
    strategy.consumeSseMessage(a, msg, sseOps)
  }

  /** 当前条 Manus 助手是否仍处于「步进气泡打字」阶段（终稿 reveal 未启动） */
  function manusStepListIsTypingLive(m: ChatMessage): boolean {
    const list = messages.value
    const tail = list[list.length - 1]
    return (
      m.role === 'assistant' &&
      m.mode === 'manus' &&
      tail?.id === m.id &&
      !m.streamComplete &&
      !m.manusFinalRevealStarted
    )
  }

  function manusMainRowCharCount(m: ChatMessage, rowIndex: number): number {
    return m.manusMainRowRevealChars?.[rowIndex] ?? 0
  }

  function manusMainVisibleSummarySlice(
    m: ChatMessage,
    rowIndex: number,
    summary: string | undefined,
  ): string {
    if (!summary) return ''
    if (!manusStepListIsTypingLive(m)) return summary
    const n = manusMainRowCharCount(m, rowIndex)
    return summary.slice(0, n)
  }

  /** 当前行是否为「正在打字」的那一行（用于光标） */
  function manusStepRowShowsCaret(
    m: ChatMessage,
    rowIndex: number,
    summary: string | undefined,
  ): boolean {
    if (!summary || !manusStepListIsTypingLive(m)) return false
    const entries = manusStepsMainEntries(m.manusSteps)
    const lens = m.manusMainRowRevealChars || []
    let i = 0
    for (; i < entries.length; i++) {
      const cap = (entries[i].step.summary || '').length
      if ((lens[i] ?? 0) < cap) break
    }
    return i === rowIndex && manusMainRowCharCount(m, rowIndex) < summary.length
  }

  function toggleManusPanel(m: ChatMessage) {
    const cur = m.manusPanelExpanded !== false
    m.manusPanelExpanded = !cur
  }

  function streamPlainPreview(m: ChatMessage): string {
    return m.content.slice(0, Math.min(revealShown.value, m.content.length))
  }

  return {
    revealShown,
    streamingAssistant,
    stopRevealRaf,
    bumpRevealPump,
    finalizePendingMarkdownIfCaughtUp,
    stopManusStepRaf,
    bumpManusStepPump,
    handleSseMessage,
    tryManusCollapseAndFinalReveal,
    manusMainVisibleSummarySlice,
    manusStepRowShowsCaret,
    toggleManusPanel,
    streamPlainPreview,
  }
}
