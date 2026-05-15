// api/auth/callback.js
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

    // Step 1: Exchange code for token
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
    console.log("Token status:", tokenRes.status);
    console.log("Token body:", tokenText.slice(0, 500));

    let tokenData;
    try { tokenData = JSON.parse(tokenText); }
    catch { throw new Error(`Token not JSON: ${tokenText.slice(0, 200)}`); }

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || `Token failed ${tokenRes.status}`);
    }

    const accessToken = tokenData.access_token;
    const scope = tokenData.scope || "";
    console.log("Token OK, scope:", scope, "token length:", accessToken.length);

    // Step 2: Get profile using /v2/me (most reliable endpoint)
    // This works with both openid and legacy scopes
    const meRes = await fetch("https://api.linkedin.com/v2/me", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    const meText = await meRes.text();
    console.log("v2/me status:", meRes.status, "body:", meText.slice(0, 300));

    let meData = {};
    try { meData = JSON.parse(meText); } catch {}

    // Step 3: If v2/me worked, use it
    let urn = meData.id;
    let name = "";

    if (urn) {
      name = [meData.localizedFirstName, meData.localizedLastName].filter(Boolean).join(" ") || "LinkedIn User";
      console.log("Got profile from v2/me — id:", urn, "name:", name);
    } else {
      // Step 4: Fall back to userinfo (OpenID Connect)
      console.log("v2/me failed, trying userinfo...");
      const uiRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      const uiText = await uiRes.text();
      console.log("userinfo status:", uiRes.status, "body:", uiText.slice(0, 300));

      let uiData = {};
      try { uiData = JSON.parse(uiText); } catch {}

      urn = uiData.sub;
      name = uiData.name || uiData.given_name || "LinkedIn User";
    }

    if (!urn) {
      throw new Error(`Profile fetch failed. v2/me: ${meRes.status}, scope granted: ${scope}. Try revoking app access at linkedin.com/settings and reconnecting.`);
    }

    const params = new URLSearchParams({
      auth_success: "1",
      token: accessToken,
      expires_in: tokenData.expires_in || 5183944,
      urn,
      name: name || "LinkedIn User",
    });

    console.log("Auth success for URN:", urn);
    return res.redirect(`/?${params.toString()}`);

  } catch (err) {
    console.error("OAuth callback error:", err.message);
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
}
