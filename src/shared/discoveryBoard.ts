/** UPnP/ONVIF device class. Trassir sends it before the real model arrives. */
export function isPlaceholderDiscoveryBoard(value: string | null | undefined): boolean {
  const compact = (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!compact) return false
  if (compact.includes('digitalsecuritycamera')) return true
  return /^(digitalcamera|ipcamera|basic)\d*$/.test(compact)
}
