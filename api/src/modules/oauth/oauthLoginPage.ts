// The one screen in this OAuth flow a human actually sees: the browser lands
// here after Claude or ChatGPT redirects to /authorize, and it has to collect
// the app password and hand back an authorization code. This is plain
// server-rendered HTML, not the Next.js app's Ledger design system — pulling
// that design system into the Express API for one login form would be a much
// larger dependency than the form warrants, so this borrows its palette
// (the same dark band, the same moss accent) without being pixel-identical to
// the rest of the product.
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function renderLoginPage(options: {
  clientName: string;
  action: string;
  hidden: Record<string, string | undefined>;
  error?: string;
}): string {
  const hiddenFields = Object.entries(options.hidden)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value as string)}">`)
    .join("\n      ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Ledger</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #15211c;
    color: #eef0e9;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  main { width: 100%; max-width: 22rem; padding: 2rem; }
  p.eyebrow { font-size: 0.8125rem; color: #9daaa1; margin: 0 0 0.375rem; }
  h1 { font-size: 1.75rem; font-weight: 800; margin: 0 0 0.5rem; letter-spacing: -0.01em; }
  p.blurb { font-size: 0.9375rem; color: #9daaa1; margin: 0 0 1.75rem; line-height: 1.5; }
  label { display: block; font-size: 0.8125rem; font-weight: 600; color: #9daaa1; margin-bottom: 0.375rem; }
  input[type="password"] {
    width: 100%;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 1px solid #2c3a33;
    border-radius: 2px;
    color: #eef0e9;
    font-size: 0.9375rem;
  }
  input[type="password"]:focus { outline: 2px solid #0c6c41; outline-offset: 0; border-color: #0c6c41; }
  button {
    width: 100%;
    min-height: 2.75rem;
    margin-top: 1.25rem;
    background: transparent;
    border: 1px solid #9daaa1;
    border-radius: 2px;
    color: #eef0e9;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover { background: rgba(238, 240, 233, 0.12); border-color: #eef0e9; }
  p.error {
    margin: 0.875rem 0 0;
    padding: 0.625rem 0.75rem;
    border: 1px solid #9b3a21;
    background: rgba(155, 58, 33, 0.16);
    border-radius: 2px;
    font-size: 0.8125rem;
  }
</style>
</head>
<body>
  <main>
    <p class="eyebrow">Ledger</p>
    <h1>Sign in</h1>
    <p class="blurb">${escapeHtml(options.clientName)} is asking to read and write your training record.</p>
    <form method="POST" action="${escapeHtml(options.action)}">
      ${hiddenFields}
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" autofocus>
      <button type="submit">Continue</button>
      ${options.error ? `<p class="error">${escapeHtml(options.error)}</p>` : ""}
    </form>
  </main>
</body>
</html>`;
}
