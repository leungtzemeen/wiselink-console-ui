import type { Ref } from 'vue'
import type { ChatMessage } from '../types/chat'
import { createClientId, pickStreamingWaitHint } from '../types/chat'
import { buildChatUrl, consumeSseResponse, type SseMessage } from '../utils/sse'
import type { TypewriterScrollApi } from './useTypewriter'

export interface ChatServiceDeps {
  messages: Ref<ChatMessage[]>
  userPrompt: Ref<string>
  activeTab: Ref<'normal' | 'manus'>
  sessionId: Ref<string>
  loading: Ref<boolean>
  error: Ref<string | null>
  streamingAssistantIndex: Ref<number>
  scroll: TypewriterScrollApi & {
    cancelFollowScroll: () => void
    scrollFeedToEnd: (force: boolean) => void
  }
  typewriter: {
    revealShown: Ref<number>
    stopRevealRaf: () => void
    stopManusStepRaf: () => void
    bumpRevealPump: () => void
    bumpManusStepPump: () => void
    finalizePendingMarkdownIfCaughtUp: (a: ChatMessage | null) => boolean
    handleSseMessage: (msg: SseMessage) => void
    streamingAssistant: () => ChatMessage | null
    tryManusCollapseAndFinalReveal: (a: ChatMessage) => void
  }
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

export function useChatService(deps: ChatServiceDeps) {
  let streamGeneration = 0
  let abort: AbortController | null = null

  /** 保留已生成内容，结束 UI 流式态并停掉打字机 / Manus 步进动画 */
  function finalizeStoppedStream(assistant: ChatMessage) {
    deps.typewriter.stopManusStepRaf()
    deps.typewriter.stopRevealRaf()
    assistant.pendingMarkdown = false
    assistant.streamComplete = true
    deps.typewriter.revealShown.value = assistant.content.length
  }

  function stopStream() {
    const assistant = deps.typewriter.streamingAssistant()
    if (!assistant || assistant.streamComplete) return

    abort?.abort()
    abort = null
    streamGeneration++
    finalizeStoppedStream(assistant)
    deps.loading.value = false
    deps.scroll.scrollFeedToEnd(true)
  }

  async function startStream(presetPrompt?: string) {
    const prompt =
      presetPrompt != null && String(presetPrompt).trim() !== ''
        ? String(presetPrompt).trim()
        : deps.userPrompt.value.trim()
    if (!prompt) {
      deps.error.value = '请先输入要发送的内容。'
      return
    }

    const gen = ++streamGeneration

    abort?.abort()
    abort = new AbortController()
    const signal = abort.signal
    deps.typewriter.stopManusStepRaf()

    const list = deps.messages.value
    const tail = list[list.length - 1]
    if (tail?.role === 'assistant' && !tail.streamComplete) {
      if (list.length >= 2) list.splice(-2, 2)
    }
    deps.streamingAssistantIndex.value = -1

    deps.error.value = null
    deps.loading.value = true

    const mode = deps.activeTab.value
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
      },
    )
    deps.streamingAssistantIndex.value = list.length - 1
    deps.scroll.scrollFeedToEnd(true)
    deps.typewriter.revealShown.value = 0
    deps.typewriter.stopRevealRaf()
    deps.userPrompt.value = ''

    let gotFirst = false
    const markFirst = () => {
      if (!gotFirst) {
        gotFirst = true
        deps.loading.value = false
        const cur = deps.typewriter.streamingAssistant()
        if (cur?.mode !== 'manus') deps.typewriter.bumpRevealPump()
      }
    }

    const url = buildChatUrl(mode === 'normal' ? 'normal' : 'manus', {
      prompt,
      sessionId: deps.sessionId.value,
    })

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal,
        cache: 'no-store',
      })

      await consumeSseResponse(
        res,
        (m) => {
          markFirst()
          deps.typewriter.handleSseMessage(m)
        },
        markFirst,
        signal,
      )

      if (gen !== streamGeneration) return

      markFirst()
      const doneA = deps.typewriter.streamingAssistant()
      if (doneA) {
        if (doneA.mode === 'manus') {
          deps.typewriter.bumpManusStepPump()
          deps.typewriter.tryManusCollapseAndFinalReveal(doneA)
        } else {
          doneA.pendingMarkdown = true
          deps.typewriter.bumpRevealPump()
          deps.typewriter.finalizePendingMarkdownIfCaughtUp(doneA)
        }
      }
    } catch (e) {
      if (isAbortError(e)) {
        if (gen === streamGeneration) {
          const a = deps.typewriter.streamingAssistant()
          if (a && !a.streamComplete) {
            finalizeStoppedStream(a)
          }
          deps.loading.value = false
        }
        return
      }
      if (gen !== streamGeneration) return

      const msg = e instanceof Error ? e.message : String(e)
      deps.error.value = msg
      const a = deps.typewriter.streamingAssistant()
      if (a) {
        if (a.mode === 'manus') deps.typewriter.stopManusStepRaf()
        if (!a.content.trim()) {
          a.content = `（请求失败：${msg}）`
        }
        deps.typewriter.revealShown.value = a.content.length
        deps.typewriter.stopRevealRaf()
        a.streamComplete = true
      }
      deps.loading.value = false
    }

    if (gen === streamGeneration) {
      deps.scroll.scrollFeedToEnd(true)
    }
  }

  function dispose() {
    stopStream()
  }

  return {
    startStream,
    stopStream,
    dispose,
  }
}
