/**
 * The trip tips welcome series in Resend: the tips.subscribed and
 * booking.paid events, the two tip templates (netlify/lib/tip-emails.mts,
 * published), and the "Trip tips welcome" automation that sends them
 * (netlify/lib/tips-automation.mts has the graph and the rules). Safe to run
 * again: anything already right is left alone.
 *
 *   node scripts/tips-automation.mts --dry     print the plan; nothing is written (reads only, and none without a key)
 *   RESEND_API_KEY=re_... node scripts/tips-automation.mts            create or update; a new automation starts disabled
 *   RESEND_API_KEY=re_... TIPS_SEGMENT_ID=... HUBSPOT_SERVICE_KEY=... node scripts/tips-automation.mts --enable
 *                                              the same, both templates republished from the code, then switch it on
 *
 * --enable is refused while POSTAL_ADDRESS in netlify/lib/tip-emails.mts is
 * null: every email in the series must carry the postal address. Setting it
 * and running this again also republishes both templates with it.
 *
 * --enable also needs TIPS_SEGMENT_ID (the value on Netlify) and
 * HUBSPOT_SERVICE_KEY. A disabled automation drops every tips.subscribed, so
 * the first switch-on (an automation that has never had a run) starts the
 * series for everyone on the tips list who has not unsubscribed, read just
 * before the switch, leaving out test addresses and anyone HubSpot shows as
 * having booked. If HubSpot cannot be read it stays off. The output counts
 * them and never prints an address in full.
 */
import { AUTOMATION_NAME, automationGraph, runTipsAutomation } from '../netlify/lib/tips-automation.mts'
import { POSTAL_ADDRESS } from '../netlify/lib/tip-emails.mts'

const args = process.argv.slice(2)
const unknown = args.filter((a) => a !== '--dry' && a !== '--enable')
if (unknown.length) { console.error(`Unknown option ${unknown.join(' ')}. Use --dry and/or --enable.`); process.exit(1) }
const dry = args.includes('--dry')
const enable = args.includes('--enable')
const key = process.env.RESEND_API_KEY || undefined
if (!key && !dry) { console.error('RESEND_API_KEY is not set (a --dry run works without it).'); process.exit(1) }

console.log(`${dry ? 'DRY RUN, nothing is written. ' : ''}${AUTOMATION_NAME}: ${enable ? 'ensure and enable' : 'ensure (status unchanged; new = disabled)'}${dry && !key ? '. No RESEND_API_KEY: showing the plan as if nothing exists yet.' : ''}`)
console.log(`postal address: ${POSTAL_ADDRESS ?? 'not set (the automation cannot be enabled)'}`)
const segment = process.env.TIPS_SEGMENT_ID || undefined
const hubspotKey = process.env.HUBSPOT_SERVICE_KEY || undefined
const { ok, rows } = await runTipsAutomation({ key, dry, enable, segment, hubspotKey })
for (const r of rows) console.log(`${r.state.padEnd(8)} ${r.part.padEnd(10)} ${r.name}${r.detail ? `  ${r.detail}` : ''}`)
if (dry) {
  console.log('\nThe graph (template ids shown as placeholders):')
  console.log(JSON.stringify(automationGraph(['<id of trip-tips-1-ride>', '<id of trip-tips-2-tours>']), null, 2))
}
if (!ok) process.exit(2)
