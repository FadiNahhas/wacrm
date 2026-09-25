import type { Automation, AutomationStep, SendButtonsStepConfig, WaitStepConfig } from '@/types'
import { supabaseAdmin } from './admin-client'
import { resumePendingExecution, type AutomationContext } from './engine'

const YES_ID = 'activation_help_yes'
const NO_ID = 'activation_help_no'

type SupportAutomation = Pick<Automation, 'id' | 'account_id' | 'user_id'>
type SupportStep = Pick<AutomationStep, 'id' | 'automation_id' | 'parent_step_id' | 'position' | 'step_type' | 'step_config'>

/** Locate the saved customer prompt so manual sends use its current wording. */
export function findActivationHelpPrompt(automations: SupportAutomation[], steps: SupportStep[]) {
  for (const automation of automations) {
    const roots = steps
      .filter((step) => step.automation_id === automation.id && !step.parent_step_id)
      .sort((a, b) => a.position - b.position)
    const waitIndex = roots.findIndex((step) =>
      step.step_type === 'wait' && Boolean((step.step_config as WaitStepConfig).cancel_if_agent_replied),
    )
    if (waitIndex < 0) continue
    const prompt = roots.slice(waitIndex + 1).find((step) => {
      if (step.step_type !== 'send_buttons') return false
      const payload = step.step_config as SendButtonsStepConfig
      if (payload.kind !== 'buttons') return false
      const ids = new Set(payload.buttons.map((button) => button.id))
      return ids.has(YES_ID) && ids.has(NO_ID)
    })
    if (prompt) return { automation, prompt }
  }
  return null
}

export type ManualHelpResult = 'sent' | 'not_found' | 'conversation_not_found' | 'busy' | 'failed'

/** Send the existing Yes/No step now, retiring any scheduled copy first. */
export async function sendActivationHelpNow(input: {
  accountId: string
  conversationId: string
}): Promise<ManualHelpResult> {
  const db = supabaseAdmin()
  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('id,contact_id,status')
    .eq('id', input.conversationId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (conversationError) throw conversationError
  if (!conversation || !conversation.contact_id || conversation.status === 'closed') {
    return 'conversation_not_found'
  }

  const { data: automations, error: automationError } = await db
    .from('automations')
    .select('id,account_id,user_id')
    .eq('account_id', input.accountId)
    .eq('trigger_type', 'interactive_reply')
    .eq('is_active', true)
  if (automationError) throw automationError
  if (!automations?.length) return 'not_found'

  const { data: steps, error: stepsError } = await db
    .from('automation_steps')
    .select('id,automation_id,parent_step_id,position,step_type,step_config')
    .in('automation_id', automations.map((automation) => automation.id))
  if (stepsError) throw stepsError
  const found = findActivationHelpPrompt(automations, steps ?? [])
  if (!found) return 'not_found'

  const { data: active, error: pendingError } = await db
    .from('automation_pending_executions')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('automation_id', found.automation.id)
    .eq('contact_id', conversation.contact_id)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
  if (pendingError) throw pendingError
  if (active?.some((row) => row.status === 'running')) return 'busy'

  const claimed: typeof active = []
  for (const row of active ?? []) {
    const { data: claim, error: claimError } = await db
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('account_id', input.accountId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (claimError) throw claimError
    if (!claim) {
      if (claimed.length) {
        await db.from('automation_pending_executions')
          .update({ status: 'pending' })
          .in('id', claimed.map((item) => item.id))
          .eq('status', 'running')
      }
      return 'busy'
    }
    claimed.push(row)
  }

  let selected = claimed[0]
  if (!selected) {
    const { data: log, error: logError } = await db.from('automation_logs').insert({
      automation_id: found.automation.id,
      account_id: input.accountId,
      user_id: found.automation.user_id,
      contact_id: conversation.contact_id,
      trigger_event: 'manual_activation_help',
      steps_executed: [],
      status: 'failed',
    }).select('id').single()
    if (logError || !log) throw logError ?? new Error('Could not log manual follow-up')
    const { data: pending, error: insertError } = await db
      .from('automation_pending_executions')
      .insert({
        automation_id: found.automation.id,
        account_id: input.accountId,
        user_id: found.automation.user_id,
        contact_id: conversation.contact_id,
        log_id: log.id,
        parent_step_id: null,
        branch: null,
        next_step_position: found.prompt.position,
        context: { conversation_id: conversation.id },
        status: 'running',
        run_at: new Date().toISOString(),
      })
      .select('*')
      .single()
    if (insertError || !pending) throw insertError ?? new Error('Could not start manual follow-up')
    selected = pending
  }

  const context: AutomationContext = {
    ...(selected.context as AutomationContext),
    conversation_id: conversation.id,
    // Manual send is deliberate even when a human replied earlier.
    cancel_if_agent_replied_since: new Date().toISOString(),
  }
  await resumePendingExecution({
    id: selected.id,
    automation_id: selected.automation_id,
    account_id: input.accountId,
    user_id: selected.user_id,
    contact_id: conversation.contact_id,
    log_id: selected.log_id,
    parent_step_id: selected.parent_step_id,
    branch: selected.branch,
    next_step_position: selected.next_step_position,
    context,
  })

  if (claimed.length > 1) {
    const { error: retireError } = await db.from('automation_pending_executions')
      .update({ status: 'done' })
      .in('id', claimed.slice(1).map((row) => row.id))
      .eq('status', 'running')
    if (retireError) throw retireError
  }

  const { data: log, error: resultError } = await db
    .from('automation_logs')
    .select('steps_executed')
    .eq('id', selected.log_id)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (resultError) throw resultError
  const delivered = (log?.steps_executed ?? []).some((step: { step_id: string; status: string }) =>
    step.step_id === found.prompt.id && step.status === 'success',
  )
  return delivered ? 'sent' : 'failed'
}
