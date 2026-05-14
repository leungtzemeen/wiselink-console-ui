<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '../types/chat'
import {
  AGENT_POPOVER_TAGS_MANUS,
  AGENT_POPOVER_TAGS_NORMAL,
} from '../types/chat'
import assistantAvatarUrl from '../assets/wiselink-logo-circle.png'

const props = defineProps<{
  message: ChatMessage | null
  position: { top: number; left: number }
  cardWidth: number
}>()

const emit = defineEmits<{
  close: []
  'quick-compare': [ev: MouseEvent]
  'quick-manus-deep': [ev: MouseEvent]
}>()

const title = computed(() => {
  const m = props.message
  if (!m) return ''
  return m.mode === 'manus' ? 'Manus (全能执行助理)' : '智选灵犀 (专属导购朋友)'
})

const tags = computed(() => {
  const m = props.message
  if (!m) return [] as string[]
  return m.mode === 'manus' ? [...AGENT_POPOVER_TAGS_MANUS] : [...AGENT_POPOVER_TAGS_NORMAL]
})

const footer = computed(() => {
  const m = props.message
  if (!m) return ''
  return m.mode === 'manus'
    ? '⚡ 高能待命中 | 期待复杂指令挑战'
    : '🟢 实时在线 | 随时准备为你货比三家'
})
</script>

<template>
  <Teleport to="body">
    <Transition name="agent-popover">
      <div v-if="message" class="agent-popover-layer" :key="message.id">
        <div class="agent-popover-backdrop" aria-hidden="true" @click="emit('close')" />
        <div
          class="agent-popover-card"
          :class="
            message.mode === 'manus' ? 'agent-popover-card--manus' : 'agent-popover-card--normal'
          "
          role="dialog"
          aria-modal="true"
          :aria-labelledby="'agent-popover-title-' + message.id"
          :style="{
            top: position.top + 'px',
            left: position.left + 'px',
            width: cardWidth + 'px',
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
                :id="'agent-popover-title-' + message.id"
                class="agent-popover-title"
              >
                {{ title }}
              </h2>
            </div>
          </div>
          <div class="agent-popover-tags" aria-label="技能标签">
            <span v-for="(tag, i) in tags" :key="i" class="agent-popover-tag">
              {{ tag }}
            </span>
          </div>
          <p class="agent-popover-footer">
            {{ footer }}
          </p>
          <button
            v-if="message.mode === 'normal'"
            type="button"
            class="agent-popover-action agent-popover-action--purple"
            @click.stop="emit('quick-compare', $event)"
          >
            ⚡ 帮我货比三家
          </button>
          <button
            v-else
            type="button"
            class="agent-popover-action agent-popover-action--blue"
            @click.stop="emit('quick-manus-deep', $event)"
          >
            🛠️ 开启深度任务
          </button>
          <p class="agent-popover-hint">点击空白处关闭 · Esc</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.agent-popover-layer {
  position: fixed;
  inset: 0;
  z-index: 9998;
  pointer-events: none;
}

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
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

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
</style>
