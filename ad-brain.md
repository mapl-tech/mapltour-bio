# Ad brain

How paid traffic is meant to turn strangers into MAPL Tours Jamaica guests, and where every piece of it lives. Read this before touching a campaign, an audience, the code offer or the emails. Update it when something changes; the ids below are the live ones.

Last updated: 2026-09-19.

## The funnel in one paragraph

A cold ad on Facebook and Instagram buys one click from someone who is going to Jamaica and has never heard of us. The click lands on bio.mapltours.com, whose only job is to trade a 5% code for an email. The email address goes into the nurture list and gets the code. Newsletters keep the list warm until the trip is near. When a person books on mapltours.com, the purchase reaches Meta with a hashed email, they join the purchaser audience, and once that audience is big enough Meta builds a lookalike from it, so the cold ads stop guessing from interests and start from people who look like guests who already paid. Every stage is measured on our own tables, never on what the ad platform claims.

## Stage 1: cold traffic (Meta)

- Campaign `Cold | Bio landing | Traffic` **120256896264390715**, CA$5/day, spend cap CA$100, ad account act_256162459122082 (CAD, America/Toronto).
- Ad set `Cold | Jamaica resort intent | CA US UK | bio | LPV` **120256896267750715**. Ages 28 to 60, US, CA, GB. Interests: Jamaica, Sandals Resorts, Beaches Resorts, All-inclusive resort. Excludes `Site visitors 180d` (main-site pixel), so the budget only reaches new people. Advantage+ audience off.
- Optimisation: **landing page views**, billed on impressions, lowest cost, no cap. A landing page view only counts when the bio page actually loads and the pixel fires, which filters accidental taps. We do not optimise for leads yet: Meta needs roughly 50 lead events a week per ad set to leave learning, and CA$5/day cannot produce that. The ad set's promoted object is the bio pixel's Lead event, so Meta still reports leads as the result.
- Ads: `Cold | Bio | Video card | Discover Jamaica` **120256896289890715** (creative 1050942381043415, montage over a DM Sans text card, 4:5) and `Cold | Bio | Still | Parasail` **120256896291520715** (creative 1427205789509838). Files in `public/media/ads/`. Button "Get Quote" to https://bio.mapltours.com/ (www.bio has no DNS record; do not use it in an ad). Both track on the bio pixel.
- Copy rules: short, sensory, one believable promise (private ride or tour, one flat price, 5% off). Brand is "MAPL Tours Jamaica" in mixed case. No em dashes. Never a statistic or review we cannot show.

The two older sales campaigns (`Tours | Prospecting | Sales` 120256777214790715 and `MBJ Transfers | Prospecting | Sales` 120256776957190715, CA$5/day each) optimise for Purchase on the main pixel and point at mapltours.com. They are middle-of-funnel in shape but running on cold interest audiences; see "Decisions" for what to do with them.

## Stage 2: the bio page turns the click into an email

