// api/middleware.js
// Shared security middleware — rate limiting, input sanitization, AES-256-GCM encryption, security headers

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// ── Rate Limiting ──
export async function rateLimit(req, maxRequests = 10, windowSeconds = 60) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || "unknown";

  const key = `ratelimit:${ip}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;

  try {
    const getRes = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const getData = await getRes.json();
    const current = parseInt(getData.result || "0", 10);

    if (current >= maxRequests) {
      return { limited: true, remaining: 0, ip };
    }

    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${current + 1}?ex=${windowSeconds}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });

    return { limited: false, remaining: maxRequests - current - 1, ip };
  } catch {
    return { limited: false, remaining: maxRequests, ip };
  }
}

// ── Input Sanitization ──
export function sanitizeInput(input, maxLength = 100) {
  if (typeof input !== "string") return "";
  return input
    .slice(0, maxLength)
    .replace(/ignore\s+(previous|all|above)\s+instructions?/gi, "")
    .replace(/you\s+are\s+now/gi, "")
    .replace(/system\s*:/gi, "")
    .replace(/assistant\s*:/gi, "")
    .replace(/human\s*:/gi, "")
    .replace(/<\|.*?\|>/g, "")
    .replace(/\[INST\].*?\[\/INST\]/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

// ── AES-256-GCM Encryption ──
// Uses ENCRYPTION_KEY env var (must be exactly 32 bytes / 64 hex chars)
// Format stored in KV: iv:authTag:ciphertext (all base64)

function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY || "";
  // If key is a hex string (64 chars), convert to buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  // Otherwise derive a 32-byte key by hashing the string
  const { createHash } = require("crypto");
  return createHash("sha256").update(raw).digest();
}

export function encryptToken(token) {
  if (!token) return "";
  try {
    const key = getEncryptionKey();
    const iv = randomBytes(12); // 96-bit IV for GCM
    const cipher = createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag(); // 16-byte authentication tag

    // Store as base64 segments separated by colons
    return [
      iv.toString("base64"),
      authTag.toString("base64"),
      encrypted.toString("base64"),
    ].join(":");
  } catch (err) {
    console.error("Encryption error:", err.message);
    return "";
  }
}

export function decryptToken(encryptedData) {
  if (!encryptedData) return "";
  try {
    const parts = encryptedData.split(":");

    // Handle legacy XOR-encrypted tokens (base64 but no colons = old format)
    if (parts.length !== 3) {
      console.log("Legacy token format detected — cannot decrypt, will need re-auth");
      return "";
    }

    const [ivB64, authTagB64, ciphertextB64] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (err) {
    console.error("Decryption error:", err.message);
    return "";
  }
}

// ── Security Headers ──
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
