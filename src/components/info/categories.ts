import type { InfoCategory } from '../../lib/database.types';

/** How each Info category reads on the page and in the owner's editor. */
export const INFO_CATEGORY_LABEL: Record<InfoCategory, string> = {
  place: 'Place',
  product: 'Product',
  equipment: 'Equipment',
  exhibit: 'Exhibit',
  service_point: 'Service point',
  instructions: 'Instructions',
};
