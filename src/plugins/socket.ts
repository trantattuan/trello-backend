import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import Redis from 'ioredis'

declare module 'fastify' {
  interface FastifyInstance {
    io: Server
  }
}

export default fp(async (app: FastifyInstance) => {
  const io = new Server(app.server, {
    cors: { origin: process.env.FRONTEND_URL, credentials: true },
    path: '/socket.io',
  })

  const pub = new Redis(process.env.REDIS_URL!)
  const sub = pub.duplicate()
  io.adapter(createAdapter(pub, sub))

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token
      const payload = app.jwt.verify<{ sub: string }>(token)
      socket.data.userId = payload.sub
      next()
    } catch {
      next(new Error('Unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('join:board', (boardId: string) => socket.join(`board:${boardId}`))
    socket.on('leave:board', (boardId: string) => socket.leave(`board:${boardId}`))
  })

  app.decorate('io', io)
  app.addHook('onClose', async () => {
    io.close()
    pub.quit()
    sub.quit()
  })
})
