/**
 * Deployment health check.
 *
 * Reports whether the server-side configuration the analyst pipeline needs is present, without
 * ever echoing a secret. This exists because the demo domain may be unreachable from the network
 * the project was built on, so "is the deployment actually configured and working?" has to be
 * answerable from outside.
 *
 *   GET /api/health              → configuration only (fast, free)
 *   GET /api/health?selftest=1   → also performs a 1-token round trip to the model provider
 *
 * Returns 200 when ready, 503 when the model provider is not configured.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function probeModelProvider(): Promise<{ live: boolean; detail: string }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return { live: false, detail: 'not configured' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (response.ok) return { live: true, detail: 'reached the model provider' };
    if (response.status === 401) return { live: false, detail: 'HTTP 401 — the API key was rejected' };
    if (response.status === 402) return { live: false, detail: 'HTTP 402 — insufficient balance' };
    if (response.status === 429) return { live: true, detail: 'HTTP 429 — rate limited but the key is valid' };
    return { live: false, detail: `HTTP ${response.status}` };
  } catch {
    // Do not echo error.message: network error strings from the Node.js socket
    // layer can include hostname fragments and are not safe to surface publicly.
    return { live: false, detail: 'request failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const deepseekConfigured = Boolean(process.env.DEEPSEEK_API_KEY);
  const githubTokenConfigured = Boolean(process.env.GITHUB_TOKEN);

  const wantsSelfTest = new URL(request.url).searchParams.get('selftest') === '1';
  const probe = wantsSelfTest && deepseekConfigured ? await probeModelProvider() : null;

  const ready = deepseekConfigured && (probe ? probe.live : true);

  return Response.json(
    {
      ok: ready,
      service: 'onboardpilot',
      modelProvider: 'deepseek',
      model: 'deepseek-chat',
      deepseekConfigured,
      githubTokenConfigured,
      // Without a token GitHub allows only 60 unauthenticated calls per hour, shared per egress IP.
      githubRateLimit: githubTokenConfigured ? '5000/hour (token)' : '60/hour (unauthenticated)',
      modelProviderProbe: probe ? probe.detail : 'not run (add ?selftest=1)',
      time: new Date().toISOString(),
      hint: ready
        ? 'Ready. POST /api/analyze with {"repo":"owner/name"}.'
        : 'Not ready — analysis would fail. Check the environment variables on this deployment.',
    },
    {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
