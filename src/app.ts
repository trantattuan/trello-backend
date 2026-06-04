import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

import dbPlugin from './plugins/db'
import redisPlugin from './plugins/redis'
import minioPlugin from './plugins/minio'
import socketPlugin from './plugins/socket'

import authRoutes from './routes/auth'
import workspaceRoutes from './routes/workspaces'
import boardRoutes from './routes/boards'
import listRoutes from './routes/lists'
import cardRoutes from './routes/cards'
import labelRoutes from './routes/labels'
import webhookRoutes from './routes/webhooks'
import searchRoutes from './routes/search'
import ruleRoutes from './routes/rules'
import scheduleRoutes from './routes/schedules'
import backupRoutes from './routes/backup'
import { startBackupScheduler } from './services/backup'

const app = Fastify({ logger: true })

async function bootstrap() {
  await app.register(swagger, {
    openapi: {
      info: { title: 'Trello Clone API', version: '1.0.0', description: 'Kanban board REST API' },
      servers: [{ url: '/api', description: 'API base' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Auth', description: 'Authentication' },
        { name: 'Workspaces', description: 'Workspace management' },
        { name: 'Boards', description: 'Board management' },
        { name: 'Lists', description: 'List management' },
        { name: 'Cards', description: 'Card management' },
        { name: 'Labels', description: 'Label management' },
        { name: 'Webhooks', description: 'API keys & webhooks' },
      ],
    },
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    staticCSP: true,
  })

  await app.register(cors, { origin: process.env.FRONTEND_URL, credentials: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })

  await app.register(dbPlugin)
  await app.register(redisPlugin)
  await app.register(minioPlugin)

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    redis: app.redis,
    keyGenerator: (req) => {
      const user = req.user as { sub?: string } | undefined
      return user?.sub ?? req.ip
    },
  })

  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      await req.jwtVerify()
      const payload = req.user as { jti: string }
      const blacklisted = await app.redis.get(`session:blacklist:${payload.jti}`)
      if (blacklisted) return reply.code(401).send({ error: 'Token revoked' })
    } catch {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  await app.register(socketPlugin)

  await app.register(authRoutes)
  await app.register(workspaceRoutes)
  await app.register(boardRoutes)
  await app.register(listRoutes)
  await app.register(cardRoutes)
  await app.register(labelRoutes)
  await app.register(webhookRoutes)
  await app.register(searchRoutes)
  await app.register(ruleRoutes)
  await app.register(scheduleRoutes)
  await app.register(backupRoutes)

  const stopScheduler = startBackupScheduler(app.db)
  app.addHook('onClose', async () => stopScheduler())

  app.get('/health', async () => ({
    status: 'ok',
    db: 'connected',
    redis: app.redis.status === 'ready' ? 'connected' : 'error',
  }))

  await app.listen({ port: parseInt(process.env.API_PORT || '3001'), host: '0.0.0.0' })
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
