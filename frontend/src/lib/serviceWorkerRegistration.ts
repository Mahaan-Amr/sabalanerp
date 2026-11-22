/** Both historical worker URLs have the same root scope. Keep its subscription
 * while replacing the script; never unregister it or reload a user's form. */
export async function registerApplicationServiceWorker() {
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  if (registration.active) return registration;
  return navigator.serviceWorker.ready;
}
