# bio.mapltours.com

The link-in-bio page for MAPL Tours Jamaica: one static Next.js page (output: export) plus one Netlify function.

- Data in `data/*.json` is exported from the main repo (`mapltours`, lib/airport-transfers.ts and lib/experiences.ts at HEAD). Re-export when fares change; never hand-edit prices.
- Every outbound link goes to mapltours.com with `utm_source=bio&utm_medium=bio` so bookings attribute to this page.
- `netlify/functions/lead.mts` sends the code email through Resend, once, with no follow-ups (dropped Sept 19 2026: a scheduled email cannot be recalled when the code is used). Needs `RESEND_API_KEY` and `BIO_AUDIENCE_ID` on the Netlify site; with `HUBSPOT_SERVICE_KEY` (a service key, `pat-na1-…`) it also creates or updates the HubSpot contact (`netlify/lib/hubspot.mts`; run `node scripts/hubspot-setup.mts` once per portal for the custom properties).
- Copy rules: no em dashes, "MAPL Tours Jamaica" mixed case, drivers "pick you up", no invented reviews or statistics.
- Check every change at 390 and 1440 in a real browser and on the Slow 4G profile; the page exists to load instantly on a phone.
