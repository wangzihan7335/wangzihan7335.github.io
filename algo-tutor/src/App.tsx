import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChatMessage,
  KnowledgePoint,
  Mastery,
  MessageAttachment,
  ModelConfig,
  Note,
  Session,
  Theme,
  Toast,
} from './types';
import {
  buildKnowledgeResultContent,
  isCompletionIntent,
  makeFallbackTitle,
  parseAssistantContent,
  sessionToApiMessages,
} from './lib/protocol';
import { createId, loadPersistedData, persistData } from './lib/storage';
import { TUTOR_SYSTEM_PROMPT } from './lib/prompt';
import { requestTitle, streamChat, userMessageForError } from './lib/api';
import { languageLabel, type CodeLanguage } from './lib/code';
import { useMediaQuery } from './hooks/useMediaQuery';
import { Sidebar } from './components/Sidebar';
import { ChatHeader } from './components/ChatHeader';
import { Welcome } from './components/Welcome';
import { ChatView } from './components/ChatView';
import { Composer } from './components/Composer';
import { SettingsModal } from './components/SettingsModal';
import { NoteDrawer } from './components/NoteDrawer';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ToastStack } from './components/ToastStack';
import { cn } from './lib/utils';

const SIDEBAR_PREF_KEY = 'shijie-algo-tutor:sidebar-collapsed';
const THEME_KEY = 'shijie-algo-tutor:theme';

function readSidebarPreference(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function createSession(title: string): Session {
  const now = Date.now();
  return {
    id: createId('ses'),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    knowledgePoints: [],
    knowledgeSubmitted: false,
  };
}

function noteTitleFromMarkdown(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    const cleaned = heading.replace(/^复习笔记\s*[·:：-]\s*/, '').trim();
    if (cleaned) return cleaned.slice(0, 40);
  }
  return fallback.slice(0, 40);
}

