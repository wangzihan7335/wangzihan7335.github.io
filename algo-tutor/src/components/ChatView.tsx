import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { Mastery, Session } from '../types';
import { findKnowledgeOwnerMessage } from '../lib/protocol';
import { formatFullDate } from '../lib/utils';
import { MessageBubble } from './MessageBubble';

interface ChatViewProps {
  session: Session;
  streamingMessageId: string | null;
  onSelectMastery: (id: number, mastery: Mastery) => void;
  onSubmitKnowledge: () => void;
  onAllNone: () => void;
  onOpenNote: () => void;
  onToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

export function ChatView({
  session,
  streamingMessageId,
  onSelectMastery,
  onSubmitKnowledge,
  onAllNone,
  onOpenNote,
  onToast,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const messages = session.messages;
  const lastMessage = messages[messages.length - 1];
  const lastContentLength = lastMessage?.content.length ?? 0;
  const lastMessageId = lastMessage?.id;
  const isStreamingHere = Boolean(streamingMessageId);
  const knowledgeOwner = findKnowledgeOwnerMessage(messages);
  const knowledgeSignature = session.knowledgePoints
    .map((point) => `${point.id}:${point.mastery || ''}`)
    .join('|');

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  };

  useEffect(() => {
    nearBottomRef.current = true;
    setShowJump(false);
    const frame = requestAnimationFrame(() => scrollToBottom('auto'));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    nearBottomRef.current = true;
    const frame = requestAnimationFrame(() => scrollToBottom('smooth'));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    const frame = requestAnimationFrame(() => scrollToBottom(isStreamingHere ? 'auto' : 'smooth'));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastContentLength, lastMessageId, isStreamingHere]);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    const frame = requestAnimationFrame(() => scrollToBottom('smooth'));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knowledgeSignature, session.knowledgeSubmitted]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const near = distance < 160;
    nearBottomRef.current = near;
    setShowJump(!near);
  };

  return (
    <div className="chat-view">
      <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className="chat-column">
          <p className="session-date">{formatFullDate(session.createdAt)}</p>

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              session={session}
              isStreaming={streamingMessageId === message.id}
              isKnowledgeOwner={knowledgeOwner?.id === message.id}
              onSelectMastery={onSelectMastery}
              onSubmitKnowledge={onSubmitKnowledge}
              onAllNone={onAllNone}
              onOpenNote={onOpenNote}
              onToast={onToast}
            />
          ))}

          {!messages.length && (
            <div className="chat-empty">
              <p>写下第一个问题吧。</p>
            </div>
          )}
        </div>
      </div>

      {showJump && (
        <button
          type="button"
          className="jump-bottom"
          onClick={() => {
            nearBottomRef.current = true;
            setShowJump(false);
            scrollToBottom('smooth');
          }}
          aria-label="回到底部"
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}
