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
/** A very low RTT usually means the workstation is connected directly to the object network. */
export const MONITORING_DIRECT_LINK_LATENCY_MS = 10

export type SignalTier = 'unknown' | 'direct' | 'excellent' | 'good' | 'degraded' | 'poor'
export type AdaptiveProbeKind = 'link' | 'server' | 'metrics'

export interface SignalSample {
  online: boolean
  latencyMs: number | null
  replyCount?: number
  sentCount?: number
  unstable?: boolean
}

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
  signalTier: SignalTier
  signalUpgradeSamples: number
  signalCandidateTier: SignalTier
  lastHttpOk: boolean | null
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
    signalTier: 'unknown',
    signalUpgradeSamples: 0,
    signalCandidateTier: 'unknown',
    lastHttpOk: null,
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

const SIGNAL_TIER_RANK: Record<SignalTier, number> = {
  unknown: 0,
  poor: 1,
  degraded: 2,
  good: 3,
  excellent: 4,
  direct: 5
}

function classifySignal(sample: SignalSample, currentTier: SignalTier): SignalTier {
  if (!sample.online) return 'poor'

  const sentCount = sample.sentCount ?? 0
  const replyCount = sample.replyCount ?? sentCount
  const packetLoss = sentCount > 0 ? Math.max(0, sentCount - replyCount) / sentCount : 0
  const latency = sample.latencyMs

  // Leave direct mode only after RTT rises above 15 ms, avoiding oscillation around 10 ms.
  const directThreshold = currentTier === 'direct' ? 15 : MONITORING_DIRECT_LINK_LATENCY_MS
  if (latency !== null && latency < directThreshold && packetLoss === 0 && !sample.unstable) {
    return 'direct'
  }
  if (sample.unstable || packetLoss > 0.4 || (latency !== null && latency >= 600)) return 'poor'
  if (packetLoss > 0.1 || latency === null || latency >= 250) return 'degraded'
  if (packetLoss === 0 && latency < 100) return 'excellent'
  return 'good'
}

/**
 * Downgrades immediately, while ordinary upgrades require three matching samples.
 * Direct mode is immediate so a wired connection starts refreshing metrics quickly.
 */
export function updateSignalTier(schedule: ObjectProbeSchedule, sample: SignalSample): SignalTier {
  const candidate = classifySignal(sample, schedule.signalTier)
  const currentRank = SIGNAL_TIER_RANK[schedule.signalTier]
  const candidateRank = SIGNAL_TIER_RANK[candidate]

  if (candidate === 'direct' || schedule.signalTier === 'unknown' || candidateRank <= currentRank) {
    schedule.signalTier = candidate
    schedule.signalCandidateTier = candidate
    schedule.signalUpgradeSamples = 0
    return schedule.signalTier
  }

  if (schedule.signalCandidateTier !== candidate) {
    schedule.signalCandidateTier = candidate
    schedule.signalUpgradeSamples = 1
    return schedule.signalTier
  }

  schedule.signalUpgradeSamples += 1
  if (schedule.signalUpgradeSamples >= 3) {
    schedule.signalTier = candidate
    schedule.signalUpgradeSamples = 0
  }
  return schedule.signalTier
}

/** Successful probe interval adjusted to the per-object connection quality. */
export function adaptiveIntervalMs(kind: AdaptiveProbeKind, tier: SignalTier): number {
  if (kind === 'link') {
    if (tier === 'direct' || tier === 'degraded' || tier === 'poor') return 10_000
    if (tier === 'excellent') return 30_000
    return MONITORING_LINK_INTERVAL_MS
  }

  if (kind === 'server') {
    if (tier === 'direct') return 20_000
    if (tier === 'excellent') return 60_000
    if (tier === 'degraded') return 30_000
    if (tier === 'poor') return 60_000
    return MONITORING_SERVER_INTERVAL_MS
  }

  if (tier === 'direct') return 30_000
  if (tier === 'excellent') return 6 * 60_000
  if (tier === 'degraded') return 5 * 60_000
  if (tier === 'poor') return 10 * 60_000
  return MONITORING_PREVIEW_INTERVAL_MS
}
