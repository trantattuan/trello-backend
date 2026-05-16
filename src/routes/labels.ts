import { FastifyInstance } from 'fastify'
import { z } from 'zod'

export default async function labelRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.post('/boards/:boardId/labels', {
    ...auth,
    schema: {
      tags: ['Labels'],
      summary: 'Create label on board',
      params: { type: 'object', properties: { boardId: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['name', 'color'],
        properties: { name: { type: 'string' }, color: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { boardId } = req.params as { boardId: string }
    const body = z.object({ name: z.string().min(1), color: z.string() }).parse(req.body)
    const label = await app.db.label.create({ data: { boardId, ...body } })
    return reply.code(201).send(label)
  })

  app.put('/labels/:id', {
    ...auth,
    schema: {
      tags: ['Labels'],
      summary: 'Update label',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { name: { type: 'string' }, color: { type: 'string' } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({ name: z.string().optional(), color: z.string().optional() }).parse(req.body)
    return app.db.label.update({ where: { id }, data: body })
  })

  app.delete('/labels/:id', {
    ...auth,
    schema: {
      tags: ['Labels'],
      summary: 'Delete label',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await app.db.label.delete({ where: { id } })
    return reply.code(204).send()
  })
}
