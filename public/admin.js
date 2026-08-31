const $ = selector => document.querySelector(selector);
const LOGIN = "https://digitalisierungsplanung.de/login.html";
const EDITOR = "https://accounts.digitalisierungsplanung.de/state.html";
const ACCOUNTS = "https://accounts.digitalisierungsplanung.de";
let me = { authenticated: false, isAdmin: false };
function loginUrl() { return `${LOGIN}?next=${encodeURIComponent(location.origin + "/admin")}`; }

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

async function json(url, options) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { accept: "application/json", ...(options?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function applySession() {
  const identity = $("#accountIdentity");
  const logout = $("#accountLogout");
  if (me.authenticated) {
    identity.textContent = me.email || "Konto";
    identity.href = EDITOR;
    if (logout) logout.hidden = false;
  } else {
    identity.textContent = "Anmelden";
    identity.href = loginUrl();
    if (logout) logout.hidden = true;
  }
}

async function readAccountsSession() {
  const response = await fetch(`${ACCOUNTS}/api/license/me`, { credentials: "include", headers: { accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.authenticated !== true) return null;
  return {
    authenticated: true,
    isAdmin: body.isAdmin === true,
    email: body.email || "",
    package: body.package || null,
    plan: body.plan || null
  };
}

function showGate(html) {
  const gate = $("#gate");
  gate.hidden = false;
  gate.innerHTML = html;
  $("#publishForm").hidden = true;
  $("#listWrap").hidden = true;
}

async function loadList() {
  const result = await json("/api/admin/packages");
  $("#packageCount").textContent = String(result.total || 0);
  const list = $("#list");
  if (!result.packages?.length) {
    list.innerHTML = '<div class="state-message">Noch keine Presets. JSON oben einfügen und veröffentlichen.</div>';
    return;
  }
  list.innerHTML = result.packages.map(item => `<article class="admin-row" data-id="${escapeHtml(item.id)}">
    <div>
      <strong>${escapeHtml(item.name)}</strong>
      <div class="hint">${escapeHtml(item.id)} · v${escapeHtml(item.version)}</div>
    </div>
    <label><span class="sr-only">Paket</span>
      <select data-plan>
        <option value="trial"${item.plan === "trial" ? " selected" : ""}>Test</option>
        <option value="starter"${item.plan === "starter" ? " selected" : ""}>Starter</option>
        <option value="expert"${item.plan === "expert" ? " selected" : ""}>Team</option>
        <option value="enterprise"${item.plan === "enterprise" ? " selected" : ""}>Unternehmen</option>
      </select>
    </label>
    <span class="chip">${escapeHtml(item.status === "published" ? "Live" : item.status === "pending" ? "Wartend" : "Abgelehnt")}</span>
    <div class="admin-row-actions">
      ${item.status === "published" ? "" : `<button class="btn-primary" type="button" data-publish>Freigeben</button>`}
      ${item.status === "published" ? `<button class="btn-secondary" type="button" data-hide>Zurückziehen</button>` : ""}
      <button class="btn-ghost" type="button" data-remove>Löschen</button>
    </div>
  </article>`).join("");
}

async function patch(id, body) {
  await json(`/api/admin/packages/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  await loadList();
}

$("#list").addEventListener("change", async event => {
  const select = event.target.closest("[data-plan]");
  const row = event.target.closest("[data-id]");
  if (!select || !row) return;
  try { await patch(row.dataset.id, { plan: select.value }); }
  catch { select.closest("article").classList.add("error"); }
});

$("#list").addEventListener("click", async event => {
  const row = event.target.closest("[data-id]");
  if (!row) return;
  try {
    if (event.target.closest("[data-publish]")) await patch(row.dataset.id, { status: "published" });
    else if (event.target.closest("[data-hide]")) await patch(row.dataset.id, { status: "pending" });
    else if (event.target.closest("[data-remove]")) {
      if (!confirm("Preset wirklich löschen?")) return;
      await json(`/api/admin/packages/${encodeURIComponent(row.dataset.id)}`, { method: "DELETE" });
      await loadList();
    }
  } catch (error) {
    $("#publishStatus").textContent = error.body?.error || "Aktion fehlgeschlagen.";
  }
});

$("#publishFile").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  $("#publishJson").value = await file.text();
});

$("#publishForm").addEventListener("submit", async event => {
  event.preventDefault();
  const status = $("#publishStatus");
  const submit = $("#publishSubmit");
  status.textContent = "";
  submit.disabled = true;
  try {
    const pkg = JSON.parse($("#publishJson").value.trim());
    await json("/api/packages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: pkg, plan: $("#publishPlan").value })
    });
    status.textContent = "Veröffentlicht.";
    $("#publishJson").value = "";
    $("#publishFile").value = "";
    await loadList();
  } catch (error) {
    status.textContent = error.body?.error === "invalid_package"
      ? "Paket entspricht nicht dem Contract."
      : error.status === 401 ? "Nur Admins können veröffentlichen." : "Veröffentlichen fehlgeschlagen.";
  } finally {
    submit.disabled = false;
  }
});

try { me = await readAccountsSession() || await json("/api/me"); }
catch { try { me = await json("/api/me"); } catch { me = { authenticated: false, isAdmin: false }; } }
if (!me || me.authenticated !== true) me = { authenticated: false, isAdmin: false };
applySession();
$("#accountLogout")?.addEventListener("click", async () => {
  try { await fetch(`${ACCOUNTS}/logout`, { method: "POST", credentials: "include" }); } catch {}
  location.href = loginUrl();
});

if (!me.authenticated) {
  showGate(`Bitte zuerst <a href="${loginUrl()}">anmelden</a>. Danach kommst du direkt hierher zurück.`);
} else if (!me.isAdmin) {
  showGate(`Angemeldet als <strong>${escapeHtml(me.email)}</strong>.<br>Presets anlegen können nur Admin-Konten. Mit <code>chris.hohlfeld@gmail.com</code> anmelden reicht — das Konto ist Admin.`);
} else {
  $("#gate").hidden = true;
  $("#publishForm").hidden = false;
  $("#listWrap").hidden = false;
  try { await loadList(); }
  catch { $("#list").innerHTML = '<div class="state-message">Katalog konnte nicht geladen werden.</div>'; }
}
