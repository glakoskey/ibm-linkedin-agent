// api/kv.js - Shared Upstash Redis helper using REST API (no SDK needed)

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(command, ...args) {
  const res = await fetch(`${KV_URL}/${command}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = await res.json();
  if (data.error) throw new Error(`KV error: ${data.error}`);
  return data.result;
}

export async function kvSet(key, value) {
  return kv("set", key, typeof value === "string" ? value : JSON.stringify(value));
}

export async function kvGet(key) {
  const result = await kv("get", key);
  if (!result) return null;
  try { return JSON.parse(result); } catch { return result; }
}

export async function kvDel(key) {
  return kv("del", key);
}

export async function kvKeys(pattern) {
  const res = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = await res.json();
  return data.result || [];
}
