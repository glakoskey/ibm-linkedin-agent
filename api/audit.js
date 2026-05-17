// api/audit.js
// Sends audit log events to Axiom for tracking all consequential actions

const AXIOM_TOKEN = process.env.AXIOM_TOKEN;
const AXIOM_DATASET = process.env.AXIOM_DATASET || "postflow-logs";

// Action types
export const ACTIONS = {
  SEARCH:       "article.search",
  GENERATE:     "post.generate",
  PUBLISH:      "post.publish",
  LINKEDIN_AUTH:"auth.linkedin_connect",
  LINKEDIN_DISC:"auth.linkedin_disconnect",
  RATE_LIMITED: "security.rate_limited",
  INJECT_BLOCK: "security.injection_blocked",
  MONITOR_RUN:  "monitor.run",
  TRACK_RUN:    "track.engagement",
};

// Send a single event to Axiom
export async function auditLog(action, details = {}, req = null) {
  if (!AXIOM_TOKEN) {
    console.log(`[AUDIT] ${action}`, details);
    return; // Gracefully skip if not configured
  }

  const ip = req
    ? (req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown")
    : "cron";

  const event = {
    _time: new Date().toISOString(),
    action,
    ip,
    environment: process.env.VERCEL_ENV || "production",
    ...details,
  };

  try {
    const res = await fetch(`https://api.axiom.co/v1/datasets/${AXIOM_DATASET}/ingest`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AXIOM_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([event]),
    });

    if (!res.ok) {
      console.error("Axiom ingest failed:", res.status, await res.text());
    }
  } catch (err) {
    // Never let audit logging failure break the main flow
    console.error("Audit log error (non-fatal):", err.message);
  }
}

// Handler for the /api/audit endpoint — returns recent audit logs
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Simple auth check — only allow if bypass token matches
  const bypass = req.query.bypass;
  if (!bypass || bypass !== process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!AXIOM_TOKEN) {
    return res.status(200).json({ message: "Axiom not configured", logs: [] });
  }

  try {
    // Query last 24 hours of logs from Axiom
    const query = {
      apl: `['${AXIOM_DATASET}'] | order by _time desc | limit 100`,
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      endTime: new Date().toISOString(),
    };

    const res2 = await fetch("https://api.axiom.co/v1/datasets/_apl?format=tabular", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AXIOM_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(query),
    });

    const data = await res2.json();
    return res.status(200).json({ logs: data });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
