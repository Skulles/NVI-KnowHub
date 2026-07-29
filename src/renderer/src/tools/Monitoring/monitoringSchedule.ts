/** Scheduling helpers for Monitoring probes on slow/unstable VPN links. */

export const MONITORING_TICK_MS = 5000
/** Faster loop while objects still await first link/server results. */
export const MONITORING_CATCHUP_TICK_MS = 750
export const MONITORING_LINK_INTERVAL_MS = 15_000
export const MONITORING_SERVER_INTERVAL_MS = 45_000
export const MONITORING_PREVIEW_INTERVAL_MS = 180_000
export const MONITORING_STREAMS_REFRESH_MS = 6 * 60 * 60 * 1000
export const MONITORING_MAX_LINK_BATCH = 10
export const MONITORING_MAX_SERVER_BATCH = 6
export const MONITORING_MAX_PREVIEW_BATCH = 2
/** Larger batches during initial catch-up so the first wave finishes sooner. */
export const MONITORING_MAX_LINK_BATCH_CATCHUP = 24
export const MONITORING_MAX_SERVER_BATCH_CATCHUP = 12
export const MONITORING_MAX_PREVIEW_BATCH_CATCHUP = 4
export const MONITORING_MAX_BACKOFF_MS = 5 * 60_000
/** Links flap on VPN — do not wait minutes to re-check. */
export const MONITORING_MAX_LINK_BACKOFF_MS = 45_000
/** Window for detecting link flapping (online ↔ offline). */
export const MONITORING_LINK_STABILITY_WINDOW_MS = 2 * 60_000
/** Min online↔offline flips inside the window to mark link unstable. */
export const MONITORING_LINK_STABILITY_MIN_FLIPS = 2
export const MONITORING_LINK_STATUS_HISTORY_LIMIT = 12

export function linkBatchLimit(catchUp: boolean): number {
  return catchUp ? MONITORING_MAX_LINK_BATCH_CATCHUP : MONITORING_MAX_LINK_BATCH
}

export function serverBatchLimit(catchUp: boolean): number {
  return catchUp ? MONITORING_MAX_SERVER_BATCH_CATCHUP : MONITORING_MAX_SERVER_BATCH
}

export function previewBatchLimit(catchUp: boolean): number {
  return catchUp ? MONITORING_MAX_PREVIEW_BATCH_CATCHUP : MONITORING_MAX_PREVIEW_BATCH
}

export function schedulerTickMs(catchUp: boolean): number {
  return catchUp ? MONITORING_CATCHUP_TICK_MS : MONITORING_TICK_MS
}

export interface LinkStatusSample {
  online: boolean
  at: number
}

/** True when the link recently flipped online↔offline enough times. */
export function isLinkUnstable(history: LinkStatusSample[] | undefined, now = Date.now()): boolean {
  if (!history?.length) return false
  const recent = history.filter((sample) => now - sample.at <= MONITORING_LINK_STABILITY_WINDOW_MS)
  if (recent.length < 3) return false
  let flips = 0
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].online !== recent[index - 1].online) flips += 1
  }
  return flips >= MONITORING_LINK_STABILITY_MIN_FLIPS
}

export function appendLinkStatusSample(
  history: LinkStatusSample[] | undefined,
  online: boolean,
  at = Date.now()
): LinkStatusSample[] {
  const prev = history ?? []
  const next = [...prev, { online, at }]
  return next.slice(-MONITORING_LINK_STATUS_HISTORY_LIMIT)
}

export function linkFailureBackoffMs(failures: number): number {
  const exp = Math.min(
    MONITORING_MAX_LINK_BACKOFF_MS,
    MONITORING_LINK_INTERVAL_MS * 2 ** Math.max(0, failures - 1)
  )
  return jitter(exp)
}

export interface ObjectProbeSchedule {
  nextLinkAt: number
  nextServerAt: number
  nextPreviewAt: number
  nextMegaphoneStatusAt: number
  linkFailures: number
  serverFailures: number
  previewFailures: number
  megaphoneStatusFailures: number
  lastStreamsAt: number
  lastMegaphonesAt: number
  /** Streams list fetched successfully for current credentials. */
  streamsReady: boolean
  /** Megaphones list fetched successfully for current credentials. */
  megaphonesReady: boolean
}

export function createProbeSchedule(now = Date.now()): ObjectProbeSchedule {
  return {
    nextLinkAt: now,
    nextServerAt: 0,
    nextPreviewAt: 0,
    nextMegaphoneStatusAt: 0,
    linkFailures: 0,
    serverFailures: 0,
    previewFailures: 0,
    megaphoneStatusFailures: 0,
    lastStreamsAt: 0,
    lastMegaphonesAt: 0,
    streamsReady: false,
    megaphonesReady: false
  }
}

export function jitter(ms: number, ratio = 0.2): number {
  const span = ms * ratio
  return Math.round(ms - span / 2 + Math.random() * span)
}

export function failureBackoffMs(failures: number, baseMs: number): number {
  const exp = Math.min(MONITORING_MAX_BACKOFF_MS, baseMs * 2 ** Math.max(0, failures - 1))
  return jitter(exp)
}

export function successDelayMs(baseMs: number): number {
  return jitter(baseMs)
}
