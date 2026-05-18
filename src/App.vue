<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ChatLayout from './components/ChatLayout.vue'
import ChatHeader from './components/ChatHeader.vue'
import ChatComposer from './components/ChatComposer.vue'
import ChatMessageItem from './components/ChatMessageItem.vue'
import AgentPopover from './components/AgentPopover.vue'
import { useAgentPopover } from './composables/useAgentPopover'
import { useAutoScroll } from './composables/useAutoScroll'
import { useChatService } from './composables/useChatService'
import { useTypewriter } from './composables/useTypewriter'
import type { ChatMessage } from './types/chat'
import { createClientId, POPOVER_CARD_W } from './types/chat'

export type { ChatMessage, ManusStep } from './types/chat'

const userPrompt = ref('')
const promptTrimmed = computed(() => userPrompt.value.trim())
const sessionId = ref('')
const activeTab = ref<'normal' | 'manus'>('normal')
const loading = ref(false)
const error = ref<string | null>(null)
const messages = ref<ChatMessage[]>([])
const streamingAssistantIndex = ref(-1)

const autoScroll = useAutoScroll()
const feedWrap = autoScroll.feedWrap
void feedWrap
const { setManusStepsOlRef, cancelFollowScroll } = autoScroll
const typewriter = useTypewriter(messages, streamingAssistantIndex, autoScroll)
const { startStream, stopStream, dispose: disposeChatFetch } = useChatService({
  messages,
  userPrompt,
  activeTab,
  sessionId,
  loading,
  error,
  streamingAssistantIndex,
  scroll: autoScroll,
  typewriter,
})

const {
  revealShown,
  streamPlainPreview,
  toggleManusPanel,
  manusMainVisibleSummarySlice,
  manusStepRowShowsCaret,
  stopRevealRaf,
  stopManusStepRaf,
} = typewriter

const assistantReplyInFlight = computed(() => {
  const list = messages.value
  const m = list[list.length - 1]
  return !!(m?.role === 'assistant' && !m.streamComplete)
})

const {
  agentPopoverMessageId,
  agentPopoverMessage,
  agentPopoverPos,
  repositionOpenAgentPopover,
  closeAgentPopover,
  onAgentQuickCompare,
  onAgentQuickManusDeep,
  onToggleAgentPopoverFromItem,
} = useAgentPopover({ messages, activeTab, userPrompt })

const canSend = computed(
  () =>
    promptTrimmed.value.length > 0 &&
    !loading.value &&
    !assistantReplyInFlight.value,
)

function onComposerSend() {
  if (canSend.value) void startStream()
}

const isNarrow = ref(false)
const mq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)') : null
function syncMq() {
  if (!mq) return
  isNarrow.value = mq.matches
}

onMounted(() => {
  sessionId.value = createClientId()
  if (mq) {
    syncMq()
    mq.addEventListener('change', syncMq)
  }
})
onBeforeUnmount(() => {
  disposeChatFetch()
  stopRevealRaf()
  stopManusStepRaf()
  cancelFollowScroll()
  mq?.removeEventListener('change', syncMq)
})

const tabLabel = computed(() => (activeTab.value === 'normal' ? '智选灵犀' : 'Manus'))
const starterSuggestions = [
  '你能做些什么?',
  '我可以问哪些类型的问题?',
  '帮我理清思路、算清账、避风险',
] as const
</script>

<template>
  <ChatLayout>
    <template #header>
      <ChatHeader />
    </template>
    <template #feed>
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

          <ChatMessageItem
            v-for="m in messages"
            :key="m.id"
            :message="m"
            :is-last="m.id === messages[messages.length - 1]?.id"
            :agent-popover-open-id="agentPopoverMessageId"
            :reveal-shown="revealShown"
            :set-manus-steps-ol-ref="setManusStepsOlRef"
            :manus-main-visible-summary-slice="manusMainVisibleSummarySlice"
            :manus-step-row-shows-caret="manusStepRowShowsCaret"
            :stream-plain-preview="streamPlainPreview"
            @toggle-agent-popover="onToggleAgentPopoverFromItem"
            @toggle-manus-panel="toggleManusPanel"
          />

          <div v-if="error" class="alert" role="alert">
            {{ error }}
          </div>
        </div>
      </div>
    </template>
    <template #composer>
      <ChatComposer
        v-model:user-prompt="userPrompt"
        v-model:active-tab="activeTab"
        :can-send="canSend"
        :loading="loading"
        :assistant-reply-in-flight="assistantReplyInFlight"
        :tab-label="tabLabel"
        :is-narrow="isNarrow"
        @send="onComposerSend"
        @stop="stopStream"
      />
    </template>
  </ChatLayout>

  <AgentPopover
    :message="agentPopoverMessage"
    :position="agentPopoverPos"
    :card-width="POPOVER_CARD_W"
    @close="closeAgentPopover"
    @quick-compare="onAgentQuickCompare"
    @quick-manus-deep="onAgentQuickManusDeep"
  />
</template>

<style src="./styles/chat-feed.css"></style>
