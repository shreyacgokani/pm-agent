import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OAUTH_STORE_PATH = path.join(__dirname, '../data/github-oauth.json');

let cachedConfig = null;

function readStore() {
  if (!fs.existsSync(OAUTH_STORE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(OAUTH_STORE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function getFrontendUrl() {
  const url = (process.env.FRONTEND_URL || 'http://localhost:3000').trim();
  return url || 'http://localhost:3000';
}

export function getCallbackUrl() {
  if (process.env.GITHUB_CALLBACK_URL?.trim()) {
    return process.env.GITHUB_CALLBACK_URL.trim();
  }
  return `${getFrontendUrl().replace(/\/$/, '')}/api/github/callback`;
}

export function getOAuthConfig() {
  if (cachedConfig) return cachedConfig;

  const stored = readStore();
  const clientId = process.env.GITHUB_CLIENT_ID?.trim() || stored?.client_id || null;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim() || stored?.client_secret || null;

  cachedConfig = {
    clientId,
    clientSecret,
    appSlug: stored?.app_slug || null,
    configured: Boolean(clientId && clientSecret),
  };

  return cachedConfig;
}

export function saveOAuthConfig({ clientId, clientSecret, appSlug = null, appId = null }) {
  fs.mkdirSync(path.dirname(OAUTH_STORE_PATH), { recursive: true });
  const payload = {
    client_id: clientId,
    client_secret: clientSecret,
    app_slug: appSlug,
    app_id: appId,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(OAUTH_STORE_PATH, JSON.stringify(payload, null, 2));
  cachedConfig = {
    clientId,
    clientSecret,
    appSlug,
    configured: true,
  };
  return cachedConfig;
}

export function isLocalDev() {
  const base = getFrontendUrl().replace(/\/$/, '');
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base);
}

export function isOAuthConfigured() {
  return getOAuthConfig().configured;
}

export function canUseManifestBootstrap() {
  return isOAuthConfigured() === false && !isLocalDev();
}

export function buildAppManifest() {
  const base = getFrontendUrl().replace(/\/$/, '');
  const callbackUrl = getCallbackUrl();

  return {
    name: 'PM Agent',
    url: base,
    hook_attributes: {
      url: `${base}/api/github/webhook`,
      active: false,
    },
    redirect_url: `${base}/api/github/manifest/callback`,
    callback_urls: [callbackUrl],
    setup_url: `${base}/integrations`,
    public: false,
    request_oauth_on_install: true,
    default_permissions: {
      contents: 'write',
      metadata: 'read',
      administration: 'write',
    },
    default_events: [],
  };
}

function escapeHtmlAttr(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

export function renderManifestBootstrapPage() {
  const manifest = JSON.stringify(buildAppManifest());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect GitHub — PM Agent</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f5f7; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #fff; border-radius: 8px; padding: 32px; max-width: 420px; width: 100%; box-shadow: 0 1px 3px rgba(0,0,0,.12); text-align: center; }
    h1 { font-size: 20px; margin: 0 0 8px; color: #172b4d; }
    p { color: #42526e; font-size: 14px; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connecting to GitHub…</h1>
    <p>Redirecting you to authorize PM Agent.</p>
    <form id="manifest-form" action="https://github.com/settings/apps/new" method="post">
      <input type="hidden" name="manifest" value="${escapeHtmlAttr(manifest)}" />
    </form>
  </div>
  <script>document.getElementById('manifest-form').submit();</script>
</body>
</html>`;
}
