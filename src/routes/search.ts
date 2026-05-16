import { FastifyInstance } from 'fastify'

export default async function searchRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.get('/search', {
    ...auth,
    schema: {
      tags: ['Search'],
      summary: 'Search cards by title, description or label name',
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string' },
          labelName: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { q, labelName } = req.query as { q: string; labelName?: string }
    const userId = (req.user as { sub: string }).sub
    if (!q.trim() && !labelName?.trim()) return []

    const accessFilter = {
      list: { board: { workspace: { members: { some: { userId } } } } },
    }

    const textFilter = q.trim() ? {
      OR: [
        { title: { contains: q, mode: 'insensitive' as const } },
        { description: { contains: q, mode: 'insensitive' as const } },
        { labels: { some: { label: { name: { contains: q, mode: 'insensitive' as const } } } } },
      ],
    } : {}

    const labelFilter = labelName?.trim() ? {
      labels: { some: { label: { name: { contains: labelName, mode: 'insensitive' as const } } } },
    } : {}

    const cards = await app.db.card.findMany({
      where: { ...accessFilter, ...textFilter, ...labelFilter },
      select: {
        id: true,
        title: true,
        description: true,
        createdAt: true,
        labels: { select: { label: { select: { id: true, name: true, color: true } } } },
        list: {
          select: {
            id: true,
            title: true,
            board: { select: { id: true, title: true, workspaceId: true } },
          },
        },
      },
      take: 30,
      orderBy: { createdAt: 'desc' },
    })

    return cards.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      createdAt: c.createdAt,
      labels: c.labels.map((l) => l.label),
      list: { id: c.list.id, title: c.list.title },
      board: c.list.board,
    }))
  })
}
