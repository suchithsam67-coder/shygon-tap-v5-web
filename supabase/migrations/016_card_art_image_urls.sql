-- 016: point the card products at the new card art.
--
-- The card photographs (/assets/cards/*.png|jpeg, the old blue-logo cards)
-- were replaced by generated SVG art in the new SHYGON design (see
-- scripts/brand/generate.mjs). products.image_url still named the old files.
-- Nothing on screen reads it today, but it is the catalogue's record of the
-- picture, so keep it true.
--
--   card-<product>-<tier>-<material>  ->  /assets/cards/<product>-<material>[-premium].svg
--
-- Only rows whose image_url still points at an old photograph are touched, so
-- a picture an administrator has since set by hand is left alone. Idempotent.

UPDATE public.products
SET image_url = '/assets/cards/'
      || substring(sku FROM '^card-(.+)-(?:standard|premium)-(?:pvc|metal|transparent)$')
      || '-'
      || substring(sku FROM '-(pvc|metal|transparent)$')
      || CASE WHEN sku LIKE '%-premium-%' THEN '-premium' ELSE '' END
      || '.svg'
WHERE sku ~ '^card-.+-(standard|premium)-(pvc|metal|transparent)$'
  AND (image_url IS NULL OR image_url ~ '^/assets/cards/.+\.(png|jpe?g)$');
