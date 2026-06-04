import { spawn } from 'child_process'
import { mkdir, rm, stat } from 'fs/promises'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const MAX_LOG = 4 * 1024

async function spawnCollect(
  cmd: string,
  args: string[],
  env?: Record<string, string>
): Promise<{ code: number; log: string }> {
  return new Promise((resolve) => {
    const chunks: string[] = []
    const proc = spawn(cmd, args, {
      env: { ...process.env, ...env },
      shell: false,
    })
    const collect = (d: Buffer) => {
      chunks.push(d.toString())
      const full = chunks.join('')
      if (full.length > MAX_LOG) {
        chunks.length = 0
        chunks.push(full.slice(full.length - MAX_LOG))
      }
    }
    proc.stdout.on('data', collect)
    proc.stderr.on('data', collect)
    proc.on('close', (code) => resolve({ code: code ?? 1, log: chunks.join('') }))
  })
}

export async function getSettings(db: PrismaClient) {
  return db.backupSettings.upsert({
    where: { id: 'global' },
    create: { id: 'global' },
    update: {},
  })
}

function parseCronIntervalMs(expr: string): number | null {
  // */N * * * *  → every N minutes
  const everyMin = expr.match(/^\*\/(\d+) \* \* \* \*$/)
  if (everyMin) return parseInt(everyMin[1]) * 60 * 1000

  // 0 */N * * *  → every N hours
  const everyHour = expr.match(/^0 \*\/(\d+) \* \* \*$/)
  if (everyHour) return parseInt(everyHour[1]) * 60 * 60 * 1000

  // 0 0 */N * *  → every N days
  const everyDay = expr.match(/^0 0 \*\/(\d+) \* \*$/)
  if (everyDay) return parseInt(everyDay[1]) * 24 * 60 * 60 * 1000

  // 0 H * * *  → daily at hour H (e.g. 0 2 * * *)
  const dailyAt = expr.match(/^0 (\d+) \* \* \*$/)
  if (dailyAt) return 24 * 60 * 60 * 1000

  return null
}

function isDue(cronExpr: string, lastRunAt: Date | null): boolean {
  if (!lastRunAt) return true
  const intervalMs = parseCronIntervalMs(cronExpr)
  if (intervalMs === null) return false
  return Date.now() - lastRunAt.getTime() >= intervalMs
}

export async function runBackup(
  runId: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
  db: PrismaClient
): Promise<void> {
  const ts = Date.now()
  const stagingDir = `/tmp/backups/${ts}`
  const logLines: string[] = []
  const log = (s: string) => logLines.push(s)

  const flush = async (status: 'running' | 'success' | 'failed', extra: Partial<{
    finishedAt: Date
    sizeBytes: bigint
    remotePath: string
    error: string
  }> = {}) => {
    const tail = logLines.join('\n').slice(-MAX_LOG)
    await db.backupRun.update({
      where: { id: runId },
      data: { status, logTail: tail, ...extra },
    })
  }

  try {
    await mkdir(stagingDir, { recursive: true })
    await flush('running')

    let totalBytes = BigInt(0)
    let remotePath = ''

    if (settings.scopeDb) {
      const dbFile = path.join(stagingDir, 'db.sql.gz')
      log('Starting pg_dump...')
      const { code, log: out } = await spawnCollect(
        'sh',
        ['-c', `pg_dump --clean --if-exists "${process.env.DATABASE_URL}" | gzip > ${dbFile}`]
      )
      log(out)
      if (code !== 0) throw new Error(`pg_dump failed (exit ${code})`)
      log('pg_dump done')
      try {
        const s = await stat(dbFile)
        totalBytes += BigInt(s.size)
      } catch {}
    }

    if (settings.scopeUploads) {
      const uploadsDir = path.join(stagingDir, 'uploads')
      await mkdir(uploadsDir, { recursive: true })
      const endpoint = process.env.MINIO_ENDPOINT || 'localhost'
      const port = process.env.MINIO_PORT || '9000'
      const user = process.env.MINIO_ROOT_USER || 'minioadmin'
      const pass = process.env.MINIO_ROOT_PASSWORD || 'minioadmin'
      const mcAlias = 'local'
      const mcEnv = { [`MC_HOST_${mcAlias}`]: `http://${user}:${pass}@${endpoint}:${port}` }

      log('Mirroring MinIO uploads...')
      const { code, log: out } = await spawnCollect(
        'mc',
        ['mirror', `${mcAlias}/uploads`, uploadsDir],
        mcEnv
      )
      log(out)
      if (code !== 0) throw new Error(`mc mirror failed (exit ${code})`)
      log('MinIO mirror done')
    }

    const archiveName = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`
    const archivePath = `/tmp/backups/${archiveName}`
    log('Creating archive...')
    const { code: tarCode, log: tarOut } = await spawnCollect(
      'tar',
      ['-czf', archivePath, '-C', '/tmp/backups', `${ts}`]
    )
    log(tarOut)
    if (tarCode !== 0) throw new Error(`tar failed (exit ${tarCode})`)

    try {
      const s = await stat(archivePath)
      totalBytes = BigInt(s.size)
    } catch {}

    const remote = `${settings.rcloneRemote}:${settings.remoteFolder}/${archiveName}`
    log(`Uploading to ${remote}...`)
    const { code: rcloneCode, log: rcloneOut } = await spawnCollect(
      'rclone',
      ['copyto', archivePath, remote, '--progress']
    )
    log(rcloneOut)
    if (rcloneCode !== 0) throw new Error(`rclone upload failed (exit ${rcloneCode})`)
    remotePath = remote
    log('Upload done')

    await rm(stagingDir, { recursive: true, force: true })
    await rm(archivePath, { force: true })

    await flush('success', {
      finishedAt: new Date(),
      sizeBytes: totalBytes,
      remotePath,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`ERROR: ${msg}`)
    await flush('failed', { finishedAt: new Date(), error: msg })
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function startBackupScheduler(db: PrismaClient): () => void {
  let running = false

  const tick = async () => {
    if (running) return
    try {
      const settings = await getSettings(db)
      if (!settings.enabled) return

      const lastRun = await db.backupRun.findFirst({
        where: { kind: 'scheduled', status: 'success' },
        orderBy: { startedAt: 'desc' },
      })

      if (!isDue(settings.cronExpr, lastRun?.startedAt ?? null)) return

      running = true
      const run = await db.backupRun.create({
        data: {
          kind: 'scheduled',
          status: 'pending',
          scopeDb: settings.scopeDb,
          scopeUploads: settings.scopeUploads,
        },
      })

      runBackup(run.id, settings, db).finally(() => { running = false })
    } catch (err) {
      console.error('[backup scheduler]', err)
      running = false
    }
  }

  const timer = setInterval(tick, 60_000)
  return () => clearInterval(timer)
}
