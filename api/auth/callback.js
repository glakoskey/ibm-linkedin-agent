// api/auth/callback.js
// Decode JWT without verifying signature to extract sub (user URN)
function decodeJWT(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Base64url decode
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "==".slice(0, (4 - base64.length % 4) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const { code, error, error_description } = req.query;
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const appUrl = "https://ibm-linkedin-agent.vercel.app";
  const redirectUri = `${appUrl}/api/auth/callback`;

  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);
  }
  if (!code) {
    return res.redirect("/?auth_error=No+authorization+code+received");
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    // Exchange code for token
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const tokenText = await tokenRes.text();
    console.log("Token status:", tokenRes.status, "body:", tokenText.slice(0, 500));

    let tokenData;
    try { tokenData = JSON.parse(tokenText); }
    catch { throw new Error(`Token not JSON: ${tokenText.slice(0, 200)}`); }

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || `Token failed ${tokenRes.status}`);
    }

    const accessToken = tokenData.access_token;
    console.log("Token OK, scope:", tokenData.scope, "has id_token:", !!tokenData.id_token);

    // Strategy 1: Extract URN from id_token JWT (no extra API call needed)
    let urn = null;
    let name = "LinkedIn User";

    if (tokenData.id_token) {
      const claims = decodeJWT(tokenData.id_token);
      console.log("JWT claims:", JSON.stringify(claims).slice(0, 300));
      if (claims?.sub) {
        urn = claims.sub;
        name = claims.name || claims.given_name || "LinkedIn User";
        console.log("Got URN from id_token:", urn, "name:", name);
      }
    }

    // Strategy 2: Try userinfo if no id_token
    if (!urn) {
      console.log("No id_token, trying userinfo...");
      const uiRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      const uiText = await uiRes.text();
      console.log("userinfo status:", uiRes.status, "body:", uiText.slice(0, 300));
      try {
        const ui = JSON.parse(uiText);
        if (ui.sub) { urn = ui.sub; name = ui.name || ui.given_name || "LinkedIn User"; }
      } catch {}
    }

    // Strategy 3: Try v2/me with no version header
    if (!urn) {
      console.log("Trying v2/me...");
      const meRes = await fetch("https://api.linkedin.com/v2/me", {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      const meText = await meRes.text();
      console.log("v2/me status:", meRes.status, "body:", meText.slice(0, 300));
      try {
        const me = JSON.parse(meText);
        if (me.id) {
          urn = me.id;
          name = [me.localizedFirstName, me.localizedLastName].filter(Boolean).join(" ") || "LinkedIn User";
        }
      } catch {}
    }

    if (!urn) {
      throw new Error("Could not get LinkedIn profile ID after 3 attempts. Please try again.");
    }

    const params = new URLSearchParams({
      auth_success: "1",
      token: accessToken,
      expires_in: tokenData.expires_in || 5183944,
      urn,
      name,
    });

    console.log("Auth success, URN:", urn);
    return res.redirect(`/?${params.toString()}`);

  } catch (err) {
    console.error("OAuth callback error:", err.message);
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
}
