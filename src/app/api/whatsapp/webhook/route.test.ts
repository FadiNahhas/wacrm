import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared, hoisted state the module mocks close over. Reset per test.
const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  state: {
    // Result the message upsert's .select() resolves to. A genuine insert
    // returns the row; a replayed delivery conflicts and returns [].
    messageUpsertResult: [{ id: 'msg-1' }] as { id: string }[],
    priorCustomerMsgCount: 0,
    /** Row `lookupInternalIdByMetaId` resolves for a `context.id`. */
    replyContextParent: null as { id: string } | null,
    conversation: { id: 'conv-1', unread_count: 0, account_id: 'acc-1' },
    upsertCalls: [] as { row: Record<string, unknown>; options: unknown }[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    afterCallbacks: [] as (() => Promise<void> | void)[],
    automationStarted: 0,
    automationCompleted: 0,
    /** whatsapp_config.mirror_inbound_media for the matched row (#466). */
    mirrorInboundMedia: true as boolean | undefined,
    /** Objects the inbound-media mirror pushed into chat-media. */
    storageUploads: [] as {
      bucket: string
      path: string
      options: { contentType?: string }
    }[],
    /** Error the next storage upload resolves with, if any. */
    storageUploadError: null as { message: string } | null,
    /** Row `findExistingContact` resolves. null => the create path. */
    existingContact: {
      id: 'contact-1',
      name: 'Ada',
      phone: '15551230000',
    } as Record<string, unknown> | null,
    /** Every patch written to `contacts` (the pushname-overwrite guard). */
    contactUpdates: [] as Record<string, unknown>[],
    /** Every row inserted into `contacts`. */
    contactInserts: [] as Record<string, unknown>[],
  },
}))

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      switch (table) {
        case 'whatsapp_config':
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    {
                      account_id: 'acc-1',
                      user_id: 'user-1',
                      access_token: 'enc',
                      mirror_inbound_media: h.state.mirrorInboundMedia,
                    },
                  ],
                  error: null,
                }),
            }),
          }
        case 'contacts':
          // findOrCreateContact writes: update(patch).eq(), and on the
          // create path insert(row).select().single().
          return {
            update: (patch: Record<string, unknown>) => {
              h.state.contactUpdates.push(patch)
              return { eq: () => Promise.resolve({ error: null }) }
            },
            insert: (row: Record<string, unknown>) => {
              h.state.contactInserts.push(row)
              return {
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { id: 'contact-new', ...row },
                      error: null,
                    }),
                }),
              }
            },
          }
        case 'conversations':
          // findOrCreateConversation: select().eq().eq().order().limit()
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [h.state.conversation],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }
        case 'broadcast_recipients':
          // flagBroadcastReplyIfAny: select().eq().eq().in().order().limit()
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    order: () => ({
                      limit: () =>
                        Promise.resolve({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }
        case 'messages':
          return {
            // Two different chains land here, told apart by the count
            // option: the prior-message count (head request) and the
            // reply-context parent lookup.
            select: (_columns: string, options?: { head?: boolean }) =>
              options?.head
                ? // priorCustomerMsgCount: select('id',{count,head}).eq().eq()
                  {
                    eq: () => ({
                      eq: () =>
                        Promise.resolve({
                          count: h.state.priorCustomerMsgCount,
                          error: null,
                        }),
                    }),
                  }
                : // lookupInternalIdByMetaId: select('id').eq().eq().maybeSingle()
                  {
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: () =>
                          Promise.resolve({
                            data: h.state.replyContextParent,
                            error: null,
                          }),
                      }),
                    }),
                  },
            // Idempotent insert: upsert(...).select('id')
            upsert: (row: Record<string, unknown>, options: unknown) => {
              h.state.upsertCalls.push({ row, options })
              return {
                select: () =>
                  Promise.resolve({
                    data: h.state.messageUpsertResult,
                    error: null,
                  }),
              }
            },
          }
        default:
          throw new Error(`unexpected table: ${table}`)
      }
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
    // Service-role Storage, used by the inbound-media mirror (#466).
    storage: {
      from(bucket: string) {
        return {
          upload: (
            path: string,
            _body: unknown,
            options: { contentType?: string },
          ) => {
            h.state.storageUploads.push({ bucket, path, options })
            return Promise.resolve({ error: h.state.storageUploadError })
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://cdn.test/${bucket}/${path}` },
          }),
        }
      },
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}))
vi.mock('@/lib/contacts/dedupe', () => ({
  // Returns a *copy* each call: findOrCreateContact mutates the row it
  // gets back to mirror the patch it wrote, and a shared object would
  // leak that mutation into the next test.
  findExistingContact: vi.fn(async () =>
    h.state.existingContact ? { ...h.state.existingContact } : null,
  ),
  isUniqueViolation: () => false,
}))
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}))
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: () => false,
  handleTemplateWebhookChange: vi.fn(),
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}))

