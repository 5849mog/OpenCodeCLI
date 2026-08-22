/**
 * URL 安全护栏：浏览器端请求前校验目标 host。
 *
 * 约束：仅允许 http/https；发请求前校验 host，拒绝 localhost、环回、
 * 私有和保留地址（防止 SSRF——把用户配置的 baseUrl 或 CORS 代理地址
 * 打向内网/本机）。
 */

const LOOPBACK_RE = /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/i;

/** 是否 IPv4 字形（四段 0-255）。非 IP 的主机名（如 api.deepseek.com）
 *  不做字面拦截——浏览器无法预解析 DNS，域名可能指向公网或内网，
 *  只能靠"字面 localhost/私有 IP"拦截 + 由用户配置的 baseUrl 可信。 */
function isIPv4Literal(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

/** IPv4 私有/保留网段（RFC1918 + 链路本地 + CGNAT + 保留）。 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a === 0 ||
    a >= 224 // 保留/组播
  );
}

/**
 * 校验 URL：仅 http/https、host 非 localhost/环回/私有/保留地址。
 * 通过返回 null，不通过返回错误消息。
 */
export function validateExternalUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `Invalid URL: ${raw}`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return `Unsupported URL protocol: ${u.protocol}`;
  }
  const host = u.hostname.toLowerCase();
  if (LOOPBACK_RE.test(host)) {
    return `Blocked loopback host: ${host}`;
  }
  // IPv6 环回/链路本地（::1 已在上面，这里兜底 ::、fe80:: 等）
  if (host.startsWith("[")) {
    const inner = host.replace(/[[\]]/g, "").toLowerCase();
    if (inner === "::" || inner.startsWith("::1") || inner.startsWith("fe80:")) {
      return `Blocked loopback/link-local host: ${host}`;
    }
    return null; // 其他 IPv6 视为公网地址放行
  }
  if (isIPv4Literal(host) && isPrivateIPv4(host)) {
    return `Blocked private/reserved host: ${host}`;
  }
  return null;
}
