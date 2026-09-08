import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BidiText } from './bidi-text'

describe('BidiText', () => {
  it('isolates time ranges and URLs without swallowing sentence punctuation', () => {
    const html = renderToStaticMarkup(<BidiText>{'שעות הפעילות: 8:30–18:00. افتحوا https://elainebooks.com.'}</BidiText>)
    expect(html).toBe('שעות הפעילות: <bdi dir="ltr">8:30–18:00</bdi>. افتحوا <bdi dir="ltr">https://elainebooks.com</bdi>.')
  })
  it('preserves ordinary Arabic, Hebrew, English, and line breaks verbatim', () => {
    const text = 'أهلًا 🌷\nرمز التفعيل: AB-123\nשלום!\nYour code: 123456.'
    expect(renderToStaticMarkup(<BidiText>{text}</BidiText>)).toBe(text)
  })
  it('renders untrusted markup as text', () => {
    expect(renderToStaticMarkup(<BidiText>{'<img src=x onerror=alert(1)>'}</BidiText>))
      .toBe('&lt;img src=x onerror=alert(1)&gt;')
  })
})
