import { FastifyInstance } from 'fastify'
import { z } from 'zod'

const wsResp = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    ownerId: { type: 'string' },
    createdAt: { type: 'string' },
  },
}

export default async function workspaceRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }

  app.get('/workspaces', {
    ...auth,
    schema: { tags: ['Workspaces'], summary: 'List my workspaces' },
  }, async (req) => {
    const userId = (req.user as { sub: string }).sub
    return app.db.workspace.findMany({
      where: { members: { some: { userId } } },
      include: {
        boards: { orderBy: { createdAt: 'desc' } },
        _count: { select: { boards: true, members: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  })

  app.post('/workspaces', {
    ...auth,
    schema: {
      tags: ['Workspaces'],
      summary: 'Create workspace',
      body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      response: { 201: wsResp },
    },
  }, async (req, reply) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
    const userId = (req.user as { sub: string }).sub
    const workspace = await app.db.workspace.create({
      data: { name, ownerId: userId, members: { create: { userId, role: 'ADMIN' } } },
    })
    return reply.code(201).send(workspace)
  })

  app.put('/workspaces/:id', {
    ...auth,
    schema: {
      tags: ['Workspaces'],
      summary: 'Rename workspace (Admin only)',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
    const userId = (req.user as { sub: string }).sub
    const member = await app.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId } } })
    if (!member || member.role !== 'ADMIN') return reply.code(403).send({ error: 'Admin only' })
    const workspace = await app.db.workspace.update({ where: { id }, data: { name } })
    return workspace
  })

  app.get('/workspaces/:id', {
    ...auth,
    schema: {
      tags: ['Workspaces'],
      summary: 'Get workspace with boards and members',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req.user as { sub: string }).sub
    const member = await app.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId } } })
    if (!member) return reply.code(403).send({ error: 'Access denied' })
    return app.db.workspace.findUniqueOrThrow({
      where: { id },
      include: {
        boards: { orderBy: { createdAt: 'desc' } },
        members: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
      },
    })
  })

  app.post('/workspaces/:id/members', {
    ...auth,
    schema: {
      tags: ['Workspaces'],
      summary: 'Invite member (Admin only)',
      params: { type: 'object', properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['ADMIN', 'MEMBER'] },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { email, role } = z.object({ email: z.string().email(), role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER') }).parse(req.body)
    const userId = (req.user as { sub: string }).sub
    const member = await app.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId } } })
    if (!member || member.role !== 'ADMIN') return reply.code(403).send({ error: 'Admin only' })
    const invitee = await app.db.user.findUnique({ where: { email } })
    if (!invitee) return reply.code(404).send({ error: 'User not found' })
    await app.db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: id, userId: invitee.id } },
      update: { role },
      create: { workspaceId: id, userId: invitee.id, role },
    })
    return reply.code(204).send()
  })

  app.delete('/workspaces/:id', {
    ...auth,
    schema: {
      tags: ['Workspaces'],
      summary: 'Delete workspace (Admin only)',
      params: { type: 'object', properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = (req.user as { sub: string }).sub
    const member = await app.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId } } })
    if (!member || member.role !== 'ADMIN') return reply.code(403).send({ error: 'Admin only' })
    await app.db.workspace.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.delete('/workspaces/:id/members/:userId', {
    ...auth,
    schema: {
      tags: ['Workspaces'],
      summary: 'Remove member (Admin only)',
      params: { type: 'object', properties: { id: { type: 'string' }, userId: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id, userId: targetId } = req.params as { id: string; userId: string }
    const userId = (req.user as { sub: string }).sub
    const member = await app.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId } } })
    if (!member || member.role !== 'ADMIN') return reply.code(403).send({ error: 'Admin only' })
    await app.db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: id, userId: targetId } } })
    return reply.code(204).send()
  })
}
