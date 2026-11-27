// The pages people see while connecting Stockroom to Claude or ChatGPT:
//   /sign-in              sign in, or create an account (then confirm the
//                         email address from the link we send)
//   /accept-invitation    join from an invitation email: someone new only
//                         chooses a password; someone with an account signs
//                         in and accepts or declines
//   /select-organization  pick which organization to connect (only for
//                         people who belong to more than one)
//   /consent              approve the AI app's access
//
// Better Auth redirects here with a signed copy of the OAuth request in the
// query string (`sig`, `ba_param`, …). Each page sends that copy back as
// `oauth_query` with its API call; Better Auth checks the signature and
// answers `{ redirect: true, url }`, which the page follows.
//
// Plain HTML and a little JavaScript, no framework. Every action shows that
// it's working (a spinner on the button, which is disabled until it's done)
// and ends in a clear message. Security:
//   - a strict Content-Security-Policy: only this response's nonce may run
//     scripts or styles, and the page may only call our own origin;
//   - frame-ancestors 'none', so no other site can embed the consent page
//     and trick someone into clicking Approve;
//   - Referrer-Policy: no-referrer, because the query carries OAuth parameters;
//   - every value shown to the user is set with textContent, never as HTML;
//   - forms say method="post", so if a script ever fails the browser can't
//     put a password in the URL.
//
// The scripts below are JavaScript inside TypeScript template strings, where
// a backslash silently disappears. So: no backslashes and no regular
// expressions in them, and no "${" (that would be TypeScript, not the page).
// A test checks that every page's script parses.

/** Helpers every page uses: API calls (with the signed OAuth query), busy buttons, status messages. */
const COMMON_SCRIPT = `
function signedOAuthQuery() {
  var params = new URLSearchParams(window.location.search);
  if (!params.has("sig")) return undefined;
  var names = new Set(params.getAll("ba_param"));
  if (names.size === 0) return undefined;
  var signed = new URLSearchParams();
  params.forEach(function (value, key) {
    if (key === "sig" || key === "ba_param" || names.has(key)) signed.append(key, value);
  });
  return signed.toString();
}
async function post(path, body) {
  var oauthQuery = signedOAuthQuery();
  if (oauthQuery) body.oauth_query = oauthQuery;
  var res;
  try {
    res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error("Can't reach Stockroom. Check your connection and try again.");
  }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.message || "Something went wrong (" + res.status + "). Please try again.");
  return data;
}
/** Shows a button as working: spinner, new label, disabled. Returns a function that puts it back. */
function busy(button, label) {
  var original = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = label;
  return function () {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = original;
  };
}
function setStatus(text, kind) {
  var status = document.getElementById("status");
  status.textContent = text;
  status.className = kind || "";
}
function showError(err) {
  setStatus(err && err.message ? err.message : "Something went wrong. Please try again.", "error");
}
function show(id, visible) {
  document.getElementById(id).hidden = visible === false;
}
/** Follows Better Auth's redirect, if it gave one; returns true if the page is navigating away. */
function follow(data, fallbackText) {
  if (data && data.url) { setStatus("Redirecting…", "info"); window.location.assign(data.url); return true; }
  setStatus(fallbackText, "success");
  return false;
}
/** A same-site path to go to next, or undefined. Anything else (another site, "//x", "javascript:") is ignored. */
function safeNext() {
  var next = new URLSearchParams(window.location.search).get("next") || "";
  if (next.charAt(0) !== "/") return undefined;
  // Let the browser's URL parser decide where it really points, and keep it
  // only if it stays on this site.
  var url = new URL(next, window.location.origin);
  return url.origin === window.location.origin ? url.pathname + url.search + url.hash : undefined;
}`;

