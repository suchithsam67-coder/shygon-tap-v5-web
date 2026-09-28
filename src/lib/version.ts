/**
 * The one place the product version is declared.
 *
 * Kept as a plain constant rather than read from package.json: the customer
 * website, the future customer app and the admin app version independently, and
 * the number a customer quotes to support has to mean this build of the Tap
 * product, not whatever npm happens to have in its manifest.
 */
export const APP_NAME = 'SHYGON Tap';
export const APP_VERSION = '1.0.1';

/**
 * Stamped by Vite when the bundle is built (see `define` in vite.config.ts),
 * not read at runtime — otherwise it would always show today's date and tell a
 * support agent nothing about which build the customer is actually running.
 */
declare const __BUILD_DATE__: string | undefined;
export const BUILD_DATE =
  typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : 'development build';

export const COMPANY = 'SHYGON Technologies Pvt Ltd';
