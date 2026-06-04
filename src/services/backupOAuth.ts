import https from 'https'
import { spawn } from 'child_process'
import type { Redis } from 'ioredis'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const STATE_TTL = 600

function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      { hostname: u.hostname, path: u.pathname, method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => resolve(Buffer.concat(chunks).toString()))
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function httpsGet(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (d) => chunks.push(d))
        res.on('end', () => resolve(Buffer.concat(chunks).toString()))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

export function buildOAuthUrl(
  clientId: string,
  _clientSecret: string,
  redirectUrl: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUrl,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUrl: string
): Promise<{ access_token: string; refresh_token: string; expiry: number }> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUrl,
    grant_type: 'authorization_code',
  }).toString()

  const raw = await httpsPost(TOKEN_URL, body, {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body).toString(),
  })
  const json = JSON.parse(raw)
  if (json.error) throw new Error(`OAuth token error: ${json.error_description ?? json.error}`)
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expiry: Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600),
  }
}

export async function fetchUserEmail(accessToken: string): Promise<string> {
  const raw = await httpsGet(USERINFO_URL, { Authorization: `Bearer ${accessToken}` })
  const json = JSON.parse(raw)
  return json.email ?? ''
}

export async function storeRcloneToken(
  remoteName: string,
  clientId: string,
  clientSecret: string,
  token: { access_token: string; refresh_token: string; expiry: number }
): Promise<void> {
  const tokenJSON = JSON.stringify({
    access_token: token.access_token,
    token_type: 'Bearer',
    refresh_token: token.refresh_token,
    expiry: new Date(token.expiry * 1000).toISOString(),
  })

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('rclone', [
      'config', 'create', remoteName, 'drive',
      'client_id', clientId,
      'client_secret', clientSecret,
      'scope', 'drive',
      'token', tokenJSON,
      '--non-interactive',
    ])
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`rclone config create failed (exit ${code})`))))
  })
}

export async function storeOAuthState(redis: Redis, state: string): Promise<void> {
  await redis.set(`backup_oauth_state:${state}`, '1', 'EX', STATE_TTL)
}

export async function consumeOAuthState(redis: Redis, state: string): Promise<boolean> {
  const val = await redis.get(`backup_oauth_state:${state}`)
  if (!val) return false
  await redis.del(`backup_oauth_state:${state}`)
  return true
}
