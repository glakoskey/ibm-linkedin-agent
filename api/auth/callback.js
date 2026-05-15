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
    // Send credentials in both body AND Basic header to satisfy LinkedIn
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

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
    catch { throw new Error(`Token response not JSON: ${tokenText.slice(0,200)}`); }

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || `Token failed ${tokenRes.status}: ${tokenText.slice(0,200)}`);
    }

    // Get LinkedIn profile
    const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    console.log("Profile sub:", profile.sub, "name:", profile.name);

    const urn = profile.sub;
    if (!urn) throw new Error("No user URN in profile response: " + JSON.stringify(profile).slice(0,200));

    const params = new URLSearchParams({
      auth_success: "1",
      token: tokenData.access_token,
      expires_in: tokenData.expires_in || 5183944,
      urn,
      name: profile.name || profile.given_name || "LinkedIn User",
    });

    return res.redirect(`/?${params.toString()}`);

  } catch (err) {
    console.error("OAuth callback error:", err.message);
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
}
