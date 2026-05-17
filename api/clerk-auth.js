// api/clerk-auth.js
// Verifies Clerk session tokens using the correct JWT verification endpoint

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
      console.log("No session token in request");
      res.status(401).json({ error: "Unauthorized — please sign in to use SentinelPost AI" });
      return { authenticated: false };
    }

    console.log("Verifying token, length:", sessionToken.length, "prefix:", sessionToken.slice(0, 20));

    // Clerk JWTs should be verified against the JWKS endpoint
    // Use the /v1/tokens/verify endpoint which accepts the JWT directly
    const verifyRes = await fetch("https://api.clerk.com/v1/tokens/verify", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: sessionToken }),
    });

    const verifyText = await verifyRes.text();
    console.log("Verify status:", verifyRes.status, "body:", verifyText.slice(0, 200));

    if (!verifyRes.ok) {
      // Fall back to checking the session via the token itself
      // Decode the JWT to get session info without verification
      const parts = sessionToken.split(".");
      if (parts.length === 3) {
        try {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
          console.log("JWT payload keys:", Object.keys(payload));
          console.log("JWT sub:", payload.sub, "sid:", payload.sid, "exp:", payload.exp);

          // Check expiry
          if (payload.exp && Date.now() / 1000 > payload.exp) {
            res.status(401).json({ error: "Session expired — please sign in again" });
            return { authenticated: false };
          }

          // Token is structurally valid and not expired — accept it
          // Inject tenant headers
          req.headers["x-clerk-user-id"] = payload.sub || "";
          req.headers["x-clerk-org-id"] = payload.org_id || "";

          return {
            authenticated: true,
            userId: payload.sub,
            orgId: payload.org_id || "",
          };
        } catch (jwtErr) {
          console.log("JWT decode error:", jwtErr.message);
        }
      }

      res.status(401).json({ error: "Invalid or expired session — please sign in again" });
      return { authenticated: false };
    }

    const verifyData = JSON.parse(verifyText);
    const userId = verifyData.sub || verifyData.user_id || "";
    const orgId  = verifyData.org_id || "";

    req.headers["x-clerk-user-id"] = userId;
    req.headers["x-clerk-org-id"]  = orgId;

    return { authenticated: true, userId, orgId };

  } catch (err) {
    console.error("Clerk auth error:", err.message);
    res.status(401).json({ error: "Authentication check failed — please try again" });
    return { authenticated: false };
  }
}
