/**
 * Deployment health check.
 *
 * Reports whether the server-side configuration the analyst pipeline needs is present, without
 * ever echoing a secret. This exists because the demo URL may be unreachable from the network the
 * project was built on, so "is the deployment actually configured?" has to be answerable from
 * outside.
 *
 *   GET /api/health
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STARTED_AT = Date.now();

export async function GET() {
  const deepseekConfigured = Boolean(process.env.DEEPSEEK_API_KEY);
  const githubTokenConfigured = Boolean(process.env.GITHUB_TOKEN);

  return Response.json(
    {
      ok: deepseekConfigured,
      service: 'onboardpilot',
      modelProvider: 'deepseek',
      model: 'deepseek-chat',
      deepseekConfigured,
      githubTokenConfigured,
      // Without a token GitHub allows only 60 unauthenticated calls per hour, shared per egress IP.
      githubRateLimit: githubTokenConfigured ? '5000/hour (token)' : '60/hour (unauthenticated)',
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      nodeVersion: process.version,
      time: new Date().toISOString(),
      hint: deepseekConfigured
        ? 'Ready. POST /api/analyze with {"repo":"owner/name"}.'
        : 'DEEPSEEK_API_KEY is not set on this deployment — analysis will fail.',
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
