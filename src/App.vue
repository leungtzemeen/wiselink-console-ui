<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { renderAssistantMarkdown } from './utils/markdown'
import {
  manusOnlyHiddenStepsPending,
  manusStepsDebugEntries,
  manusStepsMainEntries,
} from './utils/manusStepDisplay'
import { buildChatUrl, consumeSseResponse, type SseMessage } from './utils/sse'
import brandIconUrl from './assets/wiselink-robot-head.png'
import assistantAvatarUrl from './assets/wiselink-logo-circle.png'

export interface ManusStep {
  phase?: string
  summary?: string
  messageType?: string
  raw: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  mode: 'normal' | 'manus'
  content: string
  manusSteps?: ManusStep[]
  manusDone?: boolean
  /**
   * Manus：步事件区是否展开。发送后为 true。
   * 收口策略（保守）：理想情况在 RUN_FINISHED·META 对应气泡播完后再收；`done` 到达且主列表已全部打字完成后也会收口（兜底）。
   */
  manusPanelExpanded?: boolean
  /** Manus：主列表每条气泡已 reveal 字数（与 manusStepsMainEntries 顺序一致，选 B 排队打字机） */
  manusMainRowRevealChars?: number[]
  /** Manus：done 中的终稿；收口后才写入 content 并开始 reveal */
  manusPendingFinalSummary?: string
  /** Manus：已开始终稿 reveal（避免重复启动） */
  manusFinalRevealStarted?: boolean
  /** 流式首包前随机一条等待文案（按 mode 在发送时抽选，避免重渲染换句） */
  streamingWaitHint?: string
  /** 本轮 SSE 是否已结束（成功 / 失败）；用于新发送前丢弃未完成气泡 */
  streamComplete?: boolean
  /** SSE 已读完，等逐字追平全文后再切 Markdown，避免长文/导出类内容整块蹦出 */
  pendingMarkdown?: boolean
}

/**
 * 浏览器仅在「安全上下文」（https 或 localhost/127.0.0.1）提供 crypto.randomUUID。
 * 用 http://局域网IP 打开时不可用，会导致发消息、挂载时报错。
 */
function createClientId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const b = new Uint8Array(16)
    c.getRandomValues(b)
    b[6] = (b[6]! & 0x0f) | 0x40
    b[8] = (b[8]! & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

const NORMAL_STREAM_WAIT_HINTS = [
  '正在思考中...',
  '正在处理您的请求...',
  '请稍等，信息马上呈现...',
] as const

const MANUS_STREAM_WAIT_HINTS = [
  '脑细胞正在高速运转中 🧠⚡',
  'Manus 正在全速奔跑中，马上就来！',
  '正在为你精心准备大招...',
] as const

function pickStreamingWaitHint(mode: 'normal' | 'manus'): string {
  const pool = mode === 'manus' ? MANUS_STREAM_WAIT_HINTS : NORMAL_STREAM_WAIT_HINTS
  return pool[Math.floor(Math.random() * pool.length)]!
}

const userPrompt = ref('')
const promptTrimmed = computed(() => userPrompt.value.trim())

const sessionId = ref('')
const activeTab = ref<'normal' | 'manus'>('normal')

const loading = ref(false)
const error = ref<string | null>(null)

/** 单一时间线：与后端同一 sessionId 对齐，两 Tab 共用聊天记录 */
const messages = ref<ChatMessage[]>([])
let streamingAssistantIndex = -1
let streamGeneration = 0

/**
 * 最后一条为助手且尚未标记完成：涵盖智选灵犀整段 SSE + 终稿 reveal，
 * 以及 Manus 步进打字、收口、终稿 reveal，直到 `streamComplete` 为 true。
 */
const assistantReplyInFlight = computed(() => {
  const list = messages.value
  const m = list[list.length - 1]
  return !!(m?.role === 'assistant' && !m.streamComplete)
})

/** 点击助手头像时展示的 Agent 介绍 Popover（Teleport 到 body，避免被 feed 裁剪） */
const agentPopoverMessageId = ref<string | null>(null)
const agentPopoverAnchorRef = ref<HTMLElement | null>(null)
const agentPopoverPos = ref({ top: 0, left: 0 })

const agentPopoverMessage = computed(() => {
  const id = agentPopoverMessageId.value
  if (!id) return null
  return messages.value.find((x) => x.id === id) ?? null
})

const POPOVER_CARD_W = 268
const POPOVER_GAP = 10

function updateAgentPopoverPosition(anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = POPOVER_GAP
  const estH = 300
  let left: number
  let top: number

  const placeBelow = r.bottom + gap + estH <= vh - 12 && r.top < vh * 0.55
  if (placeBelow) {
    top = r.bottom + gap
    left = Math.min(Math.max(10, r.left), vw - POPOVER_CARD_W - 10)
  } else {
    left = r.right + gap
    if (left + POPOVER_CARD_W > vw - 10) {
      left = Math.max(10, r.left - POPOVER_CARD_W - gap)
    }
    top = r.top
    if (top + estH > vh - 10) {
      top = Math.max(10, vh - estH - 10)
    }
  }

  agentPopoverPos.value = { top, left }
}

function toggleAgentPopover(m: ChatMessage, ev: MouseEvent) {
  if (m.role !== 'assistant') return
  ev.stopPropagation()
  const el = ev.currentTarget as HTMLElement
  if (agentPopoverMessageId.value === m.id) {
    closeAgentPopover()
    return
  }
  agentPopoverMessageId.value = m.id
  agentPopoverAnchorRef.value = el
  nextTick(() => updateAgentPopoverPosition(el))
}

/** Popover 关闭：仅清空状态，绝不 blur，避免抢输入框焦点。 */
function closeAgentPopover() {
  agentPopoverMessageId.value = null
  agentPopoverAnchorRef.value = null
}

function repositionOpenAgentPopover() {
  const anchor = agentPopoverAnchorRef.value
  if (agentPopoverMessageId.value && anchor) {
    updateAgentPopoverPosition(anchor)
  }
}

function onAgentPopoverEscape(ev: KeyboardEvent) {
  if (ev.key !== 'Escape' || !agentPopoverMessageId.value) return
  ev.preventDefault()
  closeAgentPopover()
}

const AGENT_POPOVER_TAGS_NORMAL = [
  '商品选购',
  '多维对比',
  '理性算账',
  '生活服务',
] as const
const AGENT_POPOVER_TAGS_MANUS = [
  '自主任务拆解',
  '深度数据抓取',
  '跨平台调度',
  '报告导出',
] as const

const agentPopoverTitle = computed(() => {
  const m = agentPopoverMessage.value
  if (!m) return ''
  return m.mode === 'manus' ? 'Manus (全能执行助理)' : '智选灵犀 (专属导购朋友)'
})

const agentPopoverTags = computed(() => {
  const m = agentPopoverMessage.value
  if (!m) return [] as string[]
  return m.mode === 'manus'
    ? [...AGENT_POPOVER_TAGS_MANUS]
    : [...AGENT_POPOVER_TAGS_NORMAL]
})

const agentPopoverFooter = computed(() => {
  const m = agentPopoverMessage.value
  if (!m) return ''
  return m.mode === 'manus'
    ? '⚡ 高能待命中 | 期待复杂指令挑战'
    : '🟢 实时在线 | 随时准备为你货比三家'
})

const AGENT_QUICK_PROMPT_COMPARE =
  '帮我对比一下最近热门的两款手机，看看哪款性价比更高。'
const AGENT_QUICK_PROMPT_MANUS_DEEP =
  '帮我全网搜索关于 [待填入主题] 的深度信息并生成一份分析报告。'

/**
 * 一键直达：在 Popover 已关、键盘与布局稳定后滚动（须晚于 close，避免布局塌陷冲掉 scrollIntoView）。
 */
function scrollAgentPromptAfterPopoverClosed() {
  const el = document.getElementById('user-prompt') as HTMLTextAreaElement | null
  if (!el) return
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' })
  } catch {
    el.scrollIntoView(false)
  }
  const dock = el.closest('.composer-dock')
  if (dock) {
    try {
      ;(dock as HTMLElement).scrollIntoView({
        behavior: 'smooth',
        block: 'end',
        inline: 'nearest',
      })
    } catch {
      ;(dock as HTMLElement).scrollIntoView(false)
    }
  }
  const card = el.closest('.chat-window')
  if (card) {
    try {
      ;(card as HTMLElement).scrollIntoView({
        behavior: 'smooth',
        block: 'end',
        inline: 'nearest',
      })
    } catch {
      ;(card as HTMLElement).scrollIntoView(false)
    }
  }
}

