/**
 * The Martha Brae raft giveaway. Every code email sent while entries are
 * open is an entry (rules: mapltours.com/giveaway). Entries close at
 * 11:59 pm Eastern on Nov 30 2026 (EST, so 05:00Z on Dec 1); from then the
 * code email's block and the page's prize card drop out by themselves, so a
 * late request is never told it is in a draw that has closed. The lead
 * function tags the HubSpot contact mapl_giveaway with the id, and the Dec 1
 * draw picks from those contacts. Shared by the functions and the page so
 * both close at the same moment.
 */
export const GIVEAWAY = {
  id: 'martha-brae-2026',
  opens: Date.parse('2026-09-24T04:00:00Z'),
  closes: Date.parse('2026-12-01T05:00:00Z'),
} as const
export const giveawayOpen = (now = Date.now()) => now >= GIVEAWAY.opens && now < GIVEAWAY.closes

/** A raft ad's link names "raft" as a whole word of utm_content (raft_giveaway)
 *  or utm_campaign, split by _ - or . so "draft" or "rafting" never count. */
export const RAFT_PARAM = /[?&]utm_(?:content|campaign)=(?:[^&#]*[_.-])?raft(?:[_.-][^&#]*)?(?=[&#]|$)/i

/**
 * Runs in <head> before first paint. For a visitor from a raft ad, while
 * entries are open, it marks the document `raft`, and CSS swaps the hero's
 * line for the prize card and adds the draw's fine print: no flash, no
 * layout shift, nothing for anyone else. It also preloads the card's raft
 * thumbnail for that visitor only (the <img> is lazy, so nobody else fetches
 * it). Shipped as a string, so it is self-contained; tests run this exact
 * string.
 */
/** The prize card's thumbnail (Hero.tsx), preloaded for raft visitors only. */
export const RAFT_THUMB = { src: '/media/raft-thumb.webp', srcSet: '/media/raft-thumb.webp 2x, /media/raft-thumb@3x.webp 3x' } as const

export const RAFT_SCRIPT = `try{var n=Date.now();if(${RAFT_PARAM}.test(location.search)&&n>=${GIVEAWAY.opens}&&n<${GIVEAWAY.closes}){document.documentElement.classList.add('raft');try{var l=document.createElement('link');l.rel='preload';l.as='image';l.href='${RAFT_THUMB.src}';l.setAttribute('imagesrcset','${RAFT_THUMB.srcSet}');document.head.appendChild(l)}catch(e){}}}catch(e){}`
