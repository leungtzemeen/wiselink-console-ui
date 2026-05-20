<template>
  <div class="shell">
    <div class="chat-shell">
      <div class="chat-window">
        <slot name="header" />
        <slot name="feed" />
        <slot name="composer" />
      </div>
    </div>
    <footer class="page-foot">© 2026 个人学习项目 · WiseLink 仅供技术演示，非商用。</footer>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  max-width: min(960px, 100%);
  margin: 0 auto;
  min-height: 100dvh;
  min-height: 100svh;
  max-height: 100dvh;
  max-height: 100svh;
  overflow: hidden;
  padding-left: max(0.5rem, env(safe-area-inset-left, 0px));
  padding-right: max(0.5rem, env(safe-area-inset-right, 0px));
  padding-top: max(0.35rem, env(safe-area-inset-top, 0px));
  padding-bottom: max(0.25rem, env(safe-area-inset-bottom, 0px));
  background: #d4cfe0;
  color: #1c1530;
}

.chat-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.45rem 0.55rem 0.3rem;
}

.chat-window {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 1.35rem;
  border: 1px solid rgba(42, 8, 72, 0.18);
  box-shadow:
    0 1px 3px rgba(15, 23, 42, 0.05),
    0 10px 40px rgba(42, 8, 72, 0.09);
  overflow: hidden;
}

.page-foot {
  flex-shrink: 0;
  text-align: center;
  font-size: 0.62rem;
  color: #9ca3af;
  padding: 0.4rem 1rem calc(0.55rem + env(safe-area-inset-bottom, 0px));
  letter-spacing: 0.03em;
}

@media (max-width: 900px) {
  .shell {
    max-width: 100%;
    min-height: 100dvh;
    min-height: 100svh;
    max-height: 100dvh;
    max-height: 100svh;
    overflow: hidden;
  }

  .chat-shell {
    flex: 1;
    min-height: 0;
  }
}
</style>
