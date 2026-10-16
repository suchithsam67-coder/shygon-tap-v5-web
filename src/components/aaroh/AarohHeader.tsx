import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import BrandMark from '../brand/BrandMark';
import ThemeToggle from '../ThemeToggle';
import { CARD_SALES_OPEN } from '../../lib/commerce';

/** The store's header: the brand home, the theme switch and, once card sales open, the cart. */
export default function AarohHeader() {
  const navigate = useNavigate();
  return (
    <header className="store-header">
      <div className="store-header-inner py-4 flex items-center gap-4">
        <Link to="/shygontap" className="store-brand text-xl shrink-0">
          <BrandMark className="store-brand-mark" />
          SHYGON <span>TAP</span>
        </Link>
        <span className="flex-1" />
        <ThemeToggle />
        {CARD_SALES_OPEN && (
          <button
            onClick={() => navigate('/shygontap/checkout')}
            className="hidden sm:inline-flex items-center gap-2 text-sm font-semibold shrink-0 hover:text-[var(--ds-accent)]"
          >
            <ShoppingCart size={18} /> Cart
          </button>
        )}
      </div>
    </header>
  );
}