/**
 * 一键直达：必须在 click 同步栈内先 focus 再改值与选区，否则 iOS / Android 不会弹出软键盘。
 * 滚动与关卡片解耦：先关 Popover，再宏任务延迟滚动，避免塌陷冲掉 scrollIntoView。
 */
function applyAgentQuickPromptFromUserGesture(
  mode: 'normal' | 'manus',
  text: string,
  selectBracket: boolean,
) {
  const el = document.getElementById('user-prompt') as HTMLTextAreaElement | null
  if (!el || el.disabled) return

  el.focus({ preventScroll: true })

  activeTab.value = mode
  userPrompt.value = text
  el.value = text
  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }))

  if (selectBracket) {
    const open = text.indexOf('[')
    const close = text.indexOf(']', open + 1)
    if (open !== -1 && close > open) {
      el.setSelectionRange(open + 1, close)
    } else {
      el.setSelectionRange(text.length, text.length)
    }
  } else {
    el.setSelectionRange(text.length, text.length)
  }

  closeAgentPopover()

  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      scrollAgentPromptAfterPopoverClosed()
    }, 150)
  }
}

function onAgentQuickCompare(ev: MouseEvent) {
  ev.stopPropagation()
  ev.preventDefault()
  applyAgentQuickPromptFromUserGesture('normal', AGENT_QUICK_PROMPT_COMPARE, false)
}

function onAgentQuickManusDeep(ev: MouseEvent) {
  ev.stopPropagation()
  ev.preventDefault()
  applyAgentQuickPromptFromUserGesture('manus', AGENT_QUICK_PROMPT_MANUS_DEEP, true)
}

const canSend = computed(
  () =>
    promptTrimmed.value.length > 0 &&
    !loading.value &&
    !assistantReplyInFlight.value
)

const feedWrap = ref<HTMLElement | null>(null)

/** 流式阶段逐字显示长度；完成后整段转 Markdown */
const revealShown = ref(0)
let revealRafId = 0

let abort: AbortController | null = null

function stopRevealRaf() {
  if (revealRafId) {
    cancelAnimationFrame(revealRafId)
    revealRafId = 0
  }
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
    scheduleFollowScroll()
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
  scrollFeedToEnd(true)
  return true
}

function bumpRevealPump() {
  if (revealRafId) return
  revealRafId = requestAnimationFrame(() => {
    revealTick()
  })
}

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

function streamingAssistant(): ChatMessage | null {
  const list = messages.value
  const m = list[streamingAssistantIndex]
  if (m && m.role === 'assistant') return m
  return null
}

/**
 * Manus 步进面板收口（折叠）。
 * - `done`：**必须**调用，作为保守兜底（`manusStepsHasRunFinishedMeta` 不可信为唯一条件）。
 * - 日后若在 RUN_FINISHED·META 播完时提前收口，仍须在 `done` 再调一次（幂等），确保漏事件时也能收起。
 */