const STYLE = `
  :root { color-scheme: light dark; --fg: #1c1c1e; --muted: #6b6b70; --bg: #f6f6f7; --card: #ffffff; --line: #dcdce0; --accent: #2f5fd0; --error: #c0392b; --success: #1e8449; }
  @media (prefers-color-scheme: dark) { :root { --fg: #ececee; --muted: #a0a0a6; --bg: #151517; --card: #1f1f22; --line: #36363b; --accent: #7c9cff; --error: #ff7b6b; --success: #5fd38d; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
  main { width: 100%; max-width: 400px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 28px; }
  h1 { font-size: 1.35rem; margin: 0 0 4px; }
  p { margin: 0 0 20px; color: var(--muted); }
  label { display: block; font-size: .9rem; margin: 12px 0 4px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; font: inherit; }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  input[readonly] { color: var(--muted); }
  .hint { font-size: .8rem; color: var(--muted); margin: 4px 0 0; }
  button { width: 100%; margin-top: 20px; padding: 11px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
  button:disabled { opacity: .7; cursor: default; }
  button.secondary { background: transparent; color: var(--accent); border: 1px solid var(--line); margin-top: 10px; }
  .link { background: none; border: 0; color: var(--accent); padding: 0; margin: 16px 0 0; width: auto; font-weight: 400; }
  .spinner, button[aria-busy="true"]::before { content: ""; width: 16px; height: 16px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; display: inline-block; animation: spin .7s linear infinite; flex: none; }
  .loading { display: flex; align-items: center; gap: 10px; color: var(--muted); margin: 8px 0 20px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner, button[aria-busy="true"]::before { animation-duration: 2s; } }
  #status { min-height: 1.5em; margin: 16px 0 0; font-size: .9rem; color: var(--muted); }
  #status.error { color: var(--error); }
  #status.success { color: var(--success); }
  .box { display: flex; gap: 8px; align-items: center; border: 1px solid var(--line); border-radius: 8px; padding: 8px 8px 8px 12px; margin: 0 0 12px; }
  .box code { flex: 1; word-break: break-all; font-size: .85rem; }
  .box button { width: auto; margin: 0; padding: 6px 12px; font-size: .85rem; }
  dl { margin: 0; } dt { font-size: .85rem; color: var(--muted); margin-top: 12px; } dd { margin: 2px 0 0; word-break: break-all; }
  .choice { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; margin: 8px 0; cursor: pointer; }
  .choice input { width: auto; margin: 0; }
  [hidden] { display: none !important; }`;

