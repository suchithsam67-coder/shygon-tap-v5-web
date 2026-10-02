import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Heart, Link2, MessageCircle, Minus, Plus, Share2, Star } from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../app/toast-context';
import { describeError } from '../../lib/supabase';
import { copyText, nativeShare, toggleSaved, useSavedCards } from '../../lib/shop';
import {
  EMPTY_SUMMARY,
  fetchMyReview,
  fetchReviews,
  submitReview,
  type MyReview,
  type ReviewSummary,
} from '../../services/reviews';

/* Storefront pieces for the product page. They use the store's existing
   classes (btn, product-*, price-explainer) so the look does not change. */

export function Stars({ value, size = 15 }: { value: number; size?: number }) {
  return (
    <span className="shop-stars" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} aria-hidden="true" className={value >= n - 0.25 ? 'on' : value >= n - 0.75 ? 'half' : ''} />
      ))}
    </span>
  );
}

/** Average stars and count, linking down to the reviews. */
export function RatingSummaryLink({ productId }: { productId: string }) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  useEffect(() => {
    let live = true;
    fetchReviews(productId)
      .then((s) => live && setSummary(s))
      .catch(() => live && setSummary(EMPTY_SUMMARY));
    return () => {
      live = false;
    };
  }, [productId]);
  if (!summary || summary.count === 0 || summary.average === null) return null;
  return (
    <a href="#reviews" className="shop-rating-link">
      <Stars value={summary.average} /> <strong>{summary.average.toFixed(1)}</strong>
      <span>
        ({summary.count} review{summary.count === 1 ? '' : 's'})
      </span>
    </a>
  );
}

export function QuantityStepper({ value, onChange, max = 10 }: { value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <div className="shop-qty" role="group" aria-label="Quantity">
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label="One fewer">
        <Minus size={15} />
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="One more">
        <Plus size={15} />
      </button>
    </div>
  );
}

export function SaveButton({ productId, name }: { productId: string; name: string }) {
  const saved = useSavedCards().includes(productId);
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-sm shop-save${saved ? ' is-saved' : ''}`}
      aria-pressed={saved}
      onClick={() => toggleSaved(productId)}
      title={saved ? `Remove ${name} from Saved` : `Save ${name} for later`}
    >
      <Heart size={15} fill={saved ? 'currentColor' : 'none'} /> {saved ? 'Saved' : 'Save'}
    </button>
  );
}

export function ShareRow({ title, url }: { title: string; url: string }) {
  const toast = useToast();
  const text = `${title} — SHYGON Tap NFC card`;
  return (
    <div className="shop-share" aria-label="Share this card">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={async () => {
          if (!(await nativeShare({ title, text, url }))) {
            toast.info((await copyText(url)) ? 'Link copied' : 'Copy this link', url);
          }
        }}
      >
        <Share2 size={15} /> Share
      </button>
      <a
        className="btn btn-ghost btn-sm"
        href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <MessageCircle size={15} /> WhatsApp
      </a>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={async () => toast.info((await copyText(url)) ? 'Link copied' : 'Copy this link', url)}
      >
        <Link2 size={15} /> Copy link
      </button>
    </div>
  );
}

/** Ratings breakdown, verified-buyer reviews, and the form for a buyer. */
export function ReviewsSection({ productId, productName }: { productId: string; productName: string }) {
  const { user } = useAuth();
  const toast = useToast();
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [mine, setMine] = useState<MyReview | null>(null);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    fetchReviews(productId)
      .then((s) => live && setSummary(s))
      .catch(() => live && setSummary(EMPTY_SUMMARY));
    return () => {
      live = false;
    };
  }, [productId, version]);

  useEffect(() => {
    let live = true;
    // Signed out: nothing to load; the render shows the sign-in prompt instead.
    if (!user) return;
    fetchMyReview(productId)
      .then((m) => {
        if (!live) return;
        setMine(m);
        if (m.review) {
          setRating(m.review.rating);
          setTitle(m.review.title ?? '');
          setBody(m.review.body ?? '');
        }
      })
      .catch(() => live && setMine({ eligible: false, review: null }));
    return () => {
      live = false;
    };
  }, [productId, user]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      toast.error('Choose a star rating', 'Tap 1 to 5 stars.');
      return;
    }
    setBusy(true);
    try {
      setMine(await submitReview(productId, rating, title, body));
      toast.success(mine?.review ? 'Review updated' : 'Thanks for your review');
      setVersion((v) => v + 1);
    } catch (err) {
      toast.error('Could not save your review', describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const s = summary ?? EMPTY_SUMMARY;
  return (
    <section id="reviews" className="product-reviews" aria-labelledby="reviews-title">
      <h2 id="reviews-title">Customer reviews</h2>
      {s.count > 0 && s.average !== null ? (
        <div className="shop-review-summary">
          <div>
            <strong className="shop-review-average">{s.average.toFixed(1)}</strong>
            <Stars value={s.average} size={18} />
            <p>
              {s.count} verified review{s.count === 1 ? '' : 's'}
            </p>
          </div>
          <ul className="shop-review-bars">
            {[5, 4, 3, 2, 1].map((n) => {
              const count = Number(s.stars[String(n)] ?? 0);
              return (
                <li key={n}>
                  <span>{n}★</span>
                  <span className="shop-review-bar">
                    <span style={{ width: `${s.count ? (count / s.count) * 100 : 0}%` }} />
                  </span>
                  <span>{count}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="price-explainer text-sm">No reviews yet. Reviews come only from customers who bought {productName}.</p>
      )}

      {s.reviews.length > 0 && (
        <ul className="shop-review-list">
          {s.reviews.map((r) => (
            <li key={r.id}>
              <div className="shop-review-head">
                <Stars value={r.rating} />
                {r.title && <strong>{r.title}</strong>}
              </div>
              {r.body && <p>{r.body}</p>}
              <small>
                {r.author} · <BadgeCheck size={12} aria-hidden="true" /> Verified purchase ·{' '}
                {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                {r.updated ? ' · edited' : ''}
              </small>
            </li>
          ))}
        </ul>
      )}

      {!user ? (
        <p className="price-explainer text-sm">
          Bought this card? <Link to="/shygontap/auth" state={{ from: `/shygontap/store/${productId}` }} className="font-bold underline">Sign in</Link> to review it.
        </p>
      ) : mine?.eligible ? (
        <form className="shop-review-form" onSubmit={send}>
          <p className="shop-review-form-title">{mine.review ? 'Your review' : 'Write a review'}</p>
          <div className="shop-star-picker" role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                className={rating >= n ? 'on' : ''}
                onClick={() => setRating(n)}
              >
                <Star size={22} />
              </button>
            ))}
          </div>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Headline (optional)" />
          <textarea className="textarea" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={800} placeholder="What did you like? How do people react when you tap?" />
          {mine.review?.hidden && <p className="field-hint">This review was hidden by our team.</p>}
          <button type="submit" className="btn btn-blue btn-sm" disabled={busy}>
            {busy ? 'Saving…' : mine.review ? 'Update review' : 'Post review'}
          </button>
        </form>
      ) : mine ? (
        <p className="price-explainer text-sm">Only customers who bought {productName} can review it.</p>
      ) : null}
    </section>
  );
}
