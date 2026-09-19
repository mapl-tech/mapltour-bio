/**
 * One-time HubSpot setup: the "MAPL Tours" property group and the custom
 * contact properties the lead function writes. Safe to run again; existing
 * properties are reported as such.
 *
 *   HUBSPOT_SERVICE_KEY=pat-... node scripts/hubspot-setup.mts
 */
import { ensureLeadProperties } from '../netlify/lib/hubspot.mts'

const token = process.env.HUBSPOT_SERVICE_KEY
if (!token) { console.error('HUBSPOT_SERVICE_KEY is not set'); process.exit(1) }
if (!token.startsWith('pat-')) { console.error('HUBSPOT_SERVICE_KEY does not look like a HubSpot service key (they start with pat-)'); process.exit(1) }

const rows = await ensureLeadProperties(token)
for (const r of rows) console.log(`${r.state.padEnd(8)} ${String(r.status).padEnd(4)} ${r.name}${r.error ? `  ${r.error}` : ''}`)
if (rows.some((r) => r.state === 'failed')) process.exit(2)
