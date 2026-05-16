// api/refresh.js
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

async function callClaude(messages, useSearch = false, retries = 3) {
  const body = {
    model: MODEL,
    max_tokens: 1200,
    messages,
    ...(useSearch ? { tools: [{ type: "web_search_20250305", name: "web_search" }] } : {}),
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "20", 10);
      console.log(`Rate limited attempt ${attempt}/${retries}, waiting ${retryAfter}s...`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }
      throw new Error("Rate limit exceeded — please wait a moment and try again.");
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log("stop_reason:", data.stop_reason, "content blocks:", data.content?.length);

    // If model used search tool, send a strict follow-up
    if (data.stop_reason === "tool_use") {
      const followUp = [
        ...messages,
        { role: "assistant", content: data.content },
        {
          role: "user",
          content: `Output the articles you found as a JSON array. Include whatever you found — use approximate dates if needed. Never refuse or explain. Just output the JSON array starting with [ and ending with ]:
[{"title":"...","url":"https://...","summary":"one sentence","date":"Month DD, YYYY"}]`
        },
      ];
      return callClaude(followUp, false, retries);
    }

    const text = data.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();

    console.log("Response text (first 300):", text.slice(0, 300));
    return text;
  }
}

// Try multiple strategies to extract a JSON array from a string
function extractArticles(raw) {
  if (!raw) throw new Error("Empty response from API");

  // Strategy 1: direct parse if it's already clean JSON
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // Strategy 2: strip markdown fences and parse
  const stripped = raw.replace(/```json/gi, "").replace(/```/gi, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // Strategy 3: find first [ ... ] block
  const bracketMatch = stripped.match(/\[[\s\S]*?\]/);
  if (bracketMatch) {
    try {
      const parsed = JSON.parse(bracketMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // Strategy 4: find a longer [ ... ] block (greedy)
  const greedyMatch = raw.match(/\[[\s\S]*\]/);
  if (greedyMatch) {
    try {
      const parsed = JSON.parse(greedyMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // Strategy 5: extract individual JSON objects and build array manually
  const objMatches = raw.match(/\{[^{}]*"title"[^{}]*\}/g);
  if (objMatches && objMatches.length > 0) {
    const articles = [];
    for (const obj of objMatches) {
      try { articles.push(JSON.parse(obj)); } catch {}
    }
    if (articles.length > 0) return articles;
  }

  throw new Error(`No JSON found in response. Raw: ${raw.slice(0, 200)}`);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const site = req.query.site || "ibm.com";
    const topic = req.query.topic || "AI";

    const today = new Date();
    const weekAgo = new Date(today - 7 * 24 * 60 * 60 * 1000);
    const dateStr = weekAgo.toISOString().split("T")[0];

    console.log(`Searching ${site} for ${topic} articles since ${dateStr}`);

    const prompt = `Search the web for recent articles about ${topic} from ${site}.

Return the best 4 results you find as a JSON array. Use approximate dates if exact dates are unclear. Always return results even if dates are uncertain.

Output ONLY the JSON array, nothing else. Start with [ and end with ]:
[{"title":"article title","url":"https://full-url","summary":"one sentence summary","date":"Month DD, YYYY"}]`;

    const raw = await callClaude([{ role: "user", content: prompt }], true);
    const articles = extractArticles(raw);

    if (articles.length === 0) throw new Error("Empty articles array");

    console.log(`Found ${articles.length} articles`);

    return res.status(200).json({
      articles,
      generatedAt: new Date().toISOString(),
      weekOf: today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    });

  } catch (err) {
    console.error("Refresh error:", err.message);
    const isRateLimit = err.message.includes("Rate limit") || err.message.includes("rate limit") || err.message.includes("429");
    return res.status(isRateLimit ? 429 : 500).json({ error: err.message, isRateLimit });
  }
}
