import { REFERENCE_FILE_TYPE_ICONS, type ReviewFileType } from './referenceFileTypeIcons'
import { reviewFileType } from './reviewFileType'

type Props = {
  path: string
}

const FILE_ICON_COLORS = {
  blue: 'light-dark(#1a85d4, #69b1ff)',
  cyan: 'light-dark(#1ca1c7, #68cdf2)',
  gray: 'light-dark(#84848a, #adadb1)',
  green: 'light-dark(#199f43, #5ecc71)',
  indigo: 'light-dark(#693acf, #9d6afb)',
  mauve: 'light-dark(#594c5b, #79697b)',
  orange: 'light-dark(#d47628, #ffa359)',
  pink: 'light-dark(#d32a61, #ff678d)',
  purple: 'light-dark(#a631be, #d568ea)',
  red: 'light-dark(#d52c36, #ff6762)',
  teal: 'light-dark(#17a5af, #64d1db)',
  vermilion: 'light-dark(#ff8c5b, #d5512f)',
  yellow: 'light-dark(#d5a910, #ffd452)'
} as const

type FileIconColor = keyof typeof FILE_ICON_COLORS

const FILE_ICON_COLOR_BY_TYPE: Partial<Readonly<Record<ReviewFileType, FileIconColor>>> = {
  astro: 'purple',
  babel: 'yellow',
  bash: 'green',
  biome: 'blue',
  bootstrap: 'indigo',
  browserslist: 'yellow',
  bun: 'mauve',
  c: 'blue',
  claude: 'orange',
  cpp: 'blue',
  css: 'indigo',
  database: 'purple',
  default: 'gray',
  docker: 'blue',
  eslint: 'indigo',
  git: 'vermilion',
  go: 'cyan',
  graphql: 'pink',
  html: 'orange',
  image: 'pink',
  javascript: 'yellow',
  json: 'orange',
  markdown: 'green',
  mcp: 'teal',
  oxc: 'cyan',
  postcss: 'red',
  prettier: 'teal',
  python: 'blue',
  react: 'cyan',
  ruby: 'red',
  rust: 'orange',
  sass: 'pink',
  svg: 'orange',
  svelte: 'red',
  svgo: 'green',
  swift: 'orange',
  table: 'teal',
  tailwind: 'cyan',
  terraform: 'indigo',
  text: 'gray',
  typescript: 'blue',
  vite: 'purple',
  vscode: 'blue',
  vue: 'green',
  wasm: 'indigo',
  webpack: 'blue',
  yml: 'red',
  zig: 'orange',
  zip: 'orange'
}

function fileIconColor(fileType: ReviewFileType): string {
  const color = FILE_ICON_COLOR_BY_TYPE[fileType]
  return color
    ? `var(--trees-file-icon-color-${fileType}, var(--trees-file-icon-color, ${FILE_ICON_COLORS[color]}))`
    : 'var(--color-token-text-tertiary, var(--muted-foreground))'
}

export function ReviewFileTypeIcon({ path }: Props): React.JSX.Element {
  const fileType = reviewFileType(path)
  const Icon = REFERENCE_FILE_TYPE_ICONS[fileType]

  return (
    <span
      data-file-type={fileType}
      data-slot="review-file-type-icon"
      className="size-4 shrink-0"
      style={{ color: fileIconColor(fileType), colorScheme: 'light dark' }}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
    </span>
  )
}
