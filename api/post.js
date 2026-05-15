// api/post.js
// Publishes a post to LinkedIn and tracks it in KV for engagement monitoring

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token, urn, text, tone, articleTitle, articleUrl } = req.body;

  if (!token || !urn || !text) {
    return res.status(400).json({ error: "Missing token, urn, or text" });
  }

  try {
    // Publish to LinkedIn
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
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      }),
    });

    const postData = await postRes.json();

    if (!postRes.ok) {
      throw new Error(postData.message || postData.error || `LinkedIn API error ${postRes.status}`);
    }

    const postId = postData.id;
    console.log("Published LinkedIn post:", postId);

    // Track the post in KV for engagement monitoring
    // Fire and forget — don't fail the post if tracking fails
    try {
      await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://ibm-linkedin-agent.vercel.app"}/api/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          tone: tone || "unknown",
          articleTitle: articleTitle || "",
          articleUrl: articleUrl || "",
          token,
          urn,
        }),
      });
      console.log("Post tracked successfully");
    } catch (trackErr) {
      console.log("Tracking failed (non-fatal):", trackErr.message);
    }

    return res.status(200).json({ success: true, id: postId });

  } catch (err) {
    console.error("Post error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
