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

export function useChatService(deps: ChatServiceDeps) {
  let streamGeneration = 0
  let abort: AbortController | null = null

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
        signal: abort.signal,
        cache: 'no-store',
      })

      await consumeSseResponse(
        res,
        (m) => {
          markFirst()
          deps.typewriter.handleSseMessage(m)
        },
        markFirst,
      )

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
      if ((e as Error).name === 'AbortError') {
        if (gen === streamGeneration) deps.loading.value = false
        return
      }
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

    deps.scroll.scrollFeedToEnd(true)
  }

  function dispose() {
    abort?.abort()
  }

  return {
    startStream,
    dispose,
  }
}
