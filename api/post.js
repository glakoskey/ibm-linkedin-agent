// api/post.js — with rate limiting, token encryption, security headers
import { rateLimit, encryptToken, setSecurityHeaders } from "./middleware.js";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvSet(key, value, exSeconds = 604800) {
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}?ex=${exSeconds}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch (e) { console.log("KV set error:", e.message); }
}

export default async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Rate limit: 5 posts per minute per IP (posting is high-value action)
  const limit = await rateLimit(req, 5, 60);
  if (limit.limited) {
    return res.status(429).json({ error: "Too many requests. Please wait before posting again." });
  }

  const { token, urn, text, tone, articleTitle, articleUrl } = req.body;
  if (!token || !urn || !text) return res.status(400).json({ error: "Missing required fields" });

  // Basic content validation — prevent empty or excessively long posts
  if (text.length < 50) return res.status(400).json({ error: "Post content too short" });
  if (text.length > 3000) return res.status(400).json({ error: "Post content too long" });

  try {
    const postRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: `urn:li:person:${urn}`,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });

    const postData = await postRes.json();
    if (!postRes.ok) throw new Error(postData.message || `LinkedIn API error ${postRes.status}`);

    const postId = postData.id;
    console.log("Published post:", postId);

    // Track post — encrypt token before storing in KV
    try {
      const encryptedToken = encryptToken(token);
      await kvSet(`post:${postId}`, {
        postId, tone: tone || "unknown",
        articleTitle: articleTitle || "",
        articleUrl: articleUrl || "",
        urn, publishedAt: new Date().toISOString(),
        engagement: { likes: 0, comments: 0, shares: 0 },
        score: 0, checked: false,
      });
      // Store encrypted token for engagement tracking
      await kvSet(`token:${urn}`, encryptedToken, 5184000); // 60 days
      console.log("Post tracked with encrypted token");
    } catch (trackErr) {
      console.log("Tracking failed (non-fatal):", trackErr.message);
    }

    return res.status(200).json({ success: true, id: postId });

  } catch (err) {
    console.error("Post error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
