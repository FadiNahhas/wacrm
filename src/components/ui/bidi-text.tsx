import { Fragment, type ReactNode } from 'react'

// These tokens have a left-to-right order even inside an Arabic/Hebrew
// paragraph. Isolate them without adding invisible characters to stored text.
const LTR_TOKEN = /((?:https?:\/\/|www\.)[^\s<>]+|\b\d{1,2}:\d{2}[ \t]*[-–—][ \t]*\d{1,2}:\d{2}\b)/g

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

// Sentence punctuation after a URL stays outside it, but a closing bracket
// the URL itself opened (".../path_(test)") is part of the URL — the same
// rule linkify applies, so the isolate and the link cover the same text.
function trimUrlPunctuation(url: string): string {
  let end = url.length
  while (end > 0) {
    const ch = url[end - 1]
    if (!/[.,!?،؛؟)\]}]/.test(ch)) break
    const opener = CLOSERS[ch]
    if (opener) {
      const body = url.slice(0, end)
      if (body.split(opener).length > body.split(ch).length - 1) break
    }
    end--
  }
  return url.slice(0, end)
}

/** The isolated pieces of `text`, for callers that wrap them further (LinkifyText). */
export function bidiParts(text: string): ReactNode[] {
  return text.split(LTR_TOKEN).map((part, index) => {
    if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>
    const token = /^[hw]/.test(part) ? trimUrlPunctuation(part) : part
    const suffix = part.slice(token.length)
    return <Fragment key={index}><bdi dir="ltr">{token}</bdi>{suffix}</Fragment>
  })
}

export function BidiText({ children }: { children: string }) {
  return bidiParts(children)
}
