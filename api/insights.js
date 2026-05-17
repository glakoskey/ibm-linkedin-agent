// api/insights.js — multi-tenant
import { kvGet, kvKeys } from "./kv.js";
import { getTenantId, tenantKey } from "./tenant.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const tenantId = getTenantId(req);

    // Get tone intelligence for this tenant
    const intelligence = await kvGet(tenantKey(tenantId, "tone:intelligence"));

    // Get recent posts for this tenant only
    const allKeys = await kvKeys(tenantKey(tenantId, "post:*"));
    const posts = [];
    for (const key of allKeys) {
      const post = await kvGet(key);
      if (post) posts.push(post);
    }
    posts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    return res.status(200).json({
      intelligence: intelligence || null,
      recentPosts: posts.slice(0, 10),
      totalPosts: posts.length,
      tenantId,
    });
  } catch (err) {
    console.error("Insights error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
