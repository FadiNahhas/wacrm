import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as { id: string; context: Record<string, unknown> }[],
  update: vi.fn(),
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const query = {
        select: () => query,
        update: (value: unknown) => { h.update(value); return query },
        eq: () => query,
        in: (_field: string, ids: string[]) => {
          h.update(ids)
          return Promise.resolve({ error: null })
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(resolve),
      }
      return query
    },
  }),
}))

import { cancelReplySensitiveWaits } from './pending-wait'

beforeEach(() => {
  h.rows = []
  h.update.mockClear()
})

describe('cancelling an unanswered follow-up after a human reply', () => {
  it('retires only waits opted into agent reply cancellation', async () => {
    h.rows = [
      { id: 'activation-wait', context: { cancel_if_agent_replied_since: '2026-09-25T10:00:00Z' } },
      { id: 'unrelated-wait', context: {} },
    ]
    await cancelReplySensitiveWaits('account', 'contact')
    expect(h.update).toHaveBeenCalledWith({ status: 'done' })
    expect(h.update).toHaveBeenCalledWith(['activation-wait'])
  })

  it('does not update waits when none opted in', async () => {
    h.rows = [{ id: 'unrelated-wait', context: {} }]
    await cancelReplySensitiveWaits('account', 'contact')
    expect(h.update).not.toHaveBeenCalled()
  })
})
