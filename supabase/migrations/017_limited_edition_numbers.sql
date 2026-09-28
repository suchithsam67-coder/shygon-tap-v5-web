-- 017: every SHYGON Tap card is a numbered limited edition, in chapters of 100.
--
-- Each card design is one numbered series (Obsidian Feather, Copper Lotus,
-- Emerald Arch, Ivory Bloom), released in chapters of 100 cards. When a paid
-- order's card is issued it takes the next serial of its design, shown as
-- "Chapter I · Nº 042 of 100"; the 101st card opens Chapter II at Nº 001. The
-- number is printed on the card and shown to the customer (Cards page, e-bill)
-- and to the admin panel.
--
--   card_editions   one row per design: its chapter size and how many cards
--                   have been issued. Public read, so the store can say how
--                   many are left in the current chapter.
--   cards           + edition_design, edition_serial (the design-wide serial,
--                   1-based), edition_count (cards on this order line),
--                   edition_chapter_size. Chapter and number derive from
--                   these: chapter = (serial-1) / size + 1, number =
--                   (serial-1) % size + 1.
--
-- Serials are assigned by a BEFORE INSERT trigger on cards, so every path that
-- issues a card (fulfilment, a replay, the admin) numbers it the same way:
--   * a replayed insert for an (order, sku) that already has its card takes no
--     serial (fulfilment inserts with ON CONFLICT DO NOTHING; without this
--     check the counter would move and leave gaps);
--   * the counter row is locked while it moves, so two cards never share a
--     serial, and a rolled-back issue gives its serial back;
--   * replacement cards take no new serial (they re-make an existing card).
--
-- Idempotent: safe to run again.

CREATE TABLE IF NOT EXISTS public.card_editions (
  design        text PRIMARY KEY,
  name          text NOT NULL,
  chapter_size  integer NOT NULL DEFAULT 100 CHECK (chapter_size > 0),
  issued        integer NOT NULL DEFAULT 0 CHECK (issued >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.card_editions (design, name, chapter_size) VALUES
  ('business',      'Obsidian Feather', 100),
  ('restaurant',    'Copper Lotus',     100),
  ('event',         'Emerald Arch',     100),
  ('google-review', 'Ivory Bloom',      100)
ON CONFLICT (design) DO NOTHING;

ALTER TABLE public.card_editions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS card_editions_public_read ON public.card_editions;
CREATE POLICY card_editions_public_read ON public.card_editions FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.card_editions FROM anon, authenticated;
GRANT SELECT ON public.card_editions TO anon, authenticated;

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS edition_design text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS edition_serial integer;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS edition_count integer;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS edition_chapter_size integer;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_edition_serial
  ON public.cards (edition_design, edition_serial) WHERE edition_serial IS NOT NULL;

-- The design a card SKU belongs to: card-<design>-<finish>-<material>.
CREATE OR REPLACE FUNCTION public.card_design_of(p_sku text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT substring(p_sku FROM '^card-(.+)-(?:standard|premium)-(?:pvc|metal|transparent)$');
$$;

CREATE OR REPLACE FUNCTION public.cards_assign_edition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_design text;
  v_qty    integer := 1;
  v_first  integer;
  v_size   integer;
BEGIN
  IF NEW.edition_serial IS NOT NULL OR COALESCE(NEW.is_replacement, false) THEN
    RETURN NEW;
  END IF;

  v_design := public.card_design_of(NEW.sku);
  IF v_design IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.order_id IS NOT NULL THEN
    -- Fulfilment and a webhook replay can arrive together: take them one at a
    -- time per order line, then skip if the card already exists.
    PERFORM pg_advisory_xact_lock(hashtext('card-edition:' || NEW.order_id::text || ':' || NEW.sku));
    IF EXISTS (SELECT 1 FROM public.cards c WHERE c.order_id = NEW.order_id AND c.sku = NEW.sku) THEN
      RETURN NEW;
    END IF;
    SELECT GREATEST(1, COALESCE(SUM(oi.quantity), 1))::integer INTO v_qty
    FROM public.order_items oi
    WHERE oi.order_id = NEW.order_id AND oi.sku = NEW.sku;
  END IF;

  UPDATE public.card_editions
  SET issued = issued + v_qty, updated_at = now()
  WHERE design = v_design
  RETURNING issued - v_qty + 1, chapter_size INTO v_first, v_size;
  -- A design with no edition row is simply not numbered.
  IF v_first IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.edition_design := v_design;
  NEW.edition_serial := v_first;
  NEW.edition_count := v_qty;
  NEW.edition_chapter_size := v_size;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cards_assign_edition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cards_assign_edition ON public.cards;
CREATE TRIGGER trg_cards_assign_edition
  BEFORE INSERT ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.cards_assign_edition();

-- Number any card issued before this migration, oldest first.
DO $$
DECLARE
  r record;
  v_qty integer;
  v_first integer;
  v_size integer;
BEGIN
  FOR r IN
    SELECT c.id, c.order_id, c.sku, public.card_design_of(c.sku) AS design
    FROM public.cards c
    WHERE c.edition_serial IS NULL
      AND NOT COALESCE(c.is_replacement, false)
      AND public.card_design_of(c.sku) IS NOT NULL
    ORDER BY c.created_at, c.id
  LOOP
    SELECT GREATEST(1, COALESCE(SUM(oi.quantity), 1))::integer INTO v_qty
    FROM public.order_items oi
    WHERE oi.order_id = r.order_id AND oi.sku = r.sku;

    UPDATE public.card_editions
    SET issued = issued + v_qty, updated_at = now()
    WHERE design = r.design
    RETURNING issued - v_qty + 1, chapter_size INTO v_first, v_size;

    IF v_first IS NOT NULL THEN
      UPDATE public.cards
      SET edition_design = r.design,
          edition_serial = v_first,
          edition_count = v_qty,
          edition_chapter_size = v_size
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;
