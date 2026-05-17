import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { evaluateRules } from '../services/ruleEngine'

export default async function cardRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.post('/cards', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Create card',
      body: {
        type: 'object',
        required: ['listId', 'title'],
        properties: { listId: { type: 'string' }, title: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const body = z.object({ listId: z.string(), title: z.string().min(1) }).parse(req.body)
    const last = await app.db.card.findFirst({ where: { listId: body.listId }, orderBy: { position: 'desc' } })
    const card = await app.db.card.create({ data: { ...body, position: (last?.position ?? 0) + 1.0 } })
    const list = await app.db.list.findUniqueOrThrow({ where: { id: body.listId } })
    app.io.to(`board:${list.boardId}`).emit('card:created', { ...card, listId: body.listId })
    evaluateRules(app, { type: 'card_created', cardId: card.id, boardId: list.boardId, listId: body.listId })
    return reply.code(201).send(card)
  })

  app.put('/cards/:id', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Update card',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          dueDate: { type: 'string', nullable: true },
          coverColor: { type: 'string', nullable: true },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      dueDate: z.string().datetime().nullable().optional(),
      coverColor: z.string().nullable().optional(),
    }).parse(req.body)
    const card = await app.db.card.update({ where: { id }, data: body })
    const list = await app.db.list.findUniqueOrThrow({ where: { id: card.listId } })
    app.io.to(`board:${list.boardId}`).emit('card:updated', card)
    return card
  })

  app.put('/cards/:id/move', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Move card to another list',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['listId', 'position'],
        properties: { listId: { type: 'string' }, position: { type: 'number' } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({ listId: z.string(), position: z.number() }).parse(req.body)
    const card = await app.db.card.update({ where: { id }, data: body })
    const list = await app.db.list.findUniqueOrThrow({ where: { id: body.listId } })
    app.io.to(`board:${list.boardId}`).emit('card:moved', { id, listId: body.listId, position: body.position })
    evaluateRules(app, { type: 'card_moved', cardId: id, boardId: list.boardId, toListId: body.listId })
    return card
  })

  app.delete('/cards/:id', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Delete card',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const card = await app.db.card.delete({ where: { id } })
    const list = await app.db.list.findUniqueOrThrow({ where: { id: card.listId } })
    app.io.to(`board:${list.boardId}`).emit('card:deleted', { id })
    return reply.code(204).send()
  })

  app.post('/cards/:id/members', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Add member to card',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { userId } = z.object({ userId: z.string() }).parse(req.body)
    await app.db.cardMember.upsert({
      where: { cardId_userId: { cardId: id, userId } },
      update: {},
      create: { cardId: id, userId },
    })
    return reply.code(204).send()
  })

  app.delete('/cards/:id/members/:userId', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Remove member from card',
      params: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string }
    await app.db.cardMember.delete({ where: { cardId_userId: { cardId: id, userId } } })
    return reply.code(204).send()
  })

  app.post('/cards/:id/labels', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Add label to card',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['labelId'], properties: { labelId: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { labelId } = z.object({ labelId: z.string() }).parse(req.body)
    await app.db.cardLabel.upsert({
      where: { cardId_labelId: { cardId: id, labelId } },
      update: {},
      create: { cardId: id, labelId },
    })
    return reply.code(204).send()
  })

  app.delete('/cards/:id/labels/:labelId', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Remove label from card',
      params: { type: 'object', properties: { id: { type: 'string' }, labelId: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id, labelId } = req.params as { id: string; labelId: string }
    await app.db.cardLabel.delete({ where: { cardId_labelId: { cardId: id, labelId } } })
    return reply.code(204).send()
  })

  app.post('/cards/:id/checklists', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Create checklist on card',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { title } = z.object({ title: z.string().min(1) }).parse(req.body)
    const checklist = await app.db.checklist.create({ data: { cardId: id, title } })
    return reply.code(201).send(checklist)
  })

  app.post('/checklists/:id/items', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Add item to checklist',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { text } = z.object({ text: z.string().min(1) }).parse(req.body)
    const item = await app.db.checklistItem.create({ data: { checklistId: id, text } })
    return reply.code(201).send(item)
  })

  app.put('/checklist-items/:id', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Update checklist item',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { isDone: { type: 'boolean' }, text: { type: 'string' } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    const { isDone, text } = z.object({ isDone: z.boolean().optional(), text: z.string().optional() }).parse(req.body)
    const item = await app.db.checklistItem.update({ where: { id }, data: { isDone, text } })
    if (isDone === true) {
      const checklist = await app.db.checklist.findUnique({
        where: { id: item.checklistId },
        include: { card: { include: { list: true, checklists: { include: { items: true } } } } },
      })
      if (checklist) {
        const allDone = checklist.card.checklists.length > 0 &&
          checklist.card.checklists.every((cl) => cl.items.length > 0 && cl.items.every((i) => i.isDone))
        if (allDone) {
          evaluateRules(app, { type: 'checklist_completed', cardId: checklist.card.id, boardId: checklist.card.list.boardId })
        }
      }
    }
    return item
  })

  app.delete('/checklists/:id', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Delete checklist',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await app.db.checklist.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.delete('/checklist-items/:id', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Delete checklist item',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await app.db.checklistItem.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.get('/cards/:id/comments', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'List card comments',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    return app.db.comment.findMany({
      where: { cardId: id },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    })
  })

  app.post('/cards/:id/comments', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Add comment to card',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['body'], properties: { body: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req.user as { sub: string }).sub
    const { body: text } = z.object({ body: z.string().min(1) }).parse(req.body)
    const comment = await app.db.comment.create({
      data: { cardId: id, userId, body: text },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    })
    return reply.code(201).send(comment)
  })

  app.post('/cards/:id/attachments', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Upload attachment to card (multipart/form-data)',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req.user as { sub: string }).sub
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file' })

    const key = `${id}/${randomUUID()}-${data.filename}`
    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    await app.minio.putObject('attachments', key, buffer, buffer.length, { 'Content-Type': data.mimetype })
    const attachment = await app.db.attachment.create({
      data: { cardId: id, userId, filename: data.filename, minioKey: key, size: buffer.length, mimeType: data.mimetype },
    })
    return reply.code(201).send(attachment)
  })

  app.get('/attachments/:id/url', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Get presigned download URL for attachment',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    const attachment = await app.db.attachment.findUniqueOrThrow({ where: { id } })
    const url = await app.minio.presignedGetObject('attachments', attachment.minioKey, 900)
    return { url, filename: attachment.filename, mimeType: attachment.mimeType }
  })

  app.delete('/attachments/:id', {
    ...auth,
    schema: {
      tags: ['Cards'],
      summary: 'Delete attachment',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const attachment = await app.db.attachment.delete({ where: { id } })
    await app.minio.removeObject('attachments', attachment.minioKey)
    return reply.code(204).send()
  })
}
