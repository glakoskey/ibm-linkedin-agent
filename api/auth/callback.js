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
    console.log("Token status:", tokenRes.status, "Body:", tokenText.slice(0, 300));

    let tokenData;
    try { tokenData = JSON.parse(tokenText); }
    catch { throw new Error(`Token response not JSON: ${tokenText.slice(0, 200)}`); }

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || `Token failed ${tokenRes.status}`);
    }

    const accessToken = tokenData.access_token;

    // Fetch profile — retry once with a short delay if LinkedIn returns 401
    async function fetchProfile(token) {
      const r = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      console.log("Profile status:", r.status, "sub:", data.sub, "code:", data.code);
      return { status: r.status, data };
    }

    let { status, data: profile } = await fetchProfile(accessToken);

    // If LinkedIn revoked the token immediately (race condition), wait 1s and retry once
    if (status === 401 || !profile.sub) {
      console.log("Profile 401 — waiting 1s and retrying...");
      await new Promise(r => setTimeout(r, 1000));
      ({ status, data: profile } = await fetchProfile(accessToken));
    }

    if (!profile.sub) {
      throw new Error(`Could not retrieve LinkedIn profile (status ${status}). Please try connecting again.`);
    }

    const params = new URLSearchParams({
      auth_success: "1",
      token: accessToken,
      expires_in: tokenData.expires_in || 5183944,
      urn: profile.sub,
      name: profile.name || profile.given_name || "LinkedIn User",
    });

    return res.redirect(`/?${params.toString()}`);

  } catch (err) {
    console.error("OAuth callback error:", err.message);
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
}
