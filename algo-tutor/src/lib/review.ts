import type {
  ModelConfig,
  ReviewCard,
  ReviewCardDraft,
  ReviewGrade,
  ReviewRating,
  Session,
} from '../types';
import { CODE_LANGUAGES, type CodeLanguage } from './code';
import { parseAssistantContent } from './protocol';
import { createId } from './storage';

export const REVIEW_MODE_META: Record<
  ReviewCard['mode'],
  { label: string; short: string; hint: string }
> = {
  explain: {
    label: '复述规则',
    short: '规则',
    hint: '不看答案，用自己的话说清概念、条件和原因。',
  },
  trace: {
    label: '手推变量',
    short: '推演',
    hint: '跟着代码逐轮推演，写出变量、索引和最终结果。',
  },
  code: {
    label: '默写代码',
    short: '代码',
    hint: '不运行代码、不做编译判题，由 AI 审查你的实现逻辑。',
  },
};

export const REVIEW_RATING_META: Record<
  ReviewRating,
  { label: string; hint: string; days: number }
> = {
  again: { label: '不会', hint: '10 分钟后再来', days: 10 / 1440 },
  hard: { label: '模糊', hint: '明天再复习', days: 1 },
  good: { label: '会', hint: '3 天后再复习', days: 3 },
  easy: { label: '很熟', hint: '7 天后再复习', days: 7 },
};

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** 把一次会话压缩成足够生成复习卡、但不至于太大的上下文。 */
export function buildReviewContext(session: Session): string {
  const problem = session.messages.find((message) => message.role === 'user')?.content || '';
  const knowledge = session.knowledgePoints
    .map((point) => {
      const mastery = point.mastery ? `（自评：${point.mastery}）` : '';
      const role = point.role ? `（本题作用：${point.role}）` : '';
      return `${point.name}${role}${mastery}`;
    })
    .join('、');
  const assistantTexts = session.messages
    .filter(
      (message) =>
        message.role === 'assistant' && message.content.trim() && !message.error,
    )
    .slice(-3)
    .map((message) => parseAssistantContent(message.content).clean)
    .filter(Boolean)
    .join('\n\n');
  const note = session.note?.markdown || '';
  const laterUserText = session.messages
    .filter((message) => message.role === 'user' && message.kind !== 'knowledge-result')
    .slice(-2)
    .map((message) => message.content)
    .join('\n\n');

  const sections = [
    `题目：${clip(problem.replace(/```[\s\S]*?```/g, ' [代码见学习记录] '), 1800)}`,
    knowledge ? `知识点：${clip(knowledge, 600)}` : '',
    assistantTexts ? `最近讲解：\n${clip(assistantTexts, 5000)}` : '',
    laterUserText && laterUserText !== problem
      ? `用户最近的尝试：\n${clip(laterUserText, 2500)}`
      : '',
    note ? `复习笔记：\n${clip(note, 5500)}` : '',
  ].filter(Boolean);

  return clip(sections.join('\n\n'), 16000);
}

export function createReviewCardFromDraft(
  draft: ReviewCardDraft,
  session: Session,
  now = Date.now(),
): ReviewCard {
  return {
    ...draft,
    id: createId('rev'),
    sessionId: session.id,
    sessionTitle: session.title.slice(0, 40),
    createdAt: now,
    dueAt: now,
    intervalDays: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    attempts: 0,
  };
}

export function scheduleReviewCard(
  card: ReviewCard,
  rating: ReviewRating,
  grade?: ReviewGrade,
  now = Date.now(),
): ReviewCard {
  const meta = REVIEW_RATING_META[rating];
  let intervalDays = meta.days;
  if (rating === 'hard') intervalDays = Math.max(1, card.intervalDays * 1.1);
  if (rating === 'good') intervalDays = Math.max(3, card.intervalDays * 1.6);
  if (rating === 'easy') intervalDays = Math.max(7, card.intervalDays * 2.1);

  const easeDelta: Record<ReviewRating, number> = {
    again: -0.2,
    hard: -0.1,
    good: 0,
    easy: 0.15,
  };
  return {
    ...card,
    dueAt: now + intervalDays * 24 * 60 * 60 * 1000,
    intervalDays,
    ease: Math.min(2.8, Math.max(1.3, card.ease + easeDelta[rating])),
    reps: card.reps + 1,
    lapses: card.lapses + (rating === 'again' ? 1 : 0),
    attempts: (card.attempts || 0) + 1,
    lastReviewedAt: now,
    lastResult: rating,
    lastVerdict: grade?.verdict ?? card.lastVerdict,
    lastScore: grade?.score ?? card.lastScore,
    lastFeedback: grade?.feedback ?? card.lastFeedback,
  };
}