import { POST } from './route'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'

const mockGetMediaUrl = vi.mocked(getMediaUrl)
const mockDownloadMedia = vi.mocked(downloadMedia)

const TEXT_MESSAGE = {
  id: 'wamid.TEST1',
  from: '15551230000',
  timestamp: '1700000000',
  type: 'text',
  text: { body: 'hello' },
}

function inboundRequest(message: Record<string, unknown> = TEXT_MESSAGE) {
  const body = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pn-1' },
              contacts: [{ wa_id: '15551230000', profile: { name: 'Ada' } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  }
  return {
    text: async () => JSON.stringify(body),
    headers: { get: () => 'sha256=stub' },
  } as unknown as Request
}

async function runWebhook(message?: Record<string, unknown>) {
  const res = await POST(inboundRequest(message))
  // Drain the after() callback exactly as the runtime would.
  for (const cb of h.state.afterCallbacks) await cb()
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.messageUpsertResult = [{ id: 'msg-1' }]
  h.state.priorCustomerMsgCount = 0
  h.state.replyContextParent = null
  h.state.conversation = { id: 'conv-1', unread_count: 0, account_id: 'acc-1' }
  h.state.upsertCalls = []
  h.state.rpcCalls = []
  h.state.afterCallbacks = []
  h.state.automationStarted = 0
  h.state.automationCompleted = 0
  h.state.mirrorInboundMedia = true
  h.state.storageUploads = []
  h.state.storageUploadError = null
  h.state.existingContact = {
    id: 'contact-1',
    name: 'Ada',
    phone: '15551230000',
  }
  h.state.contactUpdates = []
  h.state.contactInserts = []
  mockGetMediaUrl.mockResolvedValue({
    url: 'https://lookaside.fbsbx.com/whatsapp/abc',
    mimeType: 'image/jpeg',
    fileSize: 2048,
  })
  mockDownloadMedia.mockResolvedValue({
    buffer: Buffer.alloc(2048),
    contentType: 'image/jpeg',
  })
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false })
  h.dispatchInboundToAiReply.mockResolvedValue(undefined)
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.runAutomationsForTrigger.mockImplementation(() => {
    h.state.automationStarted++
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        h.state.automationCompleted++
        resolve()
      }, 0)
    })
  })
})

describe('inbound webhook: idempotent insert (#367)', () => {
  it('a genuine first delivery persists once and fans out downstream', async () => {
    await runWebhook()

    // Inserted via upsert with the (conversation_id, message_id) conflict
    // target — not a bare insert.
    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].options).toMatchObject({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    })
    // Downstream side effects ran exactly once.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1)
    expect(h.dispatchWebhookEvent).toHaveBeenCalledTimes(1)
  })

  it('a replayed delivery is a no-op: no unread bump, no fan-out', async () => {
    // Upsert hits the unique index and returns no row.
    h.state.messageUpsertResult = []

    await runWebhook()

    expect(h.state.upsertCalls).toHaveLength(1)
    // None of the downstream side effects fire on a replay.
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })
})

