import { FastifyInstance } from 'fastify'

export type TriggerType = 'card_moved' | 'card_created' | 'checklist_completed'
export type ActionType = 'move_card' | 'add_label' | 'remove_label' | 'assign_member' | 'set_due_date'

interface Trigger {
  type: TriggerType
  toListId?: string
  listId?: string
}

interface Action {
  type: ActionType
  toListId?: string
  labelId?: string
  userId?: string
  daysFromNow?: number
}

export interface RuleEvent {
  type: TriggerType
  cardId: string
  boardId: string
  toListId?: string
  listId?: string
}

function matchesTrigger(trigger: Trigger, event: RuleEvent): boolean {
  if (trigger.type !== event.type) return false
  if (trigger.type === 'card_moved' && trigger.toListId && trigger.toListId !== event.toListId) return false
  if (trigger.type === 'card_created' && trigger.listId && trigger.listId !== event.listId) return false
  return true
}

async function executeAction(app: FastifyInstance, action: Action, cardId: string, boardId: string) {
  switch (action.type) {
    case 'move_card': {
      if (!action.toListId) return
      const last = await app.db.card.findFirst({ where: { listId: action.toListId }, orderBy: { position: 'desc' } })
      const position = (last?.position ?? 0) + 1
      await app.db.card.update({ where: { id: cardId }, data: { listId: action.toListId, position } })
      app.io.to(`board:${boardId}`).emit('card:moved', { id: cardId, listId: action.toListId, position })
      break
    }
    case 'add_label': {
      if (!action.labelId) return
      await app.db.cardLabel.upsert({
        where: { cardId_labelId: { cardId, labelId: action.labelId } },
        update: {},
        create: { cardId, labelId: action.labelId },
      })
      const updated = await app.db.card.findUnique({
        where: { id: cardId },
        include: { labels: { include: { label: true } }, members: { include: { user: true } } },
      })
      if (updated) app.io.to(`board:${boardId}`).emit('card:updated', updated)
      break
    }
    case 'remove_label': {
      if (!action.labelId) return
      await app.db.cardLabel.deleteMany({ where: { cardId, labelId: action.labelId } })
      const updated = await app.db.card.findUnique({
        where: { id: cardId },
        include: { labels: { include: { label: true } }, members: { include: { user: true } } },
      })
      if (updated) app.io.to(`board:${boardId}`).emit('card:updated', updated)
      break
    }
    case 'assign_member': {
      if (!action.userId) return
      await app.db.cardMember.upsert({
        where: { cardId_userId: { cardId, userId: action.userId } },
        update: {},
        create: { cardId, userId: action.userId },
      })
      const updated = await app.db.card.findUnique({
        where: { id: cardId },
        include: { labels: { include: { label: true } }, members: { include: { user: true } } },
      })
      if (updated) app.io.to(`board:${boardId}`).emit('card:updated', updated)
      break
    }
    case 'set_due_date': {
      if (action.daysFromNow == null) return
      const due = new Date()
      due.setDate(due.getDate() + action.daysFromNow)
      const updated = await app.db.card.update({ where: { id: cardId }, data: { dueDate: due } })
      app.io.to(`board:${boardId}`).emit('card:updated', updated)
      break
    }
  }
}

export async function evaluateRules(app: FastifyInstance, event: RuleEvent) {
  try {
    const rules = await app.db.rule.findMany({ where: { boardId: event.boardId, isActive: true } })
    for (const rule of rules) {
      if (!matchesTrigger(rule.trigger as unknown as Trigger, event)) continue
      const actions = rule.actions as unknown as Action[]
      for (const action of actions) {
        try {
          await executeAction(app, action, event.cardId, event.boardId)
          await app.db.ruleLog.create({
            data: { ruleId: rule.id, cardId: event.cardId, status: 'success', detail: action.type },
          })
        } catch (err) {
          await app.db.ruleLog.create({
            data: { ruleId: rule.id, cardId: event.cardId, status: 'failed', detail: String(err) },
          }).catch(() => {})
        }
      }
    }
  } catch {
    // rule evaluation is best-effort, never break main flow
  }
}
