/** Scheduling helpers for Monitoring probes on slow/unstable VPN links. */

export const MONITORING_TICK_MS = 5000
export const MONITORING_LINK_INTERVAL_MS = 15_000
export const MONITORING_SERVER_INTERVAL_MS = 45_000
export const MONITORING_PREVIEW_INTERVAL_MS = 180_000
export const MONITORING_STREAMS_REFRESH_MS = 6 * 60 * 60 * 1000
export const MONITORING_MAX_LINK_BATCH = 10
export const MONITORING_MAX_SERVER_BATCH = 6
export const MONITORING_MAX_PREVIEW_BATCH = 2
export const MONITORING_MAX_BACKOFF_MS = 5 * 60_000
/** Links flap on VPN — do not wait minutes to re-check. */
export const MONITORING_MAX_LINK_BACKOFF_MS = 45_000

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
  /** True after a successful bootstrap (version/streams) for current credentials. */
  bootstrapped: boolean
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
    bootstrapped: false
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
