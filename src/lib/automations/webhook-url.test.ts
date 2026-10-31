import { describe, expect, it } from 'vitest'
import { parseWebhookSecretRef, resolveWebhookUrl } from './webhook-url'

const config = JSON.stringify({
  acct_a: { support_discord: 'https://discord.com/api/webhooks/1/a' },
  acct_b: { other: 'https://hooks.example.com/b' },
})

describe('resolveWebhookUrl', () => {
  it('passes plain URLs through untouched', () => {
    expect(resolveWebhookUrl('https://hooks.example.com/x', 'acct_a', config))
      .toBe('https://hooks.example.com/x')
  })

  it("resolves a secret reference from the automation's account", () => {
    expect(resolveWebhookUrl('secret:support_discord', 'acct_a', config))
      .toBe('https://discord.com/api/webhooks/1/a')
  })

  it("refuses another account's secret", () => {
    expect(() => resolveWebhookUrl('secret:support_discord', 'acct_b', config))
      .toThrow('secret "support_discord" is not configured')
  })

  it('fails clearly when the config is missing or malformed', () => {
    expect(() => resolveWebhookUrl('secret:support_discord', 'acct_a', undefined))
      .toThrow('is not configured')
    expect(() => resolveWebhookUrl('secret:support_discord', 'acct_a', '{nope'))
      .toThrow('is not valid JSON')
  })

  it('rejects malformed references', () => {
    expect(() => resolveWebhookUrl('secret:../x', 'acct_a', config))
      .toThrow('invalid secret reference')
    expect(parseWebhookSecretRef('secret:')).toBeNull()
    expect(parseWebhookSecretRef(' secret:support_discord ')).toBe('support_discord')
  })
})
