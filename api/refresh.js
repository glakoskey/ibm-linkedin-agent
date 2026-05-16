// api/refresh.js
// Uses Tavily for fast article search (~1-2s) then Claude for JSON formatting

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const MODEL = "claude-sonnet-4-5";

// Search using Tavily — returns results in ~1-2 seconds
async function tavilySearch(query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 6,
      include_published_date: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `Tavily HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.results || [];
}

// Claude just formats the results — no search tool needed, much faster
async function formatWithClaude(results, site, topic) {
  const context = results
    .map((r, i) => `${i+1}. Title: ${r.title}\n   URL: ${r.url}\n   Content: ${r.content?.slice(0, 200) || ""}\n   Date: ${r.published_date || "recent"}`)
    .join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      messages: [{
        role: "user",
        content: `From these search results about ${topic} from ${site}, pick the best 4 and return them as a JSON array.

${context}

Output ONLY the JSON array, nothing else:
[{"title":"...","url":"https://...","summary":"one sentence summary","date":"Month DD, YYYY"}]`,
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Claude HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
}

// Extract JSON array from response
function extractArticles(raw) {
  if (!raw) throw new Error("Empty response");
  const clean = raw.replace(/```json|```/gi, "").trim();
  // Try direct parse
  try { const p = JSON.parse(clean); if (Array.isArray(p)) return p; } catch {}
  // Try finding array
  const m = clean.match(/\[[\s\S]*\]/);
  if (m) { try { const p = JSON.parse(m[0]); if (Array.isArray(p)) return p; } catch {} }
  throw new Error(`No JSON found. Raw: ${raw.slice(0, 150)}`);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const site = req.query.site || "ibm.com";
    const topic = req.query.topic || "AI";
    const today = new Date();

    console.log(`Tavily search: ${topic} from ${site}`);

    // Step 1: Fast Tavily search (~1-2 seconds)
    const query = `${topic} site:${site}`;
    const results = await tavilySearch(query);

    if (!results.length) throw new Error(`No results found for ${topic} on ${site}`);
    console.log(`Tavily returned ${results.length} results`);

    // Step 2: Claude formats results into clean JSON (~2-3 seconds, no web search tool)
    const raw = await formatWithClaude(results, site, topic);
    const articles = extractArticles(raw);

    if (!articles.length) throw new Error("No articles extracted");
    console.log(`Formatted ${articles.length} articles`);

    return res.status(200).json({
      articles,
      generatedAt: today.toISOString(),
      weekOf: today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    });

  } catch (err) {
    console.error("Refresh error:", err.message);
    const isRateLimit = err.message.includes("rate limit") || err.message.includes("429");
    return res.status(isRateLimit ? 429 : 500).json({ error: err.message, isRateLimit });
  }
}
