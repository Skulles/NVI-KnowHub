import React from 'react'

export type KnowHubLogoMarkProps = React.SVGProps<SVGSVGElement>

export function KnowHubLogoMark({
  className,
  ...props
}: KnowHubLogoMarkProps): React.ReactElement {
  return (
    <svg
      viewBox="0 0 200 200"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden
      {...props}
    >
      <g transform="translate(0,200) scale(0.1,-0.1)">
        <path d="M850 1553 c-16 -6 -171 -145 -293 -262 -43 -42 -84 -79 -92 -84 -25 -14 -34 -42 -64 -202 -16 -86 -35 -163 -42 -172 -7 -8 -39 -33 -71 -54 -31 -21 -64 -49 -72 -61 -23 -32 -20 -73 7 -101 30 -33 155 -107 181 -107 12 0 62 16 111 34 312 119 432 169 452 188 32 30 30 76 -6 126 -16 22 -35 43 -41 47 -25 15 -70 90 -70 115 0 15 25 118 55 228 30 111 55 214 55 230 0 47 -66 92 -110 75z" />
        <path d="M1022 1097 c-34 -36 -28 -77 16 -128 297 -343 456 -519 473 -524 29 -10 79 14 90 42 5 13 9 99 9 189 0 160 6 197 34 216 6 5 37 15 69 24 90 26 113 81 60 146 -50 60 -32 57 -394 58 l-336 0 -21 -23z" />
      </g>
    </svg>
  )
}