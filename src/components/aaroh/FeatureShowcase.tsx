import { useId, useRef, useState } from 'react';
import { AAROH_IMAGE_SIZE_SMALL, aarohImages, type AarohEdition, type AarohFinishId } from '../../data/aaroh';
import { AAROH_SHOWCASE, STATUS_LABEL, type ShowcaseFeature } from '../../data/aarohProduct';
import { SHOWCASE_ICONS } from './showcaseIcons';

const TODAY = AAROH_SHOWCASE.filter((feature) => feature.status !== 'future');
const PLANNED = AAROH_SHOWCASE.filter((feature) => feature.status === 'future');

/**
 * "One card. A world of possibilities." Feature tiles and one detail panel.
 *
 * Driven entirely by AAROH_SHOWCASE: the same features, statuses and words for
 * every edition (only the theme around it changes). Choosing a tile moves it
 * into focus and rewrites the panel: what it does, an example, what the
 * cardholder controls, and what a visitor can see. Nothing here writes
 * anything: the store only explains; the cardholder configures features in
 * their SHYGON account.
 */
export default function FeatureShowcase({ edition, finish }: { edition: AarohEdition; finish: AarohFinishId }) {
  const [selectedId, setSelectedId] = useState(TODAY[0]!.id);
  const panelRef = useRef<HTMLElement>(null);
  const selected = AAROH_SHOWCASE.find((feature) => feature.id === selectedId) ?? TODAY[0]!;
  const panelId = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const all = [...TODAY, ...PLANNED];

  // Arrow keys move between tiles, in reading order.
  const onKeyDown = (event: React.KeyboardEvent, feature: ShowcaseFeature) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = all.findIndex((item) => item.id === feature.id);
    const next = all[(index + step + all.length) % all.length]!;
    setSelectedId(next.id);
    refs.current[next.id]?.focus();
  };

  // On a narrow screen the panel sits under the tiles: bring it into view.
  const choose = (id: string) => {
    setSelectedId(id);
    if (window.matchMedia?.('(max-width: 960px)').matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  };

  const tile = (feature: ShowcaseFeature) => {
    const Icon = SHOWCASE_ICONS[feature.icon];
    const pressed = feature.id === selected.id;
    return (
      <li key={feature.id}>
        <button
          ref={(node) => {
            refs.current[feature.id] = node;
          }}
          type="button"
          className="fs-tile"
          data-status={feature.status}
          aria-pressed={pressed}
          aria-controls={panelId}
          onClick={() => choose(feature.id)}
          onKeyDown={(event) => onKeyDown(event, feature)}
        >
          <Icon size={20} aria-hidden="true" />
          <span className="fs-tile-name">{feature.name}</span>
          <span className="fs-tile-status">{STATUS_LABEL[feature.status]}</span>
        </button>
      </li>
    );
  };

  const SelectedIcon = SHOWCASE_ICONS[selected.icon];
  return (
    <div className="fs">
      <div className="fs-today">
        <h3 className="fs-group">With AAROH today</h3>
        <ul className="fs-grid">{TODAY.map(tile)}</ul>
      </div>

      <section ref={panelRef} id={panelId} className="fs-panel" aria-live="polite" aria-labelledby={`${panelId}-title`} data-status={selected.status}>
        <div key={selected.id} className="fs-panel-body">
          <div className="fs-link" aria-hidden="true">
            <img src={aarohImages(edition, finish).frontSmall} alt="" {...AAROH_IMAGE_SIZE_SMALL} />
            <span className="fs-link-line" />
            <span className="fs-link-icon"><SelectedIcon size={22} /></span>
          </div>
          <span className={`fs-status fs-status-${selected.status}`}>{STATUS_LABEL[selected.status]}</span>
          <h3 id={`${panelId}-title`} className="fs-panel-title">{selected.name}</h3>
          <p className="fs-benefit">{selected.benefit}</p>
          <dl className="fs-facts">
            <div>
              <dt>In practice</dt>
              <dd>{selected.useCase}</dd>
            </div>
            <div>
              <dt>You control</dt>
              <dd>{selected.ownerControls}</dd>
            </div>
            <div>
              <dt>Privacy</dt>
              <dd>{selected.privacy}</dd>
            </div>
            {selected.requires && (
              <div>
                <dt>Needs</dt>
                <dd>{selected.requires}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <div className="fs-planned">
        <h3 className="fs-group">Planned for SHYGON OS, not yet supported</h3>
        <p className="fs-group-note">
          Candidate modules from the SHYGON OS plan. None is part of AAROH Version 1, and none has a release date.
        </p>
        <ul className="fs-grid">{PLANNED.map(tile)}</ul>
      </div>
    </div>
  );
}
