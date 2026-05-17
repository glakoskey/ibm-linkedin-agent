// api/track.js — with token decryption for engagement checks
import { kvGet, kvSet, kvKeys } from "./kv.js";
import { decryptToken, setSecurityHeaders } from "./middleware.js";

async function fetchEngagement(postId, token) {
  const url = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(postId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  if (!res.ok) { console.log("Engagement fetch status:", res.status); return null; }
  const data = await res.json();
  return {
    likes: data.likesSummary?.totalLikes || 0,
    comments: data.commentsSummary?.totalFirstLevelComments || 0,
    shares: data.shareCount || 0,
  };
}

async function updateToneIntelligence() {
  const keys = await kvKeys("post:*");
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
  await kvSet("tone:intelligence", { toneAvg, toneCounts, bestTone, updatedAt: new Date().toISOString() });
  console.log("Tone intelligence updated. Best:", bestTone, "averages:", toneAvg);
}

export default async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method === "POST") {
    const { postId, tone, articleTitle, articleUrl, urn } = req.body;
    if (!postId || !tone) return res.status(400).json({ error: "Missing postId or tone" });

    const record = {
      postId, tone, articleTitle: articleTitle || "", articleUrl: articleUrl || "",
      urn: urn || "", publishedAt: new Date().toISOString(),
      engagement: { likes: 0, comments: 0, shares: 0 }, score: 0, checked: false,
    };
    await kvSet(`post:${postId}`, record);
    return res.status(200).json({ success: true });
  }

  if (req.method === "GET") {
    try {
      const keys = await kvKeys("post:*");
      console.log("Checking engagement for", keys.length, "posts");
      const results = [];

      for (const key of keys) {
        const post = await kvGet(key);
        if (!post || post.checked) continue;

        const age = Date.now() - new Date(post.publishedAt).getTime();
        if (age < 48 * 60 * 60 * 1000) continue;

        // Decrypt token before use
        const encryptedToken = post.urn ? await kvGet(`token:${post.urn}`) : null;
        if (!encryptedToken) { console.log("No token for post", post.postId); continue; }

        const token = decryptToken(encryptedToken);
        if (!token) { console.log("Token decryption failed"); continue; }

        const engagement = await fetchEngagement(post.postId, token);
        if (!engagement) continue;

        const score = engagement.likes + (engagement.comments * 3) + (engagement.shares * 2);
        const updated = { ...post, engagement, score, checked: true, checkedAt: new Date().toISOString() };
        await kvSet(key, updated);
        results.push({ tone: post.tone, score, engagement });
      }

      await updateToneIntelligence();
      return res.status(200).json({ success: true, checked: results.length, results });
    } catch (err) {
      console.error("Track GET error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