function collapseManusStepPanel(a: ChatMessage) {
  if (a.mode === 'manus') {
    a.manusPanelExpanded = false
    void nextTick(() => scrollManusStepsOlToEnd(a.id, true))
  }
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

function manusMainVisibleSummarySlice(m: ChatMessage, rowIndex: number, summary: string | undefined): string {
  if (!summary) return ''
  if (!manusStepListIsTypingLive(m)) return summary
  const n = manusMainRowCharCount(m, rowIndex)
  return summary.slice(0, n)
}

/** 当前行是否为「正在打字」的那一行（用于光标） */
function manusStepRowShowsCaret(m: ChatMessage, rowIndex: number, summary: string | undefined): boolean {
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
  scheduleFollowScroll()
  void nextTick(() => scrollFeedToEnd(true))
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
    scheduleManusStepsInnerScroll(a.id, true)
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

function handleSseMessage(msg: SseMessage) {
  const a = streamingAssistant()
  if (!a) return

  if (a.mode === 'normal') {
    if (msg.data) a.content += msg.data
    bumpRevealPump()
    return
  }

  if (msg.event === 'manus') {
    try {
      const o = JSON.parse(msg.data) as Record<string, unknown>
      applyManusPayload(a, o)
    } catch {
      if (!a.manusSteps) a.manusSteps = []
      a.manusSteps.push({
        raw: msg.data,
        summary: msg.data.slice(0, 200),
      })
      syncManusRevealLens(a)
      bumpManusStepPump()
    }
    scheduleFollowScroll()
    return
  }

  if (msg.event === 'done') {
    a.manusDone = true
    if (a.mode === 'manus') {
      let pending = ''
      try {
        const o = JSON.parse(msg.data) as Record<string, unknown>
        const fs = o.finalSummary
        pending = typeof fs === 'string' ? fs : ''
      } catch {
        pending = ''
      }
      a.manusPendingFinalSummary = pending
      bumpManusStepPump()
      tryManusCollapseAndFinalReveal(a)
    } else {
      try {
        const o = JSON.parse(msg.data) as Record<string, unknown>
        const fs = o.finalSummary
        if (typeof fs === 'string' && fs.trim()) {
          a.content = fs
        }
      } catch {
        /* ignore */
      }
      bumpRevealPump()
    }
    scheduleFollowScroll()
  }
}

function onPromptKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  if (!(e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  if (canSend.value) void startStream()
}

async function startStream(presetPrompt?: string) {
  const prompt =
    presetPrompt != null && String(presetPrompt).trim() !== ''
      ? String(presetPrompt).trim()
      : userPrompt.value.trim()
  if (!prompt) {
    error.value = '请先输入要发送的内容。'
    return
  }

  const gen = ++streamGeneration

  abort?.abort()
  abort = new AbortController()
  stopManusStepRaf()

  const list = messages.value
  const tail = list[list.length - 1]
  if (tail?.role === 'assistant' && !tail.streamComplete) {
    if (list.length >= 2) list.splice(-2, 2)
  }
  streamingAssistantIndex = -1

  error.value = null
  loading.value = true

  const mode = activeTab.value
  const uid = () => createClientId()
  list.push(
    { id: uid(), role: 'user', mode, content: prompt },
    {
      id: uid(),
      role: 'assistant',
      mode,
      content: '',
      streamingWaitHint: pickStreamingWaitHint(mode),
      manusSteps: [],
      manusDone: false,
      ...(mode === 'manus'
        ? {
            manusPanelExpanded: true as const,
            manusMainRowRevealChars: [] as number[],
            manusFinalRevealStarted: false as const,
          }
        : {}),
      streamComplete: false,
    }
  )
  streamingAssistantIndex = list.length - 1
  scrollFeedToEnd(true)
  revealShown.value = 0
  stopRevealRaf()
  userPrompt.value = ''

  let gotFirst = false
  const markFirst = () => {
    if (!gotFirst) {
      gotFirst = true
      loading.value = false
      const cur = streamingAssistant()
      if (cur?.mode !== 'manus') bumpRevealPump()
    }
  }

  const url = buildChatUrl(mode === 'normal' ? 'normal' : 'manus', {
    prompt,
    sessionId: sessionId.value,
  })

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: abort.signal,
      cache: 'no-store',
    })

    await consumeSseResponse(
      res,
      (m) => {
        markFirst()
        handleSseMessage(m)
      },
      markFirst
    )

    markFirst()
    const doneA = streamingAssistant()
    if (doneA) {
      if (doneA.mode === 'manus') {
        bumpManusStepPump()
        tryManusCollapseAndFinalReveal(doneA)
      } else {
        doneA.pendingMarkdown = true
        bumpRevealPump()
        finalizePendingMarkdownIfCaughtUp(doneA)
      }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      if (gen === streamGeneration) loading.value = false
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    error.value = msg
    const a = streamingAssistant()
    if (a) {
      if (a.mode === 'manus') stopManusStepRaf()
      if (!a.content.trim()) {
        a.content = `（请求失败：${msg}）`
      }
      revealShown.value = a.content.length
      stopRevealRaf()
      a.streamComplete = true
    }
    loading.value = false
  }

  scrollFeedToEnd(true)
}

const isNarrow = ref(false)

const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)') : null
function syncMq() {
  if (!mq) return
  isNarrow.value = mq.matches
}

function toggleManusPanel(m: ChatMessage) {
  const cur = m.manusPanelExpanded !== false
  m.manusPanelExpanded = !cur
}
onMounted(() => {
  sessionId.value = createClientId()
  if (mq) {
    syncMq()
    mq.addEventListener('change', syncMq)
  }
  window.addEventListener('resize', repositionOpenAgentPopover)
  window.addEventListener('keydown', onAgentPopoverEscape)
})
onBeforeUnmount(() => {
  abort?.abort()
  stopRevealRaf()
  stopManusStepRaf()
  cancelFollowScroll()
  mq?.removeEventListener('change', syncMq)
  window.removeEventListener('resize', repositionOpenAgentPopover)
  window.removeEventListener('keydown', onAgentPopoverEscape)
})

const tabLabel = computed(() =>
  activeTab.value === 'normal' ? '智选灵犀' : 'Manus'
)

const starterSuggestions = [
  '你能做些什么?',
  '我可以问哪些类型的问题?',
  '帮我理清思路、算清账、避风险',
] as const

function assistantHtml(content: string): string {
  return renderAssistantMarkdown(content)
}

function streamPlainPreview(m: ChatMessage): string {
  return m.content.slice(0, Math.min(revealShown.value, m.content.length))
}
</script>

