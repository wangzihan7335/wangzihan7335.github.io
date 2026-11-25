import type {
  ChatMessage,
  MessageAttachment,
  ModelConfig,
  PersistedData,
  ReviewCard,
  ReviewMode,
  ReviewRating,
  ReviewVerdict,
  Session,
} from '../types';
import { DEMO_CONFIG } from '../data/defaults';

const STORAGE_KEY = 'shijie-algo-tutor:v1';

function normalizeAttachment(raw: unknown): MessageAttachment | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<MessageAttachment>;
  if (!item.id || !item.name) return null;
  if (item.kind === 'text' && typeof item.text === 'string') {
    return {
      id: String(item.id),
      name: String(item.name),
      mime: String(item.mime || 'text/plain'),
      size: Number(item.size) || item.text.length,
      kind: 'text',
      text: item.text,
      truncated: Boolean(item.truncated),
    };
  }
  if (item.kind === 'image' && typeof item.dataUrl === 'string') {
    return {
      id: String(item.id),
      name: String(item.name),
      mime: String(item.mime || 'image/webp'),
      size: Number(item.size) || 0,
      kind: 'image',
      dataUrl: item.dataUrl,
      width: Number(item.width) || undefined,
      height: Number(item.height) || undefined,
    };
  }
  return null;
}

function normalizeMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<ChatMessage>;
  if (item.role !== 'user' && item.role !== 'assistant') return null;
  if (typeof item.content !== 'string') return null;
  return {
    id: String(item.id || `${item.role}_${Math.random().toString(36).slice(2)}`),
    role: item.role,
    content: item.content,
    kind: item.kind,
    createdAt: Number(item.createdAt) || Date.now(),
    attachments: Array.isArray(item.attachments)
      ? item.attachments
          .map(normalizeAttachment)
          .filter((attachment): attachment is MessageAttachment => Boolean(attachment))
      : undefined,
    stopped: item.stopped,
    error: item.error,
  };
}

function normalizeSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<Session>;
  if (!item.id || !Array.isArray(item.messages)) return null;
  const messages = item.messages
    .map(normalizeMessage)
    .filter((message): message is ChatMessage => Boolean(message));
  return {
    id: String(item.id),
    title: String(item.title || '未命名题目').slice(0, 40),
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Date.now(),
    messages,
    knowledgePoints: Array.isArray(item.knowledgePoints) ? item.knowledgePoints : [],
    knowledgeSubmitted: Boolean(item.knowledgeSubmitted),
    note: item.note,
    pinned: Boolean(item.pinned),
  };
}

function normalizeConfig(raw: unknown): ModelConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<ModelConfig>;
  if (!item.id || !item.baseUrl || !item.model) return null;
  return {
    id: String(item.id),
    name: String(item.name || '未命名模型').slice(0, 40),
    baseUrl: String(item.baseUrl),
    apiKey: String(item.apiKey || ''),
    model: String(item.model),
    temperature:
      typeof item.temperature === 'number' && Number.isFinite(item.temperature)
        ? Math.min(2, Math.max(0, item.temperature))
        : 0.6,
    stream: item.stream !== false,
  };
}

const REVIEW_MODES: ReviewMode[] = ['explain', 'trace', 'code'];
const REVIEW_RATINGS: ReviewRating[] = ['again', 'hard', 'good', 'easy'];
const REVIEW_VERDICTS: ReviewVerdict[] = ['correct', 'partial', 'incorrect'];

function stringList(raw: unknown, maxItems = 6, maxLength = 240): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const result = raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
  return result.length ? result : undefined;
}

function normalizeReviewCard(raw: unknown): ReviewCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<ReviewCard>;
  if (!item.id || !item.sessionId || !item.title || !item.prompt || !item.reference) return null;
  const mode = REVIEW_MODES.includes(item.mode as ReviewMode) ? (item.mode as ReviewMode) : null;
  if (!mode) return null;
  const lastResult = REVIEW_RATINGS.includes(item.lastResult as ReviewRating)
    ? (item.lastResult as ReviewRating)
    : undefined;
  const lastVerdict = REVIEW_VERDICTS.includes(item.lastVerdict as ReviewVerdict)
    ? (item.lastVerdict as ReviewVerdict)
    : undefined;
  return {
    id: String(item.id),
    sessionId: String(item.sessionId),
    sessionTitle: String(item.sessionTitle || '未命名题目').slice(0, 40),
    mode,
    title: String(item.title).slice(0, 120),
    prompt: String(item.prompt).slice(0, 4000),
    reference: String(item.reference).slice(0, 12000),
    hints: stringList(item.hints),
    rubric: stringList(item.rubric),
    snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, 8000) : undefined,
    language: typeof item.language === 'string' ? item.language.slice(0, 20) : undefined,
    pointName: typeof item.pointName === 'string' ? item.pointName.slice(0, 80) : undefined,
    createdAt: Number(item.createdAt) || Date.now(),
    dueAt: Number(item.dueAt) || Date.now(),
    intervalDays:
      typeof item.intervalDays === 'number' && Number.isFinite(item.intervalDays)
        ? Math.max(0, item.intervalDays)
        : 0,
    ease:
      typeof item.ease === 'number' && Number.isFinite(item.ease)
        ? Math.min(5, Math.max(1.3, item.ease))
        : 2.5,
    reps: Math.max(0, Number(item.reps) || 0),
    lapses: Math.max(0, Number(item.lapses) || 0),
    lastReviewedAt: Number(item.lastReviewedAt) || undefined,
    lastResult,
    lastVerdict,
    lastScore:
      typeof item.lastScore === 'number' && Number.isFinite(item.lastScore)
        ? Math.min(100, Math.max(0, item.lastScore))
        : undefined,
    lastFeedback: typeof item.lastFeedback === 'string' ? item.lastFeedback.slice(0, 2000) : undefined,
    attempts: Math.max(0, Number(item.attempts) || 0),
  };
}

export function loadPersistedData(): PersistedData {
  const fallback: PersistedData = {
    version: 1,
    sessions: [],
    configs: [{ ...DEMO_CONFIG }],
    activeConfigId: DEMO_CONFIG.id,
    reviewCards: [],
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedData>;
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(normalizeSession).filter((item): item is Session => Boolean(item))
      : [];
    const configs = Array.isArray(parsed.configs)
      ? parsed.configs.map(normalizeConfig).filter((item): item is ModelConfig => Boolean(item))
      : [];
    const reviewCards = Array.isArray(parsed.reviewCards)
      ? parsed.reviewCards
          .map(normalizeReviewCard)
          .filter((item): item is ReviewCard => Boolean(item))
      : [];
    const activeExists = configs.some((config) => config.id === parsed.activeConfigId);
    return {
      version: 1,
      sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt),
      configs,
      activeConfigId: activeExists ? (parsed.activeConfigId ?? null) : (configs[0]?.id ?? null),
      reviewCards: reviewCards.sort((a, b) => a.dueAt - b.dueAt),
    };
  } catch {
    return fallback;
  }
}

export function persistData(data: PersistedData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('本地存储写入失败：', error);
  }
}

export function clearPersistedData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export const STORAGE_NAME = STORAGE_KEY;
