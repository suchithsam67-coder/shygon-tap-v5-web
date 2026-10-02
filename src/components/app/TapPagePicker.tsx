import { useAccount } from '../../lib/account-context';
import { tapLabel } from '../../services/tap';

/**
 * Which page the screen is working on, for customers with more than one card
 * (every card has its own page since migration 022). Renders nothing for a
 * customer with a single page, so their screens look exactly as before.
 */
export function TapPagePicker() {
  const { taps, tap, selectTap } = useAccount();
  if (taps.length < 2 || !tap) return null;

  return (
    <label className="tap-page-picker">
      <span>Page</span>
      <select className="select" value={tap.id} onChange={(event) => selectTap(event.target.value)}>
        {taps.map((page, index) => (
          <option key={page.id} value={page.id}>
            {index + 1}. {page.display_name ? `${page.display_name} — ` : ''}
            {tapLabel(page)}
          </option>
        ))}
      </select>
    </label>
  );
}