<template>
  <div class="shell">
    <div class="chat-shell">
      <div class="chat-window">
        <header class="window-head">
          <div class="topbar-inner">
            <div class="topbar-brand">
              <img
                class="topbar-brand-mark"
                :src="brandIconUrl"
                width="28"
                height="28"
                alt=""
                decoding="async"
              />
              <h1 class="topbar-title">WiseLink AI</h1>
            </div>
          </div>
        </header>

        <div
          ref="feedWrap"
          class="feed-wrap"
          @scroll.passive="repositionOpenAgentPopover"
        >
          <div class="feed">
            <template v-if="messages.length === 0">
              <div class="onboarding-spacer" aria-hidden="true" />
              <section class="empty-onboarding" aria-label="开场引导">
                <p class="empty-greeting">
                  Hi~，我是你的专属导购<span class="greet-brand">WiseLink</span>
                </p>
                <div class="starter-chips" role="group" aria-label="快捷建议">
                  <button
                    v-for="t in starterSuggestions"
                    :key="t"
                    type="button"
                    class="starter-chip"
                    @click="void startStream(t)"
                  >
                    {{ t }}
                  </button>
                </div>
              </section>
            </template>

            <div
              v-for="m in messages"
              :key="m.id"
              class="msg-row"
              :class="m.role"
            >
              <button
                v-if="m.role === 'assistant'"
                type="button"
                class="msg-avatar msg-avatar-assistant"
                :class="{ 'is-agent-popover-open': agentPopoverMessageId === m.id }"
                aria-label="查看助手介绍"
                :aria-expanded="agentPopoverMessageId === m.id"
                aria-haspopup="dialog"
                @click="toggleAgentPopover(m, $event)"
              >
                <img
                  class="msg-avatar-img"
                  :src="assistantAvatarUrl"
                  width="40"
                  height="40"
                  alt=""
                  decoding="async"
                />
              </button>
              <div class="msg-stack">
          <div class="msg-meta">
            {{ m.role === 'user' ? '你' : '助手' }}
            <span v-if="m.role === 'assistant'" class="mode-tag">{{ m.mode === 'normal' ? '智选灵犀' : 'Manus' }}</span>
          </div>
          <div
            v-if="m.role === 'assistant' && m.mode === 'manus' && (m.manusSteps?.length || m.manusDone)"
            class="manus-panel"
          >
            <button
              type="button"
              class="manus-toggle"
              @click="toggleManusPanel(m)"
            >
              {{ m.manusPanelExpanded !== false ? '收起' : '展开' }}步进
              <span class="chev">{{ m.manusPanelExpanded !== false ? '▾' : '▸' }}</span>
            </button>
            <div
              class="manus-steps card-inset"
              :class="{ collapsed: m.manusPanelExpanded === false }"
            >
              <p class="manus-steps-title">步事件 <code>manus</code></p>
              <ol
                v-if="manusStepsMainEntries(m.manusSteps).length"
                :ref="(el) => setManusStepsOlRef(m.id, el)"
                class="steps"
              >
                <li
                  v-for="(ent, rowIndex) in manusStepsMainEntries(m.manusSteps)"
                  :key="`${m.id}-main-${ent.idx}`"
                  class="step"
                >
                  <div class="step-head">
                    <span v-if="ent.step.phase" class="pill phase">{{ ent.step.phase }}</span>
                    <span v-if="ent.step.messageType" class="pill type">{{ ent.step.messageType }}</span>
                  </div>
                  <p v-if="ent.step.summary" class="step-summary">
                    {{ manusMainVisibleSummarySlice(m, rowIndex, ent.step.summary) }}<span
                      v-if="manusStepRowShowsCaret(m, rowIndex, ent.step.summary)"
                      class="stream-caret"
                      aria-hidden="true"
                    >▎</span>
                  </p>
                  <details v-else class="raw-wrap">
                    <summary>原始数据</summary>
                    <pre class="raw">{{ ent.step.raw }}</pre>
                  </details>
                </li>
              </ol>
              <p
                v-else-if="manusOnlyHiddenStepsPending(m.manusSteps, !!m.manusDone)"
                class="empty"
              >
                处理中…
              </p>
              <p v-else-if="!m.manusSteps?.length" class="empty">暂无步事件</p>
              <p v-else-if="manusStepsDebugEntries(m.manusSteps).length" class="empty empty-muted">
                辅助信息已收起到下方「更多 / 调试」
              </p>
              <p v-else class="empty empty-muted">暂无对客展示的步事件</p>
              <details
                v-if="manusStepsDebugEntries(m.manusSteps).length"
                class="manus-debug"
              >
                <summary>更多 / 调试</summary>
                <ol class="steps steps-debug">
                  <li
                    v-for="{ step: s, idx } in manusStepsDebugEntries(m.manusSteps)"
                    :key="`${m.id}-dbg-${idx}`"
                    class="step step-debug"
                  >
                    <div class="step-head">
                      <span v-if="s.phase" class="pill phase">{{ s.phase }}</span>
                      <span v-if="s.messageType" class="pill type">{{ s.messageType }}</span>
                    </div>
                    <p v-if="s.summary" class="step-summary">{{ s.summary }}</p>
                    <details class="raw-wrap">
                      <summary>原始数据</summary>
                      <pre class="raw">{{ s.raw }}</pre>
                    </details>
                  </li>
                </ol>
              </details>
              <p v-if="m.manusDone" class="done-tag">已收到 <code>done</code></p>
            </div>
          </div>
          <div class="msg-bubble">
            <template
              v-if="
                m.role === 'assistant' &&
                m.mode === 'manus' &&
                !m.streamComplete &&
                m.id === messages[messages.length - 1]?.id &&
                !m.content &&
                m.manusPanelExpanded === false &&
                !m.manusDone
              "
            >
              <p class="manus-wait-tail">等待回复结束…</p>
            </template>
            <template
              v-else-if="
                m.role === 'assistant' &&
                !m.streamComplete &&
                m.id === messages[messages.length - 1]?.id &&
                !m.content &&
                !(m.mode === 'manus' && m.manusPanelExpanded === false && !m.manusDone)
              "
            >
              <p class="assistant-wait-hint" role="status" aria-live="polite">
                {{ m.streamingWaitHint ?? '请稍候…' }}
              </p>
            </template>
            <template v-else-if="m.role === 'assistant' && !m.content && m.streamComplete">
              （暂无文字）
            </template>
            <template v-else-if="m.role === 'assistant' && !m.streamComplete">
              <div class="plain-wrap">
                <span class="plain-stream">{{ streamPlainPreview(m) }}</span>
                <span
                  v-if="revealShown < m.content.length"
                  class="stream-caret"
                  aria-hidden="true"
                >▎</span>
              </div>
            </template>
            <template v-else-if="m.role === 'assistant' && m.streamComplete">
              <div class="md-body" v-html="assistantHtml(m.content)" />
            </template>
            <template v-else>
              {{ m.content }}
            </template>
          </div>
              </div>
            </div>

            <div v-if="error" class="alert" role="alert">
              {{ error }}
            </div>
          </div>
        </div>

        <div class="composer-dock">
          <div class="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'normal'"
              class="tab"
              :class="{ active: activeTab === 'normal' }"
              @click="activeTab = 'normal'"
            >
              智选灵犀
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="activeTab === 'manus'"
              class="tab"
              :class="{ active: activeTab === 'manus' }"
              @click="activeTab = 'manus'"
            >
              Manus
            </button>
          </div>

          <div class="composer">
            <textarea
              id="user-prompt"
              v-model="userPrompt"
              class="composer-input"
              rows="1"
              placeholder="输入你的问题…"
              spellcheck="false"
              @keydown="onPromptKeydown"
            />
            <button
              type="button"
              class="send-btn"
              :disabled="!canSend"
              :aria-label="loading || assistantReplyInFlight ? '处理中' : '发送'"
              @click="() => void startStream()"
            >
              <span v-if="loading || assistantReplyInFlight" class="send-spinner" aria-hidden="true" />
              <span v-else class="send-icon" aria-hidden="true">➤</span>
            </button>
          </div>
          <p class="composer-hint">
            <template v-if="isNarrow">点右侧按钮发送 · </template>
            <template v-else><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 发送 · </template>
            当前 <strong>{{ tabLabel }}</strong>
          </p>
        </div>
      </div>
    </div>

    <footer class="page-foot">© 2026 WiseLink. 保留所有权利。</footer>

    <Teleport to="body">
      <Transition name="agent-popover">
        <div
          v-if="agentPopoverMessage"
          class="agent-popover-layer"
          :key="agentPopoverMessage.id"
        >
          <div
            class="agent-popover-backdrop"
            aria-hidden="true"
            @click="closeAgentPopover"
          />
          <div
            class="agent-popover-card"
            :class="
              agentPopoverMessage.mode === 'manus'
                ? 'agent-popover-card--manus'
                : 'agent-popover-card--normal'
            "
            role="dialog"
            aria-modal="true"
            :aria-labelledby="'agent-popover-title-' + agentPopoverMessage.id"
            :style="{
              top: agentPopoverPos.top + 'px',
              left: agentPopoverPos.left + 'px',
              width: POPOVER_CARD_W + 'px',
            }"
            @click.stop
          >
            <div class="agent-popover-shine" aria-hidden="true" />
            <div class="agent-popover-head">
              <img
                class="agent-popover-avatar"
                :src="assistantAvatarUrl"
                width="44"
                height="44"
                alt=""
                decoding="async"
              />
              <div class="agent-popover-head-text">
                <h2
                  :id="'agent-popover-title-' + agentPopoverMessage.id"
                  class="agent-popover-title"
                >
                  {{ agentPopoverTitle }}
                </h2>
              </div>
            </div>
            <div class="agent-popover-tags" aria-label="技能标签">
              <span
                v-for="(tag, i) in agentPopoverTags"
                :key="i"
                class="agent-popover-tag"
              >
                {{ tag }}
              </span>
            </div>
            <p class="agent-popover-footer">
              {{ agentPopoverFooter }}
            </p>
            <button
              v-if="agentPopoverMessage.mode === 'normal'"
              type="button"
              class="agent-popover-action agent-popover-action--purple"
              @click.stop="onAgentQuickCompare"
            >
              ⚡ 帮我货比三家
            </button>
            <button
              v-else
              type="button"
              class="agent-popover-action agent-popover-action--blue"
              @click.stop="onAgentQuickManusDeep"
            >
              🛠️ 开启深度任务
            </button>
            <p class="agent-popover-hint">点击空白处关闭 · Esc</p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  max-width: min(960px, 100%);
  margin: 0 auto;
  min-height: 100dvh;
  min-height: 100svh;
  max-height: 100dvh;
  max-height: 100svh;
  overflow: hidden;
  padding-left: max(0.5rem, env(safe-area-inset-left, 0px));
  padding-right: max(0.5rem, env(safe-area-inset-right, 0px));
  padding-top: max(0.35rem, env(safe-area-inset-top, 0px));
  padding-bottom: max(0.25rem, env(safe-area-inset-bottom, 0px));
  background: #d4cfe0;
  color: #1c1530;
}

