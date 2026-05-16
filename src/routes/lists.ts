import { FastifyInstance } from 'fastify'
import { z } from 'zod'

export default async function listRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.post('/lists', {
    ...auth,
    schema: {
      tags: ['Lists'],
      summary: 'Create list',
      body: {
        type: 'object',
        required: ['boardId', 'title'],
        properties: { boardId: { type: 'string' }, title: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ boardId: z.string(), title: z.string().min(1) }).parse(req.body)
    const userId = (req.user as { sub: string }).sub
    const board = await app.db.board.findUniqueOrThrow({ where: { id: body.boardId } })
    const member = await app.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: board.workspaceId, userId } },
    })
    if (!member) return reply.code(403).send({ error: 'Access denied' })
    const last = await app.db.list.findFirst({ where: { boardId: body.boardId }, orderBy: { position: 'desc' } })
    const list = await app.db.list.create({ data: { ...body, position: (last?.position ?? 0) + 1.0 } })
    app.io.to(`board:${body.boardId}`).emit('list:created', list)
    return reply.code(201).send(list)
  })

  app.put('/lists/:id', {
    ...auth,
    schema: {
      tags: ['Lists'],
      summary: 'Rename list',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({ title: z.string().min(1) }).parse(req.body)
    const list = await app.db.list.update({ where: { id }, data: body })
    app.io.to(`board:${list.boardId}`).emit('list:updated', list)
    return list
  })

  app.put('/lists/reorder', {
    ...auth,
    schema: {
      tags: ['Lists'],
      summary: 'Reorder lists after drag-and-drop',
      body: {
        type: 'object',
        required: ['boardId', 'lists'],
        properties: {
          boardId: { type: 'string' },
          lists: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'string' }, position: { type: 'number' } } },
          },
        },
      },
    },
  }, async (req) => {
    const body = z.object({
      boardId: z.string(),
      lists: z.array(z.object({ id: z.string(), position: z.number() })),
    }).parse(req.body)
    await Promise.all(body.lists.map((l) => app.db.list.update({ where: { id: l.id }, data: { position: l.position } })))
    app.io.to(`board:${body.boardId}`).emit('list:reordered', body.lists)
    return { ok: true }
  })

  app.delete('/lists/:id', {
    ...auth,
    schema: {
      tags: ['Lists'],
      summary: 'Delete list',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const list = await app.db.list.delete({ where: { id } })
    app.io.to(`board:${list.boardId}`).emit('list:deleted', { id })
    return reply.code(204).send()
  })
}
