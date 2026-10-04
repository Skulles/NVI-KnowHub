/**
 * toolId → React component map for interactive tools embedded in the app.
 */
import React from 'react'
import { FuelCalculator } from './FuelCalculator/FuelCalculator'
import { Monitoring } from './Monitoring/Monitoring'
import { NetworkDiscovery } from './NetworkDiscovery/NetworkDiscovery'
import { WinBox } from './WinBox/WinBox'

const registry: Record<string, React.ComponentType> = {
  'fuel-calculator': FuelCalculator,
  'monitoring': Monitoring,
  'network-discovery': NetworkDiscovery,
  'winbox': WinBox
}

export function getToolComponent(toolId: string): React.ComponentType | null {
  return registry[toolId] ?? null
}
