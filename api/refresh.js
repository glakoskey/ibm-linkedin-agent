// api/refresh.js
// Fetches this week's articles for a given site and topic
// Includes retry logic for rate limiting

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-5";

async function callClaude(messages, useSearch = false, retries = 3) {
  const body = {
    model: MODEL,
    max_tokens: 1000,
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

    // Rate limited — wait and retry
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "20", 10);
      console.log(`Rate limited on attempt ${attempt}/${retries}, waiting ${retryAfter}s...`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }
      throw new Error("Rate limit exceeded — please wait a minute and try again.");
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();

    // If model used search tool, do a follow-up turn
    if (data.stop_reason === "tool_use") {
      const followUp = [
        ...messages,
        { role: "assistant", content: data.content },
        { role: "user", content: "Now return the JSON array of articles as requested. Only JSON, no markdown." },
      ];
      return callClaude(followUp, false, retries);
    }

    return data.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();
  }
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

    const prompt = `Search ${site} for the 4 most recent articles about ${topic} published after ${dateStr}.
Return ONLY a valid JSON array, no markdown, no explanation:
[{"title":"...","url":"https://...","summary":"one sentence summary","date":"Month DD, YYYY"}]`;

    const raw = await callClaude([{ role: "user", content: prompt }], true);
    const clean = raw.replace(/```json|```/gi, "").trim();
    const match = clean.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON found in response");

    const articles = JSON.parse(match[0]);
    if (!Array.isArray(articles) || articles.length === 0) throw new Error("Empty articles array");

    console.log(`Found ${articles.length} articles`);

    return res.status(200).json({
      articles,
      generatedAt: new Date().toISOString(),
      weekOf: today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    });

  } catch (err) {
    console.error("Refresh error:", err.message);
    // Return rate limit status so client can show friendly message
    const isRateLimit = err.message.includes("Rate limit") || err.message.includes("rate limit") || err.message.includes("429");
    return res.status(isRateLimit ? 429 : 500).json({ error: err.message, isRateLimit });
  }
}
