// api/clerk-auth.js
// Verifies Clerk session tokens on API requests using JWT verification
// Protects sensitive endpoints from unauthenticated access

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;

export async function requireAuth(req, res) {
  // If Clerk is not configured, block all requests — no graceful degradation
  if (!CLERK_SECRET_KEY) {
    console.error("CLERK_SECRET_KEY not configured — blocking request");
    res.status(503).json({ error: "Authentication service not configured" });
    return { authenticated: false };
  }

  try {
    // Get session token from Authorization header or __session cookie
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim()
      || req.cookies?.__session
      || "";

    if (!sessionToken) {
      res.status(401).json({ error: "Unauthorized — please sign in to use SentinelPost AI" });
      return { authenticated: false };
    }

    // Verify token with Clerk's backend API
    const verifyRes = await fetch("https://api.clerk.com/v1/sessions/verify", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: sessionToken }),
    });

    // Always fail closed — any non-200 response blocks the request
    if (!verifyRes.ok) {
      const errData = await verifyRes.json().catch(() => ({}));
      console.log("Clerk token verification failed:", verifyRes.status, errData.errors?.[0]?.message || "");
      res.status(401).json({ error: "Invalid or expired session — please sign in again" });
      return { authenticated: false };
    }

    const session = await verifyRes.json();

    // Verify session is actually active
    if (session.status !== "active") {
      console.log("Clerk session not active:", session.status);
      res.status(401).json({ error: "Session expired — please sign in again" });
      return { authenticated: false };
    }

    return {
      authenticated: true,
      userId: session.user_id,
      sessionId: session.id,
    };

  } catch (err) {
    // Fail closed — any unexpected error blocks the request
    console.error("Clerk auth error:", err.message);
    res.status(401).json({ error: "Authentication check failed — please try again" });
    return { authenticated: false };
  }
}
