import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Limited editions (migration 017). Every card design is a numbered series
 * released in chapters of 100: a card's serial within its design decides its
 * chapter and number, "Chapter I · Nº 042 of 100". Serials are assigned by
 * the database when a paid order's card is issued.
 */

export const CHAPTER_SIZE = 100;

export interface EditionRow {
  design: string;
  name: string;
  chapter_size: number;
  issued: number;
}

/** The edition fields a card row carries once 017 is applied. */
export interface CardEdition {
  edition_design?: string | null;
  edition_serial?: number | null;
  edition_count?: number | null;
  edition_chapter_size?: number | null;
}

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function roman(n: number): string {
  let out = '';
  let left = Math.max(1, Math.floor(n));
  for (const [value, glyph] of ROMAN) {
    while (left >= value) {
      out += glyph;
      left -= value;
    }
  }
  return out;
}

function place(serial: number, size: number) {
  return { chapter: Math.floor((serial - 1) / size) + 1, number: ((serial - 1) % size) + 1 };
}

const pad = (n: number, size: number) => String(n).padStart(String(size).length, '0');

/**
 * "Chapter I · Nº 042 of 100", or a range for an order line of several cards
 * ("Chapter I · Nº 042–044 of 100"). Null when the card has no number yet.
 */
export function formatEdition(card: CardEdition): string | null {
  const serial = card.edition_serial;
  const size = card.edition_chapter_size || CHAPTER_SIZE;
  if (!serial) return null;
  const first = place(serial, size);
  const count = Math.max(1, card.edition_count ?? 1);
  if (count === 1) return `Chapter ${roman(first.chapter)} · Nº ${pad(first.number, size)} of ${size}`;
  const last = place(serial + count - 1, size);
  return first.chapter === last.chapter
    ? `Chapter ${roman(first.chapter)} · Nº ${pad(first.number, size)}–${pad(last.number, size)} of ${size}`
    : `Chapter ${roman(first.chapter)} Nº ${pad(first.number, size)} – Chapter ${roman(last.chapter)} Nº ${pad(last.number, size)}`;
}

/** Where a design's series stands: the chapter on sale and how many are left in it. */
export function currentChapter(row: EditionRow) {
  const size = row.chapter_size || CHAPTER_SIZE;
  const inChapter = row.issued % size;
  return { chapter: Math.floor(row.issued / size) + 1, left: size - inChapter, size };
}

/**
 * The live edition counters, keyed by design. Null while loading, and when
 * the table is not there yet — the store then shows no counts rather than
 * made-up ones.
 */
export function useEditions(): Map<string, EditionRow> | null {
  const [rows, setRows] = useState<Map<string, EditionRow> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void supabase
      .from('card_editions')
      .select('design, name, chapter_size, issued')
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setRows(new Map((data as EditionRow[]).map((row) => [row.design, row])));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return rows;
}

/** "Chapter I · 58 of 100 left", for a design, or null without live data. */
export function editionAvailability(rows: Map<string, EditionRow> | null, design: string): string | null {
  const row = rows?.get(design);
  if (!row) return null;
  const { chapter, left, size } = currentChapter(row);
  return `Chapter ${roman(chapter)} · ${left} of ${size} left`;
}
