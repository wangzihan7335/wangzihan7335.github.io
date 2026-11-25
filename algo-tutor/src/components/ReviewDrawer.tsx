import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpenText,
  Check,
  ChevronRight,
  Code2,
  Eye,
  Lightbulb,
  ListTree,
  Loader2,
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
  reviewCardLanguage,
} from '../lib/review';
import type { CodeLanguage } from '../lib/code';
import { cn } from '../lib/utils';
import { CodeEditor } from './CodeEditor';
import { Markdown } from './Markdown';

interface ReviewDrawerProps {
  open: boolean;
  dueCards: ReviewCard[];
  totalCards: number;
  config: ModelConfig | null;
  activeSession: Session | null;
  generating: boolean;
  canGenerate: boolean;
  onClose: () => void;
  onGenerate: () => void;
  onRate: (card: ReviewCard, rating: ReviewRating, grade: ReviewGrade) => void;
  onToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

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

export function ReviewDrawer({
  open,
  dueCards,
  totalCards,
  config,
  activeSession,
  generating,
  canGenerate,
  onClose,
  onGenerate,
  onRate,
  onToast,
}: ReviewDrawerProps) {
  const [answer, setAnswer] = useState('');
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<CodeLanguage>('python');
  const [grade, setGrade] = useState<ReviewGrade | null>(null);
  const [grading, setGrading] = useState(false);
  const [visibleHints, setVisibleHints] = useState(0);
  const [showReference, setShowReference] = useState(false);

  const card = dueCards[0] ?? null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setAnswer('');
    setCode('');
    setGrade(null);
    setGrading(false);
    setVisibleHints(0);
    setShowReference(false);
  }, [open, card?.id]);

  useEffect(() => {
    if (!card) return;
    setLanguage(reviewCardLanguage(card));
  }, [card?.id]);

  if (!open) return null;

  const submit = async () => {
    if (!card || grading) return;
    if (!config) {
      onToast('还没有可用的模型配置，请先去模型设置。', 'error');
      return;
    }
    const response = card.mode === 'code' ? code.trim() : answer.trim();
    if (!response) {
      onToast(card.mode === 'code' ? '先写下你的代码，再交给 AI 看。' : '先写下你的答案。', 'info');
      return;
    }
    setGrading(true);
    try {
      const result = await gradeReviewAnswer(config, card, response);
      setGrade(result);
      setShowReference(false);
    } catch (error) {
      onToast(userMessageForError(error).message, 'error');
    } finally {
      setGrading(false);
    }
  };

  const rate = (rating: ReviewRating) => {
    if (!card || !grade) return;
    onRate(card, rating, grade);
    onToast(`已安排：${REVIEW_RATING_META[rating].hint}。`, 'success');
  };

  const ModeIcon = card ? MODE_ICONS[card.mode] : Sparkles;
  const hints = card?.hints || [];

  return createPortal(
    <div
      className="review-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
      >
        <header className="review-head">
          <div>
            <span className="review-eyebrow">间隔重复 · 主动回忆</span>
            <h2 id="review-title">今日复习</h2>
          </div>
          <div className="review-head-right">
            {card && (
              <span className="review-due-count">
                {dueCards.length} 张待复习
              </span>
            )}
            <button type="button" className="icon-button" onClick={onClose} aria-label="关闭复习">
              <X size={18} />
            </button>
          </div>
        </header>

        {card ? (
          <div className="review-scroll">
            <div className="review-progress">
              <span>
                <Sparkles size={12} />
                还有 {dueCards.length} 张
              </span>
              <span>{REVIEW_MODE_META[card.mode].label}</span>
            </div>

            <article className={`review-card is-${card.mode}`}>
              <div className="review-card-meta">
                <span className={cn('review-mode-badge', `is-${card.mode}`)}>
                  <ModeIcon size={13} />
                  {REVIEW_MODE_META[card.mode].label}
                </span>
                {card.pointName && <span className="review-point">{card.pointName}</span>}
              </div>
              <h3>{card.title}</h3>
              <p className="review-prompt">{card.prompt}</p>
              <p className="review-mode-hint">{REVIEW_MODE_META[card.mode].hint}</p>

              {card.mode === 'trace' && card.snippet && (
                <pre className="review-snippet">
                  <code>{card.snippet}</code>
                </pre>
              )}

              {card.mode === 'code' ? (
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
                  <span>{card.mode === 'trace' ? '写下你的推演过程' : '写下你的理解'}</span>
                  <textarea
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder={
                      card.mode === 'trace'
                        ? '例如：初始 seen = {}；第 0 轮 i=0, value=2, need=7...'
                        : '不用背原文，用自己的话说清楚原因和条件。'
                    }
                    rows={card.mode === 'trace' ? 6 : 4}
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
                      <Markdown content={card.reference} variant="note" />
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
          <div className="review-empty">
            {generating ? (
              <>
                <span className="review-empty-mark">
                  <Loader2 size={22} className="spin" />
                </span>
                <h3>正在从学习记录里提炼复习卡…</h3>
                <p>AI 会把这次对话整理成「复述规则 / 手推变量 / 默写代码」三类卡片。</p>
              </>
            ) : (
              <>
                <span className="review-empty-mark">
                  <BookOpenText size={22} />
                </span>
                <h3>{totalCards > 0 ? '今天的复习完成了' : '还没有复习卡'}</h3>
                <p>
                  {totalCards > 0
                    ? '新的复习卡会在到期后出现在这里，先把今天学到的内容消化一下。'
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
              </>
            )}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
