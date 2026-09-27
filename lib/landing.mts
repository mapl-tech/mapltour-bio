/**
 * Everyone lands at the top, where the code form is (owner, Sept 26 2026).
 *
 * Links from elsewhere used to carry #coupon (the rules page, the tips page,
 * emails), which dropped the visitor on the lower form, and a reload put a
 * returning visitor back wherever they had scrolled. This runs in <head>
 * before the body exists:
 * - an arrival with a #fragment loses it before the browser can jump to it
 *   (a back/forward visit keeps its fragment);
 * - scroll restoration is switched off as the page is left (pagehide). The
 *   browser records that with the history entry, so the next load of it (a
 *   reload, or Back from another site when the page is not in the
 *   back/forward cache) starts at the top, while in-page links (#price, the
 *   finder, the FAQ, the sticky bar) and Back within the page behave as they
 *   always have. A page restored from the back/forward cache comes back
 *   exactly as it was left.
 * Shipped as a string, so it is self-contained; tests run this exact string.
 */
export const LANDING_SCRIPT = `try{var h=history,e=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];if((!e||e.type!=='back_forward')&&location.hash)h.replaceState(h.state,'',location.pathname+location.search);if('scrollRestoration' in h)addEventListener('pagehide',function(){h.scrollRestoration='manual'})}catch(x){}`
