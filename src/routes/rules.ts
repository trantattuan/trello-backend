import { FastifyInstance } from 'fastify'
import { z } from 'zod'

const triggerSchema = z.object({
  type: z.enum(['card_moved', 'card_created', 'checklist_completed']),
  toListId: z.string().optional(),
  listId: z.string().optional(),
})

const actionSchema = z.object({
  type: z.enum(['move_card', 'add_label', 'remove_label', 'assign_member', 'set_due_date']),
  toListId: z.string().optional(),
  labelId: z.string().optional(),
  userId: z.string().optional(),
  daysFromNow: z.number().optional(),
})

export default async function ruleRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.get('/boards/:boardId/rules', { ...auth }, async (req) => {
    const { boardId } = req.params as { boardId: string }
    return app.db.rule.findMany({ where: { boardId }, orderBy: { createdAt: 'desc' } })
  })

  app.post('/boards/:boardId/rules', { ...auth }, async (req, reply) => {
    const { boardId } = req.params as { boardId: string }
    const body = z.object({
      name: z.string().min(1),
      trigger: triggerSchema,
      actions: z.array(actionSchema).min(1),
    }).parse(req.body)
    const rule = await app.db.rule.create({ data: { boardId, ...body } })
    return reply.code(201).send(rule)
  })

  app.put('/rules/:id', { ...auth }, async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      name: z.string().min(1).optional(),
      isActive: z.boolean().optional(),
      trigger: triggerSchema.optional(),
      actions: z.array(actionSchema).min(1).optional(),
    }).parse(req.body)
    return app.db.rule.update({ where: { id }, data: body })
  })

  app.delete('/rules/:id', { ...auth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await app.db.rule.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.get('/rules/:id/logs', { ...auth }, async (req) => {
    const { id } = req.params as { id: string }
    return app.db.ruleLog.findMany({ where: { ruleId: id }, orderBy: { createdAt: 'desc' }, take: 20 })
  })
}
