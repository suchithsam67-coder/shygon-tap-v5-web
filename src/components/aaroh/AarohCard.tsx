import { useState } from 'react';
import {
  AAROH_IMAGE_SIZE,
  aarohImages,
  aarohSrcSet,
  type AarohEdition,
  type AarohFinishId,
} from '../../data/aaroh';

/**
 * One AAROH card as a physical object: the front and back renders on the two
 * faces of a turnable card, landscape (85.60 × 53.98 mm), with a light sweep.
 *
 * The turn is a CSS 3D rotation about the vertical axis. The back face is
 * pre-rotated, so after a half turn it reads the right way round, never
 * mirrored. With reduced motion the faces cross-fade instead (aaroh.css).
 * `sweepKey` replays the light sweep, which sits on each face and so turns
 * with the card. Both faces are real images; if one fails to load, a plain
 * label stands in. With `priority` both load eagerly, the hidden face at low
 * fetch priority so it never competes with the face on show.
 */
export default function AarohCard({
  edition,
  finish,
  side,
  sizes = '(max-width: 720px) 92vw, 640px',
  sweepKey,
  priority = false,
  className = '',
}: {
  edition: AarohEdition;
  finish: AarohFinishId;
  side: 'front' | 'back';
  sizes?: string;
  sweepKey?: string | number;
  priority?: boolean;
  className?: string;
}) {
  const images = aarohImages(edition, finish);
  const finishName = finish === 'premium' ? 'Premium Finish' : 'Standard';
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const face = (which: 'front' | 'back') => {
    const large = which === 'front' ? images.front : images.back;
    const small = which === 'front' ? images.frontSmall : images.backSmall;
    const key = `${edition.id}-${finish}-${which}`;
    return (
      <div className={`ac-face ac-${which}`} aria-hidden={side !== which}>
        {failed[key] ? (
          <span className="ac-fallback">
            AAROH {edition.title}
            <small>{which === 'front' ? 'Front' : 'Back'}</small>
          </span>
        ) : (
          <img
            src={large}
            srcSet={aarohSrcSet(large, small)}
            sizes={sizes}
            alt={`AAROH ${edition.title}, ${finishName}, ${which}: concept render`}
            {...AAROH_IMAGE_SIZE}
            decoding="async"
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority && side !== which ? 'low' : undefined}
            onError={() => setFailed((current) => ({ ...current, [key]: true }))}
          />
        )}
        <div key={sweepKey} className="ac-sweep" aria-hidden="true" />
      </div>
    );
  };

  return (
    <div className={`ac ${className}`.trim()} data-side={side}>
      <div className="ac-shadow" aria-hidden="true" />
      <div className="ac-body">
        {face('front')}
        {face('back')}
      </div>
    </div>
  );
}
