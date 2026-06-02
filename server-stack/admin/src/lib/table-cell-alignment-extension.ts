import { Extension } from '@tiptap/core'

export type TableCellTextAlign = 'left' | 'center' | 'right' | 'justify'

export const TableCellAlignmentExtension = Extension.create({
  name: 'adminTableCellAlignment',
  addGlobalAttributes() {
    return [
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-text-align'),
            renderHTML: (attributes) => {
              const align = attributes.textAlign as TableCellTextAlign | null
              if (!align || align === 'left') return {}
              return {
                'data-text-align': align,
                style: `text-align: ${align}`,
              }
            },
          },
        },
      },
    ]
  },
})
