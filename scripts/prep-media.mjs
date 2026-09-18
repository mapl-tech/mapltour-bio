#!/usr/bin/env node
// Prepare every image and video asset for bio.mapltours.com.
//
// Sources are read from the main site's repo (mapltours/public), which this
// script never writes to. Outputs land in public/media/ with a manifest.json
// listing width, height and bytes for each file. Images go through sharp,
// video through ffmpeg. Nothing is downloaded.
//
// Run:  node scripts/prep-media.mjs
// Env:  MAPL_PUBLIC   path to the main repo's public/ (default: ../mapltours/public)
//       FFMPEG        ffmpeg binary (default: known local copies, then PATH)
//       FFPROBE       ffprobe binary (same resolution)
//
// Budgets are in decimal units (1 KB = 1000 bytes), the stricter reading.
// When a webp lands over its budget at the requested quality, the encoder
// walks a ladder that softens the image slightly before it lowers quality:
// on these photos a 0.6-1.0 px soften is invisible at phone density while a
// quality drop into the 40s shows as blocking in sea and sky. When a clip
// lands over its budget the VBV cap is tightened (bufsize = maxrate) until it
// fits. The manifest records what was actually used. The script exits 1 if
// any budget is still missed, but every output and the manifest are written.

import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'

const execFileAsync = promisify(execFile)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.resolve(process.env.MAPL_PUBLIC ?? path.join(ROOT, '..', 'mapltours', 'public'))
const OUT = path.join(ROOT, 'public', 'media')
const TOURS_JSON = path.join(ROOT, 'data', 'tours.json')

const KB = 1000
const MB = 1000 * KB
const TOTAL_BUDGET = 12 * MB
const WEBP_EFFORT = 6

// Quality delta and gaussian sigma tried in order until a webp fits its budget.
const WEBP_LADDER = [
  { dq: 0, soften: 0 },
  { dq: 0, soften: 0.6 },
  { dq: -4, soften: 0.6 },
  { dq: -8, soften: 0.6 },
  { dq: -8, soften: 0.8 },
  { dq: -12, soften: 0.8 },
  { dq: -12, soften: 1.0 },
  { dq: -16, soften: 1.0 },
]

// VBV settings tried in order until a clip fits its budget. The first row is
// the spec; the 2.4M buffer lets busy footage overshoot maxrate x duration,
// so the retries also shrink the buffer to one second.
const CLIP_LADDER = [
  { maxrate: '1.2M', bufsize: '2.4M' },
  { maxrate: '1.1M', bufsize: '1.1M' },
  { maxrate: '1.0M', bufsize: '1.0M' },
  { maxrate: '900k', bufsize: '900k' },
  { maxrate: '800k', bufsize: '800k' },
]

// ---------------------------------------------------------------------------
// Binaries
// ---------------------------------------------------------------------------

const SCRATCH_FFM =
  '/private/tmp/claude-501/-Users-leshan-Desktop-Projects-mapltours/97f85b9f-80da-45ce-a96b-9a5b2b4844f7/scratchpad/ffm/node_modules'

