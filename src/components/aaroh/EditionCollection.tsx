import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import {
  AAROH_DEFAULT_FINISH,
  AAROH_EDITIONS,
  AAROH_IMAGE_SIZE_SMALL,
  aarohImages,
  designPath,
  type AarohEdition,
  type AarohFinishId,
} from '../../data/aaroh';

/**
 * The ten AAROH editions as objects on a table: each card's front, its name
 * and its one line from the collection moodboard, lit in the edition's own
 * light. Light work only: one small image per edition, loaded lazily, and no
 * motion beyond a hover lift (none with reduced motion).
 *
 * With `onOpen`, each "Explore" button opens the edition overview in place
 * (the AAROH page); without it, each is a link to the overview's deep link.
 * The whole tile is the click target; the button or link carries the name.
 */
const EditionCollection = forwardRef<HTMLUListElement, {
  onOpen?: (edition: AarohEdition, opener: HTMLElement) => void;
  current?: string;
  finish?: AarohFinishId;
  headingLevel?: 'h2' | 'h3';
  className?: string;
}>(function EditionCollection({ onOpen, current, finish = AAROH_DEFAULT_FINISH, headingLevel = 'h3', className = '' }, ref) {
  const Heading = headingLevel;
  return (
    <ul ref={ref} className={`ec ${className}`.trim()} aria-label="The ten AAROH editions">
      {AAROH_EDITIONS.map((edition) => {
        const titleId = `ec-title-${edition.id}`;
        const lineId = `ec-line-${edition.id}`;
        const style = {
          '--ec-glow': edition.ambient.glow,
          '--ec-accent': edition.theme.accent,
        } as React.CSSProperties;
        const label = (
          <>
            Explore {edition.title} <ArrowRight size={15} aria-hidden="true" />
          </>
        );
        return (
          <li key={edition.id} className="ec-item" style={style} data-light={edition.theme.light || undefined}>
            <article className="ec-tile" aria-labelledby={titleId} aria-current={current === edition.id ? 'true' : undefined}>
              <div className="ec-art">
                <img
                  src={aarohImages(edition, finish).frontSmall}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  {...AAROH_IMAGE_SIZE_SMALL}
                />
              </div>
              <p className="ec-number">Edition {edition.number}</p>
              <Heading id={titleId} className="ec-title">{edition.title}</Heading>
              <p id={lineId} className="ec-line">{edition.character}</p>
              <span className="ec-swatches" aria-hidden="true">
                {edition.colours.map((hex) => <i key={hex} style={{ background: hex }} />)}
              </span>
              {onOpen ? (
                <button
                  type="button"
                  className="ec-open"
                  data-edition={edition.id}
                  aria-describedby={lineId}
                  onClick={(event) => onOpen(edition, event.currentTarget)}
                >
                  {label}
                </button>
              ) : (
                <Link className="ec-open" to={designPath(edition)} aria-describedby={lineId}>
                  {label}
                </Link>
              )}
            </article>
          </li>
        );
      })}
    </ul>
  );
});

export default EditionCollection;
