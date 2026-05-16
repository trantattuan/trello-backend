import { FastifyInstance } from 'fastify'
import { z } from 'zod'

export default async function listRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.post('/api/lists', auth, async (req, reply) => {
    const body = z.object({ boardId: z.string(), title: z.string().min(1) }).parse(req.body)
    const userId = (req.user as { sub: string }).sub
    const board = await app.db.board.findUniqueOrThrow({ where: { id: body.boardId } })
    const member = await app.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: board.workspaceId, userId } },
    })
    if (!member) return reply.code(403).send({ error: 'Access denied' })

    const last = await app.db.list.findFirst({ where: { boardId: body.boardId }, orderBy: { position: 'desc' } })
    const position = (last?.position ?? 0) + 1.0

    const list = await app.db.list.create({ data: { ...body, position } })
    app.io.to(`board:${body.boardId}`).emit('list:created', list)
    return reply.code(201).send(list)
  })

  app.put('/api/lists/:id', auth, async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({ title: z.string().min(1) }).parse(req.body)
    const list = await app.db.list.update({ where: { id }, data: body })
    app.io.to(`board:${list.boardId}`).emit('list:updated', list)
    return list
  })

  app.put('/api/lists/reorder', auth, async (req) => {
    const body = z.object({
      boardId: z.string(),
      lists: z.array(z.object({ id: z.string(), position: z.number() })),
    }).parse(req.body)

    await Promise.all(
      body.lists.map((l) => app.db.list.update({ where: { id: l.id }, data: { position: l.position } }))
    )
    app.io.to(`board:${body.boardId}`).emit('list:reordered', body.lists)
    return { ok: true }
  })

  app.delete('/api/lists/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const list = await app.db.list.delete({ where: { id } })
    app.io.to(`board:${list.boardId}`).emit('list:deleted', { id })
    return reply.code(204).send()
  })
}
