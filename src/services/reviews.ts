import { supabase } from '../lib/supabase';

/** Verified-buyer reviews (migration 028). */

export interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  created_at: string;
  updated: boolean;
  author: string;
  verified: boolean;
}

export interface ReviewSummary {
  count: number;
  average: number | null;
  stars: Record<string, number>;
  reviews: Review[];
}

export interface MyReview {
  eligible: boolean;
  review: { rating: number; title: string | null; body: string | null; hidden: boolean } | null;
}

const missing = (code?: string) => code === 'PGRST202' || code === '42883' || code === '42P01';

export const EMPTY_SUMMARY: ReviewSummary = { count: 0, average: null, stars: {}, reviews: [] };

// Before migration 028 the functions do not exist: ask once per visit, not on every render.
let unavailable = false;
const inflight = new Map<string, Promise<ReviewSummary>>();

/** Public. Before 028 there are simply no reviews. */
export function fetchReviews(productId: string): Promise<ReviewSummary> {
  if (unavailable) return Promise.resolve(EMPTY_SUMMARY);
  // The rating link and the reviews section ask at the same time: one request.
  const pending = inflight.get(productId);
  if (pending) return pending;
  const request = loadReviews(productId).finally(() => inflight.delete(productId));
  inflight.set(productId, request);
  return request;
}

async function loadReviews(productId: string): Promise<ReviewSummary> {
  const { data, error } = await supabase.rpc('get_product_reviews', { p_product: productId, p_limit: 20 });
  if (error) {
    if (missing(error.code)) {
      unavailable = true;
      return EMPTY_SUMMARY;
    }
    throw error;
  }
  const value = (data ?? {}) as Partial<ReviewSummary>;
  return {
    count: Number(value.count ?? 0),
    average: value.average === null || value.average === undefined ? null : Number(value.average),
    stars: value.stars ?? {},
    reviews: Array.isArray(value.reviews) ? value.reviews : [],
  };
}

export async function fetchMyReview(productId: string): Promise<MyReview> {
  if (unavailable) return { eligible: false, review: null };
  const { data, error } = await supabase.rpc('my_product_review', { p_product: productId });
  if (error) {
    if (missing(error.code)) return { eligible: false, review: null };
    throw error;
  }
  return (data ?? { eligible: false, review: null }) as MyReview;
}

export async function submitReview(productId: string, rating: number, title: string, body: string): Promise<MyReview> {
  const { data, error } = await supabase.rpc('submit_product_review', {
    p_product: productId,
    p_rating: rating,
    p_title: title,
    p_body: body,
  });
  if (error) {
    if (missing(error.code)) throw new Error('Reviews are being switched on. Please try again later.');
    throw error;
  }
  return data as MyReview;
}
