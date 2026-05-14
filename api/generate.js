// api/generate.js
// Generates a single LinkedIn post on demand (called from the browser)

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-5";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { article, tone } = req.body;
  if (!article || !tone) {
    return res.status(400).json({ error: "Missing article or tone" });
  }

  try {
    const prompt = `Write a LinkedIn post about this IBM article.

Title: ${article.title}
URL: ${article.url}
Summary: ${article.summary}

Tone: ${tone.desc}

Requirements:
- Open with a strong hook (do NOT start with "I")
- 150-250 words
- Include the article URL naturally
- End with hashtags on their own line: #IBM #AI plus 2-3 more relevant ones
- Finish with a question to spark comments
- Use blank lines between paragraphs

Write only the post text, nothing else.`;

    const res2 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res2.ok) {
      const err = await res2.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res2.status}`);
    }

    const data = await res2.json();
    const post = data.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!post) throw new Error("Empty response from Claude");

    return res.status(200).json({ post });

  } catch (err) {
    console.error("Generate error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
