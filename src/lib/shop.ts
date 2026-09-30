import { useEffect, useState } from 'react';

/**
 * Small storefront conveniences kept in this browser only: cards the visitor
 * saved for later ("Saved") and the cards they looked at recently. Nothing here
 * decides a price or an order — it only remembers product ids.
 */

const SAVED_KEY = 'shygon_saved_cards';
const RECENT_KEY = 'shygon_recent_cards';
const CHANGED = 'shygon-shop-changed';
const RECENT_MAX = 8;

function read(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 50) : [];
  } catch {
    return [];
  }
}

function write(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* private mode: the feature simply does not persist */
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function toggleSaved(id: string): boolean {
  const ids = read(SAVED_KEY);
  const saved = !ids.includes(id);
  write(SAVED_KEY, saved ? [id, ...ids] : ids.filter((x) => x !== id));
  return saved;
}

export function noteViewed(id: string) {
  const ids = read(RECENT_KEY).filter((x) => x !== id);
  write(RECENT_KEY, [id, ...ids].slice(0, RECENT_MAX));
}

function useList(key: string): string[] {
  const [ids, setIds] = useState<string[]>(() => read(key));
  useEffect(() => {
    const sync = () => setIds(read(key));
    window.addEventListener(CHANGED, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener('storage', sync);
    };
  }, [key]);
  return ids;
}

export const useSavedCards = () => useList(SAVED_KEY);
export const useRecentCards = () => useList(RECENT_KEY);

/** Native share sheet where there is one; the caller falls back to links. */
export async function nativeShare(data: { title: string; text: string; url: string }): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  try {
    await navigator.share(data);
    return true;
  } catch {
    // Dismissing the sheet is not an error worth showing.
    return true;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
