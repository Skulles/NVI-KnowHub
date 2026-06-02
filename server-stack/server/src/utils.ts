const RU: Record<string, string> = {
  а: 'a',  б: 'b',  в: 'v',  г: 'g',  д: 'd',  е: 'e',  ё: 'yo',
  ж: 'zh', з: 'z',  и: 'i',  й: 'y',  к: 'k',  л: 'l',  м: 'm',
  н: 'n',  о: 'o',  п: 'p',  р: 'r',  с: 's',  т: 't',  у: 'u',
  ф: 'f',  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '',   ы: 'y',  ь: '',   э: 'e',  ю: 'yu', я: 'ya'
}

export function toSlug(s: string, fallback = 'item'): string {
  const slug = s
    .trim()
    .toLowerCase()
    .split('')
    .map((c) => RU[c] ?? c)
    .join('')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return slug || fallback
}

export function titleToHtmlFile(title: string, articleId: string): string {
  return `${toSlug(title, articleId)}.html`
}
