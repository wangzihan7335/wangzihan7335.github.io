import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  BookOpenText,
  Check,
  ChevronRight,
  Code2,
  Eye,
  Layers,
  Lightbulb,
  ListTree,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  ModelConfig,
  ReviewCard,
  ReviewGrade,
  ReviewRating,
  ReviewVerdict,
  Session,
} from '../types';
import { gradeReviewAnswer, userMessageForError } from '../lib/api';
import {
  REVIEW_MODE_META,
  REVIEW_RATING_META,
  buildMixedReviewQueue,
  formatNextReview,
  groupReviewCards,
  reviewCardLanguage,
  sessionReviewQueue,
  type ReviewGroup,
} from '../lib/review';
import type { CodeLanguage } from '../lib/code';
import { cn } from '../lib/utils';
import { CodeEditor } from './CodeEditor';
import { Markdown } from './Markdown';

interface ReviewWorkspaceProps {
  open: boolean;
  dueCards: ReviewCard[];
  allCards: ReviewCard[];
  config: ModelConfig | null;
  activeSession: Session | null;
  generating: boolean;
  canGenerate: boolean;
  onClose: () => void;
  onGenerate: () => void;
  onRate: (card: ReviewCard, rating: ReviewRating, grade: ReviewGrade) => void;
  onToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

type ReviewView = 'home' | 'review' | 'complete';

const MODE_ICONS = {
  explain: BookOpenText,
  trace: ListTree,
  code: Code2,
};

function verdictLabel(verdict: ReviewVerdict): string {
  if (verdict === 'correct') return '答得不错';
  if (verdict === 'partial') return '还差一点';
  return '再想一遍';
}

function ratingIcon(rating: ReviewRating) {
  if (rating === 'again') return <RotateCcw size={13} />;
  if (rating === 'hard') return <Lightbulb size={13} />;
  if (rating === 'easy') return <Check size={13} />;
  return <ChevronRight size={13} />;
}

export function ReviewWorkspace({
  open,
  dueCards,
  allCards,
  config,
  activeSession,
  generating,
  canGenerate,
  onClose,
  onGenerate,
  onRate,
  onToast,
}: ReviewWorkspaceProps) {
  const [view, setView] = useState<ReviewView>('home');
  const [queue, setQueue] = useState<ReviewCard[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [queueLabel, setQueueLabel] = useState('混合复习');
  const [answer, setAnswer] = useState('');
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<CodeLanguage>('python');
  const [grade, setGrade] = useState<ReviewGrade | null>(null);
  const [grading, setGrading] = useState(false);
  const [visibleHints, setVisibleHints] = useState(0);
  const [showReference, setShowReference] = useState(false);

  const groups = useMemo(() => groupReviewCards(allCards, dueCards), [allCards, dueCards]);
  const currentCard = view === 'review' ? queue[queueIndex] ?? null : null;
  const nextDueAt = useMemo(() => {
    const future = allCards
      .map((card) => card.dueAt)
      .filter((dueAt) => dueAt > Date.now())
      .sort((a, b) => a - b);
    return future[0];
  }, [allCards]);

  useEffect(() => {
    if (!open) return;
    setView('home');
    setQueue([]);
    setQueueIndex(0);
    setCompletedCount(0);
    setQueueLabel('混合复习');
    setAnswer('');
    setCode('');
    setGrade(null);
    setGrading(false);
    setVisibleHints(0);
    setShowReference(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (view === 'home') onClose();
      else setView('home');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, view, onClose]);

  useEffect(() => {
    setAnswer('');
    setCode('');
    setGrade(null);
    setVisibleHints(0);
    setShowReference(false);
    if (currentCard) setLanguage(reviewCardLanguage(currentCard));
  }, [currentCard?.id]);

  if (!open) return null;

  const startQueue = (cards: ReviewCard[], label: string) => {
    if (!cards.length) return;
    setQueue(cards);
    setQueueIndex(0);
    setCompletedCount(0);
    setQueueLabel(label);
    setView('review');
  };

  const startMixed = () => {
    const mixed = buildMixedReviewQueue(dueCards);
    startQueue(mixed, '混合复习');
  };

  const startGroup = (group: ReviewGroup) => {
    const cards = sessionReviewQueue(dueCards, group.sessionId);
    startQueue(cards, group.sessionTitle);
  };

  const backToGroups = () => {
    setView('home');
    setQueue([]);
    setQueueIndex(0);
  };

  const submit = async () => {
    if (!currentCard || grading) return;
    if (!config) {
      onToast('还没有可用的模型配置，请先去模型设置。', 'error');
      return;
    }
    const response = currentCard.mode === 'code' ? code.trim() : answer.trim();
    if (!response) {
      onToast(currentCard.mode === 'code' ? '先写下你的代码，再交给 AI 看。' : '先写下你的答案。', 'info');
      return;
    }
    setGrading(true);
    try {
      const result = await gradeReviewAnswer(config, currentCard, response);
      setGrade(result);
      setShowReference(false);
    } catch (error) {
      onToast(userMessageForError(error).message, 'error');
    } finally {
      setGrading(false);
    }
  };

  const rate = (rating: ReviewRating) => {
    if (!currentCard || !grade) return;
    onRate(currentCard, rating, grade);
    onToast(`已安排：${REVIEW_RATING_META[rating].hint}。`, 'success');
    if (queueIndex + 1 >= queue.length) {
      setCompletedCount(queue.length);
      setView('complete');
      setQueue([]);
      setQueueIndex(0);
    } else {
      setQueueIndex((index) => index + 1);
    }
  };

  const ModeIcon = currentCard ? MODE_ICONS[currentCard.mode] : Sparkles;
  const hints = currentCard?.hints || [];

  return createPortal(
    <div className="review-workspace" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <header className="review-workspace-head">
        <div className="review-workspace-title">
          {view === 'review' ? (
            <button type="button" className="review-back-button" onClick={backToGroups}>
              <ArrowLeft size={15} />
              题目分组
            </button>
          ) : (
            <span className="review-eyebrow">间隔重复 · 主动回忆</span>
          )}
          <h2 id="review-title">
            {view === 'home' ? '今日复习' : view === 'review' ? queueLabel : '复习完成'}
          </h2>
        </div>
        <div className="review-head-right">
          {view === 'review' && (
            <span className="review-progress-label">
              {queueIndex + 1} / {queue.length}
            </span>
          )}
          {view !== 'review' && dueCards.length > 0 && (
            <span className="review-due-count">{dueCards.length} 张到期</span>
          )}
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭复习">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="review-workspace-body">
        {view === 'home' ? (
          dueCards.length > 0 ? (
            <div className="review-home">
              <section className="review-home-hero">
                <span className="review-home-kicker">今天捡回一点</span>
                <h3>把学过的，慢慢变成会的。</h3>
                <p>
                  {dueCards.length} 张到期 · {groups.length} 个题目 · 预计{' '}
                  {Math.max(2, Math.ceil((dueCards.length * 90) / 60))} 分钟
                </p>
                <div className="review-home-actions">
                  <button type="button" className="primary-button review-start-button" onClick={startMixed}>
                    <Play size={14} />
                    开始混合复习
                  </button>
                  <span>不同题目的卡片会交替出现</span>
                </div>
              </section>

              <section className="review-group-section">
                <div className="review-section-heading">
                  <span>按题目复习</span>
                  <span>{groups.length} 个题目</span>
                </div>
                <div className="review-group-grid">
                  {groups.map((group) => (
                    <button
                      type="button"
                      className="review-group-card"
                      key={group.sessionId}
                      onClick={() => startGroup(group)}
                    >
                      <span className="review-group-icon">
                        <Layers size={16} />
                      </span>
                      <span className="review-group-body">
                        <strong>{group.sessionTitle}</strong>
                        <small>
                          {group.dueCards.length} 张到期 · 共 {group.totalCount} 张
                        </small>
                        <span className="review-group-modes">
                          {group.modes.map((mode) => (
                            <span key={mode}>{REVIEW_MODE_META[mode].short}</span>
                          ))}
                        </span>
                      </span>
                      <span className="review-group-arrow">
                        复习
                        <ChevronRight size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="review-home review-home--empty">
              {generating ? (
                <div className="review-empty">
                  <span className="review-empty-mark">
                    <Loader2 size={22} className="spin" />
                  </span>
                  <h3>正在从学习记录里提炼复习卡…</h3>
                  <p>AI 会把这次对话整理成「复述规则 / 手推变量 / 默写代码」三类卡片。</p>
                </div>
              ) : (
                <div className="review-empty">
                  <span className="review-empty-mark">
                    <BookOpenText size={22} />
                  </span>
                  <h3>{allCards.length > 0 ? '今天的复习完成了' : '还没有复习卡'}</h3>
                  <p>
                    {allCards.length > 0
                      ? nextDueAt
                        ? `下一张将在 ${formatNextReview(nextDueAt)} 到期，先把今天学到的内容消化一下。`
                        : '新的复习卡会在到期后出现在这里。'
                      : '完成一次学习对话后，AI 会自动提炼 1–3 张复习卡；也可以从当前会话手动生成。'}
                  </p>
                  {canGenerate && activeSession && (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={onGenerate}
                      disabled={generating}
                    >
                      <Sparkles size={14} />
                      从当前会话生成复习卡
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        ) : view === 'review' && currentCard ? (
          <div className="review-stage">
            <div className="review-stage-top">
              <div className="review-stage-context">
                <span className={cn('review-mode-badge', `is-${currentCard.mode}`)}>
                  <ModeIcon size={13} />
                  {REVIEW_MODE_META[currentCard.mode].label}
                </span>
                <span className="review-point">{currentCard.sessionTitle}</span>
              </div>
              <span className="review-stage-step">
                还剩 {queue.length - queueIndex} 张
              </span>
            </div>

            <article className={`review-card is-${currentCard.mode}`}>
              <h3>{currentCard.title}</h3>
              <p className="review-prompt">{currentCard.prompt}</p>
              <p className="review-mode-hint">{REVIEW_MODE_META[currentCard.mode].hint}</p>

              {currentCard.mode === 'trace' && currentCard.snippet && (
                <pre className="review-snippet">
                  <code>{currentCard.snippet}</code>
                </pre>
              )}

              {currentCard.mode === 'code' ? (
                <div className="review-code-editor">
                  <CodeEditor
                    value={code}
                    onChange={setCode}
                    language={language}
                    onLanguageChange={setLanguage}
                    disabled={grading || Boolean(grade)}
                  />
                  <p className="review-no-compiler">
                    AI 只审查逻辑与边界，不运行代码、不依赖编译器或测试结果。
                  </p>
                </div>
              ) : (
                <label className="review-answer">
                  <span>{currentCard.mode === 'trace' ? '写下你的推演过程' : '写下你的理解'}</span>
                  <textarea
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder={
                      currentCard.mode === 'trace'
                        ? '例如：初始 seen = {}；第 0 轮 i=0, value=2, need=7...'
                        : '不用背原文，用自己的话说清楚原因和条件。'
                    }
                    rows={currentCard.mode === 'trace' ? 7 : 5}
                    disabled={grading || Boolean(grade)}
                  />
                </label>
              )}

              {hints.length > 0 && (
                <div className="review-hints">
                  <button
                    type="button"
                    className="review-hint-trigger"
                    onClick={() => setVisibleHints((count) => Math.min(hints.length, count + 1))}
                    disabled={visibleHints >= hints.length || Boolean(grade)}
                  >
                    <Lightbulb size={13} />
                    {visibleHints === 0 ? '给一点提示' : '再给一点提示'}
                  </button>
                  {hints.slice(0, visibleHints).map((hint, index) => (
                    <p className="review-hint" key={`${hint}-${index}`}>
                      {hint}
                    </p>
                  ))}
                </div>
              )}

              {!grade ? (
                <div className="review-actions">
                  <button type="button" className="primary-button" onClick={submit} disabled={grading}>
                    {grading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                    {grading ? 'AI 正在看…' : '交给 AI 批改'}
                  </button>
                </div>
              ) : (
                <div className={`review-feedback is-${grade.verdict}`}>
                  <div className="review-feedback-head">
                    <span className="review-verdict">{verdictLabel(grade.verdict)}</span>
                    <span className="review-score">AI 评分 {grade.score}</span>
                  </div>
                  <p>{grade.feedback}</p>
                  {grade.missing.length > 0 && (
                    <ul>
                      {grade.missing.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                  <p className="review-suggestion">
                    AI 建议：{REVIEW_RATING_META[grade.suggestedRating].label}
                  </p>

                  {!showReference && (
                    <button
                      type="button"
                      className="review-reference-toggle"
                      onClick={() => setShowReference(true)}
                    >
                      <Eye size={13} />
                      看参考答案
                    </button>
                  )}
                  {showReference && (
                    <div className="review-reference">
                      <span className="review-reference-label">参考答案</span>
                      <Markdown content={currentCard.reference} variant="note" />
                    </div>
                  )}

                  <div className="review-rating">
                    <span className="review-rating-label">你觉得自己掌握得怎么样？</span>
                    <div className="review-rating-buttons">
                      {(Object.keys(REVIEW_RATING_META) as ReviewRating[]).map((rating) => (
                        <button
                          type="button"
                          key={rating}
                          className={cn(
                            'review-rating-button',
                            `is-${rating}`,
                            grade.suggestedRating === rating && 'is-suggested',
                          )}
                          onClick={() => rate(rating)}
                        >
                          {ratingIcon(rating)}
                          <strong>{REVIEW_RATING_META[rating].label}</strong>
                          <small>{REVIEW_RATING_META[rating].hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </article>
          </div>
        ) : (
          <div className="review-complete">
            <span className="review-complete-mark">
              <Check size={24} />
            </span>
            <h3>这轮复习完成</h3>
            <p>完成了 {completedCount} 张复习卡。去休息一下，或者回到题目分组继续。</p>
            <div className="review-complete-actions">
              <button type="button" className="ghost-button" onClick={backToGroups}>
                回到题目分组
              </button>
              <button type="button" className="primary-button" onClick={onClose}>
                退出复习
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
