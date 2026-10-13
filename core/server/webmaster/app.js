// The webmaster outbox page. Plain script, no build step: the event
// server serves this file as-is (its CSP forbids inline scripts).
const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const res = await fetch(`/webmaster/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function show(signedIn) {
  $("login").hidden = signedIn;
  $("compose-wrap").hidden = !signedIn;
  $("logout").hidden = !signedIn;
  if (!signedIn) $("password").focus();
}

function setMsg(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = `msg ${kind ?? ""}`;
}

function recipients() {
  return $("to").value.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
}

function updateCount() {
  const n = recipients().length;
  $("count").textContent = n === 0 ? "" : n === 1 ? "1 recipient" : `${n} recipients, sent separately`;
}

function renderSent(list) {
  const tbody = $("sent").querySelector("tbody");
  tbody.replaceChildren();
  for (const e of list) {
    const tr = document.createElement("tr");
    const cells = [
      new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      e.to,
      e.subject,
      e.ok ? "✓ sent" : `✗ ${e.error ?? "failed"}`,
    ];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (i === 3) td.className = e.ok ? "ok" : "bad";
      tr.append(td);
    });
    tbody.append(tr);
  }
  $("sent-empty").hidden = list.length > 0;
}

async function loadSent() {
  const r = await api("sent");
  if (r.status === 401) return show(false);
  if (r.ok) renderSent(r.data.sent ?? []);
}

async function boot() {
  const r = await api("me");
  if (r.ok) {
    $("from").textContent = r.data.from;
    $("replyTo").value = r.data.replyTo;
  }
  show(Boolean(r.data.signedIn));
  if (r.data.signedIn) await loadSent();
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("login-msg", "");
  const r = await api("login", { password: $("password").value });
  if (!r.ok) return setMsg("login-msg", r.data.error ?? "Could not sign in.", "bad");
  $("password").value = "";
  show(true);
  await loadSent();
  $("to").focus();
});

$("logout").addEventListener("click", async () => {
  await api("logout", {});
  show(false);
});

$("to").addEventListener("input", updateCount);

$("compose").addEventListener("submit", async (e) => {
  e.preventDefault();
  const n = recipients().length;
  if (!window.confirm(`Send "${$("subject").value}" to ${n} ${n === 1 ? "person" : "people"}?`)) return;
  $("send").disabled = true;
  setMsg("send-msg", "Sending…");
  try {
    const r = await api("send", {
      to: $("to").value,
      replyTo: $("replyTo").value,
      subject: $("subject").value,
      body: $("body").value,
    });
    if (r.status === 401) return show(false);
    if (!r.ok) return setMsg("send-msg", r.data.error ?? "Sending failed.", "bad");
    const failed = r.data.results.filter((x) => !x.ok);
    if (failed.length === 0) {
      setMsg("send-msg", `Sent to ${r.data.results.length}.`, "ok");
      $("to").value = "";
      updateCount();
    } else {
      setMsg("send-msg", `${r.data.results.length - failed.length} sent, ${failed.length} failed: ${failed.map((x) => `${x.to} (${x.error})`).join("; ")}`, "bad");
      $("to").value = failed.map((x) => x.to).join(", ");
      updateCount();
    }
    await loadSent();
  } finally {
    $("send").disabled = false;
  }
});

void boot();
