/**
 * Manus SSE 步事件：主列表 / 「更多·调试」折叠区的展示规则（仅前端渲染层，不删原始 manusSteps）。
 * @see App.vue 步事件列表
 */

export interface ManusStepLike {
  phase?: string
  summary?: string
  messageType?: string
  raw: string
}

/** phase === STEP_STARTED && messageType === META：不对用户展示（列表跳过）。 */
export function isStepStartedMetaSkipped(s: ManusStepLike): boolean {
  return s.phase === 'STEP_STARTED' && s.messageType === 'META'
}

/**
 * 是否已出现 `RUN_FINISHED` + `META`（理想收口信号之一，用于步进气泡播完后再收起步进等）。
 * 后端**不保证**每条流都有；收口必须以 SSE `done` 为保守兜底，避免界面卡死。
 */
export function manusStepsHasRunFinishedMeta(steps: ManusStepLike[] | undefined): boolean {
  if (!steps?.length) return false
  return steps.some((s) => s.phase === 'RUN_FINISHED' && s.messageType === 'META')
}

/** 主列表：RUN_STARTED/RUN_FINISHED 的 META；STEP_OUTCOME 且 summary 非空。 */
export function isManusStepMainVisible(s: ManusStepLike): boolean {
  if (s.phase === 'RUN_STARTED' && s.messageType === 'META') return true
  if (s.phase === 'RUN_FINISHED' && s.messageType === 'META') return true
  if (isStepStartedMetaSkipped(s)) return false
  if (s.phase === 'STEP_OUTCOME') return !!s.summary?.trim()
  return false
}

/** 其余非 STEP_STARTED·META 事件：折叠到「更多 / 调试」。 */
export function isManusStepDebugFoldable(s: ManusStepLike): boolean {
  if (isManusStepMainVisible(s)) return false
  if (isStepStartedMetaSkipped(s)) return false
  return true
}

export function manusStepsMainEntries(steps: ManusStepLike[] | undefined) {
  if (!steps?.length) return []
  return steps
    .map((step, idx) => ({ step, idx }))
    .filter(({ step }) => isManusStepMainVisible(step))
}

export function manusStepsDebugEntries(steps: ManusStepLike[] | undefined) {
  if (!steps?.length) return []
  return steps
    .map((step, idx) => ({ step, idx }))
    .filter(({ step }) => isManusStepDebugFoldable(step))
}

/** 仅有 STEP_STARTED·META 等「对用户不可见」条目、且尚未 done 时的占位提示。 */
export function manusOnlyHiddenStepsPending(steps: ManusStepLike[] | undefined, manusDone: boolean) {
  if (!steps?.length || manusDone) return false
  return manusStepsMainEntries(steps).length === 0 && manusStepsDebugEntries(steps).length === 0
}
