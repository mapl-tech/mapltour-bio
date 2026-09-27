/**
 * Trip tips: the opt-in that rides along with the code request. One module
 * for the page (lib/useLead.ts) and the lead function, so the box the
 * visitor sees and the rule the server records by can never drift apart.
 *
 * The box starts unticked for everyone (owner, Sept 26 2026). From Sept 24 to
 * 26 it started ticked for visitors Netlify placed in the US; a pre-ticked
 * box is consent by default, which the page's design review scores as a
 * manipulative pattern. A tick the visitor makes is the only yes a current
 * page can send. A pre-tick arriving from a page cached before the change
 * still counts where it was lawful (the US), and nowhere else: Canada
 * (CASL) and the UK (PECR) never accept one.
 */

/** The checkbox label, word for word, on every capture point. HubSpot keeps it as what they agreed to. */
export const TIPS_LABEL = 'Send me Jamaica trip tips from MAPL Tours Jamaica, about twice a month. Unsubscribe anytime.'

/** The success line once the server has recorded a valid yes. */
export const TIPS_ON = 'Trip tips are on. The first one comes in a couple of weeks.'

/** What the box looked like before the visitor touched it. */
export type TipsDefault = 'checked' | 'unchecked'

/** Whether the box starts ticked: never, for any country. */
export function tipsDefaultFor(_country?: string | null): boolean {
  return false
}

/** Where a box that arrived ticked may still count as consent: "US" only (any case). */
export function pretickLawful(country: string | null | undefined): boolean {
  return typeof country === 'string' && country.trim().toUpperCase() === 'US'
}

/**
 * Whether a ticked box is consent. A box the visitor ticked themselves always
 * is; a box that arrived ticked counts only where a pre-ticked box is
 * allowed (the US). So a pre-ticked box from Canada or the UK is never
 * recorded as a yes, even if a stale or altered page sends one.
 */
export function tipsConsentValid(x: { optIn: unknown; defaultShown: unknown; country: string | null | undefined }): boolean {
  return x.optIn === true && (x.defaultShown === 'unchecked' || pretickLawful(x.country))
}
