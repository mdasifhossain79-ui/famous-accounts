// Minimal service worker so Edge/Chrome can offer "Install app". It does not cache anything, so updates show immediately.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
