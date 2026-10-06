-- Local-stack catalogue fixture (V6, D-4). NOT production data.
--
-- The live schema baseline is schema-only, so a fresh local database has an
-- empty catalogue and checkout would refuse every product. This fixture puts
-- back the catalogue the history migrations seeded (001, 002, 004, 005, 016,
-- 017, 018) in its final shape. Live prices or stock may have been changed by
-- an administrator since; tests must read prices from this table, never
-- assume them.

-- Experiences and the Customization Pass (004). Essential is included with
-- every Tap and never sold.
INSERT INTO public.products
  (sku, name, category, price_in_paise, product_type, ui_tier, short_description, active, sort_order)
VALUES
  ('plan-essential', 'Essential Experience', 'digital', 0, 'digital_plan', 'essential',
   'Clean, fast and professional. Included with every SHYGON Tap.', true, 60),
  ('plan-business', 'Business Experience', 'digital', 29900, 'digital_plan', 'business',
   'A professional profile with a polished opening animation.', true, 61),
  ('plan-premium', 'Premium Experience', 'digital', 59900, 'digital_plan', 'premium',
   'Premium presentation, smoother animation and a wider palette.', true, 62),
  ('plan-goat', 'GOAT Experience', 'digital', 99900, 'digital_plan', 'goat',
   'Greatest of all time. Maximum customization and a UI that adapts to you.', true, 63),
  ('pass-customization', 'Customization Pass', 'digital', 99900, 'lifetime_plan', NULL,
   'One-time ₹999. Edit your Tap whenever you like and unlock every colour palette.', true, 65),
  -- Retired names (004): kept for history, not for sale.
  ('plan-pro', 'Pro Digital Experience', 'digital', 59900, 'digital_plan', NULL, 'Retired.', false, 62),
  ('plan-3d', '3D Digital Experience', 'digital', 99900, 'digital_plan', NULL, 'Retired.', false, 63),
  ('plan-custom', 'Custom Digital Experience', 'digital', 149900, 'digital_plan', NULL, 'Retired.', false, 64),
  ('plan-lifetime', 'Lifetime Customization Plan', 'digital', 99900, 'lifetime_plan', NULL, 'Retired.', false, 65);

-- Customizations (002; the gallery was delisted in 005).
INSERT INTO public.products
  (sku, name, category, price_in_paise, product_type, short_description, active, sort_order)
VALUES
  ('addon-whatsapp', 'WhatsApp Button', 'customization', 9900, 'customization', 'A one-tap WhatsApp chat button on your public Tap.', true, 80),
  ('addon-instagram', 'Instagram Link', 'customization', 9900, 'customization', 'Send visitors straight to your Instagram profile.', true, 81),
  ('addon-linkedin', 'LinkedIn Link', 'customization', 9900, 'customization', 'Add your professional profile to your Tap.', true, 82),
  ('addon-website', 'Website Button', 'customization', 14900, 'customization', 'Link your website or portfolio from your Tap.', true, 83),
  ('addon-gallery', 'Photo Gallery Section', 'customization', 24900, 'customization', 'Show a gallery of your work on your Tap.', false, 84),
  ('addon-location', 'Location & Directions', 'customization', 14900, 'customization', 'Add a map pin and one-tap directions.', true, 85);

-- Physical cards (001, 016, 018): product x finish x material, 100 in stock.
-- The V6 release candidate does not sell them (DEC-2026-035, D-10); they stay
-- in the catalogue so the store can show them as coming soon and the tests
-- can prove checkout refuses them.
WITH designs(category, label, sort_base, standard, premium) AS (
  VALUES
    ('business', 'Business', 10, ARRAY[39900, 59900, 49900], ARRAY[69900, 89900, 79900]),
    ('restaurant', 'Restaurant', 20, ARRAY[39900, 59900, 49900], ARRAY[59900, 69900, 69900]),
    ('event', 'Event', 30, ARRAY[29900, 49900, 49900], ARRAY[49900, 59900, 59900]),
    ('google-review', 'Google Review', 40, ARRAY[39900, 59900, 49900], ARRAY[59900, 69900, 69900]),
    ('obsidian-smoke', 'Obsidian Smoke', 100, ARRAY[39900, 59900, 49900], ARRAY[69900, 89900, 79900]),
    ('rose-marble', 'Rose Marble', 110, ARRAY[39900, 59900, 49900], ARRAY[69900, 89900, 79900]),
    ('carbon-aurum', 'Carbon Aurum', 120, ARRAY[39900, 59900, 49900], ARRAY[69900, 89900, 79900]),
    ('sandstone-jaali', 'Sandstone Jaali', 130, ARRAY[39900, 59900, 49900], ARRAY[69900, 89900, 79900]),
    ('sapphire-night', 'Sapphire Night', 140, ARRAY[39900, 59900, 49900], ARRAY[69900, 89900, 79900]),
    ('aurora-glass', 'Aurora Glass', 150, ARRAY[39900, 59900, 49900], ARRAY[69900, 89900, 79900])
),
materials(material, label, idx) AS (
  VALUES ('pvc', 'PVC', 1), ('metal', 'Metal', 2), ('transparent', 'Transparent', 3)
),
tiers(tier, idx) AS (VALUES ('standard', 0), ('premium', 1))
INSERT INTO public.products
  (sku, name, category, material, tier, price_in_paise, product_type, image_url, short_description, stock, active, sort_order)
SELECT
  'card-' || d.category || '-' || t.tier || '-' || m.material,
  'Shygon Tap ' || d.label || CASE WHEN t.tier = 'premium' THEN ' Premium' ELSE '' END || ' — ' || m.label,
  d.category, m.material, t.tier,
  (CASE WHEN t.tier = 'premium' THEN d.premium ELSE d.standard END)[m.idx],
  'card',
  '/assets/cards/' || d.category || '-' || m.material || CASE WHEN t.tier = 'premium' THEN '-premium' ELSE '' END || '.svg',
  'A SHYGON Tap card.', 100, true,
  d.sort_base + t.idx * 3 + m.idx
FROM designs d CROSS JOIN tiers t CROSS JOIN materials m;

INSERT INTO public.card_editions (design, name, chapter_size) VALUES
  ('obsidian-smoke', 'Obsidian Smoke', 100),
  ('rose-marble', 'Rose Marble', 100),
  ('carbon-aurum', 'Carbon Aurum', 100),
  ('sandstone-jaali', 'Sandstone Jaali', 100),
  ('sapphire-night', 'Sapphire Night', 100),
  ('aurora-glass', 'Aurora Glass', 100)
ON CONFLICT DO NOTHING;
