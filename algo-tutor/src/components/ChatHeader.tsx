import { Menu, Moon, PanelLeftOpen, StickyNote, Sun } from 'lucide-react';
import type { ModelConfig, Session, Theme } from '../types';
import { cn } from '../lib/utils';

interface ChatHeaderProps {
  session: Session | null;
  config: ModelConfig | null;
  isStreamingHere: boolean;
  sidebarCollapsed: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onOpenNote: () => void;
}

export function ChatHeader({
  session,
  config,
  isStreamingHere,
  sidebarCollapsed,
  theme,
  onToggleTheme,
  onToggleSidebar,
  onOpenSettings,
  onOpenNote,
}: ChatHeaderProps) {
  const note = session?.note;

  return (
    <header className="chat-header">
      <div className="chat-header-inner">
        <div className="chat-header-left">
          <button
            type="button"
            className={cn(
              'icon-button header-menu',
              sidebarCollapsed ? 'show-on-desktop' : '',
            )}
            onClick={onToggleSidebar}
            title="打开侧边栏"
            aria-label="打开侧边栏"
          >
            <Menu size={17} className="mobile-only-icon" />
            <PanelLeftOpen size={17} className="desktop-only-icon" />
          </button>
          <h1 className="chat-heading" title={session?.title || '新题目'}>
            {session?.title || '新题目'}
            {isStreamingHere && <span className="heading-live">正在写</span>}
          </h1>
        </div>

        <div className="chat-header-right">
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
            aria-label={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
          >
            {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          </button>

          <button
            type="button"
            className="model-chip"
            onClick={onOpenSettings}
            title="切换模型 / 打开设置"
          >
            <span className={cn('model-dot', config?.baseUrl.startsWith('mock://') && 'is-demo')} />
            <span>{config?.name || '连接模型'}</span>
          </button>

          {note && (
            <button type="button" className="note-button" onClick={onOpenNote} title="复习笔记">
              <StickyNote size={13} />
              <span>笔记</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
