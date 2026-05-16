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

const userResp = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
  },
}

const tokenResp = {
  type: 'object',
  properties: {
    token: { type: 'string' },
    user: userResp,
  },
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register a new account',
      security: [],
      body: {
        type: 'object',
        required: ['email', 'password', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
          name: { type: 'string', minLength: 1 },
        },
      },
      response: { 201: tokenResp },
    },
  }, async (req, reply) => {
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

  app.post('/auth/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login',
      security: [],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      response: { 200: tokenResp },
    },
  }, async (req, reply) => {
    const body = loginSchema.parse(req.body)
    const user = await app.db.user.findUnique({ where: { email: body.email } })
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(body.password, user.passwordHash)
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' })

    const jti = randomUUID()
    const token = app.jwt.sign({ sub: user.id, email: user.email, jti })
    return { token, user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } }
  })

  app.post('/auth/logout', {
    onRequest: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Logout (blacklist JWT)',
      response: { 204: { type: 'null' } },
    },
  }, async (req, reply) => {
    const payload = req.user as { jti: string; exp?: number }
    const ttl = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 86400
    await app.redis.setex(`session:blacklist:${payload.jti}`, ttl, '1')
    return reply.code(204).send()
  })

  app.get('/auth/me', {
    onRequest: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Get current user',
      response: { 200: userResp },
    },
  }, async (req) => {
    return app.db.user.findUniqueOrThrow({
      where: { id: (req.user as { sub: string }).sub },
      select: { id: true, email: true, name: true, avatarUrl: true },
    })
  })
}
