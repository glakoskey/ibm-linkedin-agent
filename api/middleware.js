// api/middleware.js
// Shared security middleware — rate limiting, input sanitization, token encryption

import { kvGet, kvSet } from "./kv.js";

// ── Rate Limiting ──
// Uses KV to track request counts per IP per minute
export async function rateLimit(req, maxRequests = 10, windowSeconds = 60) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || "unknown";

  const key = `ratelimit:${ip}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;

  try {
    const current = await kvGet(key) || 0;
    if (current >= maxRequests) {
      return { limited: true, remaining: 0, ip };
    }
    // Increment counter with TTL
    const KV_URL = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${current + 1}?ex=${windowSeconds}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    return { limited: false, remaining: maxRequests - current - 1, ip };
  } catch {
    // If rate limit check fails, allow the request through
    return { limited: false, remaining: maxRequests, ip };
  }
}

// ── Input Sanitization ──
// Strips prompt injection attempts and dangerous characters from user inputs
export function sanitizeInput(input, maxLength = 100) {
  if (typeof input !== "string") return "";

  return input
    .slice(0, maxLength)
    // Remove common prompt injection patterns
    .replace(/ignore\s+(previous|all|above)\s+instructions?/gi, "")
    .replace(/you\s+are\s+now/gi, "")
    .replace(/system\s*:/gi, "")
    .replace(/assistant\s*:/gi, "")
    .replace(/human\s*:/gi, "")
    .replace(/<\|.*?\|>/g, "")           // LLM special tokens
    .replace(/\[INST\].*?\[\/INST\]/g, "") // Llama injection
    .replace(/```[\s\S]*?```/g, "")      // Code blocks
    // Remove HTML/script tags
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    // Normalize whitespace
    .trim();
}

// ── Token Encryption ──
// Simple XOR encryption for LinkedIn tokens stored in KV
// Uses ENCRYPTION_KEY env var — add this to Vercel environment variables
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "postflow-default-key-change-me";

export function encryptToken(token) {
  if (!token) return "";
  const key = ENCRYPTION_KEY;
  let result = "";
  for (let i = 0; i < token.length; i++) {
    result += String.fromCharCode(token.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return Buffer.from(result).toString("base64");
}

export function decryptToken(encrypted) {
  if (!encrypted) return "";
  try {
    const token = Buffer.from(encrypted, "base64").toString();
    const key = ENCRYPTION_KEY;
    let result = "";
    for (let i = 0; i < token.length; i++) {
      result += String.fromCharCode(token.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  } catch { return ""; }
}

// ── Security Headers ──
// Call this on every response
export function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
}

// ── CORS ──
export function setCORS(req, res, allowedOrigins = []) {
  const origin = req.headers.origin;
  if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
