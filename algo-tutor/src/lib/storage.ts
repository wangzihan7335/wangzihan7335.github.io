import type {
  ChatMessage,
  MessageAttachment,
  ModelConfig,
  PersistedData,
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

export function loadPersistedData(): PersistedData {
  const fallback: PersistedData = {
    version: 1,
    sessions: [],
    configs: [{ ...DEMO_CONFIG }],
    activeConfigId: DEMO_CONFIG.id,
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
    const activeExists = configs.some((config) => config.id === parsed.activeConfigId);
    return {
      version: 1,
      sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt),
      configs,
      activeConfigId: activeExists ? (parsed.activeConfigId ?? null) : (configs[0]?.id ?? null),
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