describe('inbound webhook: atomic unread bump (#369)', () => {
  it('increments unread through the DB-side RPC, not a read-modify-write', async () => {
    await runWebhook()

    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.state.rpcCalls[0]).toMatchObject({
      name: 'bump_conversation_on_inbound',
      args: { p_conversation_id: 'conv-1' },
    })
  })
})

describe('inbound webhook: template quick-reply buttons (#478)', () => {
  // A customer tapping a QUICK_REPLY button on a broadcast template.
  // `context.id` points at the template message we sent — which the
  // broadcast path never wrote to `messages`, so the parent lookup
  // legitimately misses and the reply is stored unquoted.
  const templateButtonTap = {
    id: 'wamid.BTN1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'button',
    button: { text: 'Yes, interested', payload: 'YES_INTERESTED' },
    context: { id: 'wamid.BROADCAST1' },
  }

  it('stores the tap as an interactive reply, not an unsupported message', async () => {
    await runWebhook(templateButtonTap)

    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Yes, interested',
      interactive_reply_id: 'YES_INTERESTED',
      reply_to_message_id: null,
    })
  })

  it('routes the tap to flows and fires the interactive_reply trigger', async () => {
    await runWebhook(templateButtonTap)

    expect(h.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          kind: 'interactive_reply',
          reply_id: 'YES_INTERESTED',
          reply_title: 'Yes, interested',
          meta_message_id: 'wamid.BTN1',
        },
      }),
    )
    const triggers = h.runAutomationsForTrigger.mock.calls.map(
      (call) => (call[0] as { triggerType: string }).triggerType,
    )
    expect(triggers).toContain('interactive_reply')
    // The AI auto-reply must stay out of it — a button tap is not a
    // free-text question.
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
  })

  it('falls back to the label when the template button carries no payload', async () => {
    await runWebhook({
      ...templateButtonTap,
      button: { text: 'Track my order' },
    })

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Track my order',
      interactive_reply_id: 'Track my order',
    })
  })
})

describe('inbound webhook: inbound media is mirrored (#466)', () => {
  const IMAGE_MESSAGE = {
    id: 'wamid.IMG1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'image',
    image: { id: '1234567890123456', mime_type: 'image/jpeg', caption: 'hi' },
  }

  it('stores a durable bucket URL instead of the expiring proxy path', async () => {
    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.storageUploads).toHaveLength(1)
    expect(h.state.storageUploads[0].bucket).toBe('chat-media')
    expect(h.state.storageUploads[0].path).toBe(
      'account-acc-1/inbound/1234567890123456-image-1700000000.jpg',
    )
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url:
        'https://cdn.test/chat-media/account-acc-1/inbound/1234567890123456-image-1700000000.jpg',
      // Meta's MIME type used to be discarded outright (`void mediaType`).
      media_type: 'image/jpeg',
    })
  })

  it('falls back to the proxy URL when the upload is refused', async () => {
    h.state.storageUploadError = { message: 'mime type not supported' }

    await runWebhook(IMAGE_MESSAGE)

    // The message still lands, and it still lands with a usable URL —
    // the mirror failing must never cost us the message.
    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
      media_type: 'image/jpeg',
    })
  })

  it('falls back to the proxy URL when the download from Meta throws', async () => {
    mockDownloadMedia.mockRejectedValueOnce(new Error('Media download failed: 404'))

    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
    })
  })

  it('skips media larger than the bucket accepts, without downloading it', async () => {
    mockGetMediaUrl.mockResolvedValue({
      url: 'https://lookaside.fbsbx.com/whatsapp/big',
      mimeType: 'application/pdf',
      fileSize: 40 * 1024 * 1024,
    })

    await runWebhook({
      id: 'wamid.DOC1',
      from: '15551230000',
      timestamp: '1700000000',
      type: 'document',
      document: {
        id: '999',
        mime_type: 'application/pdf',
        filename: 'huge.pdf',
      },
    })

    expect(mockDownloadMedia).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/999',
      media_type: 'application/pdf',
    })
  })

  it("names the object after a document's own filename", async () => {
    mockGetMediaUrl.mockResolvedValue({
      url: 'https://lookaside.fbsbx.com/whatsapp/doc',
      mimeType: 'application/pdf',
      fileSize: 4096,
    })
    mockDownloadMedia.mockResolvedValue({
      buffer: Buffer.alloc(4096),
      contentType: 'application/pdf',
    })

    await runWebhook({
      id: 'wamid.DOC2',
      from: '15551230000',
      timestamp: '1700000000',
      type: 'document',
      document: {
        id: '1234567890123456',
        mime_type: 'application/pdf',
        filename: 'invoice.pdf',
        caption: 'have a look',
      },
    })

    expect(h.state.storageUploads[0].path).toBe(
      'account-acc-1/inbound/1234567890123456-invoice.pdf',
    )
  })

  it('does not mirror when the account has opted out', async () => {
    h.state.mirrorInboundMedia = false

    await runWebhook(IMAGE_MESSAGE)

    expect(mockDownloadMedia).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
      // Still recorded — the MIME type costs nothing and makes the
      // download name right even for proxied media.
      media_type: 'image/jpeg',
    })
  })

  it('mirrors when the column is absent, e.g. a row read before migration 039', async () => {
    h.state.mirrorInboundMedia = undefined

    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.storageUploads).toHaveLength(1)
  })

  it('leaves text messages alone', async () => {
    await runWebhook()

    expect(mockGetMediaUrl).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({ media_type: null })
  })
})

