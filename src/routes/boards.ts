import { FastifyInstance } from 'fastify'
import { z } from 'zod'

async function assertMember(app: FastifyInstance, boardId: string, userId: string) {
  const board = await app.db.board.findUniqueOrThrow({ where: { id: boardId } })
  const member = await app.db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: board.workspaceId, userId } },
  })
  if (!member) throw { statusCode: 403, message: 'Access denied' }
  return board
}

export default async function boardRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.post('/boards', {
    ...auth,
    schema: {
      tags: ['Boards'],
      summary: 'Create board',
      body: {
        type: 'object',
        required: ['workspaceId', 'title'],
        properties: {
          workspaceId: { type: 'string' },
          title: { type: 'string' },
          visibility: { type: 'string', enum: ['PRIVATE', 'WORKSPACE', 'PUBLIC'] },
        },
      },
    },
  }, async (req, reply) => {
    const body = z.object({
      workspaceId: z.string(),
      title: z.string().min(1),
      visibility: z.enum(['PRIVATE', 'WORKSPACE', 'PUBLIC']).default('WORKSPACE'),
    }).parse(req.body)
    const userId = (req.user as { sub: string }).sub
    const member = await app.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: body.workspaceId, userId } },
    })
    if (!member) return reply.code(403).send({ error: 'Access denied' })
    const board = await app.db.board.create({ data: body })
    return reply.code(201).send(board)
  })

  app.get('/boards/:id', {
    ...auth,
    schema: {
      tags: ['Boards'],
      summary: 'Get full board with lists and cards',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    const userId = (req.user as { sub: string }).sub
    await assertMember(app, id, userId)
    return app.db.board.findUniqueOrThrow({
      where: { id },
      include: {
        labels: true,
        lists: {
          orderBy: { position: 'asc' },
          include: {
            cards: {
              orderBy: { position: 'asc' },
              include: {
                members: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
                labels: { include: { label: true } },
                checklists: { include: { items: true } },
                _count: { select: { attachments: true, comments: true } },
              },
            },
          },
        },
      },
    })
  })

  app.put('/boards/:id', {
    ...auth,
    schema: {
      tags: ['Boards'],
      summary: 'Update board',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          visibility: { type: 'string', enum: ['PRIVATE', 'WORKSPACE', 'PUBLIC'] },
          backgroundUrl: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    const userId = (req.user as { sub: string }).sub
    await assertMember(app, id, userId)
    const body = z.object({
      title: z.string().min(1).optional(),
      visibility: z.enum(['PRIVATE', 'WORKSPACE', 'PUBLIC']).optional(),
      backgroundUrl: z.string().optional(),
    }).parse(req.body)
    return app.db.board.update({ where: { id }, data: body })
  })

  app.delete('/boards/:id', {
    ...auth,
    schema: {
      tags: ['Boards'],
      summary: 'Delete board',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req.user as { sub: string }).sub
    await assertMember(app, id, userId)
    await app.db.board.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.get('/boards/:id/stats', {
    ...auth,
    schema: {
      tags: ['Boards'],
      summary: 'Board stats: card count by list / member / label',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    const userId = (req.user as { sub: string }).sub
    await assertMember(app, id, userId)
    const lists = await app.db.list.findMany({
      where: { boardId: id },
      include: { _count: { select: { cards: true } } },
    })
    const byMember = await app.db.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT u.name, COUNT(cm.card_id)::int as count
      FROM card_members cm
      JOIN users u ON u.id = cm.user_id
      JOIN cards c ON c.id = cm.card_id
      JOIN lists l ON l.id = c.list_id
      WHERE l.board_id = ${id}
      GROUP BY u.name
    `
    const byLabel = await app.db.$queryRaw<{ name: string; color: string; count: bigint }[]>`
      SELECT lb.name, lb.color, COUNT(cl.card_id)::int as count
      FROM card_labels cl
      JOIN labels lb ON lb.id = cl.label_id
      WHERE lb.board_id = ${id}
      GROUP BY lb.id, lb.name, lb.color
    `
    return {
      byList: lists.map((l) => ({ id: l.id, title: l.title, count: l._count.cards })),
      byMember: byMember.map((r) => ({ name: r.name, count: Number(r.count) })),
      byLabel: byLabel.map((r) => ({ name: r.name, color: r.color, count: Number(r.count) })),
    }
  })
}
