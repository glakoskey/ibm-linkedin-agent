// api/generate.js
import { rateLimit, sanitizeInput, setSecurityHeaders } from "./middleware.js";
import { auditLog, ACTIONS } from "./audit.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-5";

async function callClaude(prompt, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 512, messages: [{ role: "user", content: prompt }] }),
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "15", 10);
      if (attempt < retries) { await new Promise(r => setTimeout(r, retryAfter * 1000)); continue; }
      throw new Error("Rate limit hit — please wait a moment and try again.");
    }
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error?.message || `HTTP ${res.status}`); }
    const data = await res.json();
    return data.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  }
}

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Rate limit
  const limit = await rateLimit(req, 20, 60);
  if (limit.limited) {
    await auditLog(ACTIONS.RATE_LIMITED, { endpoint: "/api/generate", ip: limit.ip }, req);
    return res.status(429).json({ error: "Too many requests — please wait a minute.", isRateLimit: true });
  }

  const { article, tone } = req.body;
  if (!article || !tone) return res.status(400).json({ error: "Missing article or tone" });

  const safeTitle   = sanitizeInput(article.title, 200);
  const safeUrl     = sanitizeInput(article.url, 300);
  const safeSummary = sanitizeInput(article.summary, 500);
  const safeTone    = sanitizeInput(tone.desc, 100);

  try {
    const prompt = `Write a LinkedIn post about this article. Tone: ${safeTone}.

Article: ${safeTitle}
URL: ${safeUrl}
Summary: ${safeSummary}

Rules: hook opening (not "I"), 150-200 words, include URL, end with #IBM #AI + 2 hashtags, close with a question. Post text only.`;

    const post = await callClaude(prompt);
    if (!post) throw new Error("Empty response from Claude");

    // Audit log successful generation
    await auditLog(ACTIONS.GENERATE, {
      articleTitle: safeTitle,
      tone: tone.id || safeTone,
      postLength: post.length,
    }, req);

    return res.status(200).json({ post });

  } catch (err) {
    console.error("Generate error:", err.message);
    const isRateLimit = err.message.includes("Rate limit") || err.message.includes("rate limit");
    return res.status(isRateLimit ? 429 : 500).json({ error: err.message, isRateLimit });
  }
}
