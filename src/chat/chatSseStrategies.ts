import type { ChatMessage } from '../types/chat'
import type { SseMessage } from '../utils/sse'

/**
 * 由各模式策略调用的原子操作；核心 SSE 循环只依赖此接口，符合开闭原则。
 */
export interface ChatSseModeOps {
  bumpRevealPump: () => void
  bumpManusStepPump: () => void
  applyManusPayload: (a: ChatMessage, o: Record<string, unknown>) => void
  applyManusRawFallback: (a: ChatMessage, data: string) => void
  scheduleFollowScroll: () => void
  tryManusCollapseAndFinalReveal: (a: ChatMessage) => void
}

export interface ChatSseModeStrategy {
  consumeSseMessage(assistant: ChatMessage, msg: SseMessage, ops: ChatSseModeOps): void
}

const normalStrategy: ChatSseModeStrategy = {
  consumeSseMessage(assistant, msg, ops) {
    if (msg.data) assistant.content += msg.data
    ops.bumpRevealPump()
  },
}

const manusStrategy: ChatSseModeStrategy = {
  consumeSseMessage(assistant, msg, ops) {
    if (msg.event === 'manus') {
      try {
        const o = JSON.parse(msg.data) as Record<string, unknown>
        ops.applyManusPayload(assistant, o)
      } catch {
        ops.applyManusRawFallback(assistant, msg.data)
      }
      ops.scheduleFollowScroll()
      return
    }

    if (msg.event === 'done') {
      assistant.manusDone = true
      if (assistant.mode === 'manus') {
        let pending = ''
        try {
          const o = JSON.parse(msg.data) as Record<string, unknown>
          const fs = o.finalSummary
          pending = typeof fs === 'string' ? fs : ''
        } catch {
          pending = ''
        }
        assistant.manusPendingFinalSummary = pending
        ops.bumpManusStepPump()
        ops.tryManusCollapseAndFinalReveal(assistant)
      } else {
        try {
          const o = JSON.parse(msg.data) as Record<string, unknown>
          const fs = o.finalSummary
          if (typeof fs === 'string' && fs.trim()) {
            assistant.content = fs
          }
        } catch {
          /* ignore */
        }
        ops.bumpRevealPump()
      }
      ops.scheduleFollowScroll()
    }
  },
}

export type RegisteredChatMode = ChatMessage['mode']

const strategies: Record<RegisteredChatMode, ChatSseModeStrategy> = {
  normal: normalStrategy,
  manus: manusStrategy,
}

/**
 * 未来新增模式（如 search）：实现 `ChatSseModeStrategy` 并在此注册即可，无需改 fetch/SSE 核心循环。
 */
export function registerChatSseModeStrategy(mode: RegisteredChatMode, strategy: ChatSseModeStrategy): void {
  strategies[mode] = strategy
}

export function getChatSseModeStrategy(mode: RegisteredChatMode): ChatSseModeStrategy {
  return strategies[mode]
}
