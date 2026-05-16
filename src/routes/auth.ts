import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { z } from 'zod'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (req, reply) => {
    const body = registerSchema.parse(req.body)
    const exists = await app.db.user.findUnique({ where: { email: body.email } })
    if (exists) return reply.code(409).send({ error: 'Email already in use' })

    const passwordHash = await bcrypt.hash(body.password, 10)
    const user = await app.db.user.create({
      data: { email: body.email, passwordHash, name: body.name },
      select: { id: true, email: true, name: true, avatarUrl: true },
    })

    const token = app.jwt.sign({ sub: user.id, email: user.email, jti: randomUUID() })
    return reply.code(201).send({ token, user })
  })

  app.post('/api/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body)
    const user = await app.db.user.findUnique({ where: { email: body.email } })
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(body.password, user.passwordHash)
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

    const jti = randomUUID()
    const token = app.jwt.sign({ sub: user.id, email: user.email, jti })
    return { token, user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } }
  })

  app.post('/api/auth/logout', { onRequest: [app.authenticate] }, async (req, reply) => {
    const payload = req.user as { jti: string; exp?: number }
    const ttl = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 86400
    await app.redis.setex(`session:blacklist:${payload.jti}`, ttl, '1')
    return reply.code(204).send()
  })

  app.get('/api/auth/me', { onRequest: [app.authenticate] }, async (req) => {
    const user = await app.db.user.findUniqueOrThrow({
      where: { id: (req.user as { sub: string }).sub },
      select: { id: true, email: true, name: true, avatarUrl: true },
    })
    return user
  })
}
