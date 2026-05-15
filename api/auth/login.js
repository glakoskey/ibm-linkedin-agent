// api/auth/login.js
// Redirects user to LinkedIn OAuth authorization page

export default function handler(req, res) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const redirectUri = "https://ibm-linkedin-agent.vercel.app/api/auth/callback";

  // openid + profile + email = Sign In with LinkedIn (OpenID Connect)
  // w_member_social = Share on LinkedIn (requires product approval)
  const scope = "openid profile email w_member_social";
  const state = Math.random().toString(36).substring(2);

  const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "consent"); // Force fresh token every time

  res.setHeader("Set-Cookie", `li_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  res.redirect(authUrl.toString());
}