async function canRun(p) {
  try {
    await access(p, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveBinary(envName, candidates, fallback) {
  if (process.env[envName]) return process.env[envName]
  for (const c of candidates) if (await canRun(c)) return c
  return fallback
}

const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'

const FFMPEG = await resolveBinary(
  'FFMPEG',
  [path.join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg'), path.join(SCRATCH_FFM, 'ffmpeg-static', 'ffmpeg')],
  'ffmpeg',
)
const FFPROBE = await resolveBinary(
  'FFPROBE',
  [
    path.join(ROOT, 'node_modules', 'ffprobe-static', 'bin', platform, arch, 'ffprobe'),
    path.join(SCRATCH_FFM, 'ffprobe-static', 'ffprobe'),
    path.join(SCRATCH_FFM, 'ffprobe-static', 'bin', platform, arch, 'ffprobe'),
  ],
  'ffprobe',
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const manifest = {} // "/media/x.webp" -> { width, height, bytes, ... }
const problems = []

const src = (rel) => path.join(SRC, rel)
const out = (rel) => path.join(OUT, rel)
const publicPath = (rel) => '/media/' + rel.split(path.sep).join('/')
const fmt = (bytes) => (bytes >= MB ? (bytes / MB).toFixed(2) + ' MB' : (bytes / KB).toFixed(1) + ' KB')

async function requireSource(rel) {
  try {
    await access(src(rel), fsConstants.R_OK)
  } catch {
    throw new Error(`Missing source: ${src(rel)}`)
  }
  return src(rel)
}

async function record(rel, width, height, extra = {}, budget = null, note = '') {
  const { size } = await stat(out(rel))
  manifest[publicPath(rel)] = { width, height, bytes: size, ...extra }
  const over = budget != null && size > budget
  if (over) problems.push(`${publicPath(rel)} is ${fmt(size)}, budget ${fmt(budget)}`)
  console.log(
    `${over ? 'OVER' : 'ok  '} ${publicPath(rel).padEnd(40)} ${String(width).padStart(5)}x${String(height).padEnd(5)} ${fmt(size).padStart(10)}` +
      (budget != null ? `  budget ${fmt(budget)}` : '') +
      (note ? `  ${note}` : ''),
  )
}

// Centre cover crop with a mitchell kernel: no ringing on the downscale, which
// both looks cleaner and compresses smaller than lanczos on these photos.
const cover = (file, width, height) => sharp(file).resize(width, height, { fit: 'cover', position: 'centre', kernel: 'mitchell' })

// Encode a webp, walking WEBP_LADDER while the result is over budget.
// `build` returns a fresh sharp pipeline with the resize already applied.
async function writeWebp(rel, build, { quality, budget = null }) {
  await mkdir(path.dirname(out(rel)), { recursive: true })
  let result
  for (const rung of WEBP_LADDER) {
    const q = quality + rung.dq
    let pipeline = build()
    if (rung.soften > 0) pipeline = pipeline.blur(rung.soften)
    const { data, info } = await pipeline.webp({ quality: q, effort: WEBP_EFFORT }).toBuffer({ resolveWithObject: true })
    result = { data, info, q, soften: rung.soften }
    if (budget == null || data.length <= budget) break
  }
  await writeFile(out(rel), result.data)
  const extra = { quality: result.q }
  if (result.soften > 0) extra.soften = result.soften
  const note = result.q !== quality || result.soften > 0 ? `q${quality} -> q${result.q}${result.soften ? ` soften ${result.soften}` : ''}` : ''
  await record(rel, result.info.width, result.info.height, extra, budget, note)
}

async function copyAsset(rel, source, probe) {
  await mkdir(path.dirname(out(rel)), { recursive: true })
  await copyFile(source, out(rel))
  const d = await probe(out(rel))
  const extra = {}
  if (d.fps) extra.fps = d.fps
  if (d.duration) extra.duration = d.duration
  await record(rel, d.width, d.height, extra)
}

async function imageDims(file) {
  const m = await sharp(file).metadata()
  return { width: m.width, height: m.height }
}

async function videoDims(file) {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
    '-of', 'json',
    file,
  ])
  const j = JSON.parse(stdout)
  const s = j.streams?.[0] ?? {}
  const [num, den] = String(s.r_frame_rate ?? '0/1').split('/').map(Number)
  return {
    width: s.width,
    height: s.height,
    fps: den ? Math.round((num / den) * 100) / 100 : undefined,
    duration: j.format?.duration ? Math.round(Number(j.format.duration) * 100) / 100 : undefined,
  }
}

// 540x960 portrait, 24 fps, first 8 s, silent, CRF 30 under a VBV cap, moov
// atom up front so playback starts before the download finishes.
async function encodeClip(rel, source, budget) {
  await mkdir(path.dirname(out(rel)), { recursive: true })
  let used
  for (const vbv of CLIP_LADDER) {
    await execFileAsync(FFMPEG, [
      '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-i', source,
      '-t', '8',
      '-an',
      '-map_metadata', '-1',
      '-vf', 'fps=24,scale=540:960:force_original_aspect_ratio=increase:flags=lanczos,crop=540:960',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '30',
      '-maxrate', vbv.maxrate,
      '-bufsize', vbv.bufsize,
      '-profile:v', 'main',
      '-level', '3.1',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      out(rel),
    ])
    used = vbv
    const { size } = await stat(out(rel))
    if (size <= budget) break
  }
  const d = await videoDims(out(rel))
  const note = used !== CLIP_LADDER[0] ? `maxrate ${CLIP_LADDER[0].maxrate} -> ${used.maxrate}` : ''
  await record(rel, d.width, d.height, { fps: d.fps, duration: d.duration, maxrate: used.maxrate }, budget, note)
}

// ---------------------------------------------------------------------------
// 1. Hero
// ---------------------------------------------------------------------------

async function hero() {
  console.log('\n# Hero')
  const portraitMp4 = await requireSource('hero-negril-jamaica-portrait.mp4')
  const portraitPoster = await requireSource('hero-negril-jamaica-portrait.webp')
  const landscapeMp4 = await requireSource('hero-negril-jamaica-540.mp4')
  const transfersHero = await requireSource('media/img/14788935-hero.jpg')

  await copyAsset('hero-portrait.mp4', portraitMp4, videoDims)
  await copyAsset('hero-portrait.webp', portraitPoster, imageDims)
  await copyAsset('hero-landscape.mp4', landscapeMp4, videoDims)

  await writeWebp('hero-landscape.webp', () => sharp(transfersHero).resize({ width: 1600, kernel: 'mitchell', withoutEnlargement: true }), {
    quality: 62,
    budget: 120 * KB,
  })
  await writeWebp('hero-portrait-small.webp', () => cover(portraitPoster, 480, 854), { quality: 60 })
}

// ---------------------------------------------------------------------------
// 2. Tour posters, clips and blur placeholders
// ---------------------------------------------------------------------------

async function tours() {
  console.log('\n# Tours')
  const data = JSON.parse(await readFile(TOURS_JSON, 'utf8'))
  const names = [...new Set(data.tours.map((t) => t.mobileVideo).filter(Boolean).map((v) => path.basename(v, '.mp4')))]
  if (names.length === 0) throw new Error('No mobileVideo entries in data/tours.json')

  for (const name of names) {
    const poster = await requireSource(path.join('media', 'video', 'm', `${name}.webp`))
    const clip = await requireSource(path.join('media', 'video', 'm', `${name}.mp4`))

    await writeWebp(path.join('tours', `${name}.webp`), () => cover(poster, 720, 960), { quality: 62, budget: 70 * KB })
    await writeWebp(path.join('tours', `${name}-blur.webp`), () => cover(poster, 24, 32).blur(1.2), { quality: 30 })
    await encodeClip(path.join('tours', `${name}.mp4`), clip, 1.2 * MB)
  }
}

// ---------------------------------------------------------------------------
// 3. Proof block images: 900 wide, 4:5
// ---------------------------------------------------------------------------

const PROOF = [
  ['proof-arrivals.webp', 'media/img/14788935-hero.jpg'],
  ['proof-flight.webp', 'img/dest/montego-bay-beach.jpg'],
  ['proof-car.webp', 'media/img/5005121.jpg'],
  ['proof-driver.webp', 'img/dest/negril-ricks-cafe.jpg'],
]

async function proof() {
  console.log('\n# Proof')
  for (const [name, rel] of PROOF) {
    const source = await requireSource(rel)
    await writeWebp(name, () => cover(source, 900, 1125), { quality: 64, budget: 90 * KB })
  }
}

// ---------------------------------------------------------------------------
// 4. Zone thumbnails: 400x300
// ---------------------------------------------------------------------------

const ZONES = [
  ['zone-A.webp', 'img/dest/montego-bay-beach.jpg'],
  ['zone-B.webp', 'img/dest/falmouth-martha-brae-sunlit.jpg'],
  ['zone-C.webp', 'tours/nine-mile-trading-post.jpg'],
  ['zone-D.webp', 'img/dest/negril-ricks-cafe.jpg'],
  ['zone-E.webp', 'img/dest/ocho-rios-dunns-river-falls.jpg'],
]

async function zones() {
  console.log('\n# Zones')
  for (const [name, rel] of ZONES) {
    const source = await requireSource(rel)
    await writeWebp(name, () => cover(source, 400, 300), { quality: 60, budget: 30 * KB })
  }
}

// ---------------------------------------------------------------------------
// 5. Open Graph image: 1200x630 JPEG with a dark bottom gradient, no text
// ---------------------------------------------------------------------------

async function og() {
  console.log('\n# Open Graph')
  const source = await requireSource('media/img/14788935-hero.jpg')
  const W = 1200
  const H = 630
  const gradient = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.40" stop-color="#000" stop-opacity="0"/>
          <stop offset="0.75" stop-color="#000" stop-opacity="0.45"/>
          <stop offset="1" stop-color="#000" stop-opacity="0.82"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
    </svg>`,
  )
  await mkdir(OUT, { recursive: true })
  const info = await cover(source, W, H)
    .composite([{ input: gradient, blend: 'over' }])
    .jpeg({ quality: 80, mozjpeg: true, progressive: true })
    .toFile(out('og.jpg'))
  await record('og.jpg', info.width, info.height, { quality: 80 })
}

// ---------------------------------------------------------------------------
// 6. Logos
// ---------------------------------------------------------------------------

async function logos() {
  console.log('\n# Logos')
  await copyAsset('logo.svg', await requireSource('mapl-logo.svg'), imageDims)
  await copyAsset('logo-dark.svg', await requireSource('mapl-logo-dark.svg'), imageDims)
}

// ---------------------------------------------------------------------------
// 7. Manifest
// ---------------------------------------------------------------------------

async function writeManifest() {
  const totalBytes = Object.values(manifest).reduce((n, f) => n + f.bytes, 0)
  const doc = {
    generatedAt: new Date().toISOString(),
    totalBytes,
    files: Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))),
  }
  await writeFile(out('manifest.json'), JSON.stringify(doc, null, 1) + '\n')
  return totalBytes
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`source  ${SRC}`)
  console.log(`output  ${OUT}`)
  console.log(`ffmpeg  ${FFMPEG}`)
  console.log(`ffprobe ${FFPROBE}`)
  await mkdir(OUT, { recursive: true })

  await hero()
  await tours()
  await proof()
  await zones()
  await og()
  await logos()

  const totalBytes = await writeManifest()
  console.log(`\n${Object.keys(manifest).length} files, ${fmt(totalBytes)} total, budget ${fmt(TOTAL_BUDGET)}`)
  if (totalBytes > TOTAL_BUDGET) problems.push(`total ${fmt(totalBytes)} exceeds ${fmt(TOTAL_BUDGET)}`)

  if (problems.length) {
    console.error('\nOver budget:')
    for (const p of problems) console.error('  ' + p)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exitCode = 1
})
