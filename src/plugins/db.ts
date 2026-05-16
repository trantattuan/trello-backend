import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient
  }
}

export default fp(async (app: FastifyInstance) => {
  const db = new PrismaClient()
  await db.$connect()
  app.decorate('db', db)
  app.addHook('onClose', async () => db.$disconnect())
})
