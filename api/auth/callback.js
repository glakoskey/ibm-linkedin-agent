// api/auth/callback.js
// Handles LinkedIn OAuth callback, exchanges code for access token

export default async function handler(req, res) {
  const { code, error, error_description } = req.query;
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const appUrl = "https://ibm-linkedin-agent-4trq8j7la-gary-lakoskey-s-projects.vercel.app";
  const redirectUri = `${appUrl}/api/auth/callback`;

  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);
  }

  if (!code) {
    return res.redirect("/?auth_error=No+authorization+code+received");
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || "Failed to get access token");
    }

    // Get user profile to retrieve LinkedIn URN (needed for posting)
    const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    const urn = profile.sub; // LinkedIn person URN

    // Pass token and URN back to the app via URL params (stored in sessionStorage client-side)
    const params = new URLSearchParams({
      auth_success: "1",
      token: tokenData.access_token,
      expires_in: tokenData.expires_in,
      urn,
      name: profile.name || "",
    });

    res.redirect(`/?${params.toString()}`);

  } catch (err) {
    console.error("OAuth callback error:", err.message);
    res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
}
