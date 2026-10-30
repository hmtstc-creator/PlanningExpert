// SOP işleyicisi (docs/wiki/12-sop-olusturma.md). Ayrı kapsayıcıda çalışır
// (deploy/compose.yml → sop-worker): Convex'ten sıradaki işi alır, videoyu
// diske kaydeder, Gemini'ye gösterir, adımların karelerini ffmpeg ile çıkarır
// ve sonucu Convex'e yazar. Aynı anda yalnız bir iş (VPS zorlanmasın).
// Yalnız Node yerleşikleri: npm paketi yok.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const env = (k, d = '') => (process.env[k] ?? d).trim()
const SITE = env('SOP_CONVEX_SITE', 'http://backend:3211')
const CLOUD = env('SOP_CONVEX_URL', 'http://backend:3210')
const MODEL = env('SOP_AI_MODEL', 'gemini-flash-latest')
const DATA = env('SOP_DATA_DIR', '/data')
/** Ortamdaki anahtar yalnız yedek: asıl anahtar sayfadan girilir ve işle birlikte gelir. */
const ENV_AI_KEY = env('SOP_AI_KEY') || env('AI_API_KEY')
let AI_KEY = ENV_AI_KEY

/**
 * Worker jetonu: ortamda yoksa ilk açılışta üretilir ve diskte saklanır;
 * Convex ilk gelen jetonu eşler (convex/sopQueue.ts → authWorker). Böylece
 * sunucuda elle gizli değer yazılmaz.
 */
function workerToken() {
  if (env('SOP_WORKER_TOKEN')) return env('SOP_WORKER_TOKEN')
  const file = join(DATA, 'worker-token')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  mkdirSync(DATA, { recursive: true })
  const t = randomBytes(32).toString('hex')
  writeFileSync(file, t, { mode: 0o600 })
  return t
}
const TOKEN = workerToken()
const VERIFY = env('SOP_VERIFY', '1') !== '0'
/** deploy/README.md: kullanılabilir bellek 1 GB altına düşecekse durulur. */
const MIN_FREE_MB = Number(env('SOP_MIN_FREE_MB', '900'))
const IDLE_MS = 10_000
const GEMINI = env('SOP_GEMINI_URL', 'https://generativelanguage.googleapis.com')

const log = (...a) => console.log(new Date().toISOString(), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- Convex ----------

async function convex(path, body) {
  const res = await fetch(`${SITE}/sop/worker/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) throw new Error(`Convex ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function uploadFrame(file) {
  const res = await fetch(`${SITE}/sop/worker/frame`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/jpeg' },
    body: await readFile(file),
  })
  if (!res.ok) throw new Error(`Frame upload: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).storageId
}

// ---------- Sistem ----------

function freeMb() {
  try {
    const m = /MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))
    return m ? Number(m[1]) / 1024 : Infinity
  } catch {
    return Infinity
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    // nice: botlar ve site önce gelsin.
    const p = spawn('nice', ['-n', '10', cmd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-300)}`))))
  })
}

async function duration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
  const d = Number(out.trim())
  if (!(d > 0)) throw new Error('ffprobe could not read the video duration')
  return d
}

/** Videonun `second`'ındaki kare → JPEG (en çok 1280 px geniş; telefon döndürmesi ffmpeg'de). */
async function frameAt(video, second, out) {
  await run('ffmpeg', ['-v', 'error', '-y', '-threads', '1', '-ss', String(second), '-i', video, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', out])
  if (!existsSync(out) || statSync(out).size === 0) throw new Error(`No frame at ${second} s`)
}

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska' }

// ---------- Gemini ----------

async function gemini(path, init = {}) {
  const res = await fetch(`${GEMINI}${path}`, { ...init, headers: { 'x-goog-api-key': AI_KEY, ...(init.headers ?? {}) } })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res
}

/** Files API, resumable yükleme (inline sınırı 20 MB; video bundan büyük). */
async function uploadVideo(file, mime, name) {
  const size = statSync(file).size
  const start = await gemini('/upload/v1beta/files', {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: name.slice(0, 100) } }),
  })
  const url = start.headers.get('x-goog-upload-url')
  if (!url) throw new Error('Gemini gave no upload URL')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Length': String(size), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: Readable.toWeb(createReadStream(file)),
    duplex: 'half',
  })
  if (!res.ok) throw new Error(`Gemini upload ${res.status}: ${(await res.text()).slice(0, 300)}`)
  let f = (await res.json()).file
  // Video işlenene kadar (ACTIVE) beklenir.
  for (let i = 0; f.state === 'PROCESSING' && i < 120; i++) {
    await sleep(5_000)
    f = await (await gemini(`/v1beta/${f.name}`)).json()
  }
  if (f.state !== 'ACTIVE') throw new Error(`Gemini could not process the video (${f.state})`)
  return f
}