.window-head {
  flex-shrink: 0;
  background: #fff;
  border-bottom: 1px solid rgba(42, 8, 72, 0.12);
  padding: 0.65rem 0.95rem;
}

.topbar-inner {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.75rem;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.topbar-brand-mark {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.55rem;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 2px 10px rgba(59, 7, 100, 0.22);
}

.topbar-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #2d1b4e;
}

.chat-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.45rem 0.55rem 0.3rem;
}

.chat-window {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 1.35rem;
  border: 1px solid rgba(42, 8, 72, 0.18);
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.05),
    0 10px 40px rgba(42, 8, 72, 0.09);
  overflow: hidden;
}

.feed-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.85rem 1rem 0.65rem;
  background-color: #f2ecfc;
  background-image: url('/chat-bg.svg');
  background-size: cover;
  background-position: center;
  -webkit-overflow-scrolling: touch;
  overflow-anchor: none;
  scroll-behavior: auto;
}

.feed {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-bottom: 0.35rem;
  min-height: min(70vh, 28rem);
}

.onboarding-spacer {
  flex: 1 1 auto;
  min-height: 1.5rem;
}

.empty-onboarding {
  flex-shrink: 0;
  align-self: flex-start;
  max-width: min(100%, 22rem);
  padding: 0 0.15rem 0.5rem;
}

.empty-greeting {
  margin: 0 0 1rem;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.45;
  color: #2d1b4e;
}

.greet-brand {
  color: #2d1b4e;
  font-weight: 800;
}

.starter-chips {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.55rem;
}

