/**
 * Builds last week's report with the main site's local credentials and
 * writes the HTML to a scratch file. Never sends.
 *
 *   node scripts/weekly-report-dry.mts
 *   MAIN_SITE_URL=http://localhost:3100 node scripts/weekly-report-dry.mts
 *
 * Prints the subject line and any unavailable sources (reasons are masked).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { buildReport, failures } from '../netlify/lib/report/run.mts'
import { render } from '../netlify/lib/report/render.mts'

const MAIN = '/Users/leshan/Desktop/Projects/mapltours'
const OUT = '/private/tmp/claude-501/-Users-leshan-Desktop-Projects-mapltours/97f85b9f-80da-45ce-a96b-9a5b2b4844f7/scratchpad/weekly-report-dry.html'

/** KEY=value lines; surrounding quotes dropped. The first definition wins, as in dotenv. */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m || m[1] in out) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

const file = parseEnv(readFileSync(`${MAIN}/.env.local`, 'utf8'))
const env: NodeJS.ProcessEnv = { ...file, ...process.env }
if ((!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) && existsSync(`${MAIN}/.ga-service-account.json`)) {
  const sa = JSON.parse(readFileSync(`${MAIN}/.ga-service-account.json`, 'utf8')) as { client_email: string; private_key: string }
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL = sa.client_email
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = sa.private_key
}
env.MAPL_REPORT_KEY ??= file.REPORT_KEY
delete env.RESEND_API_KEY

const report = await buildReport(new Date(), env)
const { subject, html } = render(report)
writeFileSync(OUT, html)
console.log(subject)
for (const f of failures(report)) console.log(`unavailable ${f}`)
console.log(`html: ${OUT}`)
