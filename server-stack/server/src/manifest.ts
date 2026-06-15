import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface ManifestItem {
  id: string
  title: string
  type: 'article' | 'tool'
  htmlFile?: string
  toolId?: string
  version: number
}

export interface Subsection {
  id: string
  title: string
  items: ManifestItem[]
}

export interface Section {
  id: string
  title: string
  icon?: string
  items?: ManifestItem[]
  subsections?: Subsection[]
}

export interface Manifest {
  version: number
  sections: Section[]
}

export function readManifest(contentDir: string): Manifest {
  const path = join(contentDir, 'manifest.json')
  if (!existsSync(path)) return { version: 1, sections: [] }
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest
}

export function writeManifest(contentDir: string, manifest: Manifest): void {
  manifest.version = (manifest.version ?? 0) + 1
  writeFileSync(join(contentDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

export function upsertArticleInManifest(
  manifest: Manifest,
  opts: {
    id: string
    title: string
    htmlFile: string
    sectionId: string
    sectionTitle: string
    sectionIcon?: string
    subsectionId?: string
    subsectionTitle?: string
  }
): void {
  const item: ManifestItem = {
    id: opts.id,
    title: opts.title,
    type: 'article',
    htmlFile: opts.htmlFile,
    version: 1
  }

  let section = manifest.sections.find((s) => s.id === opts.sectionId)
  if (!section) {
    section = { id: opts.sectionId, title: opts.sectionTitle, icon: opts.sectionIcon }
    manifest.sections.push(section)
  }

  if (opts.subsectionId) {
    if (!section.subsections) section.subsections = []
    let sub = section.subsections.find((s) => s.id === opts.subsectionId)
    if (!sub) {
      sub = { id: opts.subsectionId, title: opts.subsectionTitle ?? opts.subsectionId, items: [] }
      section.subsections.push(sub)
    }
    const idx = sub.items.findIndex((i) => i.id === opts.id)
    if (idx >= 0) {
      sub.items[idx] = { ...sub.items[idx], ...item, version: (sub.items[idx].version ?? 0) + 1 }
    } else {
      sub.items.push(item)
    }
  } else {
    if (!section.items) section.items = []
    const idx = section.items.findIndex((i) => i.id === opts.id)
    if (idx >= 0) {
      section.items[idx] = { ...section.items[idx], ...item, version: (section.items[idx].version ?? 0) + 1 }
    } else {
      section.items.push(item)
    }
  }
}

export function removeArticleFromManifest(manifest: Manifest, id: string): void {
  for (const section of manifest.sections) {
    if (section.items) {
      section.items = section.items.filter((i) => i.id !== id)
    }
    for (const sub of section.subsections ?? []) {
      sub.items = sub.items.filter((i) => i.id !== id)
    }
  }
}

export function reorderArticlesInManifest(
  manifest: Manifest,
  sectionId: string,
  subsectionId: string | undefined,
  articleIds: string[]
): void {
  const section = manifest.sections.find((s) => s.id === sectionId)
  if (!section) return

  const reorderItems = (items: ManifestItem[]): ManifestItem[] => {
    const byId = new Map(items.map((item) => [item.id, item]))
    const reordered = articleIds
      .map((id) => byId.get(id))
      .filter((item): item is ManifestItem => !!item)
    const remaining = items.filter((item) => !articleIds.includes(item.id))
    return [...reordered, ...remaining]
  }

  if (subsectionId) {
    const sub = section.subsections?.find((s) => s.id === subsectionId)
    if (sub) sub.items = reorderItems(sub.items)
  } else if (section.items) {
    section.items = reorderItems(section.items)
  }
}

export function reorderSubsectionsInManifest(
  manifest: Manifest,
  sectionId: string,
  subsectionIds: string[]
): void {
  const section = manifest.sections.find((s) => s.id === sectionId)
  if (!section?.subsections) return

  const byId = new Map(section.subsections.map((sub) => [sub.id, sub]))
  const reordered = subsectionIds
    .map((id) => byId.get(id))
    .filter((sub): sub is Subsection => !!sub)
  const remaining = section.subsections.filter((sub) => !subsectionIds.includes(sub.id))
  section.subsections = [...reordered, ...remaining]
}
