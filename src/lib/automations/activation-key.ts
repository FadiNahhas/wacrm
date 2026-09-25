/** The support links on the book site label the key in these three locales. */
const LABELED_KEY = /(?:مفتاح\s*التفعيل|מפתח\s*הפעלה|activation\s+key)\s*[:：]\s*([a-z0-9-]{4,32})/iu

export function extractLabeledActivationKey(text: string): string | null {
  return LABELED_KEY.exec(text)?.[1]?.toUpperCase() ?? null
}