.starter-chip {
  text-align: left;
  width: fit-content;
  max-width: min(100%, 22rem);
  box-sizing: border-box;
  white-space: normal;
  border: 1px solid rgba(42, 8, 72, 0.1);
  border-radius: 999px;
  padding: 0.55rem 1rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: #2d1b4e;
  background: linear-gradient(180deg, #f3f0fa 0%, #ebe6f5 100%);
  box-shadow: 0 1px 2px rgba(42, 8, 72, 0.06);
  cursor: pointer;
  transition:
    background 0.15s,
    box-shadow 0.15s,
    transform 0.12s;
}

.starter-chip:hover {
  background: linear-gradient(180deg, #faf8ff 0%, #f0ebfb 100%);
  box-shadow: 0 2px 8px rgba(76, 29, 149, 0.12);
}

.starter-chip:active {
  transform: scale(0.99);
}

.msg-row {
  display: flex;
  gap: 0.35rem;
  max-width: 100%;
  overflow-anchor: none;
}

.msg-row.user {
  flex-direction: column;
  align-items: flex-end;
}

.msg-row.user .msg-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
  max-width: 100%;
  min-width: 0;
}

.msg-row.assistant {
  flex-direction: row;
  align-items: flex-start;
  gap: 0.55rem;
}

.msg-row.assistant .msg-stack {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}

.msg-avatar {
  flex-shrink: 0;
  border-radius: 999px;
  background: linear-gradient(145deg, #ede9fe, #faf5ff);
}

button.msg-avatar.msg-avatar-assistant {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

button.msg-avatar.msg-avatar-assistant:focus-visible {
  outline: 2px solid rgba(124, 58, 237, 0.55);
  outline-offset: 2px;
}

button.msg-avatar.msg-avatar-assistant.is-agent-popover-open {
  outline: 2px solid rgba(124, 58, 237, 0.45);
  outline-offset: 2px;
}

.msg-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
  border-radius: inherit;
}

.msg-avatar-assistant {
  width: 2.5rem;
  height: 2.5rem;
  margin-top: 0.05rem;
  box-shadow:
    0 2px 12px rgba(76, 29, 149, 0.28),
    0 0 0 1px rgba(255, 255, 255, 0.65) inset;
  animation: assistant-avatar-breathe 3.2s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .msg-avatar-assistant {
    animation: none;
  }
}

@media (max-width: 420px) {
  .msg-avatar-assistant {
    width: 2.25rem;
    height: 2.25rem;
  }

  .topbar-brand-mark {
    width: 1.5rem;
    height: 1.5rem;
  }
}

@keyframes assistant-avatar-breathe {
  0%,
  100% {
    box-shadow:
      0 2px 12px rgba(76, 29, 149, 0.22),
      0 0 0 1px rgba(255, 255, 255, 0.65) inset,
      0 0 10px rgba(0, 210, 255, 0.12);
    transform: scale(1);
  }
  50% {
    box-shadow:
      0 4px 18px rgba(124, 58, 237, 0.38),
      0 0 0 1px rgba(255, 255, 255, 0.75) inset,
      0 0 18px rgba(0, 210, 255, 0.22);
    transform: scale(1.02);
  }
}

.msg-row.user .msg-bubble {
  background: #fff;
  border: 1px solid rgba(42, 8, 72, 0.16);
  border-radius: 1.25rem;
  box-shadow: 0 3px 14px rgba(42, 8, 72, 0.08);
}

.msg-row.assistant .msg-bubble {
  background: linear-gradient(180deg, #faf8ff 0%, #ffffff 100%);
  border: 1px solid rgba(42, 8, 72, 0.16);
  border-radius: 1.25rem;
  box-shadow: 0 3px 14px rgba(42, 8, 72, 0.07);
}

.msg-meta {
  font-size: 0.7rem;
  font-weight: 600;
  color: #6b5d86;
  padding-inline: 0.15rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.mode-tag {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: rgba(76, 29, 149, 0.18);
  color: #3b0764;
}

.msg-bubble {
  padding: 0.85rem 1.05rem;
  max-width: min(100%, 36rem);
  font-size: 0.95rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: #2a2440;
  isolation: isolate;
  backface-visibility: hidden;
}

.md-body {
  white-space: normal;
  word-break: break-word;
}

.md-body :deep(p) {
  margin: 0 0 0.65em;
}

.md-body :deep(p:last-child) {
  margin-bottom: 0;
}

.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4) {
  margin: 0.85em 0 0.45em;
  line-height: 1.3;
  color: #2d1f45;
  font-weight: 700;
}

.md-body :deep(h1) {
  font-size: 1.2rem;
}

.md-body :deep(h2) {
  font-size: 1.08rem;
}

.md-body :deep(h3) {
  font-size: 1.09rem;
  margin-top: 1.05em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid rgba(76, 29, 149, 0.12);
}

.md-body :deep(ul),
.md-body :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.35em;
}

.md-body :deep(li) {
  margin: 0.25em 0;
}

.md-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
  margin: 0.75rem 0;
}

.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid rgba(42, 8, 72, 0.14);
  padding: 0.4rem 0.55rem;
  text-align: left;
  vertical-align: top;
}

.md-body :deep(thead th) {
  background: rgba(76, 29, 149, 0.1);
  font-weight: 650;
}

.md-body :deep(pre) {
  margin: 0.65rem 0;
  padding: 0.65rem 0.75rem;
  border-radius: 0.65rem;
  background: #f4f0ff;
  border: 1px solid rgba(42, 8, 72, 0.12);
  font-size: 0.82rem;
  overflow-x: auto;
}

.md-body :deep(code) {
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 0.88em;
  padding: 0.12em 0.38em;
  border-radius: 0.35rem;
  background: rgba(76, 29, 149, 0.09);
  color: #3b0764;
}

.md-body :deep(pre code) {
  padding: 0;
  background: none;
  color: inherit;
  font-size: inherit;
}

.md-body :deep(a) {
  color: #4c1d95;
  font-weight: 650;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.md-body :deep(a:hover) {
  color: #3b0764;
}

.md-body :deep(blockquote) {
  margin: 0.65rem 0;
  padding: 0.35rem 0 0.35rem 0.85rem;
  border-left: 3px solid rgba(76, 29, 149, 0.4);
  color: #4a4458;
}

.md-body :deep(hr) {
  border: none;
  border-top: 1px solid rgba(42, 8, 72, 0.14);
  margin: 1rem 0;
}

.md-body :deep(strong) {
  font-weight: 700;
  color: #241835;
}

.plain-wrap {
  display: inline;
  font-size: 0.95rem;
  line-height: 1.55;
  color: #2a2440;
}

.plain-stream {
  white-space: pre-wrap;
  word-break: break-word;
}

.stream-caret {
  display: inline-block;
  width: 0.4em;
  min-width: 0.4em;
  text-align: center;
  margin-left: 1px;
  color: rgba(76, 29, 149, 0.85);
  font-weight: 300;
  vertical-align: text-bottom;
  animation: caret-blink 1.35s ease-in-out infinite;
}

@keyframes caret-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.18;
  }
}

.assistant-wait-hint {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: #5b4a7a;
}

.manus-panel {
  width: 100%;
  max-width: min(100%, 36rem);
}

.manus-toggle {
  width: 100%;
  margin-bottom: 0.4rem;
  padding: 0.55rem 0.75rem;
  border-radius: 1rem;
  border: 1px solid rgba(42, 8, 72, 0.14);
  background: #fff;
  font: inherit;
  font-weight: 650;
  font-size: 0.82rem;
  color: #4c1d95;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.manus-steps.collapsed {
  display: none;
}

.card-inset {
  background: #fff;
  border-radius: 1.1rem;
  border: 1px solid rgba(42, 8, 72, 0.12);
  padding: 0.75rem 0.85rem;
  box-shadow: 0 1px 8px rgba(42, 8, 72, 0.07);
}

.manus-steps-title {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: #5b4a7a;
}

.manus-steps-title code {
  font-size: 0.68rem;
  background: rgba(124, 58, 237, 0.08);
  padding: 0.05rem 0.3rem;
  border-radius: 0.3rem;
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: min(40vh, 280px);
  overflow: auto;
}

