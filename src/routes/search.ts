import { FastifyInstance } from 'fastify'

export default async function searchRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.get('/search', {
    ...auth,
    schema: {
      tags: ['Search'],
      summary: 'Search cards by title or description',
      querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } },
    },
  }, async (req) => {
    const { q } = req.query as { q: string }
    const userId = (req.user as { sub: string }).sub
    if (!q.trim()) return []

    const cards = await app.db.card.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
        list: {
          board: {
            workspace: { members: { some: { userId } } },
          },
        },
      },
      select: {
        id: true,
        title: true,
        description: true,
        list: {
          select: {
            id: true,
            title: true,
            board: { select: { id: true, title: true, workspaceId: true } },
          },
        },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    })

    return cards.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      list: { id: c.list.id, title: c.list.title },
      board: c.list.board,
    }))
  })
}
