import { MARK_PATH, MARK_VIEWBOX } from './logoPaths';

/**
 * The SHYGON ribbon S, inline so it takes the surrounding colour
 * (currentColor): gold on dark, bronze on the light theme. Decorative unless
 * given a title, because it always sits next to the written name.
 */
export default function BrandMark({ className = '', title }: { className?: string; title?: string }) {
  return (
    <svg
      className={`brand-logo-mark ${className}`.trim()}
      viewBox={MARK_VIEWBOX}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}