async function generate(contents, schema, config = {}) {
  const res = await gemini(`/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema, ...config } }),
  })
  const json = await res.json()
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text) throw new Error(`Gemini gave no answer (${json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? 'empty'})`)
  return text
}

// ---------- Prompt ----------

const LANG = { tr: 'Türkçe', ro: 'Română (Romanian)' }

function template(file, values) {
  let t = readFileSync(join(HERE, file), 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '')
  for (const [k, v] of Object.entries(values)) t = t.replaceAll(`{{${k}}}`, v)
  return t.trim()
}

function prompt(task, dur) {
  const moments = task.keyMoments?.length
    ? `Kullanıcı şu anları "kilit an" olarak işaretledi (saniye): ${task.keyMoments.join(', ')}. Adımları bu anlardan böl: her kilit an bir adımın içinde olsun, karesi o ana yakın seçilsin.`
    : ''
  const examples = task.examples?.length
    ? `Aynı fabrikanın daha önce onaylanmış SOP'larından örnekler (yazım biçimi ve ayrıntı düzeyi için; içeriği kopyalama):\n${task.examples
        .map((e) => `### ${e.operation}\n${JSON.stringify(e.steps, null, 1)}`)
        .join('\n')}`
    : ''
  return template('prompt.md', {
    dil: LANG[task.language] ?? 'Türkçe',
    operasyon: task.operation || '-',
    makine: task.machine || '-',
    parca: task.partName || '-',
    referans: task.reference || '-',
    not: task.notes || '-',
    sure: String(Math.round(dur * 10) / 10),
    kilit_anlar: moments,
    ornekler: examples,
  })
}

const VERIFY_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      adim: { type: 'INTEGER' },
      foto: { type: 'INTEGER' },
      uygun: { type: 'BOOLEAN' },
      yeni_saniye: { type: 'NUMBER', nullable: true },
      isaret: { type: 'ARRAY', items: { type: 'NUMBER' }, nullable: true },
    },
    required: ['adim', 'foto', 'uygun'],
  },
}

// ---------- İşler ----------

async function analyze(task) {
  AI_KEY = task.aiKey || ENV_AI_KEY
  if (!AI_KEY) {
    await convex('fail', { jobId: task.jobId, error: 'No Gemini key — enter it on the SOP Builder page', retryable: false })
    return
  }
  let progress = 'Started'
  const beat = async (p, extra = {}) => {
    progress = p
    log(task.jobId, p)
    await convex('heartbeat', { jobId: task.jobId, progress: p, ...extra })
  }
  // Uzun beklemelerde (yükleme, Gemini) takılmış sayılmasın.
  const timer = setInterval(() => convex('heartbeat', { jobId: task.jobId, progress }).catch(() => {}), 60_000)
  const tmp = await mkdtemp(join(tmpdir(), 'sop-'))
  let geminiFile = null
  try {
    mkdirSync(join(DATA, 'videos'), { recursive: true })
    const ext = (extname(task.videoName || '') || '.mp4').toLowerCase()
    let video = task.videoPath && existsSync(task.videoPath) ? task.videoPath : join(DATA, 'videos', `${task.jobId}${ext}`)
    if (!existsSync(video) || statSync(video).size === 0) {
      if (!task.videoUrl) throw Object.assign(new Error('The video is gone — upload it again'), { final: true })
      await beat('Downloading the video')
      // Depo adresi dışarıdan görünen adresle gelir; kapsayıcı Convex'e iç ağdan gider.
      const url = new URL(task.videoUrl)
      const local = new URL(CLOUD)
      url.protocol = local.protocol
      url.host = local.host
      const res = await fetch(url)
      if (!res.ok || !res.body) throw new Error(`Video download ${res.status}`)
      await pipeline(Readable.fromWeb(res.body), createWriteStream(video))
    }
    const dur = await duration(video)
    await beat('Video saved on the server', { videoPath: video, videoSeconds: Math.round(dur * 10) / 10 })

    await beat('Sending the video to the AI')
    geminiFile = await uploadVideo(video, MIME[ext] ?? 'video/mp4', `${task.jobId}${ext}`)
    // Kısa videoda saniyede 2 kare (kısa hareket kaçmasın); uzunda düşük çözünürlük (sınır aşılmasın).
    const part = { fileData: { mimeType: geminiFile.mimeType, fileUri: geminiFile.uri }, ...(dur <= 180 ? { videoMetadata: { fps: 2 } } : {}) }
    const config = dur > 900 ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {}
    const contents = [{ role: 'user', parts: [part, { text: prompt(task, dur) }] }]

    await beat('The AI is watching the video')
    let answer = await generate(contents, task.responseSchema, config)
    let check = await convex('check', { resultJson: answer })
    if (!check.ok) {
      // Bir kez daha: hatayı modele söyle (kullanıcı kuralı: şemaya uymazsa 1 kez daha dene).
      await beat('The answer did not fit the form — asking again')
      contents.push({ role: 'model', parts: [{ text: answer }] }, { role: 'user', parts: [{ text: `Your JSON does not fit the schema: ${check.error}. Return the whole answer again, valid.` }] })
      answer = await generate(contents, task.responseSchema, config)
      check = await convex('check', { resultJson: answer })
      if (!check.ok) throw Object.assign(new Error(`The AI answer does not fit the form: ${check.error}`), { final: true })
    }
    const result = JSON.parse(answer)

    await beat(`Taking ${result.adimlar.length} steps' photos`)
    const clamp = (s) => Math.min(Math.max(0, Number(s) || 0), Math.max(0, dur - 0.1))
    const files = new Map()
    const shoot = async (i, k) => {
      const kare = result.adimlar[i].kareler[k]
      kare.saniye = Math.round(clamp(kare.saniye) * 10) / 10
      const out = join(tmp, `s${i}-p${k}-${kare.saniye}.jpg`)
      await frameAt(video, kare.saniye, out)
      files.set(`${i}:${k}`, out)
    }
    for (const [i, a] of result.adimlar.entries()) for (const k of a.kareler.keys()) await shoot(i, k)

    if (VERIFY) {
      try {
        await beat('Checking the photos against the steps')
        const parts = []
        const list = result.adimlar
          .map((a, i) => `Adım ${i + 1} (${a.baslangic_sn}–${a.bitis_sn} s): ${a.temel_adim}${a.puf_noktasi ? ` — püf: ${a.puf_noktasi}` : ''}`)
          .join('\n')
        for (const [i, a] of result.adimlar.entries())
          for (const [k, kare] of a.kareler.entries()) {
            parts.push({ text: `Adım ${i + 1}, foto ${k + 1}, saniye ${kare.saniye}` })
            parts.push({ inlineData: { mimeType: 'image/jpeg', data: (await readFile(files.get(`${i}:${k}`))).toString('base64') } })
          }
        parts.push({ text: template('prompt-verify.md', { adimlar: list }) })
        const verdict = JSON.parse(await generate([{ role: 'user', parts }], VERIFY_SCHEMA))
        for (const v of Array.isArray(verdict) ? verdict : []) {
          const a = result.adimlar[v.adim - 1]
          const kare = a?.kareler[v.foto - 1]
          if (!kare) continue
          if (!v.uygun && Number.isFinite(v.yeni_saniye)) {
            const lo = Math.min(a.baslangic_sn, a.bitis_sn)
            const hi = Math.max(a.baslangic_sn, a.bitis_sn)
            kare.saniye = Math.min(hi, Math.max(lo, v.yeni_saniye))
            kare.isaret = null
            await shoot(v.adim - 1, v.foto - 1)
          } else if (Array.isArray(v.isaret) && v.isaret.length === 4) kare.isaret = v.isaret
        }
      } catch (e) {
        log(task.jobId, 'photo check skipped:', e.message)
      }
    }

    await beat('Saving the photos')
    const frames = []
    for (const [key, file] of files) {
      const [step, photo] = key.split(':').map(Number)
      frames.push({ step, photo, second: result.adimlar[step].kareler[photo].saniye, storageId: await uploadFrame(file) })
    }
    const done = await convex('done', { jobId: task.jobId, resultJson: JSON.stringify(result), duration: Math.round(dur * 10) / 10, model: MODEL, frames })
    if (!done.ok) throw Object.assign(new Error(done.error ?? 'Convex refused the result'), { final: true })
    log(task.jobId, 'ready for review')
  } catch (e) {
    log(task.jobId, 'failed:', e.message)
    await convex('fail', { jobId: task.jobId, error: e.message, retryable: !e.final }).catch((x) => log('fail report failed', x.message))
  } finally {
    clearInterval(timer)
    await rm(tmp, { recursive: true, force: true })
    if (geminiFile) await gemini(`/v1beta/${geminiFile.name}`, { method: 'DELETE' }).catch(() => {})
  }
}

