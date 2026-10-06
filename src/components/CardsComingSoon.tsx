import { ArrowRight } from 'lucide-react';
import { CARDS_COMING_SOON } from '../lib/commerce';
import { useGoToTiers } from '../hooks/useGoToTiers';

/**
 * Shown wherever a card would be bought while card sales are closed (D-10):
 * says so plainly and offers the digital Tap that is on sale.
 */
export default function CardsComingSoon({ className = '' }: { className?: string }) {
  const goToTiers = useGoToTiers();
  return (
    <div className={`cards-coming-soon ${className}`.trim()} role="status">
      <strong>{CARDS_COMING_SOON.title}</strong>
      {CARDS_COMING_SOON.body}
      <button type="button" className="btn btn-blue btn-block" onClick={goToTiers}>
        {CARDS_COMING_SOON.action} <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
