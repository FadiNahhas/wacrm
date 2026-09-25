import { describe, expect, it } from 'vitest'
import { findActivationHelpPrompt } from './manual-activation-help'
import type { AutomationStep } from '@/types'

const automations = [{ id: 'support', account_id: 'account', user_id: 'owner' }]
const step = (id: string, position: number, step_type: AutomationStep['step_type'], step_config: AutomationStep['step_config']) => ({
  id, automation_id: 'support', parent_step_id: null, position, step_type, step_config,
})

describe('manual activation help prompt', () => {
  it('uses the saved Yes/No button step after the cancellable wait', () => {
    const steps = [
      step('intro', 0, 'send_message', { text: 'Welcome' }),
      step('prompt', 2, 'send_buttons', {
        kind: 'buttons', body: 'Still need help?', buttons: [
          { id: 'activation_help_yes', title: 'Yes' },
          { id: 'activation_help_no', title: 'No' },
        ],
      }),
      step('wait', 1, 'wait', { amount: 5, unit: 'minutes', cancel_if_agent_replied: true }),
    ]
    expect(findActivationHelpPrompt(automations, steps)?.prompt.id).toBe('prompt')
  })

  it('ignores unrelated button menus and waits that do not cancel on replies', () => {
    const steps = [
      step('wait', 0, 'wait', { amount: 5, unit: 'minutes' }),
      step('prompt', 1, 'send_buttons', {
        kind: 'buttons', body: 'Still need help?', buttons: [
          { id: 'activation_help_yes', title: 'Yes' },
          { id: 'activation_help_no', title: 'No' },
        ],
      }),
    ]
    expect(findActivationHelpPrompt(automations, steps)).toBeNull()
  })
})