describe('inbound webhook: after() awaits automations (#368)', () => {
  it('every triggered automation settles before the after() callback resolves', async () => {
    await runWebhook()

    // first_inbound_message + new_message_received + keyword_match.
    expect(h.state.automationStarted).toBe(3)
    // If the dispatches were fire-and-forget, completed would still be 0
    // here — the callback would have resolved before the timers fired.
    expect(h.state.automationCompleted).toBe(3)
  })
})

// ============================================================
// The pushname must never overwrite an operator-entered name.
//
// `contacts.name` holds names maintained externally by operators. The
// webhook used to mirror Meta's `profile.name` into it on every inbound
// message, so a contact messaging us silently destroyed the real name.
// The pushname now lands in `wa_profile_name` instead.
// ============================================================
describe('inbound webhook: WhatsApp pushname vs operator-owned name', () => {
  function inboundFrom(profileName: string) {
    const body = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pn-1' },
                contacts: [
                  { wa_id: '15551230000', profile: { name: profileName } },
                ],
                messages: [TEXT_MESSAGE],
              },
            },
          ],
        },
      ],
    }
    return {
      text: async () => JSON.stringify(body),
      headers: { get: () => 'sha256=stub' },
    } as unknown as Request
  }

  async function inboundWithPushname(profileName: string) {
    await POST(inboundFrom(profileName))
    for (const cb of h.state.afterCallbacks) await cb()
  }

  it('never writes the pushname to `name` when the contact already has one', async () => {
    h.state.existingContact = {
      id: 'contact-1',
      name: 'מנהלת בית הספר',
      wa_profile_name: null,
      phone: '15551230000',
    }

    await inboundWithPushname('Ada 🌸')

    // Exactly one patch, and it touches wa_profile_name only.
    expect(h.state.contactUpdates).toHaveLength(1)
    expect(h.state.contactUpdates[0]).toMatchObject({
      wa_profile_name: 'Ada 🌸',
    })
    expect(h.state.contactUpdates[0]).not.toHaveProperty('name')
  })

  it('does not touch the row at all when the pushname is unchanged', async () => {
    h.state.existingContact = {
      id: 'contact-1',
      name: 'מנהלת בית הספר',
      wa_profile_name: 'Ada',
      phone: '15551230000',
    }

    await inboundWithPushname('Ada')

    expect(h.state.contactUpdates).toHaveLength(0)
  })

  it('fills `name` only when the existing one is null or blank', async () => {
    for (const emptyish of [null, '', '   ']) {
      h.state.contactUpdates = []
      h.state.afterCallbacks = []
      h.state.existingContact = {
        id: 'contact-1',
        name: emptyish,
        wa_profile_name: null,
        phone: '15551230000',
      }

      await inboundWithPushname('Ada')

      expect(h.state.contactUpdates[0]).toMatchObject({
        name: 'Ada',
        wa_profile_name: 'Ada',
      })
    }
  })

  it('creates an unknown number with a null `name` and the pushname parked in wa_profile_name', async () => {
    h.state.existingContact = null

    await inboundWithPushname('Ada')

    expect(h.state.contactInserts).toHaveLength(1)
    expect(h.state.contactInserts[0]).toMatchObject({
      phone: '15551230000',
      name: null,
      wa_profile_name: 'Ada',
    })
  })

  it('creates a contact with no pushname without inventing a name', async () => {
    h.state.existingContact = null

    await inboundWithPushname('')

    expect(h.state.contactInserts[0]).toMatchObject({
      name: null,
      wa_profile_name: null,
    })
  })
})

