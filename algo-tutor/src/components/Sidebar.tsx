import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenCheck,
  MoreHorizontal,
  PanelLeftClose,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import type { ModelConfig, Session } from '../types';
import {
  cn,
  dayGroup,
  formatSidebarTime,
  type DayGroup,
} from '../lib/utils';
import { BrandMark, BrandWordmark } from './Brand';

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  config: ModelConfig | null;
  collapsed: boolean;
  mobileOpen: boolean;
  isMobile: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (session: Session) => void;
  onTogglePin: (id: string) => void;
  onOpenSettings: () => void;
  reviewDueCount: number;
  onOpenReview: () => void;
}

interface Section {
  key: string;
  label: string;
  items: Session[];
}

function matchesQuery(session: Session, query: string): boolean {
  if (!query) return true;
  const haystack = [
    session.title,
    session.note?.markdown || '',
    ...session.messages.map((message) => message.content),
    ...session.knowledgePoints.map((point) => point.name),
  ]
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function Sidebar({
  sessions,
  activeSessionId,
  config,
  collapsed,
  mobileOpen,
  isMobile,
  onToggleCollapse,
  onCloseMobile,
  onNew,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
  onOpenSettings,
  reviewDueCount,
  onOpenReview,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const renameRef = useRef<HTMLInputElement | null>(null);
  const showRail = collapsed && !isMobile;

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseMobile();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  useEffect(() => {
    if (isMobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (showRail) {
          onToggleCollapse();
          window.setTimeout(() => searchRef.current?.focus(), 120);
        } else {
          searchRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobile, showRail, onToggleCollapse]);

  useEffect(() => {
    if (!menuFor) return;
    const closeMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.session-menu-popover') || target?.closest('.session-more-button')) {
        return;
      }
      setMenuFor(null);
    };
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [menuFor]);

  useEffect(() => {
    if (!renamingId) return;
    const frame = requestAnimationFrame(() => {
      renameRef.current?.focus();
      renameRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [renamingId]);

  const filtered = useMemo(
    () => sessions.filter((session) => matchesQuery(session, query.trim())),
    [sessions, query],
  );

  const sections = useMemo<Section[]>(() => {
    const pinned = filtered
      .filter((session) => session.pinned)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const normal = filtered.filter((session) => !session.pinned);
    const order: DayGroup[] = ['今天', '昨天', '更早'];
    const result: Section[] = [];
    if (pinned.length) result.push({ key: 'pinned', label: '置顶', items: pinned });
    for (const group of order) {
      const items = normal
        .filter((session) => dayGroup(session.updatedAt) === group)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      if (items.length) result.push({ key: group, label: group, items });
    }
    return result;
  }, [filtered]);

  const totalCount = filtered.length;

  const beginRename = (session: Session) => {
    setMenuFor(null);
    setRenamingId(session.id);
    setRenameValue(session.title);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const title = renameValue.trim();
    if (title) onRename(renamingId, title);
    setRenamingId(null);
  };

  const handleNew = () => {
    onNew();
    if (isMobile) onCloseMobile();
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    if (isMobile) onCloseMobile();
  };

  const handleOpenReview = () => {
    onOpenReview();
    if (isMobile) onCloseMobile();
  };

  if (showRail) {
    return (
      <aside className="sidebar sidebar-rail" aria-label="侧边栏（已折叠）">
        <button
          type="button"
          className="rail-brand"
          onClick={onToggleCollapse}
          title="展开侧边栏"
          aria-label="展开侧边栏"
        >
          <BrandMark size={29} />
        </button>
        <div className="rail-actions">
          <button type="button" className="rail-button" onClick={handleNew} title="新建题目">
            <Plus size={18} />
          </button>
          <button
            type="button"
            className="rail-button"
            onClick={() => {
              onToggleCollapse();
              window.setTimeout(() => searchRef.current?.focus(), 120);
            }}
            title="搜索会话（Ctrl K）"
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            className="rail-button rail-review-button"
            onClick={handleOpenReview}
            title={`今日复习${reviewDueCount ? `（${reviewDueCount} 张待复习）` : ''}`}
          >
            <BookOpenCheck size={18} />
            {reviewDueCount > 0 && (
              <span className="rail-review-count">{reviewDueCount > 9 ? '9+' : reviewDueCount}</span>
            )}
          </button>
        </div>
        <div className="rail-spacer" />
        <button
          type="button"
          className="rail-config"
          onClick={onOpenSettings}
          title={`模型设置：${config?.name || '未配置'}`}
          aria-label="模型设置"
        >
          <span className="rail-config-dot" />
          <Settings2 size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={cn('sidebar', mobileOpen && 'is-mobile-open')}
      aria-label="会话侧边栏"
    >
      <div className="sidebar-head">
        <div className="sidebar-brand">
          <BrandMark size={31} />
          <BrandWordmark />
        </div>
        <button
          type="button"
          className="icon-button sidebar-collapse"
          onClick={isMobile ? onCloseMobile : onToggleCollapse}
          title={isMobile ? '关闭侧边栏' : '收起侧边栏'}
          aria-label={isMobile ? '关闭侧边栏' : '收起侧边栏'}
        >
          <PanelLeftClose size={16} className="desktop-only-icon" />
          <X size={16} className="mobile-only-icon" />
        </button>
      </div>

      <div className="sidebar-top">
        <button type="button" className="new-session-button" onClick={handleNew}>
          <Plus size={14} />
          <span>新建题目</span>
        </button>

        <button type="button" className="review-entry-button" onClick={handleOpenReview}>
          <BookOpenCheck size={14} />
          <span>今日复习</span>
          {reviewDueCount > 0 && <span className="review-entry-count">{reviewDueCount}</span>}
        </button>

        <label className="session-search">
          <Search size={13} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="搜索题目"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索历史题目"
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
              aria-label="清除搜索"
            >
              <X size={12} />
            </button>
          )}
        </label>
      </div>

      <div className="sidebar-scroll">
        {totalCount === 0 ? (
          <div className="sidebar-empty">
            <strong>{query ? '没有找到。' : '还没有题。'}</strong>
            <p>
              {query ? '换个词试试。' : '写下第一道，慢慢来。'}
            </p>
            {query && (
              <button type="button" className="link-button" onClick={() => setQuery('')}>
                清除搜索
              </button>
            )}
          </div>
        ) : (
          sections.map((section) => (
            <section className="session-section" key={section.key}>
              <div className="session-section-label">
                <span>{section.label}</span>
              </div>
              <div className="session-list">
                {section.items.map((session) => {
                  const active = session.id === activeSessionId;
                  const renaming = renamingId === session.id;
                  const menuOpen = menuFor === session.id;
                  return (
                    <div
                      className={cn(
                        'session-item',
                        active && 'is-active',
                        session.pinned && 'is-pinned',
                      )}
                      key={session.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!renaming) handleSelect(session.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          if (renaming) return;
                          event.preventDefault();
                          handleSelect(session.id);
                        }
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMenuFor(session.id);
                      }}
                      aria-current={active ? 'page' : undefined}
                    >
                      <span className="session-accent" />
                      <div className="session-body">
                        {renaming ? (
                          <input
                            ref={renameRef}
                            className="session-rename-input"
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitRename();
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                setRenamingId(null);
                              }
                            }}
                            onBlur={commitRename}
                            maxLength={30}
                            aria-label="重命名会话"
                          />
                        ) : (
                          <span className="session-title" title={session.title}>
                            {session.pinned && (
                              <Pin size={11} className="session-pin" fill="currentColor" />
                            )}
                            {session.title}
                          </span>
                        )}
                        <span className="session-time">
                          {session.note ? '笔记 · ' : ''}
                          {formatSidebarTime(session.updatedAt)}
                        </span>
                      </div>

                      {!renaming && (
                        <>
                          <button
                            type="button"
                            className="session-more-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setMenuFor(menuOpen ? null : session.id);
                            }}
                            aria-label="会话操作"
                            title="会话操作"
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {menuOpen && (
                            <div
                              className="session-menu-popover"
                              role="menu"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => beginRename(session)}
                              >
                                <PencilLine size={14} />
                                重命名
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  onTogglePin(session.id);
                                  setMenuFor(null);
                                }}
                              >
                                {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                                {session.pinned ? '取消置顶' : '置顶'}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="is-danger"
                                onClick={() => {
                                  setMenuFor(null);
                                  onDelete(session);
                                }}
                              >
                                <Trash2 size={14} />
                                删除
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <button type="button" className="sidebar-config" onClick={onOpenSettings}>
        <span className="config-dot" />
        <span className="config-info">
          <strong>{config?.name || '连接模型'}</strong>
          <small>{config?.model || '未配置'}</small>
        </span>
        <Settings2 size={14} />
      </button>
    </aside>
  );
}
