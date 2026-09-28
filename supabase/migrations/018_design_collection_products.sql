-- 018: the Design Collection — six more cards in the store.
--
-- Obsidian Smoke, Rose Marble, Carbon Aurum, Sandstone Jaali, Sapphire Night
-- and Aurora Glass (art: scripts/brand/concepts.mjs). Each is sold like the
-- four use-case cards: product x finish x material, priced here (checkout
-- reads the price from this table), 100 in stock per variant, and a numbered
-- limited edition in chapters of 100 (card_editions, migration 017).
--
-- Prices follow the Business card: 399 / 599 / 499 standard and
-- 699 / 899 / 799 premium (PVC / metal / transparent). ON CONFLICT DO NOTHING,
-- so a price or stock level an administrator has since changed is kept.
-- Requires 017. Idempotent.

INSERT INTO public.products
  (sku, name, category, material, tier, price_in_paise, product_type, image_url, short_description, stock, active, sort_order)
VALUES
  ('card-obsidian-smoke-standard-pvc', 'Shygon Tap Obsidian Smoke — PVC', 'obsidian-smoke', 'pvc', 'standard', 39900, 'card', '/assets/cards/obsidian-smoke-pvc.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 100),
  ('card-obsidian-smoke-standard-metal', 'Shygon Tap Obsidian Smoke — Metal', 'obsidian-smoke', 'metal', 'standard', 59900, 'card', '/assets/cards/obsidian-smoke-metal.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 101),
  ('card-obsidian-smoke-standard-transparent', 'Shygon Tap Obsidian Smoke — Transparent', 'obsidian-smoke', 'transparent', 'standard', 49900, 'card', '/assets/cards/obsidian-smoke-transparent.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 102),
  ('card-obsidian-smoke-premium-pvc', 'Shygon Tap Obsidian Smoke Premium — PVC', 'obsidian-smoke', 'pvc', 'premium', 69900, 'card', '/assets/cards/obsidian-smoke-pvc-premium.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 103),
  ('card-obsidian-smoke-premium-metal', 'Shygon Tap Obsidian Smoke Premium — Metal', 'obsidian-smoke', 'metal', 'premium', 89900, 'card', '/assets/cards/obsidian-smoke-metal-premium.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 104),
  ('card-obsidian-smoke-premium-transparent', 'Shygon Tap Obsidian Smoke Premium — Transparent', 'obsidian-smoke', 'transparent', 'premium', 79900, 'card', '/assets/cards/obsidian-smoke-transparent-premium.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 105),
  ('card-rose-marble-standard-pvc', 'Shygon Tap Rose Marble — PVC', 'rose-marble', 'pvc', 'standard', 39900, 'card', '/assets/cards/rose-marble-pvc.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 110),
  ('card-rose-marble-standard-metal', 'Shygon Tap Rose Marble — Metal', 'rose-marble', 'metal', 'standard', 59900, 'card', '/assets/cards/rose-marble-metal.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 111),
  ('card-rose-marble-standard-transparent', 'Shygon Tap Rose Marble — Transparent', 'rose-marble', 'transparent', 'standard', 49900, 'card', '/assets/cards/rose-marble-transparent.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 112),
  ('card-rose-marble-premium-pvc', 'Shygon Tap Rose Marble Premium — PVC', 'rose-marble', 'pvc', 'premium', 69900, 'card', '/assets/cards/rose-marble-pvc-premium.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 113),
  ('card-rose-marble-premium-metal', 'Shygon Tap Rose Marble Premium — Metal', 'rose-marble', 'metal', 'premium', 89900, 'card', '/assets/cards/rose-marble-metal-premium.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 114),
  ('card-rose-marble-premium-transparent', 'Shygon Tap Rose Marble Premium — Transparent', 'rose-marble', 'transparent', 'premium', 79900, 'card', '/assets/cards/rose-marble-transparent-premium.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 115),
  ('card-carbon-aurum-standard-pvc', 'Shygon Tap Carbon Aurum — PVC', 'carbon-aurum', 'pvc', 'standard', 39900, 'card', '/assets/cards/carbon-aurum-pvc.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 120),
  ('card-carbon-aurum-standard-metal', 'Shygon Tap Carbon Aurum — Metal', 'carbon-aurum', 'metal', 'standard', 59900, 'card', '/assets/cards/carbon-aurum-metal.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 121),
  ('card-carbon-aurum-standard-transparent', 'Shygon Tap Carbon Aurum — Transparent', 'carbon-aurum', 'transparent', 'standard', 49900, 'card', '/assets/cards/carbon-aurum-transparent.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 122),
  ('card-carbon-aurum-premium-pvc', 'Shygon Tap Carbon Aurum Premium — PVC', 'carbon-aurum', 'pvc', 'premium', 69900, 'card', '/assets/cards/carbon-aurum-pvc-premium.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 123),
  ('card-carbon-aurum-premium-metal', 'Shygon Tap Carbon Aurum Premium — Metal', 'carbon-aurum', 'metal', 'premium', 89900, 'card', '/assets/cards/carbon-aurum-metal-premium.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 124),
  ('card-carbon-aurum-premium-transparent', 'Shygon Tap Carbon Aurum Premium — Transparent', 'carbon-aurum', 'transparent', 'premium', 79900, 'card', '/assets/cards/carbon-aurum-transparent-premium.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 125),
  ('card-sandstone-jaali-standard-pvc', 'Shygon Tap Sandstone Jaali — PVC', 'sandstone-jaali', 'pvc', 'standard', 39900, 'card', '/assets/cards/sandstone-jaali-pvc.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 130),
  ('card-sandstone-jaali-standard-metal', 'Shygon Tap Sandstone Jaali — Metal', 'sandstone-jaali', 'metal', 'standard', 59900, 'card', '/assets/cards/sandstone-jaali-metal.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 131),
  ('card-sandstone-jaali-standard-transparent', 'Shygon Tap Sandstone Jaali — Transparent', 'sandstone-jaali', 'transparent', 'standard', 49900, 'card', '/assets/cards/sandstone-jaali-transparent.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 132),
  ('card-sandstone-jaali-premium-pvc', 'Shygon Tap Sandstone Jaali Premium — PVC', 'sandstone-jaali', 'pvc', 'premium', 69900, 'card', '/assets/cards/sandstone-jaali-pvc-premium.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 133),
  ('card-sandstone-jaali-premium-metal', 'Shygon Tap Sandstone Jaali Premium — Metal', 'sandstone-jaali', 'metal', 'premium', 89900, 'card', '/assets/cards/sandstone-jaali-metal-premium.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 134),
  ('card-sandstone-jaali-premium-transparent', 'Shygon Tap Sandstone Jaali Premium — Transparent', 'sandstone-jaali', 'transparent', 'premium', 79900, 'card', '/assets/cards/sandstone-jaali-transparent-premium.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 135),
  ('card-sapphire-night-standard-pvc', 'Shygon Tap Sapphire Night — PVC', 'sapphire-night', 'pvc', 'standard', 39900, 'card', '/assets/cards/sapphire-night-pvc.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 140),
  ('card-sapphire-night-standard-metal', 'Shygon Tap Sapphire Night — Metal', 'sapphire-night', 'metal', 'standard', 59900, 'card', '/assets/cards/sapphire-night-metal.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 141),
  ('card-sapphire-night-standard-transparent', 'Shygon Tap Sapphire Night — Transparent', 'sapphire-night', 'transparent', 'standard', 49900, 'card', '/assets/cards/sapphire-night-transparent.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 142),
  ('card-sapphire-night-premium-pvc', 'Shygon Tap Sapphire Night Premium — PVC', 'sapphire-night', 'pvc', 'premium', 69900, 'card', '/assets/cards/sapphire-night-pvc-premium.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 143),
  ('card-sapphire-night-premium-metal', 'Shygon Tap Sapphire Night Premium — Metal', 'sapphire-night', 'metal', 'premium', 89900, 'card', '/assets/cards/sapphire-night-metal-premium.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 144),
  ('card-sapphire-night-premium-transparent', 'Shygon Tap Sapphire Night Premium — Transparent', 'sapphire-night', 'transparent', 'premium', 79900, 'card', '/assets/cards/sapphire-night-transparent-premium.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 145),
  ('card-aurora-glass-standard-pvc', 'Shygon Tap Aurora Glass — PVC', 'aurora-glass', 'pvc', 'standard', 39900, 'card', '/assets/cards/aurora-glass-pvc.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 150),
  ('card-aurora-glass-standard-metal', 'Shygon Tap Aurora Glass — Metal', 'aurora-glass', 'metal', 'standard', 59900, 'card', '/assets/cards/aurora-glass-metal.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 151),
  ('card-aurora-glass-standard-transparent', 'Shygon Tap Aurora Glass — Transparent', 'aurora-glass', 'transparent', 'standard', 49900, 'card', '/assets/cards/aurora-glass-transparent.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 152),
  ('card-aurora-glass-premium-pvc', 'Shygon Tap Aurora Glass Premium — PVC', 'aurora-glass', 'pvc', 'premium', 69900, 'card', '/assets/cards/aurora-glass-pvc-premium.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 153),
  ('card-aurora-glass-premium-metal', 'Shygon Tap Aurora Glass Premium — Metal', 'aurora-glass', 'metal', 'premium', 89900, 'card', '/assets/cards/aurora-glass-metal-premium.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 154),
  ('card-aurora-glass-premium-transparent', 'Shygon Tap Aurora Glass Premium — Transparent', 'aurora-glass', 'transparent', 'premium', 79900, 'card', '/assets/cards/aurora-glass-transparent-premium.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 155)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.card_editions (design, name, chapter_size) VALUES
  ('obsidian-smoke', 'Obsidian Smoke', 100),
  ('rose-marble', 'Rose Marble', 100),
  ('carbon-aurum', 'Carbon Aurum', 100),
  ('sandstone-jaali', 'Sandstone Jaali', 100),
  ('sapphire-night', 'Sapphire Night', 100),
  ('aurora-glass', 'Aurora Glass', 100)
ON CONFLICT (design) DO NOTHING;
