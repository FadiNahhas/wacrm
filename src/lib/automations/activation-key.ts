/** The support links on the book site label the key in these three locales. */
const LABEL = String.raw`(?:مفتاح\s*التفعيل|מפתח\s*הפעלה|activation\s+key)`
const LABELED_KEY = new RegExp(String.raw`${LABEL}\s*[:：]\s*([a-z0-9-]{4,32})`, 'iu')
// Hand-typed variant without the colon ("مفتاح التفعيل 2IH2U1"). Only
// accepted when the token contains a digit, so "activation key doesn't
// work" can't yield "DOESN" as a key.
const LOOSE_LABELED_KEY = new RegExp(
  String.raw`${LABEL}\s*(?=[a-z0-9-]*\d)([a-z0-9-]{4,32})(?![a-z0-9-])`,
  'iu',
)
// Direction marks and isolates WhatsApp clients insert around Latin runs
// inside Arabic/Hebrew text. They aren't whitespace, so "مفتاح التفعيل:‎2IH2U1"
// used to fail the `\s*` between the colon and the key.
const BIDI_CONTROLS = /[‎‏؜‪-‮⁦-⁩]/g

export function extractLabeledActivationKey(text: string): string | null {
  const normalized = text.replace(BIDI_CONTROLS, '')
  const match = LABELED_KEY.exec(normalized) ?? LOOSE_LABELED_KEY.exec(normalized)
  return match?.[1]?.toUpperCase() ?? null
}
