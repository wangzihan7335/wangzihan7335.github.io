export type Mastery = 'high' | 'medium' | 'low' | 'none';

export type MessageKind = 'text' | 'knowledge' | 'knowledge-result';

export type Theme = 'light' | 'dark';

export type AttachmentKind = 'text' | 'image';

export interface MessageAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** 文本 / 代码文件的纯文本内容。 */
  text?: string;
  /** 图片压缩后的 data URL。 */
  dataUrl?: string;
  width?: number;
  height?: number;
  /** 文件过大时只截取了前一段文本。 */
  truncated?: boolean;
}

export interface KnowledgePoint {
  id: number;
  name: string;
  mastery?: Mastery;
}

export interface Note {
  id: string;
  title: string;
  markdown: string;
  createdAt: number;
  /** 生成这条笔记的助手消息，用于在聊天流里标记「已收录」。 */
  sourceMessageId?: string;
}

export type ReviewMode = 'explain' | 'trace' | 'code';

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export type ReviewVerdict = 'correct' | 'partial' | 'incorrect';

/**
 * AI 生成阶段的卡片草稿；前端再补 id、来源会话与复习调度字段。
 */
export interface ReviewCardDraft {
  mode: ReviewMode;
  title: string;
  prompt: string;
  reference: string;
  hints?: string[];
  rubric?: string[];
  /** trace 模式展示的代码片段。 */
  snippet?: string;
  /** code 模式使用的语言；未指定时回退 Python。 */
  language?: string;
  pointName?: string;
}

export interface ReviewCard extends ReviewCardDraft {
  id: string;
  sessionId: string;
  sessionTitle: string;
  createdAt: number;
  dueAt: number;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReviewedAt?: number;
  lastResult?: ReviewRating;
  lastVerdict?: ReviewVerdict;
  lastScore?: number;
  lastFeedback?: string;
  attempts?: number;
}

export interface ReviewGrade {
  verdict: ReviewVerdict;
  score: number;
  feedback: string;
  missing: string[];
  suggestedRating: ReviewRating;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  kind?: MessageKind;
  createdAt: number;
  /** 随消息一起发送的文件与图片。 */
  attachments?: MessageAttachment[];
  /** 用户主动停止生成时保留的半截消息。 */
  stopped?: boolean;
  /** 生成失败时的错误提示，正文可能保留部分内容。 */
  error?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  knowledgePoints: KnowledgePoint[];
  /** 是否已提交过 knowledge 卡片。 */
  knowledgeSubmitted?: boolean;
  note?: Note;
  pinned?: boolean;
}

export interface ModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  stream: boolean;
}

export interface PersistedData {
  version: 1;
  sessions: Session[];
  configs: ModelConfig[];
  activeConfigId: string | null;
  reviewCards: ReviewCard[];
}

export interface ApiTextPart {
  type: 'text';
  text: string;
}

export interface ApiImagePart {
  type: 'image_url';
  image_url: { url: string };
}

export type ApiContent = string | Array<ApiTextPart | ApiImagePart>;

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant';
  content: ApiContent;
}

export interface Toast {
  id: string;
  tone: 'success' | 'error' | 'info';
  message: string;
}

export const MASTERY_META: Record<
  Mastery,
  { label: string; short: string; hint: string; tone: string }
> = {
  high: { label: '高', short: '高', hint: '掌握扎实，可快速过', tone: 'high' },
  medium: { label: '中', short: '中', hint: '会用但不够稳', tone: 'medium' },
  low: { label: '低', short: '低', hint: '需要再讲一遍', tone: 'low' },
  none: { label: '不会', short: '不会', hint: '从零开始讲', tone: 'none' },
};
