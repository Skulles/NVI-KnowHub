/** Маршруты встроенных инструментов (раздел «Инструменты» в навигации). */
export const TOOL_NAV_ENTRIES = [
  {
    id: 'fuel',
    title: 'Расчёт расхода топлива',
    path: '/tools/fuel',
  },
  {
    id: 'mikrotik',
    title: 'Помощник настройки MikroTik',
    path: '/tools/mikrotik',
  },
] as const
