export interface SseMessage {
  event: string
  data: string
}

function parseSseBlock(block: string): SseMessage | null {
  const lines = block.split(/\r?\n/)
  let event = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice(6).trimStart()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^\s/, ''))
    }
  }

  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

/**
 * Consume a fetch Response body as SSE (text/event-stream) using ReadableStream.
 * Invokes onMessage for each complete SSE frame; onFirstChunk on first body chunk.
 */
export async function consumeSseResponse(
  response: Response,
  onMessage: (msg: SseMessage) => void,
  onFirstChunk?: () => void
): Promise<void> {
  if (!response.ok) {
    const t = await response.text().catch(() => '')
    throw new Error(t || `HTTP ${response.status}`)
  }

  const body = response.body
  if (!body) throw new Error('响应无 body')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let first = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!first && value?.length) {
      first = true
      onFirstChunk?.()
    }
    buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = findDoubleNewline(buffer)) !== -1) {
      const raw = buffer.slice(0, sep)
      buffer = buffer.slice(delimiterEnd(buffer, sep))
      const msg = parseSseBlock(raw)
      if (msg) onMessage(msg)
    }
  }

  const tail = buffer.trim()
  if (tail) {
    const msg = parseSseBlock(tail)
    if (msg) onMessage(msg)
  }
}

function findDoubleNewline(s: string): number {
  const a = s.indexOf('\n\n')
  const b = s.indexOf('\r\n\r\n')
  if (a === -1) return b
  if (b === -1) return a
  return Math.min(a, b)
}

function delimiterEnd(s: string, sep: number): number {
  if (s.slice(sep, sep + 4) === '\r\n\r\n') return sep + 4
  if (s.slice(sep, sep + 2) === '\n\n') return sep + 2
  return sep + 2
}

/**
 * 页面在 http://192.168.x.x:5173，而 .env 里是 http://192.168.x.x:8081/... 或 http://localhost:8081/...
 * 时，浏览器会跨端口/跨主机直连后端：易被 Windows 防火墙拦、或缺 CORS 导致手机一直等首包。
 * 若目标与当前页不同 origin，但属于「本机后端 / 同局域网主机上的 /api」，则改走当前页同源路径，交给 Vite/Nginx 反代。
 */
function coerceApiUrlToSamePageOrigin(absoluteUrl: string): string {
  if (typeof window === 'undefined') return absoluteUrl
  try {
    const abs = new URL(absoluteUrl, window.location.href)
    const page = window.location
    if (abs.origin === page.origin) return absoluteUrl
    const absHost = abs.hostname
    const pageHost = page.hostname
    const absIsLoopback = absHost === 'localhost' || absHost === '127.0.0.1'
    const sameHostname = absHost !== '' && absHost === pageHost
    if (absIsLoopback || sameHostname) {
      return `${abs.pathname}${abs.search}`
    }
    return absoluteUrl
  } catch {
    return absoluteUrl
  }
}

export function buildChatUrl(
  mode: 'normal' | 'manus',
  params: { prompt: string; sessionId: string }
): string {
  let rawBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim()

  /**
   * 开发环境用手机局域网 IP 打开时：一律走页面同源 `/api`，由本机 Vite 代理到 Java。
   * 避免 .env 里残留 localhost、或打包时写死的绝对地址导致请求打到「手机自己」。
   */
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const host = window.location.hostname
    const pageIsLoopback = host === 'localhost' || host === '127.0.0.1'
    if (!pageIsLoopback) {
      rawBase = '/api'
    }
  }

  /**
   * 生产构建在非 loopback 上打开时：若配置的 base 仍含 localhost/127，则改走同源 /api。
   */
  if (!import.meta.env.DEV && typeof window !== 'undefined' && rawBase) {
    const host = window.location.hostname
    const pageIsLoopback = host === 'localhost' || host === '127.0.0.1'
    const baseLooksLoopback =
      /(^|[/:@])localhost(?=[:/]|$)/i.test(rawBase) || /127\.0\.0\.1/.test(rawBase)
    if (!pageIsLoopback && baseLooksLoopback) {
      rawBase = '/api'
    }
  }

  const base = (rawBase || '/api').replace(/\/$/, '')
  const path = mode === 'normal' ? `${base}/ai/chat` : `${base}/ai/chat/manus`
  const search = new URLSearchParams({
    prompt: params.prompt,
    sessionId: params.sessionId,
  }).toString()

  if (/^https?:\/\//i.test(path)) {
    return coerceApiUrlToSamePageOrigin(`${path}?${search}`)
  }
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${normalized}?${search}`
}
