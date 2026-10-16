import { Link } from 'react-router-dom';
import BrandMark from '../components/brand/BrandMark';
import ThemeToggle from '../components/ThemeToggle';
import { ArrowRight } from 'lucide-react';
import { products } from '../data/shygonTapData';
import { notFoundMeta, productPath } from '../seo/meta';
import { AAROH, AAROH_DEFAULT_FINISH, AAROH_EDITIONS, AAROH_IMAGE_SIZE_SMALL, AAROH_PRODUCT_PATH, aarohImages } from '../data/aaroh';
import { usePageMeta } from '../seo/usePageMeta';
import StoreFooter from '../components/StoreFooter';

const META = notFoundMeta();

/**
 * Shown for any address the app does not know, including a card id that is
 * not in the catalog. It used to redirect to the home page, which search
 * engines read as a "soft 404" and which hid mistyped links from the visitor.
 * On Netlify the same URL is also answered with a real 404 status (see
 * netlify.toml).
 */
export default function NotFound() {
  usePageMeta(META);

  return (
    <div className="product-page">
      <header className="product-header">
        <div className="product-header-inner py-4 flex items-center justify-between">
          <Link to="/shygontap" className="store-brand text-xl">
            <BrandMark className="store-brand-mark" />
            SHYGON <span>TAP</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link to="/shygontap/store" className="text-sm font-semibold hover:text-[var(--ds-accent)]">
              All cards
            </Link>
          </div>
        </div>
      </header>

      <main className="product-main not-found">
        <p className="not-found-code">Error 404</p>
        <h1>Page not found</h1>
        <p className="not-found-lede">
          The link may be mistyped, or the page has moved. Everything on SHYGON Tap is still one tap away.
        </p>

        <div className="not-found-actions">
          <Link to="/shygontap" className="btn btn-blue">
            Go to the home page
          </Link>
          <Link to="/shygontap/store" className="btn btn-ghost">
            Browse all cards
          </Link>
        </div>

        <nav aria-labelledby="not-found-cards" className="not-found-cards">
          <h2 id="not-found-cards">Popular cards</h2>
          <ul>
            <li>
              <Link to={AAROH_PRODUCT_PATH}>
                <img src={aarohImages(AAROH_EDITIONS[0]!, AAROH_DEFAULT_FINISH).frontSmall} alt="" loading="lazy" {...AAROH_IMAGE_SIZE_SMALL} />
                <span>
                  <strong>{AAROH.name}</strong>
                  <small>The premium SHYGON card, in three editions.</small>
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </li>
            {products.map((product) => (
              <li key={product.id}>
                <Link to={productPath(product)}>
                  <img src={product.images.pvc} alt="" loading="lazy" />
                  <span>
                    <strong>{product.name}</strong>
                    <small>{product.shortDescription}</small>
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>

      <StoreFooter />
    </div>
  );
}