describe('inbound webhook: shared contact cards', () => {
  // Customers forward a colleague's number as a contact card rather than
  // typing it. Meta delivers the whole card inline, so the old `default`
  // branch was discarding data the webhook already had.
  const sharedContact = (contacts: unknown[]) => ({
    id: 'wamid.CONTACT1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'contacts',
    contacts,
  })

  it('summarises a single shared contact instead of rejecting it', async () => {
    await runWebhook(
      sharedContact([
        {
          name: { formatted_name: 'Ahmad Saleh', first_name: 'Ahmad' },
          phones: [
            { phone: '+962 79 123 4567', wa_id: '962791234567', type: 'MOBILE' },
          ],
        },
      ]),
    )

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'text',
      content_text: '[Contact] Ahmad Saleh - +962 79 123 4567',
    })
  })

  it('keeps every number on a card that carries more than one', async () => {
    await runWebhook(
      sharedContact([
        {
          name: { formatted_name: 'Ahmad Saleh' },
          phones: [
            { phone: '+962 79 123 4567', type: 'MOBILE' },
            { phone: '+962 6 555 0100', type: 'WORK' },
          ],
        },
      ]),
    )

    expect(h.state.upsertCalls[0].row.content_text).toBe(
      '[Contact] Ahmad Saleh - +962 79 123 4567 - +962 6 555 0100',
    )
  })

  it('gives each contact its own line when several are shared at once', async () => {
    await runWebhook(
      sharedContact([
        {
          name: { formatted_name: 'Ahmad Saleh' },
          phones: [{ phone: '+962 79 123 4567' }],
        },
        {
          name: { formatted_name: 'Lina Haddad' },
          phones: [{ phone: '+962 79 765 4321' }],
        },
      ]),
    )

    expect(h.state.upsertCalls[0].row.content_text).toBe(
      '[Contact] Ahmad Saleh - +962 79 123 4567\n' +
        '[Contact] Lina Haddad - +962 79 765 4321',
    )
  })

  it('includes the company and email when the card carries them', async () => {
    await runWebhook(
      sharedContact([
        {
          name: { formatted_name: 'Ahmad Saleh' },
          org: { company: 'Acme', title: 'Ops Lead' },
          phones: [{ phone: '+962 79 123 4567' }],
          emails: [{ email: 'ahmad@acme.com', type: 'WORK' }],
        },
      ]),
    )

    expect(h.state.upsertCalls[0].row.content_text).toBe(
      '[Contact] Ahmad Saleh - Acme - +962 79 123 4567 - ahmad@acme.com',
    )
  })

  it('falls back to the wa_id when the card has no display number', async () => {
    await runWebhook(
      sharedContact([
        {
          name: { first_name: 'Ahmad', last_name: 'Saleh' },
          phones: [{ wa_id: '962791234567' }],
        },
      ]),
    )

    expect(h.state.upsertCalls[0].row.content_text).toBe(
      '[Contact] Ahmad Saleh - 962791234567',
    )
  })

  it('still writes a legible bubble for a card with nothing usable on it', async () => {
    await runWebhook(sharedContact([{}]))

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'text',
      content_text: '[Contact]',
    })
  })
})
