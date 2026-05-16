import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const hash = await bcrypt.hash('password123', 10)

  const user = await prisma.user.upsert({
    where: { email: 'admin@trello.local' },
    update: {},
    create: {
      email: 'admin@trello.local',
      passwordHash: hash,
      name: 'Admin User',
    },
  })

  const workspace = await prisma.workspace.upsert({
    where: { id: 'seed-workspace' },
    update: {},
    create: {
      id: 'seed-workspace',
      name: 'My Workspace',
      ownerId: user.id,
      members: { create: { userId: user.id, role: 'ADMIN' } },
    },
  })

  const board = await prisma.board.create({
    data: {
      workspaceId: workspace.id,
      title: 'Project Board',
      lists: {
        create: [
          { title: 'To Do', position: 1.0 },
          { title: 'In Progress', position: 2.0 },
          { title: 'Done', position: 3.0 },
        ],
      },
    },
  })

  console.log(`Seeded: user=${user.email}, workspace=${workspace.name}, board=${board.title}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
