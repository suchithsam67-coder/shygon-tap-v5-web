-- 027: SHYGON Version 1 — AAROH joins the card catalogue. Ten editions, each
-- in two finishes, alongside the SHYGON TAP V5 cards (which stay listed).
--
-- Decision:  DEC-2026-037 (simultaneous V5 + AAROH store, 2026-10-13/14). The
--            owner chose the ten editions of the AAROH design system (E01-E10,
--            "use the same number of cards and everything same") at the
--            proposed launch prices: Standard (Tier A) ₹999, Premium Finish
--            (Tier B) ₹1,499. It replaces the earlier 027 draft
--            (DEC-2026-036 A-1), which delisted every V5 card; the owner now
--            wants V5 on sale too. Migration numbering N-1.
-- Level:     L3 (supabase/migrations/**). Under DEC-2026-018 it needs a
--            24-hour cool-off plus the checklist review before it is approved
--            or applied. Never applied by tooling to production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026.
-- Changes:
--   - public.products: 20 rows inserted (10 editions x Standard/Premium). No
--     existing row changes. Stock is 0: the owner sets the counted inventory
--     when card sales open, so nothing can be sold that has not been made.
--   - public.card_editions: 10 rows inserted, one numbered series per edition
--     (chapters of 100, migration 017). Both finishes share their edition's
--     series.
--   - public.card_design_of(text): also recognises AAROH SKUs
--     (card-aaroh-<edition>-<standard|premium>; they carry no material, which
--     is not yet confirmed with the manufacturer), so issued AAROH cards are
--     numbered. V5 SKUs map exactly as before.
--   No table, column, policy or grant change.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT sku FROM public.products WHERE sku LIKE 'card-aaroh-%';
--        -- 0 rows (the INSERT skips existing SKUs; investigate any row found)
--   SELECT design FROM public.card_editions WHERE design LIKE 'aaroh-%';
--        -- 0 rows
--   SELECT prosrc FROM pg_proc WHERE proname = 'card_design_of';
--        -- matches the body in the rollback below (migration 017)
--
-- ROLLBACK (begin)
-- DELETE FROM public.products p
-- WHERE p.sku IN ('card-aaroh-obsidian-standard', 'card-aaroh-obsidian-premium',
--                 'card-aaroh-aureate-standard', 'card-aaroh-aureate-premium',
--                 'card-aaroh-monolith-standard', 'card-aaroh-monolith-premium',
--                 'card-aaroh-ivory-veil-standard', 'card-aaroh-ivory-veil-premium',
--                 'card-aaroh-cobalt-standard', 'card-aaroh-cobalt-premium',
--                 'card-aaroh-emerald-cipher-standard', 'card-aaroh-emerald-cipher-premium',
--                 'card-aaroh-prism-standard', 'card-aaroh-prism-premium',
--                 'card-aaroh-carbon-weave-standard', 'card-aaroh-carbon-weave-premium',
--                 'card-aaroh-heritage-geometry-standard', 'card-aaroh-heritage-geometry-premium',
--                 'card-aaroh-liquid-form-standard', 'card-aaroh-liquid-form-premium')
--   AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.sku = p.sku);
-- UPDATE public.products SET active = false WHERE sku LIKE 'card-aaroh-%';
-- DELETE FROM public.card_editions
-- WHERE design IN ('aaroh-obsidian', 'aaroh-aureate',
--                 'aaroh-monolith', 'aaroh-ivory-veil',
--                 'aaroh-cobalt', 'aaroh-emerald-cipher',
--                 'aaroh-prism', 'aaroh-carbon-weave',
--                 'aaroh-heritage-geometry', 'aaroh-liquid-form') AND issued = 0;
-- CREATE OR REPLACE FUNCTION public.card_design_of(p_sku text) RETURNS text
--     LANGUAGE sql IMMUTABLE
--     AS $_$
--   SELECT substring(p_sku FROM '^card-(.+)-(?:standard|premium)-(?:pvc|metal|transparent)$');
-- $_$;
-- ROLLBACK (end)
--
-- A row that was ordered is never deleted, only delisted; an edition that has
-- issued cards keeps its counter. Idempotent: safe to run more than once.

INSERT INTO public.products
  (sku, name, category, material, tier, price_in_paise, product_type, image_url, short_description, stock, active, sort_order)
VALUES
  ('card-aaroh-obsidian-standard', 'SHYGON AAROH Obsidian', 'aaroh-obsidian', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/obsidian-standard-front-600.webp', 'AAROH card, Obsidian edition, Standard (Tier A).', 0, true, 200),
  ('card-aaroh-obsidian-premium', 'SHYGON AAROH Obsidian — Premium Finish', 'aaroh-obsidian', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/obsidian-premium-front-600.webp', 'AAROH card, Obsidian edition, Premium Finish (Tier B).', 0, true, 201),
  ('card-aaroh-aureate-standard', 'SHYGON AAROH Aureate', 'aaroh-aureate', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/aureate-standard-front-600.webp', 'AAROH card, Aureate edition, Standard (Tier A).', 0, true, 210),
  ('card-aaroh-aureate-premium', 'SHYGON AAROH Aureate — Premium Finish', 'aaroh-aureate', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/aureate-premium-front-600.webp', 'AAROH card, Aureate edition, Premium Finish (Tier B).', 0, true, 211),
  ('card-aaroh-monolith-standard', 'SHYGON AAROH Monolith', 'aaroh-monolith', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/monolith-standard-front-600.webp', 'AAROH card, Monolith edition, Standard (Tier A).', 0, true, 220),
  ('card-aaroh-monolith-premium', 'SHYGON AAROH Monolith — Premium Finish', 'aaroh-monolith', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/monolith-premium-front-600.webp', 'AAROH card, Monolith edition, Premium Finish (Tier B).', 0, true, 221),
  ('card-aaroh-ivory-veil-standard', 'SHYGON AAROH Ivory Veil', 'aaroh-ivory-veil', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/ivory-veil-standard-front-600.webp', 'AAROH card, Ivory Veil edition, Standard (Tier A).', 0, true, 230),
  ('card-aaroh-ivory-veil-premium', 'SHYGON AAROH Ivory Veil — Premium Finish', 'aaroh-ivory-veil', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/ivory-veil-premium-front-600.webp', 'AAROH card, Ivory Veil edition, Premium Finish (Tier B).', 0, true, 231),
  ('card-aaroh-cobalt-standard', 'SHYGON AAROH Cobalt', 'aaroh-cobalt', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/cobalt-standard-front-600.webp', 'AAROH card, Cobalt edition, Standard (Tier A).', 0, true, 240),
  ('card-aaroh-cobalt-premium', 'SHYGON AAROH Cobalt — Premium Finish', 'aaroh-cobalt', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/cobalt-premium-front-600.webp', 'AAROH card, Cobalt edition, Premium Finish (Tier B).', 0, true, 241),
  ('card-aaroh-emerald-cipher-standard', 'SHYGON AAROH Emerald Cipher', 'aaroh-emerald-cipher', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/emerald-cipher-standard-front-600.webp', 'AAROH card, Emerald Cipher edition, Standard (Tier A).', 0, true, 250),
  ('card-aaroh-emerald-cipher-premium', 'SHYGON AAROH Emerald Cipher — Premium Finish', 'aaroh-emerald-cipher', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/emerald-cipher-premium-front-600.webp', 'AAROH card, Emerald Cipher edition, Premium Finish (Tier B).', 0, true, 251),
  ('card-aaroh-prism-standard', 'SHYGON AAROH Prism', 'aaroh-prism', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/prism-standard-front-600.webp', 'AAROH card, Prism edition, Standard (Tier A).', 0, true, 260),
  ('card-aaroh-prism-premium', 'SHYGON AAROH Prism — Premium Finish', 'aaroh-prism', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/prism-premium-front-600.webp', 'AAROH card, Prism edition, Premium Finish (Tier B).', 0, true, 261),
  ('card-aaroh-carbon-weave-standard', 'SHYGON AAROH Carbon Weave', 'aaroh-carbon-weave', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/carbon-weave-standard-front-600.webp', 'AAROH card, Carbon Weave edition, Standard (Tier A).', 0, true, 270),
  ('card-aaroh-carbon-weave-premium', 'SHYGON AAROH Carbon Weave — Premium Finish', 'aaroh-carbon-weave', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/carbon-weave-premium-front-600.webp', 'AAROH card, Carbon Weave edition, Premium Finish (Tier B).', 0, true, 271),
  ('card-aaroh-heritage-geometry-standard', 'SHYGON AAROH Heritage Geometry', 'aaroh-heritage-geometry', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/heritage-geometry-standard-front-600.webp', 'AAROH card, Heritage Geometry edition, Standard (Tier A).', 0, true, 280),
  ('card-aaroh-heritage-geometry-premium', 'SHYGON AAROH Heritage Geometry — Premium Finish', 'aaroh-heritage-geometry', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/heritage-geometry-premium-front-600.webp', 'AAROH card, Heritage Geometry edition, Premium Finish (Tier B).', 0, true, 281),
  ('card-aaroh-liquid-form-standard', 'SHYGON AAROH Liquid Form', 'aaroh-liquid-form', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/liquid-form-standard-front-600.webp', 'AAROH card, Liquid Form edition, Standard (Tier A).', 0, true, 290),
  ('card-aaroh-liquid-form-premium', 'SHYGON AAROH Liquid Form — Premium Finish', 'aaroh-liquid-form', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/liquid-form-premium-front-600.webp', 'AAROH card, Liquid Form edition, Premium Finish (Tier B).', 0, true, 291)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.card_editions (design, name, chapter_size) VALUES
  ('aaroh-obsidian', 'AAROH Obsidian', 100),
  ('aaroh-aureate', 'AAROH Aureate', 100),
  ('aaroh-monolith', 'AAROH Monolith', 100),
  ('aaroh-ivory-veil', 'AAROH Ivory Veil', 100),
  ('aaroh-cobalt', 'AAROH Cobalt', 100),
  ('aaroh-emerald-cipher', 'AAROH Emerald Cipher', 100),
  ('aaroh-prism', 'AAROH Prism', 100),
  ('aaroh-carbon-weave', 'AAROH Carbon Weave', 100),
  ('aaroh-heritage-geometry', 'AAROH Heritage Geometry', 100),
  ('aaroh-liquid-form', 'AAROH Liquid Form', 100)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.card_design_of(p_sku text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT COALESCE(
    substring(p_sku FROM '^card-(.+)-(?:standard|premium)-(?:pvc|metal|transparent)$'),
    substring(p_sku FROM '^card-(aaroh-[a-z0-9-]+)-(?:standard|premium)$')
  );
$_$;
