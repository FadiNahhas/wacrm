import { supabaseAdmin } from './admin-client'

/** Retire waits whose owner asked to stop when a human agent replies. */
export async function cancelReplySensitiveWaits(accountId: string, contactId: string): Promise<void> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('automation_pending_executions')
    .select('id,context')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')
  if (error) throw error

  const ids = (data ?? [])
    .filter((row) => Boolean(row.context?.cancel_if_agent_replied_since))
    .map((row) => row.id as string)
  if (ids.length === 0) return

  const { error: cancelError } = await db
    .from('automation_pending_executions')
    .update({ status: 'done' })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')
    .in('id', ids)
  if (cancelError) throw cancelError
}
