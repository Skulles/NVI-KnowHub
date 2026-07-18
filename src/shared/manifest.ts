import type { ContentManifest, ContentItem, Section } from './types'

/** Все пункты содержания секции манифеста (учитывает подразделы). */
export function flattenSectionItems(section: Section): ContentItem[] {
  const fromSubs = section.subsections?.flatMap((sub) => sub.items) ?? []
  const fromItems = section.items ?? []
  if (fromSubs.length && fromItems.length) {
    return [...fromItems, ...fromSubs]
  }
  if (fromSubs.length) return fromSubs
  return fromItems
}

/** Все пункты манифеста — для синхронизации и проверки версий. */
export function flattenManifestItems(manifest: ContentManifest): ContentItem[] {
  return manifest.sections.flatMap((s) => flattenSectionItems(s))
}
