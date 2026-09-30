/**
 * Browser (desktop/Android Chrome) notifications for the signed-in customer.
 *
 * Shown only while the tab is open but not in front — when it is in front,
 * the in-page toast already says the same thing. Delivery while the site is
 * closed would need Web Push (a service worker and a push server), which this
 * does not do.
 */

export type DesktopNotificationState = 'unsupported' | 'default' | 'granted' | 'denied';

export function desktopNotificationState(): DesktopNotificationState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission as DesktopNotificationState;
}

/** Must run inside a click handler: browsers ignore prompts that are not. */
export async function enableDesktopNotifications(): Promise<DesktopNotificationState> {
  if (desktopNotificationState() === 'unsupported') return 'unsupported';
  try {
    return (await window.Notification.requestPermission()) as DesktopNotificationState;
  } catch {
    return desktopNotificationState();
  }
}

/** Only same-site paths are followed; a notification never links off-site. */
export function internalPath(link: string | null | undefined): string | null {
  if (!link) return null;
  const clean = link.trim();
  return clean.startsWith('/') && !clean.startsWith('//') ? clean : null;
}

export function showDesktopNotification(
  options: { id: string; title: string; body?: string | null; link?: string | null },
  open: (path: string) => void,
): void {
  if (desktopNotificationState() !== 'granted' || document.visibilityState === 'visible') return;
  try {
    const notification = new window.Notification(options.title, {
      body: options.body ?? undefined,
      tag: options.id,
      icon: '/icons/icon-192.png',
    });
    notification.onclick = () => {
      window.focus();
      open(internalPath(options.link) ?? '/shygontap/notifications');
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}
