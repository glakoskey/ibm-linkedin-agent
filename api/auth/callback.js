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
    console.log("Token status:", tokenRes.status, "Body:", tokenText.slice(0, 400));

    let tokenData;
    try { tokenData = JSON.parse(tokenText); }
    catch { throw new Error(`Token not JSON: ${tokenText.slice(0, 200)}`); }

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || `Token failed ${tokenRes.status}`);
    }

    const accessToken = tokenData.access_token;
    console.log("Got access token, length:", accessToken.length);

    // Try userinfo endpoint first (OpenID Connect)
    async function fetchProfile(token) {
      const r = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "LinkedIn-Version": "202304",
        },
      });
      const text = await r.text();
      console.log("userinfo status:", r.status, "body:", text.slice(0, 300));
      try { return { status: r.status, data: JSON.parse(text) }; }
      catch { return { status: r.status, data: {} }; }
    }

    // Try /v2/me as fallback (older LinkedIn API)
    async function fetchProfileV2(token) {
      const r = await fetch("https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)", {
        headers: {
          "Authorization": `Bearer ${token}`,
          "LinkedIn-Version": "202304",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      });
      const text = await r.text();
      console.log("v2/me status:", r.status, "body:", text.slice(0, 300));
      try { return { status: r.status, data: JSON.parse(text) }; }
      catch { return { status: r.status, data: {} }; }
    }

    // Try userinfo
    let { status, data: profile } = await fetchProfile(accessToken);

    // If 401, wait and retry once
    if (status === 401 || !profile.sub) {
      console.log("userinfo 401 — waiting 2s and retrying...");
      await new Promise(r => setTimeout(r, 2000));
      ({ status, data: profile } = await fetchProfile(accessToken));
    }

    // If still no sub, try the v2/me fallback
    if (!profile.sub) {
      console.log("userinfo failed, trying v2/me fallback...");
      const { status: s2, data: me } = await fetchProfileV2(accessToken);
      console.log("v2/me result:", JSON.stringify(me).slice(0, 200));
      if (me.id) {
        // v2/me uses 'id' not 'sub'
        profile = {
          sub: me.id,
          name: `${me.localizedFirstName || ""} ${me.localizedLastName || ""}`.trim() || "LinkedIn User",
        };
      }
    }

    if (!profile.sub) {
      throw new Error("Could not retrieve your LinkedIn profile. Please disconnect any existing app access at linkedin.com/settings and try again.");
    }

    console.log("Auth complete, URN:", profile.sub, "name:", profile.name);

    const params = new URLSearchParams({
      auth_success: "1",
      token: accessToken,
      expires_in: tokenData.expires_in || 5183944,
      urn: profile.sub,
      name: profile.name || "LinkedIn User",
    });

    return res.redirect(`/?${params.toString()}`);

  } catch (err) {
    console.error("OAuth callback error:", err.message);
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
}
