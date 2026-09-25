import { describe, expect, it } from 'vitest'
import { extractLabeledActivationKey } from './activation-key'

describe('extractLabeledActivationKey', () => {
  it.each([
    ['مرحبًا، لا أستطيع نقل كتابي. مفتاح التفعيل: 2IH2U1', '2IH2U1'],
    ['שלום, אני לא מצליח/ה להעביר את הספר שלי. מפתח הפעלה: ab1234', 'AB1234'],
    ['Hi, I cannot transfer my book. Activation key: 3BBS5K', '3BBS5K'],
  ])('extracts the labeled key from support links', (message, key) => {
    expect(extractLabeledActivationKey(message)).toBe(key)
  })

  it('does not mistake an unrelated number for a key', () => {
    expect(extractLabeledActivationKey('Call me at 0521234567')).toBeNull()
  })
})