export function dueReviewCards(cards: ReviewCard[], now = Date.now()): ReviewCard[] {
  return cards
    .filter((card) => card.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);
}

export interface ReviewGroup {
  sessionId: string;
  sessionTitle: string;
  dueCards: ReviewCard[];
  totalCount: number;
  modes: ReviewCard['mode'][];
}

function cardPriority(card: ReviewCard): number {
  if (card.lastResult === 'again') return 0;
  if (card.lastResult === 'hard') return 1;
  if (!card.lastReviewedAt) return 2;
  return 3;
}

function sortDueCards(cards: ReviewCard[]): ReviewCard[] {
  return [...cards].sort(
    (a, b) => cardPriority(a) - cardPriority(b) || a.dueAt - b.dueAt,
  );
}

/** 按来源题目分组；只返回当前有到期卡的题目，按最早到期时间排序。 */
export function groupReviewCards(
  cards: ReviewCard[],
  dueCards: ReviewCard[],
): ReviewGroup[] {
  const groups = new Map<
    string,
    { sessionId: string; sessionTitle: string; dueCards: ReviewCard[]; totalCount: number }
  >();

  for (const card of cards) {
    const current = groups.get(card.sessionId);
    if (current) {
      current.totalCount += 1;
      current.sessionTitle = card.sessionTitle || current.sessionTitle;
    } else {
      groups.set(card.sessionId, {
        sessionId: card.sessionId,
        sessionTitle: card.sessionTitle || '未命名题目',
        dueCards: [],
        totalCount: 1,
      });
    }
  }

  for (const card of dueCards) {
    const group = groups.get(card.sessionId);
    if (group) group.dueCards.push(card);
  }

  return [...groups.values()]
    .filter((group) => group.dueCards.length > 0)
    .map((group) => {
      const due = sortDueCards(group.dueCards);
      const modes = [...new Set(due.map((card) => card.mode))];
      return { ...group, dueCards: due, modes };
    })
    .sort(
      (a, b) =>
        Math.min(...a.dueCards.map((card) => card.dueAt)) -
        Math.min(...b.dueCards.map((card) => card.dueAt)),
    );
}

/**
 * 混合队列：不同题目的卡片轮流出现，避免同一道题连续占满一轮。
 * 同一题内部优先安排答错过的卡。
 */
export function buildMixedReviewQueue(dueCards: ReviewCard[]): ReviewCard[] {
  const bySession = new Map<string, ReviewCard[]>();
  for (const card of dueCards) {
    const list = bySession.get(card.sessionId) || [];
    list.push(card);
    bySession.set(card.sessionId, list);
  }
  const groups = [...bySession.values()]
    .map((cards) => sortDueCards(cards))
    .sort(
      (a, b) =>
        Math.min(...a.map((card) => card.dueAt)) -
        Math.min(...b.map((card) => card.dueAt)),
    );

  const queue: ReviewCard[] = [];
  let cursor = 0;
  let remaining = groups.reduce((sum, group) => sum + group.length, 0);
  while (remaining > 0) {
    let added = false;
    for (let offset = 0; offset < groups.length; offset += 1) {
      const index = (cursor + offset) % groups.length;
      const group = groups[index];
      if (group.length) {
        queue.push(group.shift()!);
        remaining -= 1;
        added = true;
        cursor = (index + 1) % groups.length;
        break;
      }
    }
    if (!added) break;
  }
  return queue;
}

export function sessionReviewQueue(
  dueCards: ReviewCard[],
  sessionId: string,
): ReviewCard[] {
  return sortDueCards(dueCards.filter((card) => card.sessionId === sessionId));
}

export function formatNextReview(dueAt: number, now = Date.now()): string {
  const delta = Math.max(0, dueAt - now);
  const minutes = Math.ceil(delta / 60_000);
  if (minutes <= 1) return '即将到期';
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.ceil(hours / 24);
  return `${days} 天后`;
}

export function reviewCardLanguage(card: ReviewCard): CodeLanguage {
  const match = CODE_LANGUAGES.find((language) => language.id === card.language);
  return match?.id ?? 'python';
}

/** 便于复用的配置检查，不直接在 UI 中依赖它。 */
export function isReviewConfigReady(config: ModelConfig | null): boolean {
  return Boolean(config?.model && config?.baseUrl);
}
