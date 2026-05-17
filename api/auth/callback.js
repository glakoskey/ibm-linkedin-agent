// api/auth/callback.js
function decodeJWT(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "==".slice(0, (4 - base64.length % 4) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch { return null; }
}

export default async function handler(req, res) {
  const { code, error, error_description } = req.query;
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const appUrl = "https://sentinelpost.vercel.app";
  const redirectUri = `${appUrl}/api/auth/callback`;

  if (error) return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);
  if (!code) return res.redirect("/?auth_error=No+authorization+code+received");

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

    let tokenData;
    try { tokenData = JSON.parse(tokenText); }
    catch { throw new Error(`Token not JSON: ${tokenText.slice(0, 200)}`); }

    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || `Token failed ${tokenRes.status}`);
    }

    const accessToken = tokenData.access_token;
    let urn = null, name = "LinkedIn User", headline = "";

    // Step 2: Decode id_token JWT for urn + name
    if (tokenData.id_token) {
      const claims = decodeJWT(tokenData.id_token);
      console.log("JWT claims keys:", Object.keys(claims || {}));
      if (claims?.sub) {
        urn = claims.sub;
        name = claims.name || claims.given_name || "LinkedIn User";
        // Some LinkedIn id_tokens include headline
        headline = claims.headline || claims.jobTitle || "";
      }
    }

    // Step 3: Call userinfo to get headline (it's in the profile scope)
    // Always call this — it returns headline even when we have urn from id_token
    try {
      const uiRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });
      const uiData = await uiRes.json();
      console.log("userinfo fields:", Object.keys(uiData));
      console.log("userinfo sample:", JSON.stringify(uiData).slice(0, 400));

      if (uiData.sub) urn = urn || uiData.sub;
      if (uiData.name) name = uiData.name;
      // LinkedIn returns headline in these possible fields
      headline = uiData.headline || uiData["https://api.linkedin.com/v2/me#headline"] || uiData.jobTitle || headline;
    } catch (e) {
      console.log("userinfo error (non-fatal):", e.message);
    }

    // Step 4: Try v2/me as last resort for urn
    if (!urn) {
      try {
        const meRes = await fetch("https://api.linkedin.com/v2/me", {
          headers: { "Authorization": `Bearer ${accessToken}` },
        });
        const me = await meRes.json();
        if (me.id) {
          urn = me.id;
          name = [me.localizedFirstName, me.localizedLastName].filter(Boolean).join(" ") || name;
          headline = me.headline || me.localizedHeadline || headline;
        }
      } catch {}
    }

    if (!urn) throw new Error("Could not retrieve LinkedIn profile. Please try again.");

    console.log("Auth success — name:", name, "headline:", headline, "urn:", urn);

    const params = new URLSearchParams({
      auth_success: "1",
      token: accessToken,
      expires_in: tokenData.expires_in || 5183944,
      urn,
      name,
      headline: headline || "",
    });

    return res.redirect(`/?${params.toString()}`);

  } catch (err) {
    console.error("OAuth callback error:", err.message);
    return res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
}
