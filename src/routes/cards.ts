import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { pipeline } from 'stream/promises'

export default async function cardRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.post('/api/cards', auth, async (req, reply) => {
    const body = z.object({ listId: z.string(), title: z.string().min(1) }).parse(req.body)
    const last = await app.db.card.findFirst({ where: { listId: body.listId }, orderBy: { position: 'desc' } })
    const card = await app.db.card.create({ data: { ...body, position: (last?.position ?? 0) + 1.0 } })
    const list = await app.db.list.findUniqueOrThrow({ where: { id: body.listId } })
    app.io.to(`board:${list.boardId}`).emit('card:created', { ...card, listId: body.listId })
    return reply.code(201).send(card)
  })

  app.put('/api/cards/:id', auth, async (req) => {
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

  app.put('/api/cards/:id/move', auth, async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({ listId: z.string(), position: z.number() }).parse(req.body)
    const card = await app.db.card.update({ where: { id }, data: body })
    const list = await app.db.list.findUniqueOrThrow({ where: { id: body.listId } })
    app.io.to(`board:${list.boardId}`).emit('card:moved', { id, listId: body.listId, position: body.position })
    return card
  })

  app.delete('/api/cards/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const card = await app.db.card.delete({ where: { id } })
    const list = await app.db.list.findUniqueOrThrow({ where: { id: card.listId } })
    app.io.to(`board:${list.boardId}`).emit('card:deleted', { id })
    return reply.code(204).send()
  })

  // Members
  app.post('/api/cards/:id/members', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { userId } = z.object({ userId: z.string() }).parse(req.body)
    await app.db.cardMember.upsert({
      where: { cardId_userId: { cardId: id, userId } },
      update: {},
      create: { cardId: id, userId },
    })
    return reply.code(204).send()
  })

  app.delete('/api/cards/:id/members/:userId', auth, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string }
    await app.db.cardMember.delete({ where: { cardId_userId: { cardId: id, userId } } })
    return reply.code(204).send()
  })

  // Labels
  app.post('/api/cards/:id/labels', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { labelId } = z.object({ labelId: z.string() }).parse(req.body)
    await app.db.cardLabel.upsert({
      where: { cardId_labelId: { cardId: id, labelId } },
      update: {},
      create: { cardId: id, labelId },
    })
    return reply.code(204).send()
  })

  app.delete('/api/cards/:id/labels/:labelId', auth, async (req, reply) => {
    const { id, labelId } = req.params as { id: string; labelId: string }
    await app.db.cardLabel.delete({ where: { cardId_labelId: { cardId: id, labelId } } })
    return reply.code(204).send()
  })

  // Checklists
  app.post('/api/cards/:id/checklists', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { title } = z.object({ title: z.string().min(1) }).parse(req.body)
    const checklist = await app.db.checklist.create({ data: { cardId: id, title } })
    return reply.code(201).send(checklist)
  })

  app.post('/api/checklists/:id/items', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { text } = z.object({ text: z.string().min(1) }).parse(req.body)
    const item = await app.db.checklistItem.create({ data: { checklistId: id, text } })
    return reply.code(201).send(item)
  })

  app.put('/api/checklist-items/:id', auth, async (req) => {
    const { id } = req.params as { id: string }
    const { isDone, text } = z.object({ isDone: z.boolean().optional(), text: z.string().optional() }).parse(req.body)
    return app.db.checklistItem.update({ where: { id }, data: { isDone, text } })
  })

  app.delete('/api/checklist-items/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    await app.db.checklistItem.delete({ where: { id } })
    return reply.code(204).send()
  })

  // Comments
  app.get('/api/cards/:id/comments', auth, async (req) => {
    const { id } = req.params as { id: string }
    return app.db.comment.findMany({
      where: { cardId: id },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    })
  })

  app.post('/api/cards/:id/comments', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req.user as { sub: string }).sub
    const { body: text } = z.object({ body: z.string().min(1) }).parse(req.body)
    const comment = await app.db.comment.create({
      data: { cardId: id, userId, body: text },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    })
    return reply.code(201).send(comment)
  })

  // Attachments
  app.post('/api/cards/:id/attachments', auth, async (req, reply) => {
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

  app.get('/api/attachments/:id/url', auth, async (req) => {
    const { id } = req.params as { id: string }
    const attachment = await app.db.attachment.findUniqueOrThrow({ where: { id } })
    const url = await app.minio.presignedGetObject('attachments', attachment.minioKey, 900)
    return { url, filename: attachment.filename, mimeType: attachment.mimeType }
  })

  app.delete('/api/attachments/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const attachment = await app.db.attachment.delete({ where: { id } })
    await app.minio.removeObject('attachments', attachment.minioKey)
    return reply.code(204).send()
  })
}
