// api/track.js — multi-tenant
import { kvGet, kvSet, kvKeys } from "./kv.js";
import { decryptToken, setSecurityHeaders } from "./middleware.js";
import { auditLog, ACTIONS } from "./audit.js";
import { getTenantId, tenantKey } from "./tenant.js";

async function fetchEngagement(postId, token) {
  const res = await fetch(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(postId)}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Restli-Protocol-Version": "2.0.0" },
  });
  if (!res.ok) { console.log("Engagement fetch status:", res.status); return null; }
  const data = await res.json();
  return {
    likes:    data.likesSummary?.totalLikes || 0,
    comments: data.commentsSummary?.totalFirstLevelComments || 0,
    shares:   data.shareCount || 0,
  };
}

async function updateToneIntelligence(tenantId) {
  const keys = await kvKeys(tenantKey(tenantId, "post:*"));
  const toneScores = {}, toneCounts = {};

  for (const key of keys) {
    const post = await kvGet(key);
    if (!post?.checked) continue;
    const t = post.tone;
    toneScores[t] = (toneScores[t] || 0) + post.score;
    toneCounts[t] = (toneCounts[t] || 0) + 1;
  }

  const toneAvg = {};
  for (const t of Object.keys(toneScores)) {
    toneAvg[t] = toneCounts[t] > 0 ? Math.round(toneScores[t] / toneCounts[t]) : 0;
  }

  const bestTone = Object.entries(toneAvg).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  await kvSet(tenantKey(tenantId, "tone:intelligence"), {
    toneAvg, toneCounts, bestTone, updatedAt: new Date().toISOString(),
  });
  console.log(`[${tenantId}] Tone intelligence updated. Best:`, bestTone);
}

export default async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method === "POST") {
    const { postId, tone, articleTitle, articleUrl, urn } = req.body;
    if (!postId || !tone) return res.status(400).json({ error: "Missing postId or tone" });

    // Use tenantId from the post record itself (set at publish time)
    const tenantId = req.body.tenantId || "shared";
    await kvSet(tenantKey(tenantId, `post:${postId}`), {
      postId, tone, articleTitle: articleTitle || "", articleUrl: articleUrl || "",
      urn: urn || "", tenantId,
      publishedAt: new Date().toISOString(),
      engagement: { likes: 0, comments: 0, shares: 0 }, score: 0, checked: false,
    });
    return res.status(200).json({ success: true });
  }

  if (req.method === "GET") {
    // Wednesday cron — iterate all tenants by scanning for post:* patterns
    try {
      const allPostKeys = await kvKeys("*:post:*");
      console.log("Track: checking", allPostKeys.length, "posts across all tenants");

      const results = [];
      const tenantsProcessed = new Set();

      for (const key of allPostKeys) {
        const post = await kvGet(key);
        if (!post || post.checked) continue;

        const age = Date.now() - new Date(post.publishedAt).getTime();
        if (age < 48 * 60 * 60 * 1000) continue;

        const tenantId = post.tenantId || "shared";
        const encryptedToken = await kvGet(tenantKey(tenantId, `token:${post.urn}`));
        if (!encryptedToken) continue;

        const token = decryptToken(encryptedToken);
        if (!token) continue;

        const engagement = await fetchEngagement(post.postId, token);
        if (!engagement) continue;

        const score   = engagement.likes + (engagement.comments * 3) + (engagement.shares * 2);
        const updated = { ...post, engagement, score, checked: true, checkedAt: new Date().toISOString() };
        await kvSet(tenantKey(tenantId, `post:${post.postId}`), updated);
        results.push({ tenantId, tone: post.tone, score, engagement });
        tenantsProcessed.add(tenantId);
      }

      // Update tone intelligence for each tenant that had posts checked
      for (const tenantId of tenantsProcessed) {
        await updateToneIntelligence(tenantId);
      }

      await auditLog(ACTIONS.TRACK_RUN, { checked: results.length, tenants: tenantsProcessed.size });
      return res.status(200).json({ success: true, checked: results.length, tenants: tenantsProcessed.size });

    } catch (err) {
      console.error("Track GET error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
