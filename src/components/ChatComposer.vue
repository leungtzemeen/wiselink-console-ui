<script setup lang="ts">
const userPrompt = defineModel<string>('userPrompt', { required: true })
const activeTab = defineModel<'normal' | 'manus'>('activeTab', { required: true })

const props = defineProps<{
  canSend: boolean
  loading: boolean
  assistantReplyInFlight: boolean
  tabLabel: string
  isNarrow: boolean
}>()

const emit = defineEmits<{
  send: []
  stop: []
}>()

function onPrimaryAction() {
  if (props.assistantReplyInFlight) {
    emit('stop')
    return
  }
  emit('send')
}

function onPromptKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  if (!(e.ctrlKey || e.metaKey)) return
  e.preventDefault()
  if (props.assistantReplyInFlight) {
    emit('stop')
    return
  }
  emit('send')
}
</script>

<template>
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
        :class="{ 'send-btn--stop': assistantReplyInFlight }"
        :disabled="!assistantReplyInFlight && !canSend"
        :aria-label="
          assistantReplyInFlight ? '停止生成' : loading ? '处理中' : '发送'
        "
        @click="onPrimaryAction"
      >
        <span
          v-if="assistantReplyInFlight"
          class="stop-icon"
          aria-hidden="true"
        />
        <span v-else-if="loading" class="send-spinner" aria-hidden="true" />
        <span v-else class="send-icon" aria-hidden="true">➤</span>
      </button>
    </div>
    <p class="composer-hint">
      <template v-if="isNarrow">点右侧按钮发送 · </template>
      <template v-else><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 发送 · </template>
      当前 <strong>{{ tabLabel }}</strong>
    </p>
  </div>
</template>

<style scoped>
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

.send-btn--stop {
  background: linear-gradient(145deg, #7f1d1d, #b91c1c);
  box-shadow: 0 4px 16px rgba(185, 28, 28, 0.4);
}

.send-btn--stop:hover:not(:disabled) {
  transform: scale(1.04);
}

.stop-icon {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 0.15rem;
  background: currentColor;
  display: block;
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
</style>
