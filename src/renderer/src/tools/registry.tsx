import React from 'react'
import { FuelCalculator } from './FuelCalculator/FuelCalculator'
import { WinBox } from './WinBox/WinBox'

const registry: Record<string, React.ComponentType> = {
  'fuel-calculator': FuelCalculator,
  'winbox': WinBox
}

export function getToolComponent(toolId: string): React.ComponentType | null {
  return registry[toolId] ?? null
}
