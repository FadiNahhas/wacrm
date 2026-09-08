/** Parse the builder's daily, half-open HH:mm-HH:mm window. */
export function parseTimeWindow(operand: string): [number, number] | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(operand)
  if (!match) return null
  return [Number(match[1]) * 60 + Number(match[2]), Number(match[3]) * 60 + Number(match[4])]
}

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0)
    return true
  } catch {
    return false
  }
}

export function isWithinTimeWindow(operand: string, timezone?: string, now = new Date()): boolean {
  const window = parseTimeWindow(operand)
  if (!window) throw new Error('time of day needs a valid HH:mm-HH:mm range')

  // Keep existing rules on their server clock until an operator selects a
  // timezone. Named zones follow daylight-saving changes without UTC offsets.
  let minutes = now.getHours() * 60 + now.getMinutes()
  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    minutes = Number(parts.find((part) => part.type === 'hour')!.value) * 60
      + Number(parts.find((part) => part.type === 'minute')!.value)
  }

  const [from, to] = window
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to
}
