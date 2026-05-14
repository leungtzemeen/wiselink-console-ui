<script setup lang="ts">
import type { ChatMessage } from '../types/chat'
import {
  manusOnlyHiddenStepsPending,
  manusStepsDebugEntries,
  manusStepsMainEntries,
} from '../utils/manusStepDisplay'

const props = defineProps<{
  message: ChatMessage
  setOlRef: (messageId: string, el: unknown) => void
  summarySlice: (m: ChatMessage, rowIndex: number, summary: string | undefined) => string
  rowShowsCaret: (m: ChatMessage, rowIndex: number, summary: string | undefined) => boolean
}>()

const emit = defineEmits<{
  'toggle-manus': []
}>()
</script>

<template>
  <div class="manus-panel">
    <button type="button" class="manus-toggle" @click="emit('toggle-manus')">
      {{ message.manusPanelExpanded !== false ? '收起' : '展开' }}步进
      <span class="chev">{{ message.manusPanelExpanded !== false ? '▾' : '▸' }}</span>
    </button>
    <div
      class="manus-steps card-inset"
      :class="{ collapsed: message.manusPanelExpanded === false }"
    >
      <p class="manus-steps-title">步事件 <code>manus</code></p>
      <ol
        v-if="manusStepsMainEntries(message.manusSteps).length"
        :ref="(el) => props.setOlRef(message.id, el)"
        class="steps"
      >
        <li
          v-for="(ent, rowIndex) in manusStepsMainEntries(message.manusSteps)"
          :key="`${message.id}-main-${ent.idx}`"
          class="step"
        >
          <div class="step-head">
            <span v-if="ent.step.phase" class="pill phase">{{ ent.step.phase }}</span>
            <span v-if="ent.step.messageType" class="pill type">{{ ent.step.messageType }}</span>
          </div>
          <p v-if="ent.step.summary" class="step-summary">
            {{ props.summarySlice(message, rowIndex, ent.step.summary) }}<span
              v-if="props.rowShowsCaret(message, rowIndex, ent.step.summary)"
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
        v-else-if="manusOnlyHiddenStepsPending(message.manusSteps, !!message.manusDone)"
        class="empty"
      >
        处理中…
      </p>
      <p v-else-if="!message.manusSteps?.length" class="empty">暂无步事件</p>
      <p v-else-if="manusStepsDebugEntries(message.manusSteps).length" class="empty empty-muted">
        辅助信息已收起到下方「更多 / 调试」
      </p>
      <p v-else class="empty empty-muted">暂无对客展示的步事件</p>
      <details
        v-if="manusStepsDebugEntries(message.manusSteps).length"
        class="manus-debug"
      >
        <summary>更多 / 调试</summary>
        <ol class="steps steps-debug">
          <li
            v-for="{ step: s, idx } in manusStepsDebugEntries(message.manusSteps)"
            :key="`${message.id}-dbg-${idx}`"
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
      <p v-if="message.manusDone" class="done-tag">已收到 <code>done</code></p>
    </div>
  </div>
</template>

<style scoped>
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
</style>
