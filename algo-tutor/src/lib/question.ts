import type { ChatMessage, Session } from '../types';

const KNOWLEDGE_RESULT_RE = /^\s*\{\s*"results"\s*:/;

/**
 * 找到本次会话的原始题目：第一条有正文或附件的用户消息。
 * 跳过前端自动发送的掌握度 JSON，避免把协议回执当成原题。
 */
export function findOriginalQuestion(session: Session | null): ChatMessage | null {
  if (!session) return null;
  for (const message of session.messages) {
    if (message.role !== 'user') continue;
    const content = message.content.trim();
    if (!content && !message.attachments?.length) continue;
    if (KNOWLEDGE_RESULT_RE.test(content)) continue;
    return message;
  }
  return null;
}
