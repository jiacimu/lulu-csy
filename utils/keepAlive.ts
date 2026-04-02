/**
 * Application keep-alive utility using Web Locks API.
 * This prevents the browser from aggressively freezing the background page.
 */

let lockPromise: Promise<void> | null = null;
let isKeepAliveStarted = false;

export function startKeepAlive() {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    console.warn('Web Locks API not supported, keep-alive may not work.');
    return;
  }
  
  if (isKeepAliveStarted) return;
  isKeepAliveStarted = true;

  console.log('Starting app keep-alive via Web Locks API...');

  // Web Lock helps prevent browser from completely freezing the page
  lockPromise = navigator.locks.request('app-keep-alive', { mode: 'shared' }, () => {
    return new Promise<void>(() => {
      // Never resolve, keep the lock active as long as the page lives
    });
  }) as unknown as Promise<void>;

  // Listen to visibility changes to handle reconnects or resume logic if needed
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('App returned to foreground. Maintaining keep-alive.');
      // Optional: Add logic to check websocket connection or force refresh stale data here
    }
  });
}
