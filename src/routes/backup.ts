import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { spawn } from 'child_process'
import { getSettings, runBackup } from '../services/backup'
import {
  buildOAuthUrl,
  exchangeCode,
  fetchUserEmail,
  storeRcloneToken,
  storeOAuthState,
  consumeOAuthState,
} from '../services/backupOAuth'

const settingsUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  cronExpr: z.string().optional(),
  retentionCount: z.number().int().positive().optional(),
  scopeDb: z.boolean().optional(),
  scopeUploads: z.boolean().optional(),
  rcloneRemote: z.string().optional(),
  remoteFolder: z.string().optional(),
})

const credsSchema = z.object({
  gdriveClientId: z.string(),
  gdriveClientSecret: z.string(),
})

export default async function backupRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.get('/backup/settings', { ...auth }, async () => {
    return getSettings(app.db)
  })

  app.put('/backup/settings', { ...auth }, async (req) => {
    const body = settingsUpdateSchema.parse(req.body)
    return app.db.backupSettings.update({
      where: { id: 'global' },
      data: body,
    })
  })

  app.post('/backup/run', { ...auth }, async (req, reply) => {
    const userId = (req.user as { sub: string }).sub

    const existing = await app.db.backupRun.findFirst({ where: { status: 'running' } })
    if (existing) return reply.code(409).send({ error: 'A backup is already running' })

    const settings = await getSettings(app.db)
    const run = await app.db.backupRun.create({
      data: {
        kind: 'manual',
        status: 'pending',
        scopeDb: settings.scopeDb,
        scopeUploads: settings.scopeUploads,
        triggeredBy: userId,
      },
    })

    runBackup(run.id, settings, app.db).catch((err) => app.log.error(err))
    return reply.code(202).send(run)
  })

  app.get('/backup/runs', { ...auth }, async (req) => {
    const { limit = '7' } = req.query as { limit?: string }
    return app.db.backupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(parseInt(limit) || 7, 100),
    })
  })

  app.get('/backup/runs/:id', { ...auth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const run = await app.db.backupRun.findUnique({ where: { id } })
    if (!run) return reply.code(404).send({ error: 'Not found' })
    return run
  })

  app.delete('/backup/runs/:id', { ...auth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await app.db.backupRun.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.get('/backup/rclone-status', { ...auth }, async () => {
    return new Promise((resolve) => {
      const chunks: string[] = []
      const proc = spawn('rclone', ['listremotes'])
      proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString()))
      proc.on('close', (code) => {
        if (code !== 0) return resolve({ installed: false, remotes: [] })
        const remotes = chunks.join('').split('\n').map((r) => r.trim()).filter(Boolean)
        resolve({ installed: true, remotes })
      })
      proc.on('error', () => resolve({ installed: false, remotes: [] }))
    })
  })

  app.put('/backup/gdrive/creds', { ...auth }, async (req) => {
    const body = credsSchema.parse(req.body)
    return app.db.backupSettings.update({
      where: { id: 'global' },
      data: {
        gdriveClientId: body.gdriveClientId,
        gdriveClientSecret: body.gdriveClientSecret,
      },
    })
  })

  app.get('/backup/gdrive/oauth/start', { ...auth }, async (req) => {
    const settings = await getSettings(app.db)
    if (!settings.gdriveClientId || !settings.gdriveClientSecret) {
      return { error: 'Google Drive credentials not configured' }
    }
    const state = randomBytes(16).toString('hex')
    await storeOAuthState(app.redis, state)

    const redirectUrl = `${req.protocol}://${req.hostname}/api/backup/oauth/callback`
    const authUrl = buildOAuthUrl(settings.gdriveClientId, settings.gdriveClientSecret, redirectUrl, state)
    return { authUrl }
  })

  app.post('/backup/gdrive/disconnect', { ...auth }, async () => {
    const settings = await getSettings(app.db)
    await new Promise<void>((resolve) => {
      const proc = spawn('rclone', ['config', 'delete', settings.rcloneRemote])
      proc.on('close', () => resolve())
      proc.on('error', () => resolve())
    })
    return app.db.backupSettings.update({
      where: { id: 'global' },
      data: { gdriveAccountEmail: '' },
    })
  })

  app.get('/backup/oauth/callback', async (req, reply) => {
    const { code, state, error: oauthError } = req.query as {
      code?: string
      state?: string
      error?: string
    }

    const html = (ok: boolean, msg: string) =>
      reply
        .code(200)
        .header('Content-Type', 'text/html')
        .send(
          `<html><script>window.opener&&window.opener.postMessage({type:'backup-oauth-result',ok:${ok},msg:${JSON.stringify(msg)}},'*');window.close();</script></html>`
        )

    if (oauthError) return html(false, oauthError)
    if (!code || !state) return html(false, 'Missing code or state')

    const valid = await consumeOAuthState(app.redis, state)
    if (!valid) return html(false, 'Invalid or expired state')

    try {
      const settings = await getSettings(app.db)
      const redirectUrl = `${req.protocol}://${req.hostname}/api/backup/oauth/callback`
      const token = await exchangeCode(code, settings.gdriveClientId, settings.gdriveClientSecret, redirectUrl)
      const email = await fetchUserEmail(token.access_token)
      await storeRcloneToken(settings.rcloneRemote, settings.gdriveClientId, settings.gdriveClientSecret, token)
      await app.db.backupSettings.update({
        where: { id: 'global' },
        data: { gdriveAccountEmail: email },
      })
      return html(true, `Connected as ${email}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return html(false, msg)
    }
  })
}
