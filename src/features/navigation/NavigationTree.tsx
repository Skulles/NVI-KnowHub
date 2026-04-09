import { Link, matchPath, useLocation } from 'react-router-dom'
import type {
  KnowledgeArticleSummary,
  KnowledgeSection,
} from '../../entities/knowledge/types'
import {
  articlePath,
  decodeArticleSlugParam,
} from '../../shared/lib/routing/articlePath'

type NavigationTreeProps = {
  sections: KnowledgeSection[]
  articles: KnowledgeArticleSummary[]
  /** Черновик или локально созданная статья, ещё не в опубликованном релизе */
  unpublishedArticleIds?: ReadonlySet<string>
}

export function NavigationTree({
  sections,
  articles,
  unpublishedArticleIds,
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
          <ul>
            {section.articles.map((article) => {
              const to = articlePath(article.slug)
              const isActive = routeSlug === article.slug

              const showUnpublishedDot =
                unpublishedArticleIds?.has(article.id) ?? false

              return (
                <li key={article.id}>
                  <Link className={isActive ? 'active' : ''} to={to}>
                    <span className="navigation-tree__link-row">
                      {showUnpublishedDot ? (
                        <span
                          aria-hidden
                          className="navigation-tree__draft-dot"
                          title="Локальные правки или статья ещё не опубликована в релиз"
                        />
                      ) : null}
                      <span className="navigation-tree__link-text">
                        {article.title}
                        {showUnpublishedDot ? (
                          <span className="visually-hidden">
                            , не опубликовано в общей базе (черновик или новая статья)
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </nav>
  )
}
