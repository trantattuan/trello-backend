import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'

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

const app = Fastify({ logger: true })

async function bootstrap() {
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

  app.get('/api/health', async () => ({
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
