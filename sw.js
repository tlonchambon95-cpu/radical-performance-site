/* =====================================================================
   sw.js — service worker de Radical Performance
   ---------------------------------------------------------------------
   Rôle : rendre l'application installable et utilisable hors ligne.

   IMPORTANT — à chaque mise en ligne, incrémenter VERSION ci-dessous.
   C'est ce qui déclenche le remplacement du cache chez les utilisateurs
   déjà installés ; sans ça ils gardent l'ancienne version indéfiniment.

   Le service worker n'est actif qu'en HTTPS ou sur http://localhost.
   En ouverture directe (file://) il ne s'enregistre pas : c'est normal,
   le site fonctionne quand même, simplement sans installation ni cache.
   ===================================================================== */
const VERSION = 'rp-v2';
const CACHE   = VERSION;

/* Coquille de l'application. La racine './' suffit en production ;
   les autres entrées sont mises en cache au mieux, une absence
   (ex. og.png non déployé) ne doit pas faire échouer l'installation. */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './og.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // add() individuel plutôt que addAll() : addAll est atomique et une
    // seule 404 annulerait toute la mise en cache
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* L'installeur de bureau pèse ~95 Mo : le laisser passer par la stratégie
     « cache d'abord » saturerait le quota de stockage du navigateur pour une
     ressource qu'on ne télécharge qu'une fois. On le sert directement. */
  if (/\.(exe|msi|zip|blockmap)$/i.test(url.pathname)) return;

  /* Navigation : réseau d'abord, pour qu'une nouvelle version soit prise
     dès qu'elle est en ligne ; repli sur le cache si hors ligne. */
  if (req.mode === 'navigate'){
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req))
            || (await caches.match('./index.html'))
            || (await caches.match('./'))
            || Response.error();
      }
    })());
    return;
  }

  /* Ressources : cache d'abord, revalidation en arrière-plan */
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(res => {
      if (res && res.ok){
        caches.open(CACHE).then(c => c.put(req, res.clone()));
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
