import type {
  ApiMessage,
  ChatMessage,
  KnowledgePoint,
  Mastery,
  Session,
} from '../types';

/**
 * 结构化协议解析。
 *
 * 所有 title / knowledge 块都在这里被识别并从显示正文中剔除；
 * 原始消息仍然完整保存在 localStorage，刷新后可以重新解析。
 */

const TITLE_BLOCK_RE = /```[ \t]*title[ \t]*\r?\n([\s\S]*?)```/i;
const KNOWLEDGE_BLOCK_RE = /```[ \t]*knowledge[ \t]*\r?\n([\s\S]*?)```/gi;
const UNCLOSED_PROTOCOL_RE = /\n?```[ \t]*(?:title|knowledge)\b[\s\S]*$/i;

const VALID_MASTERY: Mastery[] = ['high', 'medium', 'low', 'none'];

export function cleanTitle(raw: string): string {
  let title = String(raw || '')
    .replace(/```/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || '';
  title = title
    .replace(/^(标题|题目|title|会话标题)\s*[:：]\s*/i, '')
    .replace(/^[#>*\-\s]+/, '')
    .replace(/[*_`"'“”‘’《》]/g, '')
    .replace(/\s+/g, '')
    .trim();
  return Array.from(title).slice(0, 15).join('');
}

export function makeFallbackTitle(problem: string): string {
  const text = String(problem || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '新的算法题';
  const clipped = Array.from(text).slice(0, 15).join('');
  return clipped || '新的算法题';
}

function cleanKnowledgeRole(raw: unknown): string {
  return String(raw ?? '')
    .replace(/^\s*(?:在本题中|本题作用|作用|role)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function parseKnowledgeJson(raw: string): KnowledgePoint[] {
  const text = String(raw || '')
    .trim()
    .replace(/^json\s*/i, '')
    .trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const candidate =
    Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { points?: unknown })?.points)
        ? (parsed as { points: unknown[] }).points
        : [];
  const points: KnowledgePoint[] = [];
  const usedIds = new Set<number>();
  for (let index = 0; index < candidate.length; index += 1) {
    const item = candidate[index];
    if (!item || typeof item !== 'object') continue;
    const record = item as { name?: unknown; id?: unknown; role?: unknown; usage?: unknown; purpose?: unknown };
    const name = String(record.name ?? '').trim();
    if (!name) continue;
    let id = Number(record.id);
    if (!Number.isFinite(id) || id <= 0 || usedIds.has(id)) {
      id = 1;
      while (usedIds.has(id)) id += 1;
    }
    usedIds.add(id);
    const role = cleanKnowledgeRole(record.role ?? record.usage ?? record.purpose);
    points.push({ id, name: name.slice(0, 40), ...(role ? { role } : {}) });
    if (points.length >= 10) break;
  }
  return points;
}

export function parseAssistantContent(
  content: string,
  options: { streaming?: boolean } = {},
): {
  title?: string;
  points: KnowledgePoint[];
  clean: string;
  hasKnowledge: boolean;
} {
  let title: string | undefined;
  const titleMatch = content.match(TITLE_BLOCK_RE);
  if (titleMatch?.[1]) {
    const parsedTitle = cleanTitle(titleMatch[1]);
    if (parsedTitle) title = parsedTitle;
  }

  const points: KnowledgePoint[] = [];
  let hasKnowledge = false;
  const seenNames = new Set<string>();
  for (const match of content.matchAll(KNOWLEDGE_BLOCK_RE)) {
    hasKnowledge = true;
    for (const point of parseKnowledgeJson(match[1])) {
      if (seenNames.has(point.name)) continue;
      seenNames.add(point.name);
      points.push({ ...point, id: points.length + 1 });
    }
  }

  let clean = content
    .replace(TITLE_BLOCK_RE, '')
    .replace(KNOWLEDGE_BLOCK_RE, '')
    .replace(UNCLOSED_PROTOCOL_RE, '');

  if (options.streaming) {
    // 正在吐 JSON 的协议块（还没有闭合）不要闪现在气泡里。
    clean = clean.replace(UNCLOSED_PROTOCOL_RE, '');
  }

  clean = clean
    .replace(/^\s+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, points, clean, hasKnowledge };
}

export function stripProtocolBlocks(content: string): string {
  return parseAssistantContent(content).clean;
}

export function buildKnowledgeResultContent(points: KnowledgePoint[]): string {
  const results = points
    .filter((point) => point.mastery)
    .map((point) => ({ id: point.id, mastery: point.mastery }));
  return JSON.stringify({ results });
}

export function parseKnowledgeResultContent(
  content: string,
): Array<{ id: number; mastery: Mastery }> {
  const text = String(content || '');
  const match = text.match(/\{[\s\S]*"results"[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as {
      results?: Array<{ id?: unknown; mastery?: unknown }>;
    };
    if (!Array.isArray(parsed.results)) return [];
    return parsed.results
      .map((item) => ({
        id: Number(item?.id),
        mastery: String(item?.mastery) as Mastery,
      }))
      .filter(
        (item) => Number.isFinite(item.id) && VALID_MASTERY.includes(item.mastery),
      );
  } catch {
    return [];
  }
}

export interface KnowledgeResultView {
  items: Array<{ id: number; name: string; mastery: Mastery }>;
  summary: string;
}

export function describeKnowledgeResult(
  points: KnowledgePoint[],
  content: string,
): KnowledgeResultView {
  const results = parseKnowledgeResultContent(content);
  const nameById = new Map(points.map((point) => [point.id, point.name]));
  const labels: Record<Mastery, string> = {
    high: '高',
    medium: '中',
    low: '低',
    none: '不会',
  };
  const items = results.map((result) => ({
    id: result.id,
    name: nameById.get(result.id) || `知识点 ${result.id}`,
    mastery: result.mastery,
  }));
  const summary = items.map((item) => `${item.name} · ${labels[item.mastery]}`).join('　');
  return { items, summary };
}

export function isCompletionIntent(text: string): boolean {
  const compact = String(text || '').replace(/\s+/g, '');
  if (!compact) return false;
  if (
    /^(完成|做完了|写完了|写好了|搞定了?|结束了|我完成了|我写完了|ok完成)/i.test(compact)
  ) {
    return true;
  }
  return compact.length <= 30 && /(生成|整理|输出).*(复习)?笔记/.test(compact);
}

export function isCodeSubmission(text: string): boolean {
  const raw = String(text || '');
  return /```(?:python|js|javascript|java|cpp|c\+\+|go|rust|ts|typescript)?/i.test(raw) ||
    (raw.includes('\n') && /(function\s|def\s|class\s|return\s|for\s*\(|while\s*\()/.test(raw));
}

/** 找到最近一条包含完整 knowledge 块的助手消息，用于定位卡片渲染位置。 */
export function findKnowledgeOwnerMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || message.error) continue;
    if (parseAssistantContent(message.content).points.length > 0) return message;
  }
  return null;
}

export function getFirstUserMessage(session: Session): string {
  return session.messages.find((message) => message.role === 'user')?.content || '';
}

/** 构造发送给模型的对话历史。协议原文、笔记和附件都保留。 */
export function sessionToApiMessages(session: Session): ApiMessage[] {
  return session.messages
    .filter((message) => message.content.trim() || message.attachments?.length)
    .map((message) => {
      if (message.role === 'assistant') {
        return { role: 'assistant', content: message.content };
      }

      const textBlocks: string[] = [];
      if (message.content.trim()) textBlocks.push(message.content.trim());
      let textBudget = 100_000;

      for (const attachment of message.attachments || []) {
        if (attachment.kind !== 'text' || !attachment.text) continue;
        const header = `--- 附件：${attachment.name} ---`;
        const footer = '--- 附件结束 ---';
        const remaining = Math.max(0, textBudget - header.length - footer.length);
        if (remaining <= 0) {
          textBlocks.push(`[附件 ${attachment.name} 因上下文过长未发送]`);
          break;
        }
        const body = attachment.text.slice(0, remaining);
        textBudget -= header.length + body.length + footer.length;
        textBlocks.push(`${header}\n${body}\n${footer}`);
      }

      const images = (message.attachments || []).filter(
        (attachment) => attachment.kind === 'image' && attachment.dataUrl,
      );
      if (images.length) {
        const imageNames = images.map((image) => image.name).join('、');
        const text = `${textBlocks.join('\n\n')}\n\n[用户上传的图片：${imageNames}]`.trim();
        return {
          role: 'user',
          content: [
            { type: 'text' as const, text },
            ...images.map((image) => ({
              type: 'image_url' as const,
              image_url: { url: image.dataUrl || '' },
            })),
          ],
        };
      }

      return { role: 'user', content: textBlocks.join('\n\n') };
    });
}

export function countMastery(points: KnowledgePoint[]): Record<Mastery | 'unset', number> {
  const result: Record<Mastery | 'unset', number> = {
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
    unset: 0,
  };
  for (const point of points) {
    if (point.mastery) result[point.mastery] += 1;
    else result.unset += 1;
  }
  return result;
}
