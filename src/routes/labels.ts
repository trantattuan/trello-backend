import { FastifyInstance } from 'fastify'
import { z } from 'zod'

export default async function labelRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.post('/api/boards/:boardId/labels', auth, async (req, reply) => {
    const { boardId } = req.params as { boardId: string }
    const body = z.object({ name: z.string().min(1), color: z.string() }).parse(req.body)
    const label = await app.db.label.create({ data: { boardId, ...body } })
    return reply.code(201).send(label)
  })

  app.put('/api/labels/:id', auth, async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({ name: z.string().optional(), color: z.string().optional() }).parse(req.body)
    return app.db.label.update({ where: { id }, data: body })
  })

  app.delete('/api/labels/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    await app.db.label.delete({ where: { id } })
    return reply.code(204).send()
  })
}