export default function App() {
  const initial = useMemo(() => loadPersistedData(), []);
  const [sessions, setSessions] = useState<Session[]>(initial.sessions);
  const [configs, setConfigs] = useState<ModelConfig[]>(initial.configs);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(initial.activeConfigId);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<{ sessionId: string; messageId: string } | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarPreference);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [focusToken, setFocusToken] = useState(0);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const isMobile = useMediaQuery('(max-width: 900px)');
  const activeStreamRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const activeConfig = useMemo(
    () => configs.find((config) => config.id === activeConfigId) ?? configs[0] ?? null,
    [configs, activeConfigId],
  );
  const isStreamingHere = Boolean(streaming && streaming.sessionId === activeSessionId);
  const isStreamingElsewhere = Boolean(streaming && streaming.sessionId !== activeSessionId);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      persistData({ version: 1, sessions, configs, activeConfigId });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [sessions, configs, activeConfigId]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_PREF_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_KEY && (event.newValue === 'light' || event.newValue === 'dark')) {
        setTheme(event.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleTheme = () => setTheme((current) => (current === 'light' ? 'dark' : 'light'));

  useEffect(() => {
    if (!isMobile) setMobileSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    const overlaysOpen =
      settingsOpen || noteOpen || Boolean(deleteTarget) || mobileSidebarOpen;
    if (!overlaysOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [settingsOpen, noteOpen, deleteTarget, mobileSidebarOpen]);

  useEffect(() => {
    return () => {
      activeStreamRef.current?.abort();
    };
  }, []);

  const addToast = (message: string, tone: Toast['tone'] = 'info') => {
    const id = createId('toast');
    setToasts((previous) => [...previous.slice(-3), { id, message, tone }]);
    window.setTimeout(
      () => {
        setToasts((previous) => previous.filter((toast) => toast.id !== id));
      },
      tone === 'error' ? 5200 : 3200,
    );
  };

  const dismissToast = (id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  };

  const ensureConfig = (): boolean => {
    if (activeConfig) return true;
    addToast('还没有可用的模型配置，请先添加一个。', 'error');
    setSettingsOpen(true);
    return false;
  };

  const updateSession = (id: string, updater: (session: Session) => Session) => {
    setSessions((previous) =>
      previous.map((session) => (session.id === id ? updater(session) : session)),
    );
  };

  const applyAssistantTitle = (sessionId: string, title: string) => {
    if (!title) return;
    setSessions((previous) =>
      previous.map((session) =>
        session.id === sessionId ? { ...session, title: title.slice(0, 15) } : session,
      ),
    );
  };

  const maybeBackfillTitle = (
    sessionSnapshot: Session,
    parsedTitle: string | undefined,
    config: ModelConfig,
  ) => {
    if (parsedTitle) return;
    if (config.baseUrl.startsWith('mock://')) return;
    const firstProblem = sessionSnapshot.messages.find((message) => message.role === 'user')?.content;
    if (!firstProblem) return;
    const fallback = makeFallbackTitle(firstProblem);
    requestTitle(config, firstProblem)
      .then((title) => {
        if (!title) return;
        setSessions((previous) =>
          previous.map((session) =>
            session.id === sessionSnapshot.id &&
            (session.title === fallback || session.title === '新的算法题')
              ? { ...session, title: title.slice(0, 15) }
              : session,
          ),
        );
      })
      .catch(() => {
        // 标题生成只是锦上添花，失败时保留题目前 15 字作为兜底。
      });
  };

  const startAssistantReply = (
    sessionSnapshot: Session,
    options: { pendingNote: boolean; isFirstExchange: boolean },
  ) => {
    if (activeStreamRef.current) {
      addToast('当前还有一轮生成在进行中，请稍候。', 'info');
      return;
    }
    if (!activeConfig) {
      ensureConfig();
      return;
    }

    const config = activeConfig;
    const sessionId = sessionSnapshot.id;
    const assistantId = createId('msg');
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      kind: 'text',
      createdAt: Date.now(),
    };
    setSessions((previous) =>
      previous.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: [...session.messages, assistantMessage],
              updatedAt: Date.now(),
            }
          : session,
      ),
    );
    setStreaming({ sessionId, messageId: assistantId });
    const controller = new AbortController();
    activeStreamRef.current = controller;

    const apiMessages = [
      { role: 'system' as const, content: TUTOR_SYSTEM_PROMPT },
      ...sessionToApiMessages(sessionSnapshot),
    ];
    let fullContent = '';
    let titleApplied = false;
    let pendingNote = options.pendingNote;

    const finalizeSuccess = () => {
      const parsed = parseAssistantContent(fullContent);
      if (!fullContent.trim()) {
        updateSession(sessionId, (session) => ({
          ...session,
          messages: session.messages.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  error: '模型返回了空内容。请检查模型名称、API Key，或稍后重试。',
                }
              : message,
          ),
          updatedAt: Date.now(),
        }));
        addToast('模型没有返回内容，请检查模型设置。', 'error');
        return;
      }

      const now = Date.now();
      const noteTitle = parsed.title || sessionSnapshot.title;
      const noteContent = pendingNote && parsed.clean.trim() ? parsed.clean : '';
      const createdNote: Note | null = noteContent
        ? {
            id: createId('note'),
            title: noteTitleFromMarkdown(noteContent, noteTitle),
            markdown: noteContent,
            createdAt: now,
            sourceMessageId: assistantId,
          }
        : null;
      setSessions((previous) =>
        previous.map((session) => {
          if (session.id !== sessionId) return session;
          const title = parsed.title || session.title;
          let knowledgePoints = session.knowledgePoints;
          let knowledgeSubmitted = session.knowledgeSubmitted;
          if (parsed.points.length) {
            knowledgePoints = parsed.points.map((point) => ({ ...point }));
            knowledgeSubmitted = false;
          }
          return {
            ...session,
            title,
            note: createdNote || session.note,
            knowledgePoints,
            knowledgeSubmitted,
            updatedAt: now,
            messages: session.messages.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: fullContent,
                    kind: parsed.points.length ? 'knowledge' : 'text',
                    error: undefined,
                  }
                : message,
            ),
          };
        }),
      );
      if (!parsed.title && options.isFirstExchange) {
        maybeBackfillTitle(sessionSnapshot, parsed.title, config);
      }
      if (createdNote) {
        addToast('复习笔记已生成并保存。', 'success');
        if (activeSessionIdRef.current === sessionId) setNoteOpen(true);
      } else if (parsed.points.length) {
        addToast('已拆出知识点，请按真实情况选择掌握程度。', 'info');
      }
      pendingNote = false;
    };

    const finalizeStopped = () => {
      const stoppedContent = fullContent;
      setSessions((previous) =>
        previous.map((session) => {
          if (session.id !== sessionId) return session;
          if (!stoppedContent.trim()) {
            return {
              ...session,
              messages: session.messages.filter((message) => message.id !== assistantId),
              updatedAt: Date.now(),
            };
          }
          return {
            ...session,
            updatedAt: Date.now(),
            messages: session.messages.map((message) =>
              message.id === assistantId
                ? { ...message, content: stoppedContent, stopped: true }
                : message,
            ),
          };
        }),
      );
      addToast('已停止生成，前半段已保留。', 'info');
    };

    const finalizeError = (error: unknown) => {
      const friendly = userMessageForError(error);
      const detail = friendly.detail ? ` ${friendly.detail}` : '';
      setSessions((previous) =>
        previous.map((session) => {
          if (session.id !== sessionId) return session;
          return {
            ...session,
            updatedAt: Date.now(),
            messages: session.messages.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: fullContent,
                    error: `${friendly.message}${detail}`.trim(),
                  }
                : message,
            ),
          };
        }),
      );
      console.error('模型请求失败：', error);
      addToast(friendly.message, 'error');
    };

    streamChat({
      config,
      messages: apiMessages,
      signal: controller.signal,
      onDelta: (delta) => {
        fullContent += delta;
        if (!titleApplied) {
          const titleMatch = fullContent.match(/```[ \t]*title[ \t]*\r?\n([\s\S]*?)```/i);
          if (titleMatch?.[1]) {
            const parsed = parseAssistantContent(fullContent);
            if (parsed.title) {
              titleApplied = true;
              applyAssistantTitle(sessionId, parsed.title);
            }
          }
        }
        setSessions((previous) =>
          previous.map((session) => {
            if (session.id !== sessionId) return session;
            return {
              ...session,
              messages: session.messages.map((message) =>
                message.id === assistantId ? { ...message, content: fullContent } : message,
              ),
            };
          }),
        );
      },
    })
      .then(() => {
        finalizeSuccess();
      })
      .catch((error) => {
        const aborted =
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError');
        if (aborted) finalizeStopped();
        else finalizeError(error);
      })
      .finally(() => {
        activeStreamRef.current = null;
        setStreaming(null);
      });
  };

  const sendTurn = (
    baseSession: Session,
    content: string,
    kind: 'text' | 'knowledge-result',
    options: {
      pendingNote?: boolean;
      knowledgeSubmitted?: boolean;
      attachments?: MessageAttachment[];
    } = {},
  ) => {
    if (activeStreamRef.current) {
      addToast('当前还有一轮生成在进行中，请先停止或稍候。', 'info');
      return;
    }
    const trimmed = content.trim();
    const attachments = options.attachments || [];
    if (!trimmed && !attachments.length) return;
    if (!ensureConfig()) return;
    const now = Date.now();
    const userMessage: ChatMessage = {
      id: createId('msg'),
      role: 'user',
      content: kind === 'knowledge-result' ? trimmed : content,
      kind,
      createdAt: now,
      ...(attachments.length ? { attachments } : {}),
    };
    const isNewSession = !sessions.some((session) => session.id === baseSession.id);
    const nextSession: Session = {
      ...baseSession,
      knowledgeSubmitted:
        options.knowledgeSubmitted ?? baseSession.knowledgeSubmitted,
      messages: [...baseSession.messages, userMessage],
      updatedAt: now,
    };
    if (isNewSession) {
      setSessions((previous) => [nextSession, ...previous]);
      setActiveSessionId(nextSession.id);
    } else {
      setSessions((previous) =>
        previous.map((session) => (session.id === nextSession.id ? nextSession : session)),
      );
    }
    setDraft('');
    setMobileSidebarOpen(false);
    startAssistantReply(nextSession, {
      pendingNote: Boolean(options.pendingNote),
      isFirstExchange: !baseSession.messages.some((message) => message.role === 'assistant'),
    });
  };

  const handleSend = (attachments: MessageAttachment[] = []): boolean => {
    if (isStreamingElsewhere) {
      addToast('另一条会话正在生成，请等它结束或先停止。', 'info');
      return false;
    }
    if (activeStreamRef.current) {
      addToast('当前还有一轮生成在进行中，请先停止或稍候。', 'info');
      return false;
    }
    const content = draft.trim();
    if (!content && !attachments.length) return false;
    if (!ensureConfig()) return false;
    const fallbackSource = content || attachments[0]?.name || '附件提问';
    const baseSession = activeSession ?? createSession(makeFallbackTitle(fallbackSource));
    sendTurn(baseSession, content, 'text', {
      attachments,
      pendingNote:
        activeSession !== null &&
        activeSession.messages.some((message) => message.role === 'assistant') &&
        isCompletionIntent(content),
    });
    return true;
  };

  const handleSendCode = ({
    code,
    language,
    attachments = [],
  }: {
    code: string;
    language: CodeLanguage;
    attachments?: MessageAttachment[];
  }): boolean => {
    if (isStreamingElsewhere) {
      addToast('另一条会话正在生成，请等它结束或先停止。', 'info');
      return false;
    }
    if (activeStreamRef.current) {
      addToast('当前还有一轮生成在进行中，请先停止或稍候。', 'info');
      return false;
    }
    const trimmed = code.trim();
    if (!trimmed) return false;
    if (!ensureConfig()) return false;
    const label = languageLabel(language);
    const longestBackticks = Math.max(2, ...(trimmed.match(/`+/g) || []).map((run) => run.length));
    const fence = '`'.repeat(longestBackticks + 1);
    const content = [
      `请检查这段 ${label} 代码，指出具体错误并引导我修改，先不要直接给完整答案。`,
      '',
      `${fence}${language}`,
      trimmed,
      fence,
    ].join('\n');
    const baseSession = activeSession ?? createSession('代码检查');
    sendTurn(baseSession, content, 'text', { pendingNote: false, attachments });
    return true;
  };

  const handleQuickAction = (text: string) => {
    if (!activeSession) return;
    if (isStreamingElsewhere) {
      addToast('另一条会话正在生成，请等它结束或先停止。', 'info');
      return;
    }
    sendTurn(activeSession, text, 'text', {
      pendingNote: isCompletionIntent(text),
    });
  };

  const handleNewSession = () => {
    setActiveSessionId(null);
    setDraft('');
    setNoteOpen(false);
    setMobileSidebarOpen(false);
    if (!isMobile) setFocusToken((token) => token + 1);
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    setNoteOpen(false);
    setMobileSidebarOpen(false);
  };

  const handleRenameSession = (id: string, title: string) => {
    const cleaned = title.trim().slice(0, 30);
    if (!cleaned) {
      addToast('标题不能为空。', 'error');
      return;
    }
    updateSession(id, (session) => ({ ...session, title: cleaned }));
    addToast('会话已重命名。', 'success');
  };

  const handleTogglePin = (id: string) => {
    updateSession(id, (session) => ({ ...session, pinned: !session.pinned }));
  };

  const handleDeleteSession = (session: Session) => {
    setDeleteTarget(session);
  };

  const confirmDeleteSession = () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    if (streaming?.sessionId === targetId) {
      activeStreamRef.current?.abort();
    }
    const remaining = sessions.filter((session) => session.id !== targetId);
    if (activeSessionId === targetId) {
      const next = remaining.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
      setActiveSessionId(next?.id ?? null);
    }
    setSessions(remaining);
    setDeleteTarget(null);
    setNoteOpen(false);
    addToast('会话已删除。', 'success');
  };

  const handleSelectMastery = (pointId: number, mastery: Mastery) => {
    if (!activeSession || activeSession.knowledgeSubmitted) return;
    updateSession(activeSession.id, (session) => ({
      ...session,
      knowledgePoints: session.knowledgePoints.map((point) =>
        point.id === pointId ? { ...point, mastery } : point,
      ),
    }));
  };

  const handleAllNone = () => {
    if (!activeSession || activeSession.knowledgeSubmitted) return;
    updateSession(activeSession.id, (session) => ({
      ...session,
      knowledgePoints: session.knowledgePoints.map((point) => ({
        ...point,
        mastery: 'none' as Mastery,
      })),
    }));
  };

  const handleSubmitKnowledge = () => {
    if (!activeSession || activeSession.knowledgeSubmitted) return;
    const points = activeSession.knowledgePoints;
    if (!points.length) return;
    if (points.some((point) => !point.mastery)) {
      addToast('请先把每个知识点的掌握程度都选完。', 'error');
      return;
    }
    if (!ensureConfig()) return;
    sendTurn(activeSession, buildKnowledgeResultContent(points), 'knowledge-result', {
      knowledgeSubmitted: true,
    });
  };

  const handleStop = () => {
    activeStreamRef.current?.abort();
  };

  const handleToggleSidebar = () => {
    if (isMobile) setMobileSidebarOpen((open) => !open);
    else setSidebarCollapsed((collapsed) => !collapsed);
  };

  const handleOpenSettings = () => {
    setMobileSidebarOpen(false);
    setSettingsOpen(true);
  };

  const handleOpenNote = () => {
    if (!activeSession?.note) return;
    setNoteOpen(true);
  };

  const handlePickExample = (prompt: string) => {
    setDraft(prompt);
    if (!isMobile) setFocusToken((token) => token + 1);
  };

  const handleSaveSettings = (nextConfigs: ModelConfig[], nextActiveId: string | null) => {
    setConfigs(nextConfigs);
    setActiveConfigId(nextActiveId);
  };

  const hasAssistantMessage = Boolean(
    activeSession?.messages.some((message) => message.role === 'assistant'),
  );
  const sidebarVisible = !sidebarCollapsed || isMobile;

  return (
    <div
      className={cn(
        'app-shell',
        sidebarCollapsed && !isMobile && 'sidebar-is-collapsed',
        mobileSidebarOpen && 'mobile-sidebar-is-open',
      )}
    >
      <svg className="hand-drawn-defs" aria-hidden="true" focusable="false">
        <defs>
          <filter id="sketch-line" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.014 0.04"
              numOctaves="2"
              seed="11"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="1.5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        config={activeConfig}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        isMobile={isMobile}
        onToggleCollapse={handleToggleSidebar}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onNew={handleNewSession}
        onSelect={handleSelectSession}
        onRename={handleRenameSession}
        onDelete={handleDeleteSession}
        onTogglePin={handleTogglePin}
        onOpenSettings={handleOpenSettings}
      />

      {mobileSidebarOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="关闭侧边栏"
        />
      )}

      <main className="main-panel">
        <ChatHeader
          session={activeSession}
          config={activeConfig}
          isStreamingHere={isStreamingHere}
          sidebarCollapsed={!sidebarVisible}
          theme={theme}
          onToggleTheme={toggleTheme}
          onToggleSidebar={handleToggleSidebar}
          onOpenSettings={handleOpenSettings}
          onOpenNote={handleOpenNote}
        />

        <div className="main-body">
          {activeSession ? (
            <ChatView
              key={activeSession.id}
              session={activeSession}
              streamingMessageId={isStreamingHere ? (streaming?.messageId ?? null) : null}
              onSelectMastery={handleSelectMastery}
              onSubmitKnowledge={handleSubmitKnowledge}
              onAllNone={handleAllNone}
              onOpenNote={handleOpenNote}
              onToast={addToast}
            />
          ) : (
            <Welcome
              config={activeConfig}
              hasConfigs={configs.length > 0}
              onPickExample={handlePickExample}
              onOpenSettings={handleOpenSettings}
              isStreaming={Boolean(streaming)}
            />
          )}
        </div>

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
          onSendCode={handleSendCode}
          onStop={handleStop}
          isStreamingHere={isStreamingHere}
          isStreamingElsewhere={isStreamingElsewhere}
          hasSession={Boolean(activeSession)}
          hasAssistantMessage={hasAssistantMessage}
          focusToken={focusToken}
          onQuickAction={handleQuickAction}
          onToast={addToast}
        />
      </main>

      <SettingsModal
        open={settingsOpen}
        configs={configs}
        activeConfigId={activeConfig?.id ?? null}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
        onToast={addToast}
      />

      <NoteDrawer
        open={noteOpen}
        session={activeSession}
        onClose={() => setNoteOpen(false)}
        onToast={addToast}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除这条会话？"
        description={
          deleteTarget
            ? `「${deleteTarget.title}」的对话、知识点选择与复习笔记都会被删除，且无法恢复。`
            : ''
        }
        confirmLabel="删除会话"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteSession}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
