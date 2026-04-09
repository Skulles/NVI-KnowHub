import type { PlatformBridge } from './index'
import { createWebPlatformBridge } from './webBridge'

export function createDesktopPlatformBridge(
  overrides: Partial<PlatformBridge> = {},
): PlatformBridge {
  const webBridge = createWebPlatformBridge()

  return {
    ...webBridge,
    runtime: 'desktop',
    ...overrides,
  }
}
