// api/auth/login.js
// Redirects user to LinkedIn OAuth authorization page

export default function handler(req, res) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const redirectUri = `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://ibm-linkedin-agent-4trq8j7la-gary-lakoskey-s-projects.vercel.app"}/api/auth/callback`;

  const scope = "openid profile email w_member_social";
  const state = Math.random().toString(36).substring(2);

  const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("state", state);

  res.setHeader("Set-Cookie", `li_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  res.redirect(authUrl.toString());
}
