<script setup lang="ts">
import { renderAssistantMarkdown } from '../utils/markdown'
import type { ChatMessage } from '../types/chat'
import assistantAvatarUrl from '../assets/wiselink-logo-circle.png'
import ManusStepsPanel from './ManusStepsPanel.vue'

const props = defineProps<{
  message: ChatMessage
  isLast: boolean
  agentPopoverOpenId: string | null
  revealShown: number
  setManusStepsOlRef: (messageId: string, el: unknown) => void
  manusMainVisibleSummarySlice: (
    m: ChatMessage,
    rowIndex: number,
    summary: string | undefined,
  ) => string
  manusStepRowShowsCaret: (
    m: ChatMessage,
    rowIndex: number,
    summary: string | undefined,
  ) => boolean
  streamPlainPreview: (m: ChatMessage) => string
}>()

const emit = defineEmits<{
  'toggle-agent-popover': [payload: { message: ChatMessage; event: MouseEvent }]
  'toggle-manus-panel': [message: ChatMessage]
}>()

function assistantHtml(content: string): string {
  return renderAssistantMarkdown(content)
}
</script>

<template>
  <div class="msg-row" :class="message.role">
    <button
      v-if="message.role === 'assistant'"
      type="button"
      class="msg-avatar msg-avatar-assistant"
      :class="{ 'is-agent-popover-open': agentPopoverOpenId === message.id }"
      aria-label="查看助手介绍"
      :aria-expanded="agentPopoverOpenId === message.id"
      aria-haspopup="dialog"
      @click="emit('toggle-agent-popover', { message, event: $event })"
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
        {{ message.role === 'user' ? '你' : '助手' }}
        <span v-if="message.role === 'assistant'" class="mode-tag">{{
          message.mode === 'normal' ? '智选灵犀' : 'Manus'
        }}</span>
      </div>
      <ManusStepsPanel
        v-if="
          message.role === 'assistant' &&
          message.mode === 'manus' &&
          (message.manusSteps?.length || message.manusDone)
        "
        :message="message"
        :set-ol-ref="setManusStepsOlRef"
        :summary-slice="manusMainVisibleSummarySlice"
        :row-shows-caret="manusStepRowShowsCaret"
        @toggle-manus="emit('toggle-manus-panel', message)"
      />
      <div class="msg-bubble">
        <template
          v-if="
            message.role === 'assistant' &&
            message.mode === 'manus' &&
            !message.streamComplete &&
            isLast &&
            !message.content &&
            message.manusPanelExpanded === false &&
            !message.manusDone
          "
        >
          <p class="manus-wait-tail">等待回复结束…</p>
        </template>
        <template
          v-else-if="
            message.role === 'assistant' &&
            !message.streamComplete &&
            isLast &&
            !message.content &&
            !(message.mode === 'manus' && message.manusPanelExpanded === false && !message.manusDone)
          "
        >
          <p class="assistant-wait-hint" role="status" aria-live="polite">
            {{ message.streamingWaitHint ?? '请稍候…' }}
          </p>
        </template>
        <template v-else-if="message.role === 'assistant' && !message.content && message.streamComplete">
          （暂无文字）
        </template>
        <template v-else-if="message.role === 'assistant' && !message.streamComplete">
          <div class="plain-wrap">
            <span class="plain-stream">{{ props.streamPlainPreview(message) }}</span>
            <span
              v-if="revealShown < message.content.length"
              class="stream-caret"
              aria-hidden="true"
            >▎</span>
          </div>
        </template>
        <template v-else-if="message.role === 'assistant' && message.streamComplete">
          <div class="md-body" v-html="assistantHtml(message.content)" />
        </template>
        <template v-else>
          {{ message.content }}
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.manus-wait-tail {
  margin: 0;
  font-size: 0.88rem;
  color: #6b5f8a;
}
</style>
