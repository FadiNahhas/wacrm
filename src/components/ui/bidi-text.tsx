import { Fragment, type ReactNode } from 'react'

// These tokens have a left-to-right order even inside an Arabic/Hebrew
// paragraph. Isolate them without adding invisible characters to stored text.
const LTR_TOKEN = /((?:https?:\/\/|www\.)[^\s<>]+|\b\d{1,2}:\d{2}[ \t]*[-–—][ \t]*\d{1,2}:\d{2}\b)/g

/** The isolated pieces of `text`, for callers that wrap them further (LinkifyText). */
export function bidiParts(text: string): ReactNode[] {
  return text.split(LTR_TOKEN).map((part, index) => {
    if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>
    const suffix = /^[hw]/.test(part) ? (part.match(/[.,!?،؛؟)\]}]+$/)?.[0] ?? '') : ''
    const token = suffix ? part.slice(0, -suffix.length) : part
    return <Fragment key={index}><bdi dir="ltr">{token}</bdi>{suffix}</Fragment>
  })
}

export function BidiText({ children }: { children: string }) {
  return bidiParts(children)
}
