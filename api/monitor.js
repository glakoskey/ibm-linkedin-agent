// api/monitor.js
// Daily cron — uses Tavily to search IBM for breaking news, scores with Claude

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const MODEL = "claude-sonnet-4-5";
import { kvGet, kvSet } from "./kv.js";

async function tavilySearch(query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 5,
      include_published_date: true,
    }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

async function scoreWithClaude(results) {
  const context = results
    .map((r, i) => `${i+1}. ${r.title} — ${r.content?.slice(0, 150) || ""}`)
    .join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `Score these IBM news results for importance (0-10). 8-10=major launch/acquisition/earnings. 5-7=significant partnership/research. 1-4=regular content. 0=nothing notable.

${context}

Return ONLY JSON:
{"importanceScore":0,"hasBreakingNews":false,"reason":"...","articles":[{"title":"...","url":"...","summary":"...","date":"..."}]}`
      }],
    }),
  });

  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  const clean = text.replace(/```json|```/gi, "").trim();
  const m = clean.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in scoring response");
  return JSON.parse(m[0]);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0];

    // Check if we already ran today
    const cached = await kvGet(`monitor:${dateStr}`);
    if (cached) {
      console.log("Monitor: returning cached result for today");
      return res.status(200).json(cached);
    }

    console.log("Monitor: searching IBM for breaking news...");

    // Fast Tavily search
    const results = await tavilySearch("IBM announcement news today site:ibm.com OR site:newsroom.ibm.com");
    console.log(`Monitor: got ${results.length} results from Tavily`);

    if (!results.length) {
      const empty = { breakingNews: false, importanceScore: 0, reason: "No results found", checkedAt: today.toISOString() };
      await kvSet(`monitor:${dateStr}`, empty, 86400);
      return res.status(200).json(empty);
    }

    // Claude scores importance
    const analysis = await scoreWithClaude(results);
    const THRESHOLD = 7;

    const result = {
      breakingNews: analysis.importanceScore >= THRESHOLD,
      importanceScore: analysis.importanceScore,
      reason: analysis.reason,
      articles: analysis.articles || [],
      checkedAt: today.toISOString(),
    };

    // Cache for 24 hours
    await kvSet(`monitor:${dateStr}`, result, 86400);
    await kvSet("monitor:latest", result, 86400);

    if (result.breakingNews) {
      await kvSet("monitor:alert", { ...result, dismissed: false }, 86400);
    }

    console.log(`Monitor: score=${result.importanceScore} breaking=${result.breakingNews}`);
    return res.status(200).json(result);

  } catch (err) {
    console.error("Monitor error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
