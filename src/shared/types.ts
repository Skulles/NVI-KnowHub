export interface ContentManifest {
  version: number
  sections: Section[]
}

/** Подгруппа внутри секции сайдбара (напр. темы инструкций). */
export interface Subsection {
  id: string
  title: string
  items: ContentItem[]
}

export interface Section {
  id: string
  title: string
  icon?: string
  /**
   * Пункты, если секция без подразделов (`subsections`).
   * Если переданы только `subsections`, `items` можно не задавать.
   */
  items?: ContentItem[]
  /** Дополнительное деление на разделы (например внутри «Инструкции»). */
  subsections?: Subsection[]
}

export interface ContentItem {
  id: string
  title: string
  type: 'article' | 'tool'
  toolId?: string
  htmlFile?: string
  icon?: string
  version: number
}
