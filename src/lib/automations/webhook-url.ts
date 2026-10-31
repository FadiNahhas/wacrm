/**
 * Webhook URLs that carry a credential (Discord, Slack, …) can't sit in
 * `automation_steps.step_config`: every member of the account can read
 * that row. A `send_webhook` step may instead point at a named URL kept
 * in server config:
 *
 *   step_config.url = "secret:support_discord"
 *   AUTOMATION_WEBHOOK_URLS = {"<account_id>": {"support_discord": "https://…"}}
 *
 * Names are looked up under the automation's own account, so one tenant
 * can't post through another tenant's webhook by guessing its name.
 */

const SECRET_REF = /^secret:([A-Za-z0-9_-]{1,64})$/

export const WEBHOOK_URLS_ENV = 'AUTOMATION_WEBHOOK_URLS'

/** Returns the name in a `secret:<name>` reference, or null for a plain URL. */
export function parseWebhookSecretRef(url: string): string | null {
  return SECRET_REF.exec(url.trim())?.[1] ?? null
}

export function isWebhookSecretRef(url: string): boolean {
  return url.trim().startsWith('secret:')
}

/** Resolve a step's URL to the address to call. Throws on a missing secret. */
export function resolveWebhookUrl(
  url: string,
  accountId: string,
  rawConfig: string | undefined = process.env[WEBHOOK_URLS_ENV],
): string {
  if (!isWebhookSecretRef(url)) return url
  const name = parseWebhookSecretRef(url)
  if (!name) throw new Error('send_webhook: invalid secret reference')

  let config: unknown
  try {
    config = rawConfig ? JSON.parse(rawConfig) : {}
  } catch {
    throw new Error(`send_webhook: ${WEBHOOK_URLS_ENV} is not valid JSON`)
  }
  const forAccount = (config as Record<string, unknown> | null)?.[accountId]
  const resolved = (forAccount as Record<string, unknown> | null | undefined)?.[name]
  if (typeof resolved !== 'string' || !resolved) {
    throw new Error(`send_webhook: secret "${name}" is not configured`)
  }
  return resolved
}
