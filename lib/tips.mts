/**
 * Trip tips: the opt-in that rides along with the code request. One module
 * for the page (lib/useLead.ts) and the lead function, so the box the
 * visitor sees and the rule the server records by can never drift apart.
 *
 * The owner wants the box ticked by default. Canada (CASL) and the UK (PECR)
 * do not accept a pre-ticked box as consent, and the ads reach both, so it
 * starts ticked only for a visitor Netlify places in the US. Everyone else,
 * and anyone whose country is unknown, starts unticked.
 */

/** The checkbox label, word for word, on every capture point. HubSpot keeps it as what they agreed to. */
export const TIPS_LABEL = 'Send me Jamaica trip tips from MAPL Tours Jamaica, about twice a month. Unsubscribe anytime.'

/** The success line once the server has recorded a valid yes. */
export const TIPS_ON = 'Trip tips are on. The first one comes in a couple of weeks.'

/** What the box looked like before the visitor touched it. */
export type TipsDefault = 'checked' | 'unchecked'

/** True only for "US" (any case). Unknown, empty and every other country start unticked. */
export function tipsDefaultFor(country: string | null | undefined): boolean {
  return typeof country === 'string' && country.trim().toUpperCase() === 'US'
}

/**
 * Whether a ticked box is consent. A box the visitor ticked themselves always
 * is; a box that arrived ticked counts only where a pre-ticked box is
 * allowed (the US). So a pre-ticked box from Canada or the UK is never
 * recorded as a yes, even if a stale or altered page sends one.
 */
export function tipsConsentValid(x: { optIn: unknown; defaultShown: unknown; country: string | null | undefined }): boolean {
  return x.optIn === true && (x.defaultShown === 'unchecked' || tipsDefaultFor(x.country))
}
