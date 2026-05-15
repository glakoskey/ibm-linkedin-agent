// api/monitor.js
// Daily cron — searches IBM for breaking news, scores importance, triggers refresh if significant

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-5";
import { kvGet, kvSet } from "./kv.js";

async function callClaude(messages, useSearch = false) {
  const body = {
    model: MODEL,
    max_tokens: 800,
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

  if (data.stop_reason === "tool_use") {
    const followUp = [
      ...messages,
      { role: "assistant", content: data.content },
      { role: "user", content: "Based on the search results, provide your analysis as requested." },
    ];
    return callClaude(followUp, false);
  }

  return data.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const today = new Date();
    const yesterday = new Date(today - 24 * 60 * 60 * 1000);
    const dateStr = yesterday.toISOString().split("T")[0];

    console.log("Monitor: searching IBM for breaking news since", dateStr);

    // Search for breaking IBM news
    const searchPrompt = `Search ibm.com and IBM newsroom for major announcements or breaking news published after ${dateStr}. 
Look for: product launches, major partnerships, acquisitions, earnings, IBM Think announcements, or significant AI breakthroughs.

Return ONLY a JSON object, no markdown:
{
  "hasBreakingNews": true/false,
  "importanceScore": 0-10,
  "articles": [{"title":"...","url":"...","summary":"...","date":"..."}],
  "reason": "why this is or isn't breaking news"
}

Score 8-10: Major product launch, acquisition, earnings surprise, IBM Think keynote
Score 5-7: Significant partnership, major research, executive announcement  
Score 1-4: Regular blog posts, minor updates
Score 0: Nothing significant found`;

    const raw = await callClaude([{ role: "user", content: searchPrompt }], true);
    console.log("Monitor raw response:", raw.slice(0, 500));

    let analysis = { hasBreakingNews: false, importanceScore: 0, articles: [], reason: "" };
    try {
      const clean = raw.replace(/```json|```/gi, "").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) analysis = JSON.parse(match[0]);
    } catch (e) {
      console.log("Parse error:", e.message);
    }

    console.log("Importance score:", analysis.importanceScore, "Breaking:", analysis.hasBreakingNews);

    // Store latest monitor result
    await kvSet("monitor:latest", {
      ...analysis,
      checkedAt: today.toISOString(),
    });

    // If score >= 7, store as breaking news alert
    const THRESHOLD = 7;
    if (analysis.importanceScore >= THRESHOLD && analysis.articles.length > 0) {
      console.log("BREAKING NEWS DETECTED — score:", analysis.importanceScore);

      // Store alert for app to show
      await kvSet("monitor:alert", {
        articles: analysis.articles,
        importanceScore: analysis.importanceScore,
        reason: analysis.reason,
        detectedAt: today.toISOString(),
        dismissed: false,
      });

      return res.status(200).json({
        breakingNews: true,
        importanceScore: analysis.importanceScore,
        articles: analysis.articles,
        reason: analysis.reason,
      });
    }

    return res.status(200).json({
      breakingNews: false,
      importanceScore: analysis.importanceScore,
      reason: analysis.reason,
      checkedAt: today.toISOString(),
    });

  } catch (err) {
    console.error("Monitor error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
