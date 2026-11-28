import type { KnowledgePoint, Mastery } from '../types';
import { MASTERY_META } from '../types';

interface KnowledgePanelProps {
  points: KnowledgePoint[];
  submitted: boolean;
  onSelect: (id: number, mastery: Mastery) => void;
  onAllNone: () => void;
  onSubmit: () => void;
}

const MASTERY_ORDER: Mastery[] = ['high', 'medium', 'low', 'none'];

export function KnowledgePanel({
  points,
  submitted,
  onSelect,
  onAllNone,
  onSubmit,
}: KnowledgePanelProps) {
  if (!points.length) return null;
  const selectedCount = points.filter((point) => point.mastery).length;
  const allSelected = selectedCount === points.length;

  return (
    <section className={`knowledge-panel ${submitted ? 'is-submitted' : ''}`}>
      <header className="knowledge-head">
        <h3>先自评一下</h3>
        <p>{points.length} 个知识点，选完继续</p>
      </header>

      <div className="knowledge-list" role="group" aria-label="知识点掌握程度">
        {points.map((point, index) => (
          <div className="knowledge-row" key={point.id}>
            <span className="knowledge-index">{String(index + 1).padStart(2, '0')}</span>
            <div className="knowledge-copy">
              <span className="knowledge-name">{point.name}</span>
              {point.role && (
                <span className="knowledge-role" title={point.role}>
                  <span className="knowledge-role-mark">本题作用</span>
                  {point.role}
                </span>
              )}
            </div>
            <div
              className="mastery-switch"
              role="radiogroup"
              aria-label={`${point.name} 的掌握程度`}
            >
              {MASTERY_ORDER.map((mastery) => {
                const meta = MASTERY_META[mastery];
                const selected = point.mastery === mastery;
                return (
                  <button
                    key={mastery}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`mastery-button mastery-${mastery} ${selected ? 'is-selected' : ''}`}
                    disabled={submitted}
                    onClick={() => onSelect(point.id, mastery)}
                    title={meta.hint}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {submitted ? (
        <p className="knowledge-done">已记下。助教会从你最不确定的地方讲起。</p>
      ) : (
        <footer className="knowledge-footer">
          <button type="button" className="link-button" onClick={onAllNone}>
            全选不会
          </button>
          <div className="knowledge-actions">
            <span className="knowledge-progress">
              {selectedCount} / {points.length}
            </span>
            <button
              type="button"
              className="ink-button knowledge-submit"
              disabled={!allSelected}
              onClick={onSubmit}
            >
              {allSelected ? '确认' : '选择…'}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
