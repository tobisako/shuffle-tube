/**
 * ShuffleTube クラウド版（外出先のスマホで使う版）
 *
 * Lambda の関数 URL 1 つで次を受け持つ。データと画面は非公開の S3 に置く。
 *   GET  /<VIEW_TOKEN>/                     … 画面（S3 の web/ 以下）。index.html にはクラウド版の印を足す
 *   GET  /<VIEW_TOKEN>/api/data             … プレイリストとライブラリ（S3 の data/ 以下）。?v=<前回の版> で変化が無ければ 204
 *   PUT  /<VIEW_TOKEN>/api/playlists|library … スマホでの編集の保存。Mac のアプリが数秒ごとに確かめて取り込む
 *   PUT  /upload/playlists|library          … Mac のアプリからのデータ受け取り（ヘッダー x-upload-key が必要）
 * 保存したら、応答の x-data-version に保存後の版を返す（送った側が自分の変更を取り込み直さないため）。
 * 合言葉（VIEW_TOKEN）を知らない人には 404 を返す。
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createHash, timingSafeEqual } from 'node:crypto'

const s3 = new S3Client({})
const BUCKET = process.env.BUCKET
const VIEW_TOKEN = process.env.VIEW_TOKEN
const UPLOAD_KEY = process.env.UPLOAD_KEY

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  png: 'image/png',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
}
const TEXT = new Set(['html', 'js', 'css', 'json', 'webmanifest', 'svg'])
const CLOUD_FLAG = '<script>window.__SHUFFLETUBE_CLOUD__=true</script>'

const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
const notFound = () => ({ statusCode: 404, headers: { 'content-type': 'text/plain' }, body: 'Not Found' })

async function getObject(key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    return Buffer.from(await r.Body.transformToByteArray())
  } catch (e) {
    if (e.name === 'NoSuchKey') return null
    throw e
  }
}

async function readJson(key, fallback) {
  const b = await getObject(key)
  if (!b) return fallback
  try { return JSON.parse(b.toString('utf8')) } catch { return fallback }
}

/** 今のデータとその版（中身のハッシュ）。版は GET と PUT の応答で同じ計算をする */
async function currentData() {
  const [playlists, library] = await Promise.all([readJson('data/playlists.json', []), readJson('data/library.json', [])])
  const body = JSON.stringify({ playlists, library, history: [] })
  return { body, version: createHash('sha1').update(body).digest('hex').slice(0, 16) }
}

/** 配列の JSON を data/<kind>.json に保存して、保存後の版を返す */
async function saveData(kind, event) {
  const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '')
  let data
  try { data = JSON.parse(body) } catch { return { statusCode: 400, body: 'Bad JSON' } }
  if (!Array.isArray(data)) return { statusCode: 400, body: 'Array expected' }
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: `data/${kind}.json`, Body: JSON.stringify(data), ContentType: 'application/json',
  }))
  const { version } = await currentData()
  return { statusCode: 200, headers: { 'content-type': TYPES.json, 'cache-control': 'no-store', 'x-data-version': version }, body: JSON.stringify({ version }) }
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? 'GET'
  const path = event.rawPath ?? '/'

  // Mac のアプリからのアップロード
  const up = /^\/upload\/(playlists|library)$/.exec(path)
  if (up) {
    if (method !== 'PUT') return { statusCode: 405, body: 'Method Not Allowed' }
    if (!same(event.headers?.['x-upload-key'], UPLOAD_KEY)) return { statusCode: 403, body: 'Forbidden' }
    return saveData(up[1], event)
  }

  const prefix = `/${VIEW_TOKEN}`
  if (!VIEW_TOKEN || !(path === prefix || path.startsWith(prefix + '/'))) return notFound()
  // スマホからの編集の保存
  const save = /^\/api\/(playlists|library)$/.exec(path.slice(prefix.length))
  if (save && method === 'PUT') return saveData(save[1], event)
  if (method !== 'GET' && method !== 'HEAD') return notFound()
  // 相対パスの画面ファイルが正しく読めるよう、末尾の / を付けさせる
  if (path === prefix) return { statusCode: 302, headers: { location: prefix + '/' } }

  const rest = path.slice(prefix.length + 1) || 'index.html'
  if (rest === 'api/data') {
    const { body, version } = await currentData()
    const headers = { 'content-type': TYPES.json, 'cache-control': 'no-store', 'x-data-version': version }
    // スマホは数秒ごとに問い合わせるので、変化が無ければ中身を返さない
    if (event.queryStringParameters?.v === version) return { statusCode: 204, headers }
    return { statusCode: 200, headers, body }
  }

  if (rest.includes('..')) return notFound()
  const file = await getObject('web/' + rest)
  if (!file) return notFound()
  const ext = rest.split('.').pop().toLowerCase()
  const headers = {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    // ファイル名にハッシュが付く assets/ は長くキャッシュ、それ以外は毎回確認
    'cache-control': rest.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  }
  if (rest === 'index.html') {
    headers['x-robots-tag'] = 'noindex'
    return { statusCode: 200, headers, body: file.toString('utf8').replace('<head>', '<head>' + CLOUD_FLAG) }
  }
  if (TEXT.has(ext)) return { statusCode: 200, headers, body: file.toString('utf8') }
  return { statusCode: 200, headers, body: file.toString('base64'), isBase64Encoded: true }
}
