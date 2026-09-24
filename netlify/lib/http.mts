/**
 * Shared response bits for the functions.
 *
 * netlify.toml gives "/*" a 30-day durable edge cache. Every function answer
 * is about one visitor (their country, their email, their link), so each one
 * says no-store to the browser AND to Netlify's CDN: a cached /api/geo would
 * hand every visitor the first visitor's country.
 */
export const NO_STORE = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' } as const

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...NO_STORE, ...headers } })

/** A 303 that carries no-store too (Response.redirect's headers cannot be added to). */
export const seeOther = (location: string) => new Response(null, { status: 303, headers: { Location: location, ...NO_STORE } })

/** An ISO country code: exactly two letters A to Z, or null. */
export function countryCode(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : null
}
