const CACHE_NAME = 'tally-pwa-v1'
const CORE_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function isApiRequest(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (isApiRequest(url)) {
    event.respondWith(fetch(request))
    return
  }

  const accept = request.headers.get('accept') || ''
  const isNavigation = request.mode === 'navigate' || accept.includes('text/html')

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((res) => {
        const copy = res.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        return res
      })
    }),
  )
})

