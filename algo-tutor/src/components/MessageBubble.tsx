import { useState } from 'react';
import { Check, Copy, StickyNote } from 'lucide-react';
import type { ChatMessage, Mastery, Session } from '../types';
import { MASTERY_META } from '../types';
import { describeKnowledgeResult, parseAssistantContent } from '../lib/protocol';
import { copyText } from '../lib/utils';
import { Markdown } from './Markdown';
import { KnowledgePanel } from './KnowledgePanel';
import { BrandMark } from './Brand';
import { AttachmentList } from './AttachmentList';

interface MessageBubbleProps {
  message: ChatMessage;
  session: Session;
  isStreaming: boolean;
  isKnowledgeOwner: boolean;
  onSelectMastery: (id: number, mastery: Mastery) => void;
  onSubmitKnowledge: () => void;
  onAllNone: () => void;
  onOpenNote: () => void;
  onToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

export function MessageBubble({
  message,
  session,
  isStreaming,
  isKnowledgeOwner,
  onSelectMastery,
  onSubmitKnowledge,
  onAllNone,
  onOpenNote,
  onToast,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isNoteSource = Boolean(
    session.note?.sourceMessageId && session.note.sourceMessageId === message.id,
  );

  if (message.role === 'user') {
    if (message.kind === 'knowledge-result') {
      const view = describeKnowledgeResult(session.knowledgePoints, message.content);
      return (
        <article className="message user-message knowledge-result-message">
          <span className="message-label">你 · 已自评</span>
          <div className="knowledge-result-note">
            {view.items.map((item) => (
              <span
                className={`result-chip result-${item.mastery}`}
                key={`${item.id}-${item.mastery}`}
              >
                {item.name}
                <b>{MASTERY_META[item.mastery].label}</b>
              </span>
            ))}
          </div>
        </article>
      );
    }

    return (
      <article className="message user-message">
        <span className="message-label">你</span>
        {message.content.trim() && (
          <div className="user-bubble">
            <Markdown content={message.content} variant="user" />
          </div>
        )}
        {Boolean(message.attachments?.length) && (
          <AttachmentList attachments={message.attachments || []} variant="message" />
        )}
      </article>
    );
  }

  const parsed = parseAssistantContent(message.content, { streaming: isStreaming });
  const cleanContent = parsed.clean;
  const showThinking = isStreaming && !cleanContent;
  const showKnowledge =
    isKnowledgeOwner && !isStreaming && session.knowledgePoints.length > 0;

  const handleCopy = async () => {
    const ok = await copyText(cleanContent);
    if (!ok) {
      onToast('复制失败，请手动选择文本。', 'error');
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    onToast('已复制。', 'success');
  };

  return (
    <article className={`message assistant-message ${isNoteSource ? 'is-note-source' : ''}`}>
      <div className="assistant-head">
        <BrandMark size={17} />
        <span className="assistant-name">拾阶</span>
        {isStreaming && <span className="live-badge">正在想…</span>}
        {isNoteSource && !isStreaming && (
          <button type="button" className="note-inline-badge" onClick={onOpenNote}>
            笔记 · 已收录
          </button>
        )}
      </div>

      <div className="assistant-body">
        {showThinking ? (
          <div className="thinking-row" aria-label="助教正在思考">
            <span className="thinking-dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : (
          cleanContent && <Markdown content={cleanContent} variant="assistant" />
        )}

        {isStreaming && cleanContent && <span className="stream-caret" aria-hidden="true" />}

        {showKnowledge && (
          <KnowledgePanel
            points={session.knowledgePoints}
            submitted={Boolean(session.knowledgeSubmitted)}
            onSelect={onSelectMastery}
            onAllNone={onAllNone}
            onSubmit={onSubmitKnowledge}
          />
        )}

        {message.stopped && <p className="message-note stopped-note">已停下，保留到这里。</p>}

        {message.error && (
          <div className="message-error" role="alert">
            <strong>没有写完</strong>
            <p>{message.error}</p>
          </div>
        )}

        {!isStreaming && cleanContent && (
          <div className="message-actions">
            <button
              type="button"
              className="message-action"
              onClick={handleCopy}
              title="复制回复"
              aria-label="复制回复"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            {isNoteSource && (
              <button
                type="button"
                className="message-action"
                onClick={onOpenNote}
                title="查看复习笔记"
                aria-label="查看复习笔记"
              >
                <StickyNote size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
