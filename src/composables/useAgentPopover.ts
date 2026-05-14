import { computed, nextTick, onBeforeUnmount, onMounted, type Ref, ref } from 'vue'
import type { ChatMessage } from '../types/chat'
import {
  AGENT_QUICK_PROMPT_COMPARE,
  AGENT_QUICK_PROMPT_MANUS_DEEP,
  POPOVER_CARD_W,
  POPOVER_GAP,
} from '../types/chat'

export function useAgentPopover(deps: {
  messages: Ref<ChatMessage[]>
  activeTab: Ref<'normal' | 'manus'>
  userPrompt: Ref<string>
}) {
  const agentPopoverMessageId = ref<string | null>(null)
  const agentPopoverAnchorRef = ref<HTMLElement | null>(null)
  const agentPopoverPos = ref({ top: 0, left: 0 })

  const agentPopoverMessage = computed(() => {
    const id = agentPopoverMessageId.value
    if (!id) return null
    return deps.messages.value.find((x) => x.id === id) ?? null
  })

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
    void nextTick(() => updateAgentPopoverPosition(el))
  }

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

  function applyAgentQuickPromptFromUserGesture(
    mode: 'normal' | 'manus',
    text: string,
    selectBracket: boolean,
  ) {
    const el = document.getElementById('user-prompt') as HTMLTextAreaElement | null
    if (!el || el.disabled) return
    el.focus({ preventScroll: true })
    deps.activeTab.value = mode
    deps.userPrompt.value = text
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

  onMounted(() => {
    window.addEventListener('resize', repositionOpenAgentPopover)
    window.addEventListener('keydown', onAgentPopoverEscape)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', repositionOpenAgentPopover)
    window.removeEventListener('keydown', onAgentPopoverEscape)
  })

  function onToggleAgentPopoverFromItem(payload: { message: ChatMessage; event: MouseEvent }) {
    toggleAgentPopover(payload.message, payload.event)
  }

  return {
    agentPopoverMessageId,
    agentPopoverMessage,
    agentPopoverPos,
    repositionOpenAgentPopover,
    closeAgentPopover,
    onAgentQuickCompare,
    onAgentQuickManusDeep,
    onToggleAgentPopoverFromItem,
  }
}
