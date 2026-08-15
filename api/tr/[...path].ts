/**
 * 基元律动（TokenRhythm）生产代理（Vercel Edge Function）
 *
 * 前端统一请求同源 /tr/v1/...（见 src/services/ai.ts 的 tokenrhythm baseUrl），
 * 开发态由 vite proxy 转发；生产态由本函数转发到 https://tokenrhythm.studio/v1/...。
 * 上游带 CSRF 校验：转发前剥离 Origin、Referer、Sec-Fetch-*、Sec-CH-UA* 等
 * 浏览器跨站标识头，与 vite.config.ts 的 dev proxy 行为保持一致；
 * Authorization 与 Content-Type 原样透传。
 * vercel.json framework=vite 时 api/ 目录自动识别，无需额外配置。
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

export const config = { runtime: 'edge' };

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
