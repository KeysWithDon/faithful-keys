import path from 'node:path';

export const APP_URL = 'faithful-keys://app/';
export function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'faithful-keys:' && url.host === 'app' && !url.username && !url.password;
  } catch { return false; }
}

// Never expose an arbitrary local file through the application protocol.
export function resolveAsset(root, value) {
  if (!isAppUrl(value)) return null;
  let pathname;
  try { pathname = decodeURIComponent(new URL(value).pathname); } catch { return null; }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) return null;
  const relative = pathname.replace(/^\/+/, '') || 'index.html';
  const result = path.resolve(root, relative);
  return result.startsWith(path.resolve(root) + path.sep) ? result : null;
}

export function allowPermission(permission, requestingUrl, topUrl, isMainFrame = true) {
  return isMainFrame !== false && isAppUrl(requestingUrl) && isAppUrl(topUrl)
    && ['midi', 'clipboard-sanitized-write', 'persistent-storage', 'fullscreen'].includes(permission);
}

export function externalLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    // These are the existing product's external destinations and download page.
    if (!['github.com', 'keyswithdon.github.io', 'www.youtube.com', 'youtube.com', 'youtu.be'].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');
