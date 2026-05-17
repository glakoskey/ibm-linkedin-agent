// api/clerk-auth.js
// Verifies Clerk session tokens and extracts tenant identity for multi-tenant isolation

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

export async function requireAuth(req, res) {
  if (!CLERK_SECRET_KEY) {
    console.error("CLERK_SECRET_KEY not configured — blocking request");
    res.status(503).json({ error: "Authentication service not configured" });
    return { authenticated: false };
  }

  try {
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim()
      || req.cookies?.__session
      || "";

    if (!sessionToken) {
      res.status(401).json({ error: "Unauthorized — please sign in to use SentinelPost AI" });
      return { authenticated: false };
    }

    // Verify token with Clerk
    const verifyRes = await fetch("https://api.clerk.com/v1/sessions/verify", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: sessionToken }),
    });

    if (!verifyRes.ok) {
      const errData = await verifyRes.json().catch(() => ({}));
      console.log("Clerk verification failed:", verifyRes.status, errData.errors?.[0]?.message || "");
      res.status(401).json({ error: "Invalid or expired session — please sign in again" });
      return { authenticated: false };
    }

    const session = await verifyRes.json();

    if (session.status !== "active") {
      res.status(401).json({ error: "Session expired — please sign in again" });
      return { authenticated: false };
    }

    // Inject tenant identity into request headers for downstream use
    req.headers["x-clerk-user-id"] = session.user_id || "";
    req.headers["x-clerk-org-id"] = session.last_active_organization_id || "";
    req.headers["x-clerk-session-id"] = session.id || "";

    return {
      authenticated: true,
      userId: session.user_id,
      orgId: session.last_active_organization_id || "",
      sessionId: session.id,
    };

  } catch (err) {
    console.error("Clerk auth error:", err.message);
    res.status(401).json({ error: "Authentication check failed — please try again" });
    return { authenticated: false };
  }
}