.step {
  padding: 0.5rem 0.6rem;
  border-radius: 0.85rem;
  background: #faf8ff;
  border: 1px solid rgba(42, 8, 72, 0.1);
}

.step-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-bottom: 0.25rem;
}

.pill {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
}

.pill.phase {
  background: rgba(124, 58, 237, 0.12);
  color: #5b21b6;
}

.pill.type {
  background: rgba(14, 165, 233, 0.12);
  color: #0369a1;
}

.step-summary {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: #3f365f;
}

.step-summary .stream-caret {
  font-size: 0.72rem;
  vertical-align: text-bottom;
}

.manus-wait-tail {
  margin: 0;
  font-size: 0.88rem;
  color: #6b5f8a;
}

.raw-wrap summary {
  cursor: pointer;
  font-size: 0.72rem;
  color: #6d28d9;
}

.raw {
  margin: 0.25rem 0 0;
  font-size: 0.65rem;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 100px;
  overflow: auto;
}

.empty {
  margin: 0;
  font-size: 0.8rem;
  color: #9b8fc4;
}

.empty.empty-muted {
  font-size: 0.75rem;
  color: #a8a0c2;
}

.manus-debug {
  margin-top: 0.65rem;
  padding-top: 0.5rem;
  border-top: 1px dashed rgba(42, 8, 72, 0.12);
}

.manus-debug > summary {
  cursor: pointer;
  font-size: 0.72rem;
  font-weight: 650;
  color: #6d28d9;
}

.steps-debug {
  margin-top: 0.45rem;
  max-height: min(32vh, 220px);
}

.step-debug .step-summary {
  font-size: 0.78rem;
}

.done-tag {
  margin: 0.5rem 0 0;
  font-size: 0.72rem;
  color: #059669;
}

.chev {
  opacity: 0.65;
}

.alert {
  padding: 0.75rem 1rem;
  border-radius: 1.1rem;
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
  font-size: 0.88rem;
}

.composer-dock {
  flex-shrink: 0;
  padding: 0.65rem 0.85rem calc(0.65rem + env(safe-area-inset-bottom, 0px));
  background: #fff;
  border-top: 1px solid rgba(42, 8, 72, 0.1);
}

.tabs {
  display: flex;
  width: 100%;
  gap: 0.35rem;
  padding: 0.2rem;
  background: #f4f0ff;
  border-radius: 999px;
  margin-bottom: 0.55rem;
}

.tab {
  flex: 1;
  border: none;
  cursor: pointer;
  padding: 0.5rem 0.75rem;
  border-radius: 999px;
  font-size: 0.88rem;
  font-weight: 650;
  color: #5b4a7a;
  background: transparent;
  transition: background 0.2s, color 0.2s, box-shadow 0.2s;
}

.tab:hover {
  color: #4c1d95;
}

.tab.active {
  background: #fff;
  color: #5b21b6;
  box-shadow: 0 2px 10px rgba(42, 8, 72, 0.14);
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.35rem 0.35rem 0.35rem 0.65rem;
  background: #f7f5fb;
  border-radius: 1.35rem;
  border: 1px solid rgba(42, 8, 72, 0.12);
}

.composer-input {
  flex: 1;
  min-height: 2.75rem;
  max-height: 8rem;
  margin: 0;
  padding: 0.55rem 0;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 0.95rem;
  line-height: 1.45;
  color: #2a2440;
  resize: none;
  outline: none;
}

.composer-input::placeholder {
  color: #a39bb8;
}

.composer-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.send-btn {
  flex-shrink: 0;
  width: 2.75rem;
  height: 2.75rem;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #4c1d95, #6d28d9);
  color: #fff;
  box-shadow: 0 4px 16px rgba(59, 7, 100, 0.45);
  transition: transform 0.15s, opacity 0.15s;
}

.send-btn:hover:not(:disabled) {
  transform: scale(1.04);
}

.send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}

.send-icon {
  font-size: 1rem;
  margin-left: 0.1rem;
}

.send-spinner {
  width: 1.1rem;
  height: 1.1rem;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.composer-hint {
  margin: 0.45rem 0 0;
  text-align: center;
  font-size: 0.68rem;
  color: #9b8fc4;
}

.composer-hint kbd {
  font-family: ui-monospace, monospace;
  font-size: 0.62rem;
  padding: 0.05rem 0.3rem;
  border-radius: 0.3rem;
  background: #f4f0ff;
  border: 1px solid rgba(42, 8, 72, 0.16);
  color: #5b21b6;
}

.page-foot {
  flex-shrink: 0;
  text-align: center;
  font-size: 0.62rem;
  color: #9ca3af;
  padding: 0.4rem 1rem calc(0.55rem + env(safe-area-inset-bottom, 0px));
  letter-spacing: 0.03em;
}

.agent-popover-layer {
  position: fixed;
  inset: 0;
  z-index: 9998;
  pointer-events: none;
}

/* 关闭时淡出（等价 Tailwind transition-opacity） */
.agent-popover-enter-active,
.agent-popover-leave-active {
  transition: opacity 0.22s ease;
}

.agent-popover-enter-from,
.agent-popover-leave-to {
  opacity: 0;
}

.agent-popover-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  background: rgba(15, 23, 42, 0.12);
  /* backdrop-blur-md */
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* rounded-xl + shadow-lg + bg-white/80 + backdrop-blur-md（项目未装 Tailwind，用 CSS 对齐常用 token） */
.agent-popover-card {
  position: fixed;
  z-index: 9999;
  pointer-events: auto;
  max-width: calc(100vw - 20px);
  box-sizing: border-box;
  padding: 1rem 1rem 0.7rem;
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(124, 58, 237, 0.28);
  box-shadow:
    0 10px 15px -3px rgba(15, 23, 42, 0.08),
    0 4px 6px -4px rgba(15, 23, 42, 0.06),
    0 20px 38px -14px rgba(76, 29, 149, 0.22);
  overflow-x: hidden;
  overflow-y: auto;
  max-height: min(72vh, 22rem);
  isolation: isolate;
}

.agent-popover-card--normal {
  border-color: rgba(109, 40, 217, 0.38);
  box-shadow:
    0 10px 15px -3px rgba(15, 23, 42, 0.08),
    0 4px 6px -4px rgba(15, 23, 42, 0.06),
    0 22px 44px -12px rgba(91, 33, 182, 0.28);
}

.agent-popover-card--manus {
  border-color: rgba(37, 99, 235, 0.42);
  box-shadow:
    0 10px 15px -3px rgba(15, 23, 42, 0.08),
    0 4px 6px -4px rgba(15, 23, 42, 0.06),
    0 22px 44px -12px rgba(29, 78, 216, 0.26);
}

.agent-popover-shine {
  position: absolute;
  top: -40%;
  right: -30%;
  width: 72%;
  height: 75%;
  pointer-events: none;
  z-index: 0;
}

.agent-popover-card--normal .agent-popover-shine {
  background: radial-gradient(
    circle at 35% 42%,
    rgba(167, 139, 250, 0.35) 0%,
    rgba(124, 58, 237, 0.1) 42%,
    transparent 70%
  );
}

.agent-popover-card--manus .agent-popover-shine {
  background: radial-gradient(
    circle at 35% 42%,
    rgba(96, 165, 250, 0.45) 0%,
    rgba(59, 130, 246, 0.12) 45%,
    transparent 70%
  );
}

.agent-popover-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.75rem;
}