/** Ekrandan istenen kareler: video diskte, yalnız ffmpeg (yapay zekâ yok). */
async function frames(task) {
  if (!task.videoPath || !existsSync(task.videoPath)) {
    log(task.jobId, 'video missing, dropping frame requests')
    await convex('frames-done', { jobId: task.jobId, frames: [], dropPending: true })
    return
  }
  const tmp = await mkdtemp(join(tmpdir(), 'sopf-'))
  try {
    const out = []
    for (const f of task.frames) {
      const file = join(tmp, `${f.step}-${f.photo}.jpg`)
      await frameAt(task.videoPath, f.second, file)
      out.push({ ...f, storageId: await uploadFrame(file) })
    }
    await convex('frames-done', { jobId: task.jobId, frames: out })
  } catch (e) {
    log(task.jobId, 'frames failed:', e.message)
    await convex('frames-done', { jobId: task.jobId, frames: [], dropPending: true }).catch(() => {})
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function main() {
  log(`SOP worker: ${SITE}, model ${MODEL}, data ${DATA}`)
  for (;;) {
    if (freeMb() < MIN_FREE_MB) {
      log(`only ${Math.round(freeMb())} MB free — waiting`)
      await sleep(60_000)
      continue
    }
    try {
      const task = await convex('claim')
      if (!task) await sleep(IDLE_MS)
      else if (task.type === 'frames') await frames(task)
      else await analyze(task)
    } catch (e) {
      log('loop error:', e.message)
      await sleep(30_000)
    }
  }
}

main()
