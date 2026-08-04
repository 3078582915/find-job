import db from '../database';
import { v4 as uuidv4 } from '../utils';

export const DEMO_USER_ID = 'u001';

export interface AgentConversationRecord {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AgentMessageRecord {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function createConversation(userId = DEMO_USER_ID, title = '新对话') {
  const id = uuidv4();
  db.prepare(
    'INSERT INTO agent_conversations (id, user_id, title) VALUES (?, ?, ?)'
  ).run(id, userId, title.trim().slice(0, 60) || '新对话');
  return getConversation(id, userId)!;
}

export function getConversation(id: string, userId = DEMO_USER_ID) {
  return db.prepare(
    'SELECT * FROM agent_conversations WHERE id = ? AND user_id = ?'
  ).get(id, userId) as AgentConversationRecord | undefined;
}

export function listConversations(userId = DEMO_USER_ID) {
  return db.prepare(`
    SELECT c.*,
      (SELECT content FROM agent_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*) FROM agent_messages m WHERE m.conversation_id = c.id) AS message_count
    FROM agent_conversations c
    WHERE c.user_id = ?
    ORDER BY c.updated_at DESC, c.created_at DESC
  `).all(userId);
}

export function deleteConversation(id: string, userId = DEMO_USER_ID) {
  const result = db.prepare(
    'DELETE FROM agent_conversations WHERE id = ? AND user_id = ?'
  ).run(id, userId);
  return result.changes > 0;
}

export function appendMessage(
  conversationId: string,
  role: AgentMessageRecord['role'],
  content: string,
  metadata: Record<string, unknown> = {},
) {
  const id = uuidv4();
  const insert = db.transaction(() => {
    db.prepare(`
      INSERT INTO agent_messages (id, conversation_id, role, content, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, role, content, JSON.stringify(metadata));
    db.prepare(
      "UPDATE agent_conversations SET updated_at = datetime('now') WHERE id = ?"
    ).run(conversationId);
  });
  insert();
  return getMessage(id)!;
}

export function getMessage(id: string) {
  const row = db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(id) as any;
  if (!row) return undefined;
  return { ...row, metadata: parseJsonObject(row.metadata) } as AgentMessageRecord;
}

export function listMessages(conversationId: string, limit = 100) {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = db.prepare(`
    SELECT * FROM agent_messages
    WHERE conversation_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?
  `).all(conversationId, safeLimit) as any[];
  return rows.reverse().map((row) => ({
    ...row,
    metadata: parseJsonObject(row.metadata),
  })) as AgentMessageRecord[];
}

export function updateConversationTitleFromMessage(conversationId: string, message: string) {
  const conversation = db.prepare(
    'SELECT title FROM agent_conversations WHERE id = ?'
  ).get(conversationId) as { title: string } | undefined;
  if (!conversation || conversation.title !== '新对话') return;
  const title = message.replace(/\s+/g, ' ').trim().slice(0, 28) || '新对话';
  db.prepare(
    "UPDATE agent_conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title, conversationId);
}

export function getPreferences(userId = DEMO_USER_ID) {
  const row = db.prepare(
    'SELECT preferences FROM agent_preferences WHERE user_id = ?'
  ).get(userId) as { preferences: string } | undefined;
  return parseJsonObject(row?.preferences);
}

export function savePreferences(preferences: Record<string, unknown>, userId = DEMO_USER_ID) {
  db.prepare(`
    INSERT INTO agent_preferences (user_id, preferences, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      preferences = excluded.preferences,
      updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(preferences));
  return getPreferences(userId);
}

export function createPendingAction(
  conversationId: string,
  actionType: string,
  payload: Record<string, unknown>,
  userId = DEMO_USER_ID,
) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO agent_pending_actions
      (id, conversation_id, user_id, action_type, payload, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+15 minutes'))
  `).run(id, conversationId, userId, actionType, JSON.stringify(payload));
  return getPendingAction(id, userId)!;
}

export function getPendingAction(id: string, userId = DEMO_USER_ID) {
  const row = db.prepare(
    'SELECT * FROM agent_pending_actions WHERE id = ? AND user_id = ?'
  ).get(id, userId) as any;
  if (!row) return undefined;
  return {
    ...row,
    payload: parseJsonObject(row.payload),
    result: parseJsonObject(row.result),
  };
}

export function listPendingActions(
  conversationId: string,
  userId = DEMO_USER_ID,
  statuses: Array<'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'> = ['pending'],
) {
  const safeStatuses = statuses.length ? statuses : ['pending'];
  const placeholders = safeStatuses.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT * FROM agent_pending_actions
    WHERE conversation_id = ? AND user_id = ? AND status IN (${placeholders})
      AND expires_at > datetime('now')
    ORDER BY created_at ASC
  `).all(conversationId, userId, ...safeStatuses) as any[];
  return rows.map((row) => ({
    ...row,
    payload: parseJsonObject(row.payload),
    result: parseJsonObject(row.result),
  }));
}

export function claimPendingAction(id: string, userId = DEMO_USER_ID) {
  const result = db.prepare(`
    UPDATE agent_pending_actions
    SET status = 'processing'
    WHERE id = ? AND user_id = ? AND status = 'pending' AND expires_at > datetime('now')
  `).run(id, userId);
  return result.changes > 0 ? getPendingAction(id, userId) : undefined;
}

export function finishPendingAction(
  id: string,
  status: 'completed' | 'failed' | 'cancelled',
  result: Record<string, unknown>,
  userId = DEMO_USER_ID,
) {
  db.prepare(`
    UPDATE agent_pending_actions SET status = ?, result = ?
    WHERE id = ? AND user_id = ?
  `).run(status, JSON.stringify(result), id, userId);
  return getPendingAction(id, userId);
}

export function logAgentAction(
  conversationId: string,
  toolName: string,
  input: unknown,
  output: unknown,
  status: 'success' | 'error' | 'pending',
  userId = DEMO_USER_ID,
) {
  db.prepare(`
    INSERT INTO agent_action_logs
      (id, conversation_id, user_id, tool_name, input, output, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(), conversationId, userId, toolName,
    JSON.stringify(input ?? {}), JSON.stringify(output ?? null), status,
  );
}
