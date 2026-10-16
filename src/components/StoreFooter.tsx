import { Link } from 'react-router-dom';
import BrandMark from './brand/BrandMark';
import { products, siteContent, WHATSAPP_NUMBER } from '../data/shygonTapData';
import { LEGAL_PAGES, productPath } from '../seo/meta';
import { AAROH, AAROH_EDITIONS, AAROH_PRODUCT_PATH, designPath } from '../data/aaroh';
import { LEGAL } from '../data/legal';

/**
 * Footer for the catalog, product and 404 pages.
 *
 * Every card page links to every other one and back to the home page and
 * store, so a visitor (or a crawler) that lands deep in the catalog is never
 * at a dead end.
 */
export default function StoreFooter() {
  return (
    <footer className="store-footer">
      <div className="store-footer-inner">
        <div className="store-footer-lead">
          <Link to="/shygontap" className="store-brand text-xl">
            <BrandMark className="store-brand-mark" />
            SHYGON <span>TAP</span>
          </Link>
          <p>Premium NFC business cards with a digital profile that opens in one tap. No app needed.</p>
        </div>

        <nav aria-label="AAROH">
          <p className="store-footer-label">AAROH</p>
          <ul>
            <li>
              <Link to={AAROH_PRODUCT_PATH}>{AAROH.name}</Link>
            </li>
            {AAROH_EDITIONS.map((edition) => (
              <li key={edition.id}>
                <Link to={designPath(edition)}>AAROH {edition.title}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Cards">
          <p className="store-footer-label">Cards</p>
          <ul>
            {products.map((product) => (
              <li key={product.id}>
                <Link to={productPath(product)}>{product.name}</Link>
              </li>
            ))}
            <li>
              <Link to="/shygontap/store">All cards</Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="SHYGON Tap">
          <p className="store-footer-label">SHYGON Tap</p>
          <ul>
            <li>
              <Link to="/shygontap">Home</Link>
            </li>
            <li>
              <Link to="/shygontap/account">Your account</Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Legal">
          <p className="store-footer-label">Legal</p>
          <ul>
            <li>
              <Link to={LEGAL_PAGES.privacy.path}>Privacy Policy</Link>
            </li>
            <li>
              <Link to={`${LEGAL_PAGES.privacy.path}#data-we-collect`}>What data we collect</Link>
            </li>
            <li>
              <Link to={LEGAL_PAGES.terms.path}>Terms and Conditions</Link>
            </li>
            <li>
              <Link to={LEGAL_PAGES.refunds.path}>Refund Policy</Link>
            </li>
            <li>
              <Link to={LEGAL_PAGES.shipping.path}>Shipping Policy</Link>
            </li>
            <li>
              <Link to={LEGAL_PAGES.cookies.path}>Cookie Policy</Link>
            </li>
          </ul>
        </nav>

        <div>
          <p className="store-footer-label">Contact</p>
          <ul>
            <li>
              <a href={`mailto:${siteContent.contact.email}`}>{siteContent.contact.email}</a>
            </li>
            <li>
              <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer">
                WhatsApp ordering
              </a>
            </li>
            <li>{siteContent.contact.location}</li>
          </ul>
        </div>
      </div>

      <p className="store-footer-legal">
        © {new Date().getFullYear()} {LEGAL.legalName}. All rights reserved. {LEGAL.city}, {LEGAL.state}, {LEGAL.country}.
      </p>
    </footer>
  );
}