function page(title: string, body: string, script: string, nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<main>${body}</main>
<script nonce="${nonce}">${COMMON_SCRIPT}
${script}</script>
</body>
</html>`;
}

const SIGN_IN_BODY = `
<h1 id="heading">Sign in to Stockroom</h1>
<p id="subheading">Connect your Stockroom notes to your AI assistant.</p>
<form id="form" method="post">
  <div id="name-field" hidden>
    <label for="name">Your name</label>
    <input id="name" name="name" autocomplete="name" maxlength="100">
  </div>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" required maxlength="254">
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required minlength="10" maxlength="128">
  <p id="password-hint" class="hint" hidden>At least 10 characters.</p>
  <button id="submit" type="submit">Sign in</button>
</form>
<button id="toggle" class="link" type="button">New to Stockroom? Create an account</button>
<p id="status" role="status" aria-live="polite"></p>`;

const SIGN_IN_SCRIPT = `
var creating = false;
document.getElementById("toggle").addEventListener("click", function () {
  creating = !creating;
  show("name-field", creating);
  show("password-hint", creating);
  document.getElementById("name").required = creating;
  document.getElementById("password").autocomplete = creating ? "new-password" : "current-password";
  document.getElementById("heading").textContent = creating ? "Create your Stockroom account" : "Sign in to Stockroom";
  document.getElementById("submit").textContent = creating ? "Create account" : "Sign in";
  document.getElementById("toggle").textContent = creating ? "Already have an account? Sign in" : "New to Stockroom? Create an account";
  setStatus("");
  document.getElementById(creating ? "name" : "email").focus();
});
document.getElementById("form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var form = new FormData(event.target);
  var body = { email: form.get("email"), password: form.get("password") };
  if (creating) {
    body.name = form.get("name");
    // The confirmation link brings them back to this page, with any
    // connection or invitation still in progress.
    body.callbackURL = window.location.pathname + window.location.search;
  }
  setStatus("");
  var restore = busy(document.getElementById("submit"), creating ? "Creating account…" : "Signing in…");
  try {
    var data = await post(creating ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email", body);
    if (creating && !data.url) {
      show("form", false);
      show("toggle", false);
      document.getElementById("heading").textContent = "Check your email";
      document.getElementById("subheading").textContent = "We sent a link to " + body.email + ". Open it to confirm your address; it signs you in and brings you back here.";
      return;
    }
    var next = !data.url && safeNext();
    if (next) { setStatus("Signed in. Taking you back…", "info"); window.location.assign(next); return; }
    if (!follow(data, "You're signed in. You can close this page.")) restore();
  } catch (err) {
    restore();
    showError(err);
  }
});`;

const CONSENT_BODY = `
<h1>Allow access?</h1>
<p>An AI app wants to use your Stockroom notes for you.</p>
<dl>
  <dt>App</dt><dd id="client"></dd>
  <dt>Sends your access to</dt><dd id="destination"></dd>
  <dt>Access requested</dt><dd id="scopes"></dd>
</dl>
<p id="unverified" class="hint" hidden>This app registered itself, so its name isn't verified. Only allow it if you started connecting it yourself and you recognise the address above.</p>
<button id="allow" type="button">Allow</button>
<button id="deny" class="secondary" type="button">Deny</button>
<p id="status" role="status" aria-live="polite"></p>`;

const CONSENT_SCRIPT = `
var query = new URLSearchParams(window.location.search);
// Who is asking, and where access goes, in forms an attacker can't fake:
// a client_id that is a URL (Client ID Metadata Document, as Claude and
// ChatGPT use) proves the app's domain; a self-registered client gets a
// random ID, so it is marked unverified. The redirect address is where the
// authorization goes, and it must exactly match what the app registered.
function hostOf(value) {
  try { var url = new URL(value); return url.protocol === "https:" ? url.host : ""; } catch (err) { return ""; }
}
var clientId = query.get("client_id") || "";
var clientHost = hostOf(clientId);
document.getElementById("client").textContent = clientHost ? clientHost + " (verified by its address)" : "An app that registered itself";
show("unverified", !clientHost);
document.getElementById("destination").textContent = hostOf(query.get("redirect_uri") || "") || (query.get("redirect_uri") || "Unknown");
document.getElementById("scopes").textContent = (query.get("scope") || "").split(" ").filter(Boolean).join(", ") || "Basic access";
async function decide(accept) {
  var other = document.getElementById(accept ? "deny" : "allow");
  other.disabled = true;
  var restore = busy(document.getElementById(accept ? "allow" : "deny"), accept ? "Allowing…" : "Denying…");
  setStatus("");
  try {
    if (!follow(await post("/api/auth/oauth2/consent", { accept: accept }), accept ? "Access allowed." : "Access denied.")) restore();
  } catch (err) {
    restore();
    other.disabled = false;
    showError(err);
  }
}
document.getElementById("allow").addEventListener("click", function () { decide(true); });
document.getElementById("deny").addEventListener("click", function () { decide(false); });`;

const SELECT_ORGANIZATION_BODY = `
<h1>Choose an organization</h1>
<p>You belong to more than one. Your AI app will work with the notes of the one you choose.</p>
<div id="loading" class="loading"><span class="spinner" aria-hidden="true"></span>Loading your organizations…</div>
<form id="form" method="post" hidden>
  <div id="choices"></div>
  <button id="submit" type="submit">Continue</button>
</form>
<p id="status" role="status" aria-live="polite"></p>`;

const SELECT_ORGANIZATION_SCRIPT = `
async function load() {
  var res = await fetch("/api/auth/organization/list", { credentials: "same-origin" }).catch(function () { return null; });
  show("loading", false);
  if (!res) { setStatus("Can't reach Stockroom. Check your connection and reload the page.", "error"); return; }
  var organizations = res.ok ? await res.json() : [];
  if (!organizations.length) { setStatus("You don't belong to any organization yet.", "error"); return; }
  var choices = document.getElementById("choices");
  organizations.forEach(function (org, index) {
    var label = document.createElement("label");
    label.className = "choice";
    var input = document.createElement("input");
    input.type = "radio"; input.name = "organization"; input.value = org.id; input.checked = index === 0;
    label.appendChild(input);
    label.appendChild(document.createTextNode(org.name));
    choices.appendChild(label);
  });
  show("form");
}
document.getElementById("form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var chosen = new FormData(event.target).get("organization");
  var restore = busy(document.getElementById("submit"), "Continuing…");
  setStatus("");
  try {
    await post("/api/auth/organization/set-active", { organizationId: chosen });
    if (!follow(await post("/api/auth/oauth2/continue", { postLogin: true }), "Organization chosen.")) restore();
  } catch (err) {
    restore();
    showError(err);
  }
});
load().catch(function (err) { show("loading", false); showError(err); });`;

const ACCEPT_INVITATION_BODY = `
<h1 id="heading">You're invited</h1>
<p id="details" hidden></p>
<div id="loading" class="loading"><span class="spinner" aria-hidden="true"></span>Loading your invitation…</div>

