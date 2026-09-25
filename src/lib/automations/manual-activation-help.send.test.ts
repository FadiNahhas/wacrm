import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  resumed: [] as Row[],
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      let operation = 'select'
      let payload: Row = {}
      const filters: ((row: Row) => boolean)[] = []
      const result = () => {
        const tableRows = h.tables[table] ?? []
        if (operation === 'insert') {
          const row = { id: `${table}-${tableRows.length + 1}`, ...payload }
          tableRows.push(row)
          return { data: row, error: null }
        }
        const matches = tableRows.filter((row) => filters.every((filter) => filter(row)))
        if (operation === 'update') {
          matches.forEach((row) => Object.assign(row, payload))
          return { data: matches, error: null }
        }
        return { data: matches, error: null }
      }
      const query = {
        select: () => query,
        insert: (value: Row) => { operation = 'insert'; payload = value; return query },
        update: (value: Row) => { operation = 'update'; payload = value; return query },
        eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query },
        in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query },
        order: () => query,
        single: async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error } },
        maybeSingle: async () => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error } },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }
      return query
    },
  }),
}))

vi.mock('./engine', () => ({
  resumePendingExecution: async (row: Row) => {
    h.resumed.push(row)
    const pending = h.tables.automation_pending_executions.find((item) => item.id === row.id)
    if (pending) pending.status = 'done'
    const log = h.tables.automation_logs.find((item) => item.id === row.log_id)
    if (log) log.steps_executed = [{ step_id: 'prompt', status: 'success' }]
  },
}))

import { sendActivationHelpNow } from './manual-activation-help'

beforeEach(() => {
  h.resumed = []
  h.tables = {
    conversations: [{ id: 'conversation', account_id: 'account', contact_id: 'contact', status: 'open' }],
    automations: [{ id: 'support', account_id: 'account', user_id: 'owner', trigger_type: 'interactive_reply', is_active: true }],
    automation_steps: [
      { id: 'wait', automation_id: 'support', parent_step_id: null, position: 1, step_type: 'wait', step_config: { amount: 5, unit: 'minutes', cancel_if_agent_replied: true } },
      { id: 'prompt', automation_id: 'support', parent_step_id: null, position: 2, step_type: 'send_buttons', step_config: { kind: 'buttons', body: 'Still need help?', buttons: [{ id: 'activation_help_yes', title: 'Yes' }, { id: 'activation_help_no', title: 'No' }] } },
    ],
    automation_pending_executions: [],
    automation_logs: [],
  }
})

describe('manual activation help send', () => {
  it('claims the scheduled wait and retires extra copies before they can fire', async () => {
    h.tables.automation_pending_executions = [
      { id: 'pending-1', account_id: 'account', automation_id: 'support', user_id: 'owner', contact_id: 'contact', log_id: 'log-1', parent_step_id: null, branch: null, next_step_position: 2, context: {}, status: 'pending' },
      { id: 'pending-2', account_id: 'account', automation_id: 'support', user_id: 'owner', contact_id: 'contact', log_id: 'log-2', parent_step_id: null, branch: null, next_step_position: 2, context: {}, status: 'pending' },
    ]
    h.tables.automation_logs = [{ id: 'log-1', account_id: 'account', steps_executed: [] }, { id: 'log-2', account_id: 'account', steps_executed: [] }]

    expect(await sendActivationHelpNow({ accountId: 'account', conversationId: 'conversation' })).toBe('sent')
    expect(h.resumed).toHaveLength(1)
    expect(h.tables.automation_pending_executions.map((row) => row.status)).toEqual(['done', 'done'])
  })

  it('can send the saved prompt when there is no timer to accelerate', async () => {
    expect(await sendActivationHelpNow({ accountId: 'account', conversationId: 'conversation' })).toBe('sent')
    expect(h.resumed[0].next_step_position).toBe(2)
    expect(h.tables.automation_pending_executions[0].status).toBe('done')
  })

  it('refuses a second send while the scheduler is already processing it', async () => {
    h.tables.automation_pending_executions = [
      { id: 'pending-1', account_id: 'account', automation_id: 'support', contact_id: 'contact', status: 'running' },
    ]
    expect(await sendActivationHelpNow({ accountId: 'account', conversationId: 'conversation' })).toBe('busy')
    expect(h.resumed).toHaveLength(0)
  })
})
