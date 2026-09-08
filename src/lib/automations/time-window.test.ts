import { describe, expect, it } from 'vitest'
import { isWithinTimeWindow, isValidTimeZone, parseTimeWindow } from './time-window'

const zone = 'Asia/Jerusalem'
const workingHours = (iso: string) => isWithinTimeWindow('08:30-18:00', zone, new Date(iso))

describe('daily working hours in Jerusalem', () => {
  it.each([
    ['2026-01-12T06:29:59Z', false],
    ['2026-01-12T06:30:00Z', true],
    ['2026-01-12T15:59:59Z', true],
    ['2026-01-12T16:00:00Z', false],
    ['2026-07-12T05:29:59Z', false],
    ['2026-07-12T05:30:00Z', true],
    ['2026-07-12T14:59:59Z', true],
    ['2026-07-12T15:00:00Z', false],
  ])('evaluates %s with the correct seasonal offset', (iso, expected) => {
    expect(workingHours(iso)).toBe(expected)
  })

  it.each([
    ['2026-03-26T05:30:00Z', false],
    ['2026-03-28T05:30:00Z', true],
    ['2026-10-24T05:30:00Z', true],
    ['2026-10-26T05:30:00Z', false],
  ])('follows daylight-saving changes around %s', (iso, expected) => {
    expect(workingHours(iso)).toBe(expected)
  })

  it('applies every day, including Friday and Saturday', () => {
    for (let day = 6; day <= 12; day++) {
      expect(workingHours(`2026-09-${String(day).padStart(2, '0')}T05:30:00Z`)).toBe(true)
      expect(workingHours(`2026-09-${String(day).padStart(2, '0')}T15:00:00Z`)).toBe(false)
    }
  })

  it('supports overnight windows and local midnight', () => {
    const overnight = (iso: string) => isWithinTimeWindow('18:00-08:30', zone, new Date(iso))
    expect(overnight('2026-09-08T15:00:00Z')).toBe(true)
    expect(overnight('2026-09-08T21:00:00Z')).toBe(true)
    expect(overnight('2026-09-09T05:29:59Z')).toBe(true)
    expect(overnight('2026-09-09T05:30:00Z')).toBe(false)
  })

  it('keeps unconfigured legacy rules on the server clock', () => {
    expect(isWithinTimeWindow('08:30-18:00', undefined, new Date(2026, 0, 12, 8, 30))).toBe(true)
    expect(isWithinTimeWindow('08:30-18:00', '', new Date(2026, 0, 12, 18, 0))).toBe(false)
  })

  it('evaluates the selected zone rather than a fixed Jerusalem offset', () => {
    expect(isWithinTimeWindow('08:30-18:00', 'UTC', new Date('2026-07-12T05:30:00Z'))).toBe(false)
  })

  it.each(['24:00-08:30', '08:60-18:00', '8:30-18:00', 'garbage', ''])('rejects malformed range %s', (range) => {
    expect(parseTimeWindow(range)).toBeNull()
    expect(() => isWithinTimeWindow(range, zone)).toThrow()
  })

  it('rejects invalid zones instead of silently choosing an after-hours branch', () => {
    expect(isValidTimeZone(zone)).toBe(true)
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    expect(() => isWithinTimeWindow('08:30-18:00', 'Not/AZone')).toThrow()
  })
})