<form id="join-form" method="post" hidden>
  <label for="join-email">Email</label>
  <input id="join-email" type="email" autocomplete="username" readonly>
  <label for="join-password">Choose a password</label>
  <input id="join-password" type="password" autocomplete="new-password" required minlength="10" maxlength="128">
  <label for="join-confirm">Confirm password</label>
  <input id="join-confirm" type="password" autocomplete="new-password" required minlength="10" maxlength="128">
  <p class="hint">At least 10 characters.</p>
  <button id="join" type="submit">Join</button>
</form>

<div id="connect" hidden>
  <p>To use Stockroom, add it as a connector in Claude or ChatGPT with this address, then sign in with your email and the password you just chose:</p>
  <div class="box"><code id="mcp-url"></code><button id="copy" type="button" class="secondary">Copy</button></div>
</div>

<button id="accept" type="button" hidden>Accept invitation</button>
<button id="decline" class="secondary" type="button" hidden>Decline</button>
<p id="sign-in" hidden><a id="sign-in-link" href="/sign-in">Sign in</a> with the email address the invitation was sent to, then come back to this link.</p>
<p id="status" role="status" aria-live="polite"></p>`;

const ACCEPT_INVITATION_SCRIPT = `
var invitationId = new URLSearchParams(window.location.search).get("id") || "";
// The link's secret is after "#", which the browser never sends to the
// server. Read it, then remove it from the address bar and history.
var token = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
var thisPage = window.location.pathname + window.location.search;
var roleNames = { admin: "an Admin", member: "a Member" };

function details(text) {
  show("loading", false);
  var el = document.getElementById("details");
  el.textContent = text;
  show("details");
}

// Someone new: the emailed link proved the address, so they only choose a password.
async function loadWithToken() {
  var invitation;
  try {
    invitation = await post("/invitations/preview", { invitationId: invitationId, token: token });
  } catch (err) {
    details(err.message);
    return;
  }
  var who = invitation.inviterName || "A colleague";
  if (invitation.hasAccount) {
    // They already have an account: sign in, then accept here (the ordinary flow).
    details(who + " invited you to join " + invitation.organizationName + ". You already have an account with " + invitation.email + ".");
    document.getElementById("sign-in-link").href = "/sign-in?next=" + encodeURIComponent(thisPage);
    show("sign-in");
    return;
  }
  document.getElementById("heading").textContent = "Join " + invitation.organizationName;
  details(who + " invited you to join " + invitation.organizationName + " on Stockroom as " + (roleNames[invitation.role] || "a member") + ". Choose a password to finish.");
  document.getElementById("join-email").value = invitation.email;
  document.getElementById("join").textContent = "Join " + invitation.organizationName;
  show("join-form");
  document.getElementById("join-password").focus();
}

