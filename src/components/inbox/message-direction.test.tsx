import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'
import { MessageBubble } from './message-bubble'
import { ReplyQuote } from './reply-quote'
import { InteractivePreview } from '../interactive/interactive-preview'
import type { Message } from '@/types'
import messages from '../../../messages/en.json'

const text = 'أهلًا 🌷 ساعات العمل 8:30–18:00.\nhttps://elainebooks.com\nYour code: AB-123.\nשלום, תודה!'
const render = (element: React.ReactElement) => renderToStaticMarkup(
  <NextIntlClientProvider locale="en" messages={messages}>{element}</NextIntlClientProvider>,
)

describe('message direction is independent of interface language', () => {
  it.each(['text', 'image', 'video', 'template', 'interactive'] as const)('isolates %s message text from the timestamp and controls', (content_type) => {
    const message: Message = {
      id: 'm', conversation_id: 'c', sender_type: 'customer',
      content_type, content_text: text, status: 'delivered', created_at: '2026-09-08T10:00:00Z',
    }
    const html = render(<MessageBubble message={message} />)
    expect(html).toMatch(/<p dir="auto" class="message-text [^"]*">أهلًا/)
    expect(html).toContain('https://elainebooks.com')
    expect(html).toContain('Your code: AB-123.')
    // The message owns its direction, not the surrounding bubble or metadata.
    expect(html).not.toMatch(/^<div dir="auto"/)
  })

  it('gives quoted text and its author independent directions', () => {
    const html = render(<ReplyQuote authorLabel="Elaine Books" preview={text} />)
    expect(html.match(/dir="auto"/g)).toHaveLength(2)
    expect(html).toContain('Elaine Books')
    expect(html).toContain('שלום, תודה!')
  })

  it('isolates interactive body, header, footer and button labels', () => {
    const html = render(<InteractivePreview payload={{
      kind: 'buttons', body: text, header: 'Welcome', footer: 'شكرًا',
      buttons: [{ id: 'btnupdt', title: 'جرّبت ولم أنجح' }],
    }} />)
    expect(html.match(/<p dir="auto"/g)).toHaveLength(3)
    expect(html).toMatch(/<bdi[^>]*>جرّبت ولم أنجح<\/bdi>/)
  })
})
