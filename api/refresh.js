// api/refresh.js — multi-tenant
import { rateLimit, sanitizeInput, setSecurityHeaders } from "./middleware.js";
import { auditLog, ACTIONS } from "./audit.js";
import { getTenantId, tenantKey } from "./tenant.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TAVILY_API_KEY    = process.env.TAVILY_API_KEY;
const MODEL             = "claude-sonnet-4-5";
const KV_URL            = process.env.KV_REST_API_URL;
const KV_TOKEN          = process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
    const data = await res.json();
    if (!data.result) return null;
    return JSON.parse(data.result);
  } catch { return null; }
}

async function kvSet(key, value, exSeconds = 86400) {
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}?ex=${exSeconds}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch (e) { console.log("KV set error:", e.message); }
}

async function tavilySearch(query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: TAVILY_API_KEY, query, search_depth: "basic", max_results: 6, include_published_date: true }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

async function formatWithClaude(results, site, topic) {
  const context = results.map((r, i) => `${i+1}. Title: ${r.title}\n   URL: ${r.url}\n   Content: ${r.content?.slice(0, 200) || ""}\n   Date: ${r.published_date || "recent"}`).join("\n\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 800, messages: [{ role: "user", content: `From these search results about ${topic} from ${site}, pick the best 4 and return ONLY a JSON array:\n${context}\n\n[{"title":"...","url":"https://...","summary":"one sentence","date":"Month DD, YYYY"}]` }] }),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
  const data = await res.json();
  return data.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
}

function extractArticles(raw) {
  if (!raw) throw new Error("Empty response");
  const clean = raw.replace(/```json|```/gi, "").trim();
  try { const p = JSON.parse(clean); if (Array.isArray(p)) return p; } catch {}
  const m = clean.match(/\[[\s\S]*\]/);
  if (m) { try { const p = JSON.parse(m[0]); if (Array.isArray(p)) return p; } catch {} }
  throw new Error(`No JSON found. Raw: ${raw.slice(0, 150)}`);
}

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const limit = await rateLimit(req, 30, 60);
  if (limit.limited) {
    await auditLog(ACTIONS.RATE_LIMITED, { endpoint: "/api/refresh", ip: limit.ip }, req);
    return res.status(429).json({ error: "Too many requests — please wait a minute.", isRateLimit: true });
  }

  try {
    const site  = sanitizeInput(req.query.site  || "ibm.com", 100);
    const topic = sanitizeInput(req.query.topic || "AI", 100);
    const force = req.query.force === "1";
    const today = new Date();

    if (!/^[a-zA-Z0-9][a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}/.test(site)) {
      return res.status(400).json({ error: "Invalid site format" });
    }

    // Tenant-scoped cache key — each client gets their own article cache
    const tenantId  = getTenantId(req);
    const cacheKey  = tenantKey(tenantId, `articles:${site}:${topic}`.toLowerCase().replace(/[^a-z0-9:.]/g, "-"));

    if (!force) {
      const cached = await kvGet(cacheKey);
      if (cached?.articles?.length > 0) {
        console.log(`Cache hit: ${cacheKey}`);
        await auditLog(ACTIONS.SEARCH, { site, topic, cached: true, resultCount: cached.articles.length, tenantId }, req);
        return res.status(200).json({ ...cached, fromCache: true });
      }
    }

    console.log(`Tavily search [${tenantId}]: ${topic} from ${site}`);
    const results  = await tavilySearch(`${topic} site:${site}`);
    if (!results.length) throw new Error(`No results found for ${topic} on ${site}`);

    const raw      = await formatWithClaude(results, site, topic);
    const articles = extractArticles(raw);
    if (!articles.length) throw new Error("No articles extracted");

    const result = {
      articles,
      generatedAt: today.toISOString(),
      weekOf: today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    };

    await kvSet(cacheKey, result, 86400);
    await auditLog(ACTIONS.SEARCH, { site, topic, cached: false, resultCount: articles.length, tenantId }, req);

    return res.status(200).json(result);

  } catch (err) {
    console.error("Refresh error:", err.message);
    const isRateLimit = err.message.includes("rate limit") || err.message.includes("429");
    return res.status(isRateLimit ? 429 : 500).json({ error: err.message, isRateLimit });
  }
}
