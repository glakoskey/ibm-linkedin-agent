// api/auth/callback.js
// Handles LinkedIn OAuth callback, exchanges code for access token

export default async function handler(req, res) {
  const { code, error, error_description, state } = req.query;
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const appUrl = "https://ibm-linkedin-agent.vercel.app";
  const redirectUri = `${appUrl}/api/auth/callback`;

  // Log everything for debugging
  console.log("Callback received:", { code: !!code, error, error_description, state });
  console.log("Client ID present:", !!clientId);
  console.log("Client Secret present:", !!clientSecret);

  if (error) {
    console.error("LinkedIn returned error:", error, error_description);
    return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);
  }

  if (!code) {
    return res.redirect("/?auth_error=No+authorization+code+received");
  }

  if (!clientId || !clientSecret) {
    return res.redirect("/?auth_error=Missing+API+credentials+in+environment");
  }

  try {
    // Exchange code for access token
    console.log("Exchanging code for token...");
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    console.log("Token request redirect_uri:", redirectUri);

    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    const tokenText = await tokenRes.text();
    console.log("Token response status:", tokenRes.status);
    console.log("Token response body:", tokenText);

    let tokenData;
    try {
      tokenData = JSON.parse(tokenText);
    } catch {
      throw new Error(`Token response not JSON: ${tokenText.slice(0, 200)}`);
    }

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || `Token exchange failed: ${tokenRes.status}`);
    }

    console.log("Got access token, fetching profile...");

    // Get user profile
    const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const profileText = await profileRes.text();
    console.log("Profile response status:", profileRes.status);
    console.log("Profile response body:", profileText);

    let profile = {};
    try {
      profile = JSON.parse(profileText);
    } catch {
      throw new Error(`Profile response not JSON: ${profileText.slice(0, 200)}`);
    }

    const urn = profile.sub;
    if (!urn) throw new Error("No user URN returned from LinkedIn profile");

    console.log("Auth complete for:", profile.name, "URN:", urn);

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
