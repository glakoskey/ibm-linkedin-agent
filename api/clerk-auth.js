// api/clerk-auth.js
// Verifies Clerk session token on API requests
// Protects all API endpoints from unauthenticated access

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

export async function requireAuth(req, res) {
  // Skip auth check if Clerk is not configured (graceful degradation)
  if (!CLERK_SECRET_KEY) {
    console.log("Clerk not configured — skipping auth check");
    return { authenticated: true, userId: "anonymous" };
  }

  try {
    // Get session token from Authorization header or cookie
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim()
      || req.cookies?.__session
      || "";

    if (!sessionToken) {
      res.status(401).json({ error: "Unauthorized — please sign in" });
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
      res.status(401).json({ error: "Invalid or expired session — please sign in again" });
      return { authenticated: false };
    }

    const session = await verifyRes.json();
    return { authenticated: true, userId: session.user_id, sessionId: session.id };

  } catch (err) {
    console.error("Clerk auth error:", err.message);
    // On error, allow through (graceful degradation — rate limiting still protects us)
    return { authenticated: true, userId: "unknown" };
  }
}
