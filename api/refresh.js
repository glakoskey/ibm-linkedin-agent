// api/refresh.js
// Vercel serverless function — runs every Monday at 8am CT (13:00 UTC)
// Searches IBM for this week's AI articles and generates LinkedIn posts

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-20250514";

const TONES = [
  { id: "thought-leader", label: "Thought Leader", desc: "insightful and authoritative" },
  { id: "conversational", label: "Conversational", desc: "friendly and approachable" },
  { id: "technical",      label: "Technical",      desc: "deep-dive and expert"        },
  { id: "inspirational",  label: "Inspirational",  desc: "motivating and forward-looking" },
];

async function callClaude(messages, useSearch = false) {
  const body = {
    model: MODEL,
    max_tokens: 1500,
    messages,
    ...(useSearch ? { tools: [{ type: "web_search_20250305", name: "web_search" }] } : {}),
  };

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

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();

  // If model used search tool, do a follow-up turn to get the text summary
  if (data.stop_reason === "tool_use") {
    const followUp = [
      ...messages,
      { role: "assistant", content: data.content },
      { role: "user", content: "Now summarize what you found and return the result as requested." },
    ];
    return callClaude(followUp, false);
  }

  const text = data.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .trim();

  return text;
}

async function searchIBMArticles() {
  const today = new Date();
  const weekAgo = new Date(today - 7 * 24 * 60 * 60 * 1000);
  const dateStr = weekAgo.toISOString().split("T")[0];

  const prompt = `Search ibm.com for the 4 most recent articles about AI published after ${dateStr}. 
Return ONLY a valid JSON array, no markdown, no explanation:
[{"title":"...","url":"https://...","summary":"one sentence summary","date":"Month DD, YYYY"}]`;

  const raw = await callClaude([{ role: "user", content: prompt }], true);

  // Try to parse JSON from response
  const clean = raw.replace(/```json|```/gi, "").trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in search response");

  const articles = JSON.parse(match[0]);
  if (!Array.isArray(articles) || articles.length === 0) throw new Error("Empty articles array");

  return articles;
}

async function generatePost(article, tone) {
  const prompt = `Write a LinkedIn post about this IBM article.

Title: ${article.title}
URL: ${article.url}
Summary: ${article.summary}
Date: ${article.date}

Tone: ${tone.desc}

Requirements:
- Open with a strong hook (do NOT start with "I")
- 150-250 words
- Include the article URL naturally
- End with hashtags on their own line: #IBM #AI plus 2-3 more relevant ones
- Finish with a question to spark comments
- Use blank lines between paragraphs

Write only the post text, nothing else.`;

  return callClaude([{ role: "user", content: prompt }]);
}

export default async function handler(req, res) {
  // Allow GET (cron trigger) and POST (manual trigger)
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Simple auth check for manual POST triggers
  if (req.method === "POST") {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${ANTHROPIC_API_KEY}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    console.log("Starting IBM article refresh...");

    // Step 1: Search for this week's IBM articles
    console.log("Searching IBM for articles...");
    const articles = await searchIBMArticles();
    console.log(`Found ${articles.length} articles`);

    // Step 2: Generate all posts (4 articles × 4 tones = 16 posts)
    console.log("Generating LinkedIn posts...");
    const posts = {};

    for (let i = 0; i < articles.length; i++) {
      for (const tone of TONES) {
        const key = `${i}-${tone.id}`;
        console.log(`Generating post: ${key}`);
        posts[key] = await generatePost(articles[i], tone);
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Step 3: Build the response payload
    const payload = {
      articles,
      posts,
      generatedAt: new Date().toISOString(),
      weekOf: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    };

    console.log("Refresh complete!");
    return res.status(200).json(payload);

  } catch (err) {
    console.error("Refresh error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
