import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import Redis from 'ioredis'

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

export default fp(async (app: FastifyInstance) => {
  const redis = new Redis(process.env.REDIS_URL!)
  app.decorate('redis', redis)
  app.addHook('onClose', async () => redis.quit())
})
