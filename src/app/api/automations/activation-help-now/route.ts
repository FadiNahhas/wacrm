import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { sendActivationHelpNow } from '@/lib/automations/manual-activation-help'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: Request) {
  let accountId: string
  let userId: string
  try {
    const ctx = await requireRole('agent')
    accountId = ctx.accountId
    userId = ctx.userId
  } catch (error) {
    return toErrorResponse(error)
  }
  const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
  if (!limit.success) return rateLimitResponse(limit)
  try {
    const body = await request.json().catch(() => null)
    const conversationId = body?.conversation_id
    if (typeof conversationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
      return NextResponse.json({ error: 'A valid conversation is required' }, { status: 400 })
    }
    const result = await sendActivationHelpNow({ accountId, conversationId })
    if (result === 'sent') return NextResponse.json({ sent: true })
    if (result === 'busy') return NextResponse.json({ error: 'The follow-up is already being sent' }, { status: 409 })
    if (result === 'not_found') return NextResponse.json({ error: 'Activation support automation is not active' }, { status: 404 })
    if (result === 'conversation_not_found') return NextResponse.json({ error: 'Open conversation not found' }, { status: 404 })
    return NextResponse.json({ error: 'The follow-up could not be sent' }, { status: 502 })
  } catch (error) {
    console.error('[automations] manual activation follow-up failed:', error)
    return NextResponse.json({ error: 'The follow-up could not be sent' }, { status: 500 })
  }
}
