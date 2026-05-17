// api/post.js — multi-tenant
import { rateLimit, encryptToken, setSecurityHeaders } from "./middleware.js";
import { auditLog, ACTIONS } from "./audit.js";
import { requireAuth } from "./clerk-auth.js";
import { getTenantId, tenantKey } from "./tenant.js";

const KV_URL   = process.env.KV_REST_API_URL;
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

  const auth = await requireAuth(req, res);
  if (!auth.authenticated) return;

  const limit = await rateLimit(req, 5, 60);
  if (limit.limited) {
    await auditLog(ACTIONS.RATE_LIMITED, { endpoint: "/api/post", ip: limit.ip }, req);
    return res.status(429).json({ error: "Too many requests. Please wait before posting again." });
  }

  const { token, urn, text, tone, articleTitle, articleUrl } = req.body;
  if (!token || !urn || !text) return res.status(400).json({ error: "Missing required fields" });
  if (text.length < 50)   return res.status(400).json({ error: "Post content too short" });
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
        specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text }, shareMediaCategory: "NONE" } },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });

    const postData = await postRes.json();
    if (!postRes.ok) throw new Error(postData.message || `LinkedIn API error ${postRes.status}`);

    const postId   = postData.id;
    const tenantId = getTenantId(req);
    console.log(`Published post [${tenantId}]:`, postId);

    await auditLog(ACTIONS.PUBLISH, {
      postId, tone: tone || "unknown",
      articleTitle: articleTitle || "",
      urn, postLength: text.length, tenantId,
    }, req);

    // Store post and encrypted token under tenant-scoped keys
    try {
      const encryptedToken = encryptToken(token);
      await kvSet(tenantKey(tenantId, `post:${postId}`), {
        postId, tone: tone || "unknown",
        articleTitle: articleTitle || "", articleUrl: articleUrl || "",
        urn, tenantId,
        publishedAt: new Date().toISOString(),
        engagement: { likes: 0, comments: 0, shares: 0 }, score: 0, checked: false,
      });
      await kvSet(tenantKey(tenantId, `token:${urn}`), encryptedToken, 5184000);
    } catch (trackErr) {
      console.log("Tracking failed (non-fatal):", trackErr.message);
    }

    return res.status(200).json({ success: true, id: postId });

  } catch (err) {
    console.error("Post error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
