<script setup lang="ts">
import brandIconUrl from '../assets/wiselink-robot-head.png'
</script>

<template>
  <header class="window-head">
    <div class="topbar-inner">
      <div class="topbar-brand">
        <img
          class="topbar-brand-mark"
          :src="brandIconUrl"
          width="28"
          height="28"
          alt=""
          decoding="async"
        />
        <h1 class="topbar-title">WiseLink AI</h1>
      </div>
    </div>
  </header>
</template>

<style scoped>
.window-head {
  flex-shrink: 0;
  background: #fff;
  border-bottom: 1px solid rgba(42, 8, 72, 0.12);
  padding: 0.65rem 0.95rem;
}

.topbar-inner {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.75rem;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.topbar-brand-mark {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.55rem;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 2px 10px rgba(59, 7, 100, 0.22);
}

.topbar-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #2d1b4e;
}

@media (max-width: 420px) {
  .topbar-brand-mark {
    width: 1.5rem;
    height: 1.5rem;
  }
}
</style>
