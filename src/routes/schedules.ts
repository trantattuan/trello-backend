import { FastifyInstance } from 'fastify'
import { z } from 'zod'

const createSchema = z.object({
  listId: z.string(),
  title: z.string().min(1),
  scheduledAt: z.string().datetime().optional(),
  cronExpression: z.string().optional(),
})

const updateSchema = z.object({
  listId: z.string().optional(),
  title: z.string().min(1).optional(),
  scheduledAt: z.string().datetime().nullish(),
  cronExpression: z.string().nullish(),
  isActive: z.boolean().optional(),
})

export default async function scheduleRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.get('/boards/:boardId/schedules', { ...auth }, async (req) => {
    const { boardId } = req.params as { boardId: string }
    return app.db.scheduledJob.findMany({ where: { boardId }, orderBy: { createdAt: 'desc' } })
  })

  app.post('/boards/:boardId/schedules', { ...auth }, async (req, reply) => {
    const { boardId } = req.params as { boardId: string }
    const body = createSchema.parse(req.body)
    const job = await app.db.scheduledJob.create({
      data: {
        boardId,
        listId: body.listId,
        title: body.title,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        cronExpression: body.cronExpression ?? null,
      },
    })
    return reply.code(201).send(job)
  })

  app.put('/schedules/:id', { ...auth }, async (req) => {
    const { id } = req.params as { id: string }
    const body = updateSchema.parse(req.body)
    return app.db.scheduledJob.update({
      where: { id },
      data: {
        ...body,
        scheduledAt: body.scheduledAt !== undefined
          ? (body.scheduledAt ? new Date(body.scheduledAt) : null)
          : undefined,
      },
    })
  })

  app.delete('/schedules/:id', { ...auth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await app.db.scheduledJob.delete({ where: { id } })
    return reply.code(204).send()
  })

  // Internal endpoint for cron service
  app.get('/schedules/pending', async (req, reply) => {
    const secret = req.headers['x-cron-secret']
    if (secret !== process.env.CRON_SECRET) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    const now = new Date()
    const jobs = await app.db.scheduledJob.findMany({
      where: {
        isActive: true,
        OR: [
          // one-time: scheduledAt <= now and never run
          { scheduledAt: { lte: now }, lastRunAt: null, cronExpression: null },
          // recurring: has cron expression and is active (cron service decides timing)
          { cronExpression: { not: null } },
        ],
      },
    })
    return jobs
  })

  // Internal endpoint for cron service to mark job as run
  app.patch('/schedules/:id/run', async (req, reply) => {
    const secret = req.headers['x-cron-secret']
    if (secret !== process.env.CRON_SECRET) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    const { id } = req.params as { id: string }
    const job = await app.db.scheduledJob.update({
      where: { id },
      data: { lastRunAt: new Date() },
    })
    // Deactivate one-time jobs after running
    if (job.scheduledAt && !job.cronExpression) {
      await app.db.scheduledJob.update({ where: { id }, data: { isActive: false } })
    }
    return reply.code(204).send()
  })
}