.agent-popover-avatar {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow:
    0 2px 12px rgba(76, 29, 149, 0.28),
    0 0 0 2px rgba(255, 255, 255, 0.9);
}

.agent-popover-card--manus .agent-popover-avatar {
  box-shadow:
    0 2px 12px rgba(29, 78, 216, 0.3),
    0 0 0 2px rgba(255, 255, 255, 0.9);
}

.agent-popover-head-text {
  min-width: 0;
}

.agent-popover-title {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.3;
  color: #2d1b4e;
}

.agent-popover-card--manus .agent-popover-title {
  color: #172554;
}

.agent-popover-tags {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.85rem;
}

.agent-popover-tag {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 650;
  line-height: 1.2;
  padding: 0.28rem 0.5rem;
  border-radius: 999px;
  letter-spacing: 0.02em;
}

.agent-popover-card--normal .agent-popover-tag {
  color: #4c1d95;
  background: rgba(237, 233, 254, 0.95);
  border: 1px solid rgba(167, 139, 250, 0.45);
}

.agent-popover-card--manus .agent-popover-tag {
  color: #1e3a8a;
  background: rgba(219, 234, 254, 0.95);
  border: 1px solid rgba(96, 165, 250, 0.55);
}

.agent-popover-footer {
  position: relative;
  z-index: 1;
  margin: 0 0 0.65rem;
  font-size: 0.74rem;
  font-weight: 650;
  line-height: 1.45;
  color: #3f3656;
  padding: 0.45rem 0.55rem;
  border-radius: 0.5rem;
}

/* 等价 Tailwind: w-full py-2 rounded-lg text-white font-medium hover:opacity-90 transition-all */
.agent-popover-action {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 0.5rem;
  padding: 0.5rem 0.75rem;
  border: none;
  border-radius: 0.5rem;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 500;
  line-height: 1.35;
  color: #fff;
  text-align: center;
  cursor: pointer;
  transition:
    opacity 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

@media (hover: hover) {
  .agent-popover-action:hover {
    opacity: 0.9;
  }
}

.agent-popover-action:active {
  transform: scale(0.99);
}

.agent-popover-action:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: 2px;
}

.agent-popover-action--purple {
  background: linear-gradient(145deg, #5b21b6, #7c3aed);
  box-shadow: 0 4px 16px rgba(91, 33, 182, 0.42);
}

.agent-popover-action--blue {
  background: linear-gradient(145deg, #1d4ed8, #2563eb);
  box-shadow: 0 4px 16px rgba(29, 78, 216, 0.4);
}

.agent-popover-card--normal .agent-popover-footer {
  color: #4c1d95;
  background: linear-gradient(135deg, rgba(237, 233, 254, 0.9), rgba(221, 214, 254, 0.65));
  border: 1px solid rgba(167, 139, 250, 0.35);
}

.agent-popover-card--manus .agent-popover-footer {
  color: #1e40af;
  background: linear-gradient(135deg, rgba(219, 234, 254, 0.95), rgba(191, 219, 254, 0.7));
  border: 1px solid rgba(59, 130, 246, 0.35);
}

.agent-popover-hint {
  position: relative;
  z-index: 1;
  margin: 0.1rem 0 0;
  font-size: 0.6rem;
  color: #9b8fc4;
  text-align: center;
}

@media (prefers-color-scheme: dark) {
  .agent-popover-backdrop {
    background: rgba(2, 6, 23, 0.55);
  }

  .agent-popover-card {
    background: rgba(30, 27, 46, 0.82);
    color: #e9e4f4;
  }

  .agent-popover-title {
    color: #f5f3ff;
  }

  .agent-popover-card--manus .agent-popover-title {
    color: #dbeafe;
  }

  .agent-popover-card--normal .agent-popover-tag {
    color: #ddd6fe;
    background: rgba(76, 29, 149, 0.45);
    border-color: rgba(167, 139, 250, 0.35);
  }

  .agent-popover-card--manus .agent-popover-tag {
    color: #bfdbfe;
    background: rgba(30, 58, 138, 0.55);
    border-color: rgba(59, 130, 246, 0.4);
  }

  .agent-popover-card--normal .agent-popover-footer {
    color: #e9d5ff;
    background: linear-gradient(135deg, rgba(76, 29, 149, 0.5), rgba(67, 56, 102, 0.55));
    border-color: rgba(167, 139, 250, 0.28);
  }

  .agent-popover-card--manus .agent-popover-footer {
    color: #bfdbfe;
    background: linear-gradient(135deg, rgba(30, 58, 138, 0.55), rgba(23, 37, 84, 0.55));
    border-color: rgba(59, 130, 246, 0.3);
  }

  .agent-popover-hint {
    color: #a8a4b8;
  }

  .agent-popover-action--purple {
    background: linear-gradient(145deg, #6d28d9, #8b5cf6);
    box-shadow: 0 4px 18px rgba(124, 58, 237, 0.35);
  }

  .agent-popover-action--blue {
    background: linear-gradient(145deg, #2563eb, #3b82f6);
    box-shadow: 0 4px 18px rgba(59, 130, 246, 0.38);
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-popover-enter-active,
  .agent-popover-leave-active {
    transition-duration: 0.04s;
  }

  .agent-popover-card {
    scroll-behavior: auto;
  }
}

@media (max-width: 900px) {
  /* 与宽屏一致：最外层不滚动，仅 .feed-wrap 内跟底，避免页面级滚动条不随气泡走 */
  .shell {
    max-width: 100%;
    min-height: 100dvh;
    min-height: 100svh;
    max-height: 100dvh;
    max-height: 100svh;
    overflow: hidden;
  }

  .chat-shell {
    flex: 1;
    min-height: 0;
  }
}
</style>
