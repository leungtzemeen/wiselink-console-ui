import DOMPurify from 'dompurify'
import { marked } from 'marked'

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 仅允许 http(s) 链接，避免 javascript: 等 */
export function sanitizeHref(href: string): string | null {
  const t = href.trim()
  if (!t) return null
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'https://example.com/'
    const u = new URL(t, base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.href
  } catch {
    return null
  }
}

/**
 * 模型常输出 `###🍱标题`（# 与正文之间无空格），CommonMark 会当成普通段落，页面上就看到裸 `###`。
 * 在 ATX 标题标记后若紧跟非空白、非 `#` 的字符，则插入一个空格以便 marked 识别为 h1–h6。
 */
function normalizeAtxHeadingSpaces(md: string): string {
  const withAsciiHash = md.replace(/＃/g, '#')
  return withAsciiHash.replace(/^(\s*)(#{1,6})([^\s#])/gm, '$1$2 $3')
}

marked.use({
  async: false,
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const safe = sanitizeHref(href)
      if (!safe) return text
      const tAttr = title != null && title !== '' ? ` title="${escapeAttr(String(title))}"` : ''
      const isPdf = /\.pdf(\?|#|$)/i.test(safe)
      const dl = isPdf ? ' download' : ''
      return `<a href="${escapeAttr(safe)}"${tAttr} target="_blank" rel="noopener noreferrer"${dl}>${text}</a>`
    },
  },
})

export function renderAssistantMarkdown(md: string): string {
  if (!md.trim()) return ''
  const normalized = normalizeAtxHeadingSpaces(md)
  const raw = marked.parse(normalized, { async: false }) as string
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'download'],
  })
}
