// Server-side page fetch for the link import: public http(s) only, a
// browser-like User-Agent (many recipe sites 403 anything else), a 10 s
// timeout and a 3 MB cap. Redirects are followed by hand so every hop gets
// the same host check.

export const PAGE_TIMEOUT_MS = 10_000
export const PAGE_MAX_BYTES = 3 * 1024 * 1024
const MAX_REDIRECTS = 5

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

export class PageFetchError extends Error {
  constructor(
    readonly status: 400 | 502,
    message: string,
  ) {
    super(message)
  }
}

// True for loopback, private, link-local and other non-public hosts. Works on
// URL.hostname, which the WHATWG parser has already normalised (so
// "http://2130706433/" arrives here as "127.0.0.1"). DNS names that resolve
// to private addresses are not caught; the Workers runtime cannot reach
// private networks anyway.
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!h.includes('.') && !h.includes(':')) return true // "localhost", "intranet"
  if (/\.(localhost|local|internal|lan|home|arpa)$/.test(h)) return true

  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
  }

  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedHost(mapped[1])
    if (/^::ffff:/.test(h)) return true
    return /^(fc|fd|fe[89ab])/.test(h)
  }
  return false
}

export function checkPublicUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PageFetchError(400, 'That is not a valid link.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PageFetchError(400, 'Only http and https links can be imported.')
  }
  if (url.username || url.password || isBlockedHost(url.hostname)) {
    throw new PageFetchError(400, "That link doesn't point to a public website.")
  }
  return url
}

export interface FetchedPage {
  // After redirects.
  url: string
  html: string
  truncated: boolean
}

export async function fetchPage(raw: string): Promise<FetchedPage> {
  let url = checkPublicUrl(raw)
  const signal = AbortSignal.timeout(PAGE_TIMEOUT_MS)
  for (let hop = 0; ; hop++) {
    let res: Response
    try {
      res = await fetch(url.toString(), {
        redirect: 'manual',
        signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
      })
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      throw new PageFetchError(502, timedOut ? 'The site took too long to answer.' : "Couldn't reach that site.")
    }

    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new PageFetchError(502, 'That link redirects too many times.')
      url = checkPublicUrl(new URL(location, url).toString())
      continue
    }
    if (!res.ok) throw new PageFetchError(502, `The site answered ${res.status}.`)

    const { text, truncated } = await readCapped(res, PAGE_MAX_BYTES)
    return { url: url.toString(), html: text, truncated }
  }
}

async function readCapped(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const room = max - bytes
    bytes += value.byteLength
    if (value.byteLength > room) {
      text += decoder.decode(value.subarray(0, room))
      await reader.cancel()
      return { text, truncated: true }
    }
    text += decoder.decode(value, { stream: true })
  }
  return { text: text + decoder.decode(), truncated: false }
}