document.getElementById("join-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  var password = document.getElementById("join-password").value;
  if (password !== document.getElementById("join-confirm").value) {
    setStatus("The two passwords don't match.", "error");
    document.getElementById("join-confirm").focus();
    return;
  }
  setStatus("");
  var restore = busy(document.getElementById("join"), "Creating your account…");
  try {
    var joined = await post("/invitations/join", { invitationId: invitationId, token: token, password: password });
    show("join-form", false);
    document.getElementById("heading").textContent = "Welcome to " + joined.organizationName;
    details("Your account is ready" + (joined.signedIn ? " and you're signed in." : ". Sign in with " + joined.email + " and your new password."));
    document.getElementById("mcp-url").textContent = window.location.origin + "/mcp";
    show("connect");
  } catch (err) {
    restore();
    showError(err);
  }
});

document.getElementById("copy").addEventListener("click", async function () {
  try {
    await navigator.clipboard.writeText(document.getElementById("mcp-url").textContent);
    setStatus("Copied.", "success");
  } catch (err) {
    setStatus("Couldn't copy: select the address and copy it yourself.", "error");
  }
});

// Someone with an account (or an older link without a token): sign in, then accept or decline.
async function loadSignedIn() {
  var res = await fetch("/api/auth/organization/get-invitation?id=" + encodeURIComponent(invitationId), { credentials: "same-origin" }).catch(function () { return null; });
  if (!res) { details("Can't reach Stockroom. Check your connection and reload the page."); return; }
  if (res.status === 401) {
    details("Sign in to see and accept this invitation.");
    document.getElementById("sign-in-link").href = "/sign-in?next=" + encodeURIComponent(thisPage);
    show("sign-in");
    return;
  }
  var invitation = await res.json().catch(function () { return {}; });
  if (!res.ok) { details(invitation.message || "This invitation can't be found, has expired, or is for a different email address."); return; }
  details((invitation.inviterEmail || "Someone") + " invited you to join " + (invitation.organizationName || "an organization") + ".");
  show("accept"); show("decline");
}
async function respond(accept) {
  var other = document.getElementById(accept ? "decline" : "accept");
  other.disabled = true;
  var restore = busy(document.getElementById(accept ? "accept" : "decline"), accept ? "Joining…" : "Declining…");
  setStatus("");
  try {
    await post(accept ? "/api/auth/organization/accept-invitation" : "/api/auth/organization/reject-invitation", { invitationId: invitationId });
    document.getElementById("heading").textContent = accept ? "You've joined" : "Invitation declined";
    details(accept
      ? "You're now a member. Connect Stockroom in Claude or ChatGPT and choose this organization when asked."
      : "You won't be added to the organization.");
    show("accept", false);
    show("decline", false);
  } catch (err) {
    restore();
    other.disabled = false;
    showError(err);
  }
}
document.getElementById("accept").addEventListener("click", function () { respond(true); });
document.getElementById("decline").addEventListener("click", function () { respond(false); });

if (!invitationId) details("This invitation link is incomplete. Open it again from the email.");
else (token ? loadWithToken() : loadSignedIn()).catch(function (err) { details(err.message); });`;

function htmlResponse(html: string, nonce: string): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; ` +
        "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function signInPage(): Response {
  const nonce = newNonce();
  return htmlResponse(page("Sign in · Stockroom", SIGN_IN_BODY, SIGN_IN_SCRIPT, nonce), nonce);
}

export function selectOrganizationPage(): Response {
  const nonce = newNonce();
  return htmlResponse(page("Choose an organization · Stockroom", SELECT_ORGANIZATION_BODY, SELECT_ORGANIZATION_SCRIPT, nonce), nonce);
}

export function acceptInvitationPage(): Response {
  const nonce = newNonce();
  return htmlResponse(page("Invitation · Stockroom", ACCEPT_INVITATION_BODY, ACCEPT_INVITATION_SCRIPT, nonce), nonce);
}

export function consentPage(): Response {
  const nonce = newNonce();
  return htmlResponse(page("Allow access · Stockroom", CONSENT_BODY, CONSENT_SCRIPT, nonce), nonce);
}
