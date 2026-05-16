import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomBytes } from 'crypto'

export default async function webhookRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.post('/api/workspaces/:id/api-keys', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req.user as { sub: string }).sub
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
    const member = await app.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId } },
    })
    if (!member || member.role !== 'ADMIN') return reply.code(403).send({ error: 'Admin only' })

    const key = `tk_${randomBytes(32).toString('hex')}`
    const apiKey = await app.db.apiKey.create({ data: { workspaceId: id, userId, key, name } })
    return reply.code(201).send(apiKey)
  })

  app.delete('/api/api-keys/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    await app.db.apiKey.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.post('/api/webhooks/inbound', async (req, reply) => {
    const apiKey = req.headers['x-api-key'] as string
    if (!apiKey) return reply.code(401).send({ error: 'API key required' })
    const key = await app.db.apiKey.findUnique({ where: { key: apiKey } })
    if (!key) return reply.code(401).send({ error: 'Invalid API key' })
    // Extend here: process inbound webhook payload
    return { received: true, workspaceId: key.workspaceId }
  })
}
