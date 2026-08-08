/* 词忆 WordMemory Service Worker 模板（由 scripts/generate-sw.mjs 在构建后生成 dist/sw.js）
 * 策略：
 *  - 应用外壳（HTML/JS/CSS/图标）：install 阶段 precache 全部资产清单，首次访问后即可离线使用
 *  - 词库数据（dicts/*.json）：Cache-First，静态数据，命中即用（无需 precache，已安装词库数据在 IndexedDB）
 *  - 跨域请求（AI API 等）不缓存
 * 升级：修改 VERSION 后重新部署，activate 阶段自动清理旧缓存。
 */
const VERSION = 'v2';
const SHELL_CACHE = `wordmemory-shell-${VERSION}`;
const DICT_CACHE = `wordmemory-dicts-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(async (cache) => {
        // 逐个缓存并容忍单文件失败（cache.addAll 任一失败会导致整个 install 失败）
        await Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch(() => {
              /* 单文件缓存失败不阻塞安装 */
            }),
          ),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.includes(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/dicts/')) {
    event.respondWith(cacheFirst(req, DICT_CACHE));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}
