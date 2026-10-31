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

  it('ignores direction marks WhatsApp inserts around the key', () => {
    expect(extractLabeledActivationKey('مفتاح التفعيل:‎2IH2U1‏')).toBe('2IH2U1')
    expect(extractLabeledActivationKey('مفتاح التفعيل: ⁦3BBS5K⁩')).toBe('3BBS5K')
  })

  it('accepts a hand-typed key without the colon when it contains a digit', () => {
    expect(extractLabeledActivationKey('مفتاح التفعيل 2IH2U1 لو سمحت')).toBe('2IH2U1')
    expect(extractLabeledActivationKey('activation key doesnt work')).toBeNull()
  })

  it('does not mistake an unrelated number for a key', () => {
    expect(extractLabeledActivationKey('Call me at 0521234567')).toBeNull()
  })
})
