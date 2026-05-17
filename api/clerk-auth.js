// api/clerk-auth.js
// Verifies Clerk session tokens and extracts organization-based tenant identity
// Each Clerk organization = one client tenant (fully isolated data in Upstash KV)

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

function decodeJWT(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { return null; }
}

export async function requireAuth(req, res) {
  if (!CLERK_SECRET_KEY) {
    console.error("CLERK_SECRET_KEY not configured");
    res.status(503).json({ error: "Authentication service not configured" });
    return { authenticated: false };
  }

  try {
    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.replace("Bearer ", "").trim();

    if (!sessionToken) {
      res.status(401).json({ error: "Unauthorized — please sign in to use SentinelPost AI" });
      return { authenticated: false };
    }

    // Decode JWT to extract claims
    const claims = decodeJWT(sessionToken);
    if (!claims?.sub) {
      res.status(401).json({ error: "Invalid token" });
      return { authenticated: false };
    }

    // Check expiry
    if (claims.exp && Date.now() / 1000 > claims.exp) {
      res.status(401).json({ error: "Session expired — please sign in again" });
      return { authenticated: false };
    }

    console.log(`Auth: user=${claims.sub} org=${claims.org_id || "none"} role=${claims.org_role || "none"}`);

    // Verify user exists in Clerk
    const userRes = await fetch(`https://api.clerk.com/v1/users/${claims.sub}`, {
      headers: { "Authorization": `Bearer ${CLERK_SECRET_KEY}` },
    });

    if (!userRes.ok) {
      console.log("User not found in Clerk:", claims.sub, userRes.status);
      res.status(401).json({ error: "User not found — please sign in again" });
      return { authenticated: false };
    }

    const user = await userRes.json();
    const userId = claims.sub;
    const orgId  = claims.org_id || "";

    // Inject headers for tenant.js to use downstream
    req.headers["x-clerk-user-id"] = userId;
    req.headers["x-clerk-org-id"]  = orgId;

    console.log(`Auth OK: ${user.email_addresses?.[0]?.email_address} org=${orgId || "personal"}`);

    return { authenticated: true, userId, orgId };

  } catch (err) {
    console.error("Clerk auth error:", err.message);
    // Fail closed — never allow through on error
    res.status(401).json({ error: "Authentication failed — please try again" });
    return { authenticated: false };
  }
}
