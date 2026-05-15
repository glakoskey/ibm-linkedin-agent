// api/post.js
// Publishes a post to LinkedIn on behalf of the authenticated user

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token, urn, text } = req.body;

  if (!token || !urn || !text) {
    return res.status(400).json({ error: "Missing token, urn, or text" });
  }

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
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      }),
    });

    const postData = await postRes.json();

    if (!postRes.ok) {
      throw new Error(postData.message || postData.error || `LinkedIn API error ${postRes.status}`);
    }

    return res.status(200).json({ success: true, id: postData.id });

  } catch (err) {
    console.error("Post error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
