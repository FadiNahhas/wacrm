import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import { MessageBubble } from './message-bubble'
import type { Message } from '@/types'
import messages from '../../../messages/en.json'

const render = (content_text: string) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={messages}>
    <MessageBubble message={{
      id: 'm', conversation_id: 'c', sender_type: 'customer',
      content_type: 'text', content_text, status: 'delivered', created_at: '2026-09-08T10:00:00Z',
    } satisfies Message} />
  </NextIntlClientProvider>,
)

describe('activation key copy pill', () => {
  it('appears under a message that carries a labelled key', () => {
    const html = render('مرحبًا، لا أستطيع نقل كتابي. مفتاح التفعيل: 2ih2u1')
    expect(html).toContain('aria-label="Copy activation key 2IH2U1"')
    expect(html).toMatch(/<bdi dir="ltr"[^>]*>2IH2U1<\/bdi>/)
  })

  it('stays hidden on ordinary messages', () => {
    expect(render('Call me at 0521234567')).not.toContain('Copy activation key')
  })
})
