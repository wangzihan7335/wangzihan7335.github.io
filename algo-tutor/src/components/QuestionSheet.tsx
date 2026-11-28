import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, X } from 'lucide-react';
import type { ChatMessage, Session } from '../types';
import { formatFullDate } from '../lib/utils';
import { AttachmentList } from './AttachmentList';
import { Markdown } from './Markdown';

interface QuestionSheetProps {
  open: boolean;
  session: Session | null;
  question: ChatMessage | null;
  onClose: () => void;
}

export function QuestionSheet({ open, session, question, onClose }: QuestionSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !session || !question) return null;

  return createPortal(
    <div
      className="question-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="question-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-sheet-title"
      >
        <header className="question-sheet-head">
          <div className="question-sheet-title">
            <span className="question-sheet-eyebrow">
              <BookOpen size={12} />
              原题
            </span>
            <h2 id="question-sheet-title">{session.title}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭原题">
            <X size={18} />
          </button>
        </header>

        <div className="question-sheet-meta">
          <span>{formatFullDate(question.createdAt)}</span>
          <span className="meta-dot">·</span>
          <span>来自本次会话的第一条提问</span>
        </div>

        <div className="question-sheet-scroll">
          {question.content.trim() && (
            <div className="question-sheet-content">
              <Markdown content={question.content} variant="assistant" />
            </div>
          )}
          {Boolean(question.attachments?.length) && (
            <div className="question-sheet-attachments">
              <AttachmentList attachments={question.attachments || []} variant="message" />
            </div>
          )}
        </div>

        <footer className="question-sheet-foot">
          <span>随时可以回看，不需要再往上翻。</span>
          <button type="button" className="link-button" onClick={onClose}>
            知道了
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
