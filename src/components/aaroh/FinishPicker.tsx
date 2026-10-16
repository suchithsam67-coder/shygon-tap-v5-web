import { useRef } from 'react';
import { AAROH_FINISHES, type AarohFinish } from '../../data/aaroh';

/** Arrow keys move a radio group's choice, as in a native radio group. */
function arrowStep(event: React.KeyboardEvent): number {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') return 1;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') return -1;
  return 0;
}

/** Choosing a finish: Standard or Premium Finish, each with its price. */
export default function FinishPicker({
  selected,
  onSelect,
  labelledBy,
  priceFor,
}: {
  selected: AarohFinish;
  onSelect: (finish: AarohFinish) => void;
  labelledBy: string;
  priceFor: (finish: AarohFinish) => string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = arrowStep(event);
    if (!step) return;
    event.preventDefault();
    const next = (index + step + AAROH_FINISHES.length) % AAROH_FINISHES.length;
    onSelect(AAROH_FINISHES[next]!);
    refs.current[next]?.focus();
  };

  return (
    <div className="aaroh-finish-picker" role="radiogroup" aria-labelledby={labelledBy}>
      {AAROH_FINISHES.map((item, index) => {
        const checked = item.id === selected.id;
        return (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="aaroh-finish-option"
            onClick={() => onSelect(item)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="aaroh-finish-head">
              <strong>{item.title}</strong>
              <span>{priceFor(item)}</span>
            </span>
            <small>{item.summary}</small>
          </button>
        );
      })}
    </div>
  );
}
