// api/insights.js
// Returns tone intelligence and recent post performance for the dashboard

import { kvGet, kvKeys } from "./kv.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Get tone intelligence summary
    const intelligence = await kvGet("tone:intelligence");

    // Get recent posts (last 10)
    const keys = await kvKeys("post:*");
    const posts = [];
    for (const key of keys) {
      const post = await kvGet(key);
      if (post) posts.push(post);
    }
    posts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const recentPosts = posts.slice(0, 10);

    return res.status(200).json({
      intelligence: intelligence || null,
      recentPosts,
      totalPosts: posts.length,
    });
  } catch (err) {
    console.error("Insights error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
