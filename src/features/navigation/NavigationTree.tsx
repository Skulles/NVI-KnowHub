import { Link, matchPath, useLocation } from 'react-router-dom'
import {
  type KnowledgeArticleSummary,
  type KnowledgeSection,
  TOOLS_SECTION_ID,
} from '../../entities/knowledge/types'
import { TOOL_NAV_ENTRIES } from '../../shared/config/toolsNav'
import {
  articlePath,
  decodeArticleSlugParam,
} from '../../shared/lib/routing/articlePath'

export type ArticleLocalChangeKind = 'added' | 'edited' | 'deleted'

type NavigationTreeProps = {
  sections: KnowledgeSection[]
  articles: KnowledgeArticleSummary[]
  /** Локальные изменения относительно опубликованного релиза: добавлено / правки / удалено из snapshot */
  articleLocalChangeKind?: Readonly<Record<string, ArticleLocalChangeKind>>
  /** Не подсвечивать активную статью (например, открыта форма создания поста). */
  muteActiveHighlight?: boolean
}

export function NavigationTree({
  sections,
  articles,
  articleLocalChangeKind,
  muteActiveHighlight,
}: NavigationTreeProps) {
  const location = useLocation()
  const routeMatch = matchPath('/article/:slug', location.pathname)
  const routeSlug =
    routeMatch?.params.slug !== undefined
      ? decodeArticleSlugParam(routeMatch.params.slug)
      : null

  const groupedSections = sections
    .filter((section) => section.parentId === null)
    .map((section) => ({
      ...section,
      articles: articles.filter((article) => article.sectionId === section.id),
    }))

  return (
    <nav className="navigation-tree">
      {groupedSections.map((section) => (
        <section key={section.id} className="navigation-section">
          <h3>{section.title}</h3>
          {section.id === TOOLS_SECTION_ID ? (
            <ul>
              {TOOL_NAV_ENTRIES.map((entry) => {
                const isActive = Boolean(
                  matchPath({ path: entry.path, end: true }, location.pathname),
                )
                return (
                  <li key={entry.id}>
                    <Link className={isActive ? 'active' : ''} to={entry.path}>
                      <span className="navigation-tree__link-text">{entry.title}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
          <ul>
            {section.articles.map((article) => {
              const to = articlePath(article.slug)
              const isActive =
                !muteActiveHighlight && routeSlug === article.slug

              const changeKind = articleLocalChangeKind?.[article.id]
              const dotClass =
                changeKind === 'added'
                  ? 'navigation-tree__draft-dot navigation-tree__draft-dot--added'
                  : changeKind === 'deleted'
                    ? 'navigation-tree__draft-dot navigation-tree__draft-dot--deleted'
                    : changeKind === 'edited'
                      ? 'navigation-tree__draft-dot navigation-tree__draft-dot--edited'
                      : null

              const dotTitle =
                changeKind === 'added'
                  ? 'Статья добавлена локально, ещё не в опубликованном релизе'
                  : changeKind === 'edited'
                    ? 'Есть несохранённые в релиз правки (черновик)'
                    : changeKind === 'deleted'
                      ? 'Статья удалена из актуального snapshot, черновик сохранён локально'
                      : undefined

              const dotHidden =
                changeKind === 'added'
                  ? ', добавлена локально, не в общей базе'
                  : changeKind === 'edited'
                    ? ', есть локальный черновик'
                    : changeKind === 'deleted'
                      ? ', статья удалена из snapshot, черновик только локально'
                      : ''

              return (
                <li key={article.id}>
                  <Link className={isActive ? 'active' : ''} to={to}>
                    <span className="navigation-tree__link-row">
                      {dotClass ? (
                        <span
                          aria-hidden
                          className={dotClass}
                          title={dotTitle}
                        />
                      ) : null}
                      <span className="navigation-tree__link-text">
                        {article.title}
                        {dotClass ? (
                          <span className="visually-hidden">{dotHidden}</span>
                        ) : null}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
          )}
        </section>
      ))}
    </nav>
  )
}
