// Безкоштовний Cloudflare Worker із точним розкладом кожні 10 хвилин (*/10 * * * *).
// Альтернатива cron-job.org, якщо зручніше тримати крон у коді:
//   cd deploy/keep-warm && npx wrangler deploy

const DEFAULT_URL = 'https://clarity-three-xi.vercel.app/api/health/';

async function ping(env) {
  const url = env?.HEALTH_URL || DEFAULT_URL;
  const res = await fetch(url, {
    headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'clarity-keep-warm/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Keep-warm failed: ${res.status} ${url}`);
  }
  return res.status;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ping(env));
  },
  async fetch(_request, env) {
    const status = await ping(env);
    return new Response(JSON.stringify({ ok: true, upstream: status }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  },
};
