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
export function createClientId(): string {
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

export const NORMAL_STREAM_WAIT_HINTS = [
  '正在思考中...',
  '正在处理您的请求...',
  '请稍等，信息马上呈现...',
] as const

export const MANUS_STREAM_WAIT_HINTS = [
  '脑细胞正在高速运转中 🧠⚡',
  'Manus 正在全速奔跑中，马上就来！',
  '正在为你精心准备大招...',
] as const

export function pickStreamingWaitHint(mode: 'normal' | 'manus'): string {
  const pool = mode === 'manus' ? MANUS_STREAM_WAIT_HINTS : NORMAL_STREAM_WAIT_HINTS
  return pool[Math.floor(Math.random() * pool.length)]!
}

export const AGENT_POPOVER_TAGS_NORMAL = [
  '商品选购',
  '多维对比',
  '理性算账',
  '生活服务',
] as const

export const AGENT_POPOVER_TAGS_MANUS = [
  '自主任务拆解',
  '深度数据抓取',
  '跨平台调度',
  '报告导出',
] as const

export const AGENT_QUICK_PROMPT_COMPARE =
  '帮我对比一下最近热门的两款手机，看看哪款性价比更高。'

export const AGENT_QUICK_PROMPT_MANUS_DEEP =
  '帮我全网搜索关于 [待填入主题] 的深度信息并生成一份分析报告。'

export const POPOVER_CARD_W = 268
export const POPOVER_GAP = 10
