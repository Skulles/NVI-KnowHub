import type { ContentManifest, ContentItem, Section } from './types'

/** Все пункты содержания секции манифеста (учитывает подразделы). */
export function flattenSectionItems(section: Section): ContentItem[] {
  if (section.subsections?.length) {
    return section.subsections.flatMap((sub) => sub.items)
  }
  return section.items ?? []
}

/** Все пункты манифеста — для синхронизации и проверки версий. */
export function flattenManifestItems(manifest: ContentManifest): ContentItem[] {
  return manifest.sections.flatMap((s) => flattenSectionItems(s))
}
