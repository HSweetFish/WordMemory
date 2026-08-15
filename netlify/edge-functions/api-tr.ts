/**
 * 基元律动（TokenRhythm）生产代理（Netlify Edge Function）
 *
 * 与 Vercel 版（api/tr/[...path].ts）等价：同源 /tr/v1/* → https://tokenrhythm.studio/v1/*，
 * 转发前剥离浏览器跨站标识头（上游 CSRF 校验），Authorization / Content-Type 原样透传。
 * 路径绑定见 netlify.toml 的 [[edge_functions]]（path = "/tr/*"）。
 */

const UPSTREAM = 'https://tokenrhythm.studio';

/** 与 vite.config.ts 保持一致：转发前剥离的浏览器跨站标识头（上游 CSRF 校验会拒绝它们） */
const STRIP_HEADERS = [
  'origin',
  'referer',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
];

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // /tr/v1/chat/completions → https://tokenrhythm.studio/v1/chat/completions
  const path = url.pathname.replace(/^\/tr/, '');
  const headers = new Headers(req.headers);
  for (const h of STRIP_HEADERS) headers.delete(h);

  const upstream = await fetch(UPSTREAM + path + url.search, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
  });

  // 原样返回上游响应：状态码 + 响应头 + body（同源转发，无需额外 CORS 头）
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
