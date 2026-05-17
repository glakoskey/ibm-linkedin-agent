// api/health.js
// Checks status of all critical services and returns health status

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TAVILY_API_KEY    = process.env.TAVILY_API_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const checks = {};
  let overallStatus = "healthy";

  // Check Upstash KV
  try {
    const kvRes = await fetch(`${KV_URL}/ping`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    checks.database = kvRes.ok ? "ok" : "error";
  } catch {
    checks.database = "error";
  }

  // Check Anthropic API key is configured
  checks.ai = ANTHROPIC_API_KEY ? "ok" : "error";

  // Check Tavily API key is configured
  checks.search = TAVILY_API_KEY ? "ok" : "error";

  // Check LinkedIn OAuth is configured
  checks.linkedin = (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) ? "ok" : "error";

  // Determine overall status
  const values = Object.values(checks);
  if (values.every(v => v === "ok")) {
    overallStatus = "healthy";
  } else if (values.some(v => v === "ok")) {
    overallStatus = "degraded";
  } else {
    overallStatus = "down";
  }

  return res.status(200).json({
    status: overallStatus,
    checks,
    timestamp: new Date().toISOString(),
  });
}
