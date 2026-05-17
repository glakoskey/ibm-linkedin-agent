// api/tenant.js
// Multi-tenant helper — derives a tenant ID from the Clerk organization or user
// Used to prefix all KV keys so client data stays isolated

export function getTenantId(req) {
  // Prefer organization ID (when Clerk orgs are set up per client)
  // Fall back to user ID for single-user tenants
  const orgId = req.headers["x-clerk-org-id"] || "";
  const userId = req.headers["x-clerk-user-id"] || "";

  if (orgId) return `org_${orgId}`;
  if (userId) return `usr_${userId}`;

  // For cron jobs (no user context) use a shared tenant
  return "shared";
}

// Prefix a KV key with the tenant ID
export function tenantKey(tenantId, key) {
  return `${tenantId}:${key}`;
}

// Extract tenant ID from a prefixed key
export function stripTenantPrefix(prefixedKey, tenantId) {
  return prefixedKey.replace(`${tenantId}:`, "");
}