- The page asks for an email in exchange for the code. That is a much smaller step than paying a company abroad from a cold ad, which is why cold traffic goes here and not to checkout.
- On submit, `netlify/functions/lead.mts` sends the code email through Resend (once; the day-5 and day-12 follow-ups were dropped on 2026-09-19 because a scheduled email cannot be recalled when the code is used), adds the address to the Resend audience (the nurture list), and sends a `Lead` event to Meta's Conversions API with the same event id the browser pixel used (`lib/analytics.ts`), so ad blockers do not lose it and Meta does not count it twice.
- The code is **JAMAICA5**: 5% off one booking, tours and airport rides, one use per email, no expiry, always out of MAPL's margin (never out of a driver's or operator's rate). It is managed on mapltours.com at /admin/coupons; `data/offer.json` here must match what that desk says.
- Tracking on the page: GA4 property **G-4H9FL0R9VM**, Meta pixel **1060325803564034** (its own, not the main site's). Conversions API needs `META_PIXEL_ID` and `META_CAPI_TOKEN` on the Netlify site `mapltours-bio` (set).
- Email rules (`netlify/lib/emails.mts`): both the ride and the tour get a section and a button, images are 4:3 (`public/media/email/`), the tone is a local who knows the road, not an agency, and there is no "No problem." sign-off. Every link carries `utm_source=bio&utm_medium=email&utm_campaign=bio_coupon`.

**A second capture point on mapltours.com itself (2026-09-19).** The 5% popup (`components/CouponPopup.tsx` in the main repo) opens on the home and explore pages ten seconds into a visit, once, then not for seven days, never again once the guest has the code, and never for a visit that started on the bio page. Its submit goes to the main site's `/api/lead`, which relays to this repo's lead function as `channel: 'site'`: same email (footer says mapltours.com), same Resend audience, HubSpot contact with `mapl_source = site popup`, and the Lead counted on the MAIN pixel (1607953960710055) with a browser event id, plus GA4 `generate_lead` with `lead_source` popup_home or popup_explore. Compare the two capture points by `mapl_source` in HubSpot and by `lead_source` in GA4.

## Stage 3: nurture the list

Today the list lives in the Resend audience and in HubSpot; the only automatic email is the code itself. The plan:

1. **Newsletters** to the list, roughly every two weeks, each one useful on its own: what a ride from MBJ costs and how the driver meets you, the three tours people book most, what to know the week before you fly. One button per email, the code mentioned once near the end. Same tone and image rules as the code emails.
2. **HubSpot** (portal "MAPL Tours Jamaica", free tier) becomes the contact database: every bio lead is created there with source, code and UTM fields, and every paid booking on mapltours.com marks the contact as a customer with the booking type and amount. Newsletters and segments are built in HubSpot's Marketing Emails (free tier: 2,000 sends a month, HubSpot branding). Workflows are a paid feature on this portal, so there is no timed automation; newsletters are sent by hand from HubSpot. Wiring uses a HubSpot service key with `crm.objects.contacts` read and write, stored as `HUBSPOT_SERVICE_KEY` on the bio Netlify site (never in the repo; the repo is public).
3. Segments that matter: leads with no booking after 30 days (send the "what to know before you fly" note), leads whose trip date has passed (stop), customers (thank-you and a second-trip note six months on).

## Stage 4: the booking

Bookings happen on mapltours.com only. Checkout is server-priced, Stripe live, the webhook flips the row to paid and fires `Purchase` to GA4 and to Meta (browser pixel plus Conversions API from the webhook, `lib/meta-capi.ts`, hashed email, event id = booking reference). The booking row stores `attribution` (utm fields, fbclid, gclid) and any coupon in `coupon_code` / `coupon_discount`, and the `coupon_redemptions` ledger records each JAMAICA5 use by email. A booking that started from this funnel shows `utm_source=bio` or a JAMAICA5 line, or both. That table is the truth; Meta's results column overclaims because it credits anything within seven days of a click.

## Stage 5: lookalike

- Seed: `Purchasers 180d` **120256896673830715** (main pixel 1607953960710055, Purchase event, prefilled). It fills itself from the webhook; nothing to upload.
- Meta builds a lookalike only from a seed with at least **100 people in one country**. Until then, do not create one; it fails or delivers nothing.
- When the seed is ready: a 1% lookalike per country (US, CA, GB separately, or one with a multi-country location spec), then a new cold ad set in the bio campaign that targets the lookalike instead of interests, same budget, same creatives, run side by side for two weeks, keep the cheaper lead.
- Leads can seed a second lookalike (`Bio leads 180d`) sooner than purchasers, and it is a weaker but usable signal.

## Audiences (act_256162459122082)

| Audience | Id | Source | Use |
|---|---|---|---|
| Site visitors 180d | 120256776914580715 | main pixel, all | excluded from every cold ad set |
| FB Page engagers 365d | 120256776892960715 | Page 1332003366660610 | too small to use yet |
| Bio visitors 180d | 120256896671320715 | bio pixel, PageView | warm campaign pool |
| Bio leads 180d | 120256896672120715 | bio pixel, Lead | exclude from cold ads; nurture by email |
| Purchasers 180d | 120256896673830715 | main pixel, Purchase | lookalike seed; exclude from everything else |

Custom audiences below about 100 people do not deliver; a retargeting ad set on `Bio visitors 180d` waits until the count clears 1,000.

## What to measure, in this order

1. Cost per landing page view (Meta insights, the `landing_page_view` action).
2. Lead rate: emails captured divided by landing page views. GA4 on G-4H9FL0R9VM against Meta's Lead count; they should agree within a few.
3. Bookings carrying the bio attribution or a JAMAICA5 redemption, from the bookings table and the admin coupon desk, not from Meta.
4. Cost per paid booking = campaign spend / those bookings. Margin on a booking is the MAPL fee less the 5% given away; the ad is worth running while cost per booking stays under that.

Starting thresholds (adjust once there is data): after CA$50 on an ad, a cost per landing page view above CA$2 means swap the creative; after 100 landing page views, a lead rate under 5% means the page or the audience is wrong, not the budget; a creative that is beaten by its sibling for two straight weeks is paused.

## Decisions and the reasoning

- **Cold traffic goes to the bio page, not to checkout.** A stranger will not prepay a company abroad from an ad; an email is a step they will take, and the sequence does the selling over the next twelve days.
- **Landing page views, not leads or purchases, as the optimisation goal at this budget.** See stage 1. Revisit when a single ad set produces 50 leads a week.
- **The discount is a code, not a lower price.** It gives us the email, it is countable per booking, and it comes out of our margin so the driver's rate never moves.
- **Google Search stays on.** It is the only channel where the person is asking for a ride from MBJ right now; it is also where a Meta viewer goes a week later to look us up. Its 10% impression share means it is starved, not failing.
- **Two pixels on purpose.** The bio has its own pixel so its audiences and lead events are clean; the main pixel holds purchase truth. Do not swap them.

## Baseline, 2026-09-19

- Google Search `MBJ Airport Transfers | Search`, CA$5/day: last 7 days 306 impressions, 30 clicks, CTR 9.8%, CA$1.22 per click, CA$36.71 spent, 0 conversions, impression share 10%. Almost all clicks from the core ad group; the town ad groups barely show.
- Meta `Tours | Prospecting | Sales`, lifetime since Sep 12: CA$30.78, 2,384 impressions, 75 link clicks, 55 landing page views (CA$0.56 each).
- Meta `MBJ Transfers | Prospecting | Sales`, same window: CA$24.70, 1,624 impressions, 25 link clicks, 15 landing page views (CA$1.65 each).
- Meta cold bio campaign: switched on 2026-09-19 around 12:00 ET, no data yet.
- Bookings table: 1 booking row created in the last 30 days, pending, none paid. No channel has a paid booking to its name in that window; every "which channel works" question is unanswerable until that changes, so the first job is volume enough to measure.

## Rules that do not bend

- Never complete a checkout on production to "test"; it creates a live pending row and a Stripe intent. Use the dev server with an @example.com email.
- Build campaigns paused, read them back, then enable. Every enable is a spend decision the owner makes.
- No statistic, review, rating or "guests love" line in an ad that we cannot show on request.
- Tokens and keys never go in this repo; it is public. They live in Netlify env and the local `.env.local`.
- Analytics is blocked in the automated browsers, so nothing Claude does shows up as traffic. Do not remove those blocks.

## Next steps

- [ ] Read the cold campaign back after 48 hours: cost per landing page view and Lead count per creative.
- [x] HubSpot service key `HUBSPOT_SERVICE_KEY` (Development, Keys, Service keys) on both Netlify sites; properties created with `node scripts/hubspot-setup.mts`; the function is wired (`netlify/lib/hubspot.mts`).
- [ ] Mark customers in HubSpot from the mapltours.com webhook (lives on the money path; ship with the owner's checkout batch).
- [ ] First newsletter draft to the list once it passes 50 addresses.
- [ ] Retargeting ad set on `Bio visitors 180d` when it clears 1,000.
- [ ] Lookalike from `Purchasers 180d` when it clears 100 in one country.
