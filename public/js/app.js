// app.js — Explore Accelerator · SAP S/4HANA Cloud PE
"use strict";

// ── Utility ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── API helpers ───────────────────────────────────────────────────────────────
const api = {
  get:    url       => fetch(url).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.detail || d.error || `HTTP ${r.status}`); return d; }),
  post:   (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async r => { const d = await r.json(); if (!r.ok) return { ok: false, error: d.detail || d.error || `HTTP ${r.status}` }; return d; }),
  delete: url       => fetch(url, { method: "DELETE" }).then(r => r.json()),
};

// ── Router ────────────────────────────────────────────────────────────────────
const routes = {
  home:               pagHome,
  "bdcq-agent":       pagBDCQ,
  "f2s-deck":         pagF2SDeck,
  "kdd-generator":    pagKDD,
  "bpd-agent":        pagBPD,
  catalog:            pagCatalog,
  reference:          pagReference,
  output:             pagOutput,
  editor:             pagEditor,
  "gap-analysis":     pagGapAnalysis,
  "decision-library": pagDecisionLibrary,
  "mcp-server":       pagMCPServer,
  settings:           pagSettings,
};

function getPage() {
  return location.hash.replace("#", "") || "home";
}

function navigate(page) {
  location.hash = page;
}

async function render() {
  const page = getPage();
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.page === page);
  });
  const fn = routes[page] || pagHome;
  const el = document.getElementById("app");
  el.innerHTML = `<div class="loader"><div class="spinner"></div> Loading…</div>`;
  try {
    el.innerHTML = await fn();
    bindPage(page);
  } catch (e) {
    el.innerHTML = `<div class="alert alert-danger">⚠️ ${escHtml(e.message)}</div>`;
  }
}

// Restore last session ID from localStorage so editor works after page refresh
window._lastKddSessionId = localStorage.getItem("kddSessionId") || null;

window.addEventListener("hashchange", render);
document.addEventListener("DOMContentLoaded", render);

// ── Bind page-specific logic ──────────────────────────────────────────────────
function bindPage(page) {
  if (page === "bdcq-agent")       bindBDCQ();
  if (page === "f2s-deck")         bindF2SDeck();
  if (page === "kdd-generator")    bindKDD();
  if (page === "bpd-agent")        bindBPD();
  if (page === "catalog")          bindCatalog();
  if (page === "settings")         bindSettings();
  if (page === "output")           bindOutput();
  if (page === "editor")           bindEditor();
  if (page === "gap-analysis")     bindGapAnalysis();
  if (page === "decision-library") bindDecisionLibrary();
  if (page === "mcp-server")       bindMCPServer();
}

// ── Module short-code → full LOB name (global, used by editor + KDD Analysis) ──
const MODULE_NAMES = {
  FIN:"Finance", SD:"Sales", MM:"Sourcing and Procurement",
  PP:"Manufacturing", PM:"Asset Management", HCM:"Human Resources",
  SCM:"Supply Chain", CS:"Service", SM:"Service",
  IT:"IT Management", RE:"R&D and Engineering",
  PS:"Professional Services", LE:"Logistics",
  DM:"Data Management",
  CO:"Finance", TR:"Finance",   // Controlling / Treasury roll into Finance
  QM:"Manufacturing", WM:"Supply Chain", EWM:"Supply Chain",
  TM:"Supply Chain", IM:"Supply Chain",
  Cross:"Cross-Module", "Cross-Module":"Cross-Module"
};
// r.l1 is set by the generator (full name); fall back to the map, then raw value
const modName = r => (r && r.l1) || MODULE_NAMES[r && r.module] || (r && r.module) || "—";

// ── HOME page ─────────────────────────────────────────────────────────────────
async function pagHome() {
  const [s, lib] = await Promise.all([
    api.get("/api/status"),
    api.get("/api/decisions/summary").catch(() => ({ total: 0, scopeItems: 0, projects: 0, byFitGap: { Fit: 0, "Partial Fit": 0, Gap: 0 } }))
  ]);

  const outdatedAlert = s.catalogOutdated
    ? `<div class="alert alert-warning">⚠️ Catalog is version <strong>${s.catalogVersion}</strong> — expected <strong>${s.expectedRelease}</strong>. Update via the Chrome extension.</div>`
    : "";
  const cacheAlert = !s.cacheReady
    ? `<div class="alert alert-warning">⚠️ KDD cache not built yet. <a href="#settings" style="color:var(--accent);font-weight:600">Build it in Settings →</a> (takes ~2 seconds)</div>`
    : "";

  const libNote = lib.total > 0
    ? `${lib.scopeItems} scope items · ${lib.projects} project${lib.projects !== 1 ? "s" : ""}`
    : "No decisions saved yet";

  return `
    <div class="page-header">
      <div class="page-title">Home</div>
      <div class="page-sub">SAP S/4HANA Cloud Public Edition · Explore Phase</div>
    </div>

    ${outdatedAlert}
    ${cacheAlert}

    <div class="stats-grid">
      <div class="card">
        <div class="card-title">Catalog Version</div>
        <div class="card-value">${s.catalogVersion}</div>
        <div class="card-note">${s.catalogOutdated ? "⚠️ Update available" : "✅ Up to date"}</div>
      </div>
      <div class="card">
        <div class="card-title">Scope Items</div>
        <div class="card-value">${s.totalProcesses.toLocaleString()}</div>
        <div class="card-note">SAP processes in catalog</div>
      </div>

      <div class="card" style="cursor:pointer" onclick="navigate('decision-library')">
        <div class="card-title">📚 Decision Library</div>
        <div class="card-value">${lib.total.toLocaleString()}</div>
        <div class="card-note">${libNote}</div>
      </div>
    </div>

    <div class="section-divider">Quick Actions</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="navigate('kdd-generator')">◈ Generate KDD Log</button>
      <button class="btn btn-outline" onclick="navigate('catalog')">⊞ Browse Scope Catalog</button>
      <button class="btn btn-outline" onclick="navigate('decision-library')">📚 Decision Library</button>
      <button class="btn btn-outline" onclick="navigate('output')">↓ View Output Files</button>
    </div>

    <div class="section-divider" style="margin-top:28px">Explore Phase Skills</div>
    <div class="agent-list">
      ${agentCard(1,"BDCQ Enricher","Enriches BDCQ questions with country statutory requirements (GST, VAT, e-invoicing, withholding tax), industry-specific context, and Cloud PE constraint flags. Pre-answers mandatory compliance items and generates precise workshop prompts.","Active","Explore","navigate('bdcq-agent')")}
      ${agentCard(2,"F2S Deck Generator","Generates a rich Fit-to-Standard workshop PowerPoint deck from scope catalog descriptions, BDCQ questions (L1/L2/L3 with Topic context), KDD cache decisions, and per-scope Claude intelligence briefs — process flow, gap watchpoints, Fiori config areas.","Active","F2S Workshop","navigate('f2s-deck')")}
      ${agentCard(3,"KDD Generator","4-stage AI pipeline per scope item: past decisions overlay → SAP context parsing → 3-call Claude generation (15 questions across 10 coverage areas) → Cloud PE validation with auto-fix. Exports a 5-sheet Excel with RICEF classification.","Active","SAP Activate","navigate('kdd-generator')")}
      ${agentCard(4,"BPD Agent","7-phase AI pipeline: L2–L5 process hierarchy generation → BPMN swimlane SVG diagrams → E2E narrative → Fit-to-Standard table → Next Steps → As-Is/To-Be gap analysis. Clean Core, SAP Fiori apps, Business Configuration paths.","Active","BPD","navigate('bpd-agent')")}
    </div>`;
}

function skillCard(icon, id, name, desc, status, tag, iconSize) {
  const isActive = status === "Active";
  const statusClass = isActive ? "badge-green" : "badge-gray";
  const dimClass   = isActive ? "" : " skill-card--dimmed";
  return `
    <div class="skill-card${dimClass}">
      <div class="skill-card-header">
        <div class="skill-card-icon" style="font-size:${iconSize}">${icon}</div>
        <div class="skill-card-name">${name}</div>
      </div>
      <div class="skill-card-desc">${desc}</div>
      <div class="skill-card-footer">
        <span class="badge ${statusClass}">${status}</span>
        <span class="badge badge-purple">${tag}</span>
        <span class="text-sm text-muted" style="margin-left:auto">${id}</span>
      </div>
    </div>`;
}

// ── Vertical agent card (home page & skills page) ─────────────────────────────
function agentCard(step, name, desc, status, tag, onclick) {
  const isActive = status === "Active";
  const dimClass = isActive ? "" : " agent-card--dimmed";
  const statusClass = isActive ? "badge-green" : "badge-gray";
  const action = isActive && onclick
    ? `<button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="${onclick}">Open →</button>`
    : `<span class="badge badge-gray" style="font-size:11px">Coming Soon</span>`;
  return `
    <div class="agent-card${dimClass}">
      <div class="agent-num">${step}</div>
      <div class="agent-card-body">
        <div class="agent-card-name">${name}</div>
        <div class="agent-card-desc">${desc}</div>
        <div class="agent-card-meta">
          <span class="badge ${statusClass}">${status}</span>
          <span class="badge badge-purple">${tag}</span>
        </div>
      </div>
      <div class="agent-card-action">${action}</div>
    </div>`;
}

// ── FIT-TO-STANDARD DECK page ─────────────────────────────────────────────────
async function pagF2SDeck() {
  let lobs = [];
  try { lobs = await api.get("/api/catalog/lobs"); } catch (_) {}
  const lobOptions = lobs.map(l =>
    `<option value="${escHtml(l.name)}">${escHtml(l.name)} (${l.count})</option>`
  ).join("");

  const today = new Date();
  const defaultDate = today.toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" });

  return `
    <!-- Accenture purple header bar -->
    <div style="background:linear-gradient(135deg,#460073 0%,#A100FF 100%);
                border-radius:10px;padding:24px 28px;margin-bottom:22px;
                display:flex;align-items:center;gap:18px">
      <div style="font-size:48px;font-weight:900;color:#A100FF;line-height:1;
                  text-shadow:0 0 20px rgba(161,0,255,0.5)">&gt;</div>
      <div>
        <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.3px">
          F2S Deck Generator</div>
        <div style="color:#E0C8FF;font-size:13px;margin-top:3px">
          Accenture · SAP S/4HANA Cloud Public Edition · Explore Phase</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="color:#E0C8FF;font-size:11px">Enriched with</div>
        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;justify-content:flex-end">
          <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">📖 Catalog</span>
          <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">📋 BDCQ</span>
          <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">◈ KDD Cache</span>
          <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">✦ Claude AI</span>
        </div>
      </div>
    </div>

    <div id="f2s-cache-warn"></div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">

      <!-- LEFT: Workshop Details -->
      <div class="card" style="padding:20px">
        <div class="section-divider" style="margin-top:0;color:#A100FF;border-color:#A100FF">
          Workshop Details
        </div>
        <div style="display:flex;flex-direction:column;gap:11px">
          <div>
            <label class="form-label">Workshop Title</label>
            <input id="f2s-title" class="form-input"
                   placeholder="e.g. Fit-to-Standard Workshop — Finance"
                   value="Fit-to-Standard Workshop" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="form-label">Client Name <span style="color:#A100FF">*</span></label>
              <input id="f2s-client" class="form-input" placeholder="e.g. Acme Corp" />
            </div>
            <div>
              <label class="form-label">SAP Release</label>
              <input id="f2s-release-display" class="form-input" value="Loading…" disabled style="background:#f5f5f5;color:#888;cursor:not-allowed" />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="form-label">Facilitator (Accenture)</label>
              <input id="f2s-facilitator" class="form-input" placeholder="e.g. Jane Smith" />
            </div>
            <div>
              <label class="form-label">Customer Process Owner</label>
              <input id="f2s-owner" class="form-input" placeholder="e.g. John Doe" />
            </div>
          </div>
          <div>
            <label class="form-label">Client Countries <span style="color:var(--muted);font-weight:400;font-size:11px">(optional — shown on cover, filters locale BDCQ questions)</span></label>
            <div id="f2s-country-wrap" style="position:relative;user-select:none">
              <div id="f2s-country-trigger" class="form-input"
                   style="cursor:pointer;min-height:36px;display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:4px 30px 4px 8px;position:relative"
                   onclick="f2sCountryToggle(event)">
                <span id="f2s-country-pills"><span style="color:var(--muted,#999);font-size:13px">Select countries…</span></span>
                <span style="position:absolute;right:8px;top:50%;transform:translateY(-50%);color:var(--muted,#999);pointer-events:none;font-size:11px">&#9660;</span>
              </div>
              <div id="f2s-country-panel" style="display:none;position:absolute;z-index:999;top:calc(100% + 2px);left:0;right:0;
                   background:var(--surface,#fff);border:1px solid var(--border,#ddd);border-radius:6px;
                   box-shadow:0 6px 16px rgba(0,0,0,.18);overflow:hidden">
                <div style="padding:6px 6px 2px">
                  <input id="f2s-country-search" class="form-input"
                         style="font-size:12px;padding:5px 8px;width:100%;box-sizing:border-box"
                         placeholder="Search countries…"
                         oninput="f2sCountryFilter(this.value)"
                         onclick="event.stopPropagation()" />
                </div>
                <div id="f2s-country-list" style="max-height:220px;overflow-y:auto;padding:2px 4px 6px"></div>
              </div>
            </div>
          </div>
          <div>
            <label class="form-label">Workshop Date</label>
            <input id="f2s-date" class="form-input" value="${escHtml(defaultDate)}" />
          </div>
          <div>
            <label class="form-label">Brand Colour</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input id="f2s-color-text" class="form-input" value="#A100FF" style="flex:1;font-family:monospace"
                     oninput="document.getElementById('f2s-color-pick').value=this.value" />
              <input id="f2s-color-pick" type="color" value="#A100FF"
                     style="width:42px;height:36px;border:1px solid var(--border);border-radius:6px;cursor:pointer;padding:2px"
                     oninput="document.getElementById('f2s-color-text').value=this.value" />
              <button class="btn btn-outline" style="font-size:11px;padding:6px 10px;white-space:nowrap"
                      onclick="document.getElementById('f2s-color-text').value='#A100FF';document.getElementById('f2s-color-pick').value='#A100FF'">
                ↺ Accenture
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: Scope Picker -->
      <div class="card" style="padding:20px">
        <div class="section-divider" style="margin-top:0;color:#A100FF;border-color:#A100FF">
          Scope Items
        </div>

        <!-- Text input + preview trigger -->
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <input id="f2s-scope-input" class="form-input"
                 placeholder="Paste scope IDs: BD6, J59, BEI …"
                 style="flex:1;font-family:monospace;font-size:13px"
                 oninput="f2sSyncChips()" />
          <button class="btn btn-outline" style="white-space:nowrap;font-size:12px"
                  onclick="f2sPreview()">⟳ Preview</button>
        </div>

        <!-- Selected chips -->
        <div id="f2s-chips" style="display:flex;flex-wrap:wrap;gap:6px;min-height:28px;margin-bottom:10px"></div>

        <!-- LOB browse -->
        <select id="f2s-lob-filter" class="form-input" style="margin-bottom:8px"
                onchange="f2sFilterLOB(this.value)">
          <option value="">— Browse by Line of Business —</option>
          ${lobOptions}
        </select>
        <div id="f2s-lob-items"
             style="max-height:220px;overflow-y:auto;border:1px solid var(--border);
                    border-radius:6px;padding:4px"></div>

        <div style="font-size:11px;color:var(--muted);margin-top:8px">
          Type IDs above, click "+ Add" from the list, or paste a comma-separated list.
          Hit <kbd style="background:var(--bg-hover);padding:1px 5px;border-radius:3px">⟳ Preview</kbd> to check coverage before generating.
        </div>
      </div>
    </div>

    <!-- Data preview table (filled by f2sPreview()) -->
    <div id="f2s-preview"></div>

    <div style="display:flex;gap:12px;justify-content:center;margin:18px 0 10px">
      <button class="btn btn-primary btn-generate" onclick="f2sGenerate()">
        &gt;&nbsp;&nbsp;Generate F2S Workshop Deck
      </button>
    </div>

    <div id="f2s-result"></div>`;
}

function bindF2SDeck() {

  // ── Fetch current SAP release from server (computed from today's date) ───────
  let _currentRelease = "";
  (async () => {
    try {
      const r = await api.get("/api/f2s/current-release");
      _currentRelease = r.code;
      const el = document.getElementById("f2s-release-display");
      if (el) el.value = `${r.code} (${r.label})`;
    } catch (_) {
      const el = document.getElementById("f2s-release-display");
      if (el) el.value = "See SAP release notes";
    }
  })();

  // ── Check KDD cache status ──────────────────────────────────────────────────
  (async () => {
    try {
      const s = await api.get("/api/status");
      const el = document.getElementById("f2s-cache-warn");
      if (el && !s.cacheReady) {
        el.innerHTML = `
          <div class="alert alert-warning" style="margin-bottom:14px">
            ⚠️ <strong>KDD cache not built.</strong>
            Deck will still generate using the catalog and BDCQ — but the
            "Design Decisions" reference slides require the cache.
            <a href="#settings" style="color:var(--accent);font-weight:600;margin-left:8px">
              Build cache in Settings →</a>
          </div>`;
      }
    } catch (_) {}
  })();

  // ── Chip management ─────────────────────────────────────────────────────────
  function getScopeIds() {
    const raw = (document.getElementById("f2s-scope-input") || {}).value || "";
    return [...new Set(raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean))];
  }

  function renderChips() {
    const ids = getScopeIds();
    const el  = document.getElementById("f2s-chips");
    if (!el) return;
    const res = document.getElementById("f2s-result");
    if (res && res.querySelector(".alert-warning")) res.innerHTML = "";
    const prev = document.getElementById("f2s-preview");
    if (prev && ids.length && prev.querySelector(".alert-warning")) prev.innerHTML = "";
    el.innerHTML = ids.map(id => `
      <span style="display:inline-flex;align-items:center;gap:5px;background:#F0E6FF;
                   color:#460073;border:1px solid #D9BAFF;border-radius:20px;
                   padding:3px 12px 3px 10px;font-size:12px;font-weight:600">
        ${escHtml(id)}
        <span style="cursor:pointer;color:#A100FF;font-size:14px;line-height:1"
              onclick="f2sRemoveScope('${escHtml(id)}')">&times;</span>
      </span>`).join("");
  }

  window.f2sSyncChips = () => renderChips();

  window.f2sRemoveScope = (id) => {
    const inp = document.getElementById("f2s-scope-input");
    const ids = getScopeIds().filter(x => x !== id);
    inp.value = ids.join(", ");
    renderChips();
    document.getElementById("f2s-preview").innerHTML = "";
  };

  // ── LOB browser ─────────────────────────────────────────────────────────────
  window.f2sFilterLOB = async (lob) => {
    const el = document.getElementById("f2s-lob-items");
    if (!lob) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="loader" style="padding:8px"><div class="spinner"></div></div>`;
    try {
      const items = await api.get(`/api/catalog/lob/${encodeURIComponent(lob)}`);
      if (!items.length) {
        el.innerHTML = `<div style="padding:8px;color:var(--muted);font-size:12px">No items</div>`;
        return;
      }
      el.innerHTML = items.map(i => `
        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:5px 8px;border-radius:4px;font-size:12px;cursor:pointer"
             onmouseenter="this.style.background='#F0E6FF'"
             onmouseleave="this.style.background=''">
          <span>
            <strong style="color:#A100FF">${escHtml(i.id)}</strong>
            — ${escHtml(i.name)}
          </span>
          <button class="btn btn-outline"
                  style="font-size:10px;padding:2px 8px;height:24px;border-color:#A100FF;color:#A100FF"
                  onclick="f2sAddScope('${escHtml(i.id)}')">+ Add</button>
        </div>`).join("");
    } catch (e) {
      el.innerHTML = `<div style="padding:8px;color:var(--error);font-size:12px">${escHtml(e.message)}</div>`;
    }
  };

  window.f2sAddScope = (id) => {
    const inp = document.getElementById("f2s-scope-input");
    const ids = getScopeIds();
    if (!ids.includes(id.toUpperCase())) {
      inp.value = [...ids, id.toUpperCase()].join(", ");
      renderChips();
    }
  };

  // ── Data preview table ───────────────────────────────────────────────────────
  window.f2sPreview = async () => {
    const scopeIds = getScopeIds();
    const el = document.getElementById("f2s-preview");
    if (!scopeIds.length) {
      el.innerHTML = `<div class="alert alert-warning" style="margin-bottom:14px">
        ⚠️ Enter at least one scope ID first.</div>`;
      return;
    }
    el.innerHTML = `<div class="loader" style="padding:12px"><div class="spinner"></div> Checking coverage…</div>`;
    try {
      const r = await api.post("/api/f2s/preview", { scopeIds });
      if (!r.ok) { el.innerHTML = ""; return; }

      const rows = r.scopes.map(s => {
        const notFound = !s.inCatalog;
        const color    = notFound ? "color:#C0392B" : "";
        const bdcqBadge = s.bdcq.total > 0
          ? `<span style="color:#1E7B4D;font-weight:600">${s.bdcq.l1}L1 · ${s.bdcq.l2}L2 · ${s.bdcq.l3}L3</span>`
          : `<span style="color:var(--muted)">—</span>`;
        const kddBadge = s.kddCached > 0
          ? `<span style="background:#F0E6FF;color:#460073;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600">${s.kddCached} KDDs cached</span>`
          : `<span style="color:var(--muted);font-size:11px">no cache</span>`;
        return `
          <tr style="${notFound ? 'background:#FFF5F5' : ''}">
            <td><strong style="color:#A100FF">${escHtml(s.id)}</strong></td>
            <td style="${color}">${escHtml(s.name || "Not found in catalog")}</td>
            <td>${escHtml(s.lob)}</td>
            <td style="text-align:center">${bdcqBadge}</td>
            <td style="text-align:center">${kddBadge}</td>
            <td style="text-align:center">
              ${notFound
                ? '<span style="color:#C0392B;font-weight:600">✗ Missing</span>'
                : '<span style="color:#1E7B4D;font-weight:600">✓</span>'}
            </td>
          </tr>`;
      }).join("");

      const missing = r.scopes.filter(s => !s.inCatalog).length;
      const warn = missing ? `
        <div style="margin-bottom:8px;padding:8px 12px;background:#FFF5F5;
                    border:1px solid #FFCDD2;border-radius:6px;font-size:12px;color:#C0392B">
          ⚠️  ${missing} scope ID${missing > 1 ? "s" : ""} not found in catalog — will be skipped.
        </div>` : "";

      el.innerHTML = `
        ${warn}
        <div class="card" style="padding:0;overflow:hidden;margin-bottom:18px">
          <div style="background:#460073;color:#fff;padding:9px 16px;font-size:13px;font-weight:600">
            ◧ Scope Coverage Preview — ${r.scopes.length} item${r.scopes.length !== 1 ? "s" : ""}
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Name</th><th>LOB</th>
                  <th style="text-align:center">BDCQ Questions</th>
                  <th style="text-align:center">KDD Cache</th>
                  <th style="text-align:center">In Catalog</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    } catch (e) {
      el.innerHTML = `<div class="alert alert-warning">Preview failed: ${escHtml(e.message)}</div>`;  // already escaped
    }
  };

  // ── Country multi-select ──────────────────────────────────────────────────────
  const _F2S_COUNTRY_LIST = [
    "Argentina","Australia","Austria","Brazil","Canada","China","Denmark",
    "Finland","France","Germany","India","Italy","Japan","Mexico",
    "Netherlands","New Zealand","Norway","Poland","Singapore","South Africa",
    "South Korea","Spain","Sweden","Switzerland","United Kingdom","United States"
  ];
  let _f2sCountrySel  = new Set();
  let _f2sCountryOpen = false;

  window.f2sCountryToggle = function(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById("f2s-country-panel");
    if (!panel) return;
    _f2sCountryOpen = !_f2sCountryOpen;
    panel.style.display = _f2sCountryOpen ? "block" : "none";
    if (_f2sCountryOpen) {
      _f2sCountryRender("");
      setTimeout(() => document.getElementById("f2s-country-search")?.focus(), 50);
    }
  };

  window.f2sCountryFilter = function(q) { _f2sCountryRender(q); };

  function _f2sCountryRender(q) {
    const lower    = (q || "").toLowerCase();
    const filtered = _F2S_COUNTRY_LIST.filter(c => !lower || c.toLowerCase().includes(lower));
    const list     = document.getElementById("f2s-country-list");
    if (!list) return;
    list.innerHTML = filtered.map(c => {
      const chk = _f2sCountrySel.has(c) ? "checked" : "";
      const esc = c.replace(/'/g, "\\'");
      return `<label style="display:flex;align-items:center;gap:7px;padding:5px 8px;cursor:pointer;border-radius:4px;font-size:12px"
                     onmouseover="this.style.background='var(--hover,#f5f5f5)'" onmouseout="this.style.background=''">
        <input type="checkbox" value="${c}" ${chk} onchange="f2sCountryCheck('${esc}',this.checked)"
               onclick="event.stopPropagation()" style="accent-color:var(--accent,#A100FF)" />${c}
      </label>`;
    }).join("");
  }

  window.f2sCountryCheck = function(country, checked) {
    if (checked) _f2sCountrySel.add(country);
    else         _f2sCountrySel.delete(country);
    _f2sCountryUpdatePills();
    _f2sCountryRender(document.getElementById("f2s-country-search")?.value || "");
  };

  function _f2sCountryUpdatePills() {
    const pills = document.getElementById("f2s-country-pills");
    if (!pills) return;
    if (_f2sCountrySel.size === 0) {
      pills.innerHTML = '<span style="color:var(--muted,#999);font-size:13px">Select countries…</span>';
    } else {
      pills.innerHTML = [..._f2sCountrySel].map(c => {
        const esc = c.replace(/'/g, "\\'");
        return `<span style="background:var(--accent,#A100FF);color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;display:inline-flex;align-items:center;gap:3px">
          ${c}<span onclick="event.stopPropagation();f2sCountryCheck('${esc}',false)"
                    style="cursor:pointer;margin-left:2px;opacity:.8;font-size:14px;line-height:1">&times;</span>
        </span>`;
      }).join("");
    }
  }

  document.addEventListener("click", function(e) {
    if (!_f2sCountryOpen) return;
    const wrap = document.getElementById("f2s-country-wrap");
    if (wrap && !wrap.contains(e.target)) {
      _f2sCountryOpen = false;
      const panel = document.getElementById("f2s-country-panel");
      if (panel) panel.style.display = "none";
    }
  });

  // ── Generate ─────────────────────────────────────────────────────────────────
  window.f2sGenerate = async () => {
    const resultEl = document.getElementById("f2s-result");
    const title       = document.getElementById("f2s-title").value.trim();
    const client      = document.getElementById("f2s-client").value.trim();
    const facilitator = document.getElementById("f2s-facilitator").value.trim();
    const owner       = document.getElementById("f2s-owner").value.trim();
    const wsDate      = document.getElementById("f2s-date").value.trim();
    const countries   = [..._f2sCountrySel];
    const release     = _currentRelease;
    const color       = document.getElementById("f2s-color-text").value.trim() || "#A100FF";
    const scopeIds    = getScopeIds();

    if (!scopeIds.length) {
      resultEl.innerHTML = `<div class="alert alert-warning">⚠️ Enter at least one scope ID.</div>`;
      return;
    }
    if (!client) {
      resultEl.innerHTML = `<div class="alert alert-warning">⚠️ Client name is required.</div>`;
      return;
    }

    // Scroll to result and show live timer
    resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
    const _genStart = Date.now();
    let _timerInterval = setInterval(() => {
      const sec = ((Date.now() - _genStart) / 1000).toFixed(1);
      const timerEl = document.getElementById("f2s-gen-timer");
      if (timerEl) timerEl.textContent = `${sec}s`;
    }, 100);

    resultEl.innerHTML = `
      <div class="alert alert-info" style="display:flex;align-items:center;gap:12px;padding:16px 20px">
        <div class="spinner"></div>
        <div>
          <div style="font-weight:600">Building F2S workshop deck…</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">
            ${scopeIds.length} scope item${scopeIds.length !== 1 ? "s" : ""}
            · Claude generating per-scope intelligence
            · est. ${scopeIds.length <= 1 ? "2–4 min" : `${scopeIds.length * 2}–${scopeIds.length * 3} min`}
          </div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">
            ⏱ <span id="f2s-gen-timer">0.0s</span>
          </div>
        </div>
      </div>`;

    try {
      const payload = {
        workshopTitle: title, clientName: client, facilitator,
        workshopDate: wsDate, brandColor: color,
        customerProcessOwner: owner, countries, release, scopeIds,
      };
      const r = await api.post("/api/f2s/generate-deck", payload);

      clearInterval(_timerInterval);
      const wallSec = ((Date.now() - _genStart) / 1000).toFixed(1);

      if (r.ok) {
        const omHtml = r.omissions && r.omissions.length
          ? `<details style="margin-top:10px;font-size:12px">
               <summary style="cursor:pointer;color:#E0C8FF">
                 ${r.omissions.length} omission${r.omissions.length !== 1 ? "s" : ""}</summary>
               <ul style="margin:6px 0 0 16px;color:#E0C8FF">
                 ${r.omissions.map(o => `<li>${escHtml(o)}</li>`).join("")}
               </ul>
             </details>`
          : '<div style="font-size:12px;color:#B8FFD8;margin-top:6px">✓ No omissions — full coverage</div>';

        const tokTotal = r.tokensEstimated || 0;
        const tokIn    = r.tokensPrompt    || 0;
        const tokOut   = r.tokensCompletion || 0;
        const tokHtml  = tokTotal > 0
          ? `<div style="margin-top:10px;font-size:11px;color:#C8A8FF;
                         background:rgba(255,255,255,0.08);border-radius:6px;
                         padding:8px 12px;display:inline-flex;gap:18px">
               <span>⏱ ${r.elapsedSeconds ?? wallSec}s</span>
               <span>🧮 ~${tokTotal.toLocaleString()} tokens (est.)</span>
               <span style="opacity:.75">${tokIn.toLocaleString()} in · ${tokOut.toLocaleString()} out</span>
             </div>`
          : `<div style="margin-top:8px;font-size:11px;color:#C8A8FF">⏱ ${r.elapsedSeconds ?? wallSec}s</div>`;

        resultEl.innerHTML = `
          <div style="background:linear-gradient(135deg,#460073,#A100FF);
                      border-radius:10px;padding:22px 26px;color:#fff">
            <div style="font-size:18px;font-weight:700;margin-bottom:4px">
              &gt; Workshop Deck Ready
            </div>
            <div style="color:#E0C8FF;font-size:13px;margin-bottom:14px">
              ${r.slideCount} slides  ·  ${scopeIds.length} scope item${scopeIds.length !== 1 ? "s" : ""}
              ·  Accenture S/4HANA Cloud PE theme
            </div>
            <a href="${r.downloadUrl}" download
               style="display:inline-block;background:#fff;color:#460073;
                      font-weight:700;font-size:14px;padding:10px 24px;
                      border-radius:6px;text-decoration:none">
              ↓  Download ${escHtml(r.filename)}
            </a>
            ${tokHtml}
            ${omHtml}
          </div>`;
      } else {
        resultEl.innerHTML = `<div class="alert alert-warning">⚠️ ${escHtml(r.error || "Unknown error")}</div>`;
      }
    } catch (err) {
      clearInterval(_timerInterval);
      resultEl.innerHTML = `<div class="alert alert-warning">⚠️ ${escHtml(err.message)}</div>`;
    }
  };

}

// ── CATALOG page ──────────────────────────────────────────────────────────────
async function pagCatalog() {
  const lobs = await api.get("/api/catalog/lobs");
  const lobList = lobs.map(l =>
    `<button class="lob-btn" data-lob="${l.name}" onclick="selectLOB('${encodeURIComponent(l.name)}')">
      ${l.name}
      <span class="lob-count">${l.count} items</span>
    </button>`
  ).join("");

  return `
    <div class="page-header">
      <div class="page-title">Scope Catalog</div>
      <div class="page-sub">Browse ${lobs.reduce((s,l)=>s+l.count,0)} SAP processes · version from status</div>
    </div>

    <div class="search-wrap">
      <span class="search-icon">⌕</span>
      <input id="cat-search" class="form-input" placeholder="Search by scope item ID or name (e.g. BD6 or Accounts)…" oninput="doCatSearch(this.value)" />
    </div>

    <div id="search-results"></div>

    <div class="section-divider">Browse by Line of Business</div>
    <div class="lob-grid" id="lob-grid">${lobList}</div>

    <div id="lob-items"></div>`;
}

function bindCatalog() {
  window.selectLOB = async (lobEnc) => {
    const lob = decodeURIComponent(lobEnc);
    document.querySelectorAll(".lob-btn").forEach(b => b.classList.toggle("selected", b.dataset.lob === lob));
    const el  = document.getElementById("lob-items");
    el.innerHTML = `<div class="loader"><div class="spinner"></div> Loading ${escHtml(lob)}…</div>`;
    const items = await api.get(`/api/catalog/lob/${encodeURIComponent(lob)}`);
    el.innerHTML = `
      <div class="section-divider">${escHtml(lob)} — ${items.length} items</div>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Name</th><th>LOB</th></tr></thead>
            <tbody>${items.map(i => `
              <tr style="cursor:pointer" onclick="showItemDetail('${escHtml(i.id)}')">
                <td><span class="bold" style="color:var(--accent)">${escHtml(i.id)}</span></td>
                <td>${escHtml(i.name)}</td>
                <td><span class="badge badge-purple">${escHtml(i.lob)}</span></td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  };

  window.doCatSearch = async (q) => {
    const el = document.getElementById("search-results");
    if (!q.trim()) { el.innerHTML = ""; return; }
    const results = await api.get(`/api/catalog/search?q=${encodeURIComponent(q)}`);
    if (!results.length) { el.innerHTML = `<div class="alert alert-info">No results for &ldquo;${escHtml(q)}&rdquo;</div>`; return; }
    el.innerHTML = `
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:16px">
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Name</th><th>LOB</th></tr></thead>
            <tbody>${results.map(i => `
              <tr style="cursor:pointer" onclick="showItemDetail('${escHtml(i.id)}')">
                <td><span class="bold" style="color:var(--accent)">${escHtml(i.id)}</span></td>
                <td>${escHtml(i.name)}</td>
                <td><span class="badge badge-purple">${escHtml(i.lob)}</span></td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  };

  window.showItemDetail = async (id) => {
    const item = await api.get(`/api/catalog/item/${id}`);
    const prev = document.getElementById("item-detail");
    if (prev) prev.remove();
    const div = document.createElement("div");
    div.id = "item-detail";
    div.className = "card";
    div.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div><span class="bold" style="color:var(--accent);font-size:16px">${escHtml(item.id)}</span>
          <span style="font-size:16px;font-weight:700;margin-left:8px">${escHtml(item.name)}</span></div>
        <button class="btn btn-sm btn-outline" onclick="document.getElementById('item-detail').remove()">✕ Close</button>
      </div>
      <div class="mb-2"><span class="badge badge-purple">${escHtml(item.lob)}</span></div>
      <div style="font-size:13px;color:var(--text);line-height:1.7;white-space:pre-wrap">${escHtml(item.description)}</div>
      <div class="mt-3">
        <button class="btn btn-primary btn-sm" onclick="navigate('kdd-generator');(function tryPrefill(n){window.prefillKDD?window.prefillKDD('${escHtml(item.id)}'):n>0&&setTimeout(()=>tryPrefill(n-1),150);})(20)">
          ◈ Generate KDD for ${escHtml(item.id)}
        </button>
      </div>`;
    document.getElementById("app").appendChild(div);
    div.scrollIntoView({ behavior: "smooth" });
  };
}

// ── KDD GENERATOR page ────────────────────────────────────────────────────────
async function pagKDD() {
  const [lobs, countryMap] = await Promise.all([
    api.get("/api/catalog/lobs"),
    api.get("/api/catalog/country-map"),
  ]);
  const lobOpts    = lobs.map(l => `<option value="${l.name}">${l.name} (${l.count})</option>`).join("");
  const regionOpts = Object.keys(countryMap).map(r => `<option value="${r}">${r}</option>`).join("");
  // Embed country map for use by bindKDD without a second fetch
  window._kddCountryMapData = countryMap;

  return `
    <div style="background:linear-gradient(135deg,#460073 0%,#A100FF 100%);
                border-radius:10px;padding:24px 28px;margin-bottom:22px;
                display:flex;align-items:center;gap:18px">
      <div style="font-size:48px;font-weight:900;color:#A100FF;line-height:1;
                  text-shadow:0 0 20px rgba(161,0,255,0.5)">◈</div>
      <div>
        <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.3px">
          KDD Generator</div>
        <div style="color:#E0C8FF;font-size:13px;margin-top:3px">
          Accenture · SAP S/4HANA Cloud Public Edition · Explore Phase</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="color:#E0C8FF;font-size:11px">Powered by</div>
        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;justify-content:flex-end">
          <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">📖 Scope Catalog</span>
          <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">◈ KDD Cache</span>
          <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">✦ Claude AI</span>
        </div>
      </div>
    </div>

    <div class="card" id="kdd-form-card">
      <div class="section-divider" style="margin-top:0">1 · Project Details</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Client Name *</label>
          <input id="kdd-client" class="form-input" placeholder="e.g. Acme Corporation" />
        </div>
        <div class="form-group">
          <label class="form-label">Project Name *</label>
          <input id="kdd-project" class="form-input" placeholder="e.g. S4HANA Rollout Phase 1" />
        </div>
      </div>

      <div class="section-divider">2 · Client Country / Region
        <span style="font-size:11px;color:var(--text-muted);font-weight:400;margin-left:6px">optional — filters available scope items</span>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Region</label>
          <select id="kdd-region" class="form-select" onchange="kddRegionChange(this.value)">
            <option value="">— All Regions —</option>
            ${regionOpts}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Country</label>
          <select id="kdd-country" class="form-select" onchange="kddCountryChange(this.value)" disabled>
            <option value="">— Select region first —</option>
          </select>
        </div>
      </div>
      <div id="kdd-country-info" style="font-size:12px;color:var(--text-muted);margin-top:4px;min-height:0"></div>

      <div class="section-divider" style="margin-top:10px">3 · Browse &amp; Select Scope Items</div>

      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:10px;flex-wrap:wrap">
        <div class="form-group" style="margin-bottom:0;min-width:200px">
          <label class="form-label">Browse by LOB</label>
          <select id="kdd-lob" class="form-select" onchange="kddLoadLOB(this.value)">
            <option value="">— select LOB —</option>
            ${lobOpts}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;flex:1;min-width:180px">
          <label class="form-label">Filter items</label>
          <input id="kdd-item-filter" class="form-input" placeholder="Type to filter by name or ID…" oninput="kddFilter(this.value)" />
        </div>
      </div>

      <div id="kdd-item-list" class="item-list" style="display:none"></div>

      <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
        <label class="form-label">Quick Add by ID
          <span style="font-weight:400;color:var(--text-muted);font-size:11px;margin-left:4px">— add specific scope IDs directly</span>
        </label>
        <div style="display:flex;gap:8px">
          <div class="kdd-id-wrap">
            <input id="kdd-id-input" class="form-input" placeholder="e.g. BD6, J59, BFB — comma-separated or type to search" autocomplete="off" />
            <div id="kdd-ac-dropdown" class="ac-dropdown"></div>
          </div>
          <button class="btn btn-outline" onclick="kddAddByIds()">Add</button>
        </div>
      </div>

      <div class="section-divider">4 · Selected Items</div>
      <div id="kdd-chips" class="chips mb-3">
        <span class="text-muted text-sm">No items selected yet</span>
      </div>

      <div id="kdd-alert"></div>

      <div style="margin-top:8px;text-align:center">
        <button id="kdd-ai-btn" class="btn btn-primary btn-generate" onclick="kddGenerate('ai')"
          title="Claude generates tailored KDDs — 3 items run in parallel">
          &gt;&nbsp;&nbsp;Generate KDDs with AI
        </button>
      </div>
      <div style="font-size:11.5px;color:var(--text-muted);text-align:center;margin-top:5px">
        Claude AI · 3 scope items in parallel · ~40s
      </div>
    </div>

    <div id="kdd-result"></div>`;
}

function bindKDD() {
  window._kddSelected   = new Map(); // id → { id, name, lob }
  window._kddAllItems   = [];
  window._kddRegion     = "";
  window._kddCountry    = "";
  window._kddCountryMap = window._kddCountryMapData || {};

  // ── Country / Region helpers ──────────────────────────────────────────────────

  function _itemAvailableInFilter(item) {
    if (!_kddCountry && !_kddRegion) return true;
    const c = item.countries || {};
    if (_kddCountry) return Object.values(c).some(arr => arr.includes(_kddCountry));
    return _kddRegion in c;
  }

  async function _updateCountryInfo() {
    const el = document.getElementById("kdd-country-info");
    if (!el) return;
    if (!_kddCountry && !_kddRegion) { el.textContent = ""; return; }
    const label = _kddCountry || _kddRegion;
    try {
      const q   = _kddCountry ? `country=${encodeURIComponent(_kddCountry)}` : `region=${encodeURIComponent(_kddRegion)}`;
      const res = await api.get(`/api/catalog/country-stats?${q}`);
      el.textContent = `${res.available} of ${res.total} scope items available for ${label}`;
    } catch (_) {
      el.textContent = `Filtering by: ${label}`;
    }
  }

  async function _updateLobCounts() {
    const lobEl = document.getElementById("kdd-lob");
    if (!lobEl) return;
    const currentLob = lobEl.value;
    let url = "/api/catalog/lobs";
    if (_kddCountry)     url += `?country=${encodeURIComponent(_kddCountry)}`;
    else if (_kddRegion) url += `?region=${encodeURIComponent(_kddRegion)}`;
    try {
      const lobs = await api.get(url);
      const opts = lobs.map(l =>
        `<option value="${l.name}"${l.name === currentLob ? " selected" : ""}>${l.name} (${l.count})</option>`
      ).join("");
      lobEl.innerHTML = `<option value="">— select LOB —</option>` + opts;
    } catch (_) {}
  }

  window.kddRegionChange = async (region) => {
    _kddRegion  = region;
    _kddCountry = "";
    const countryEl = document.getElementById("kdd-country");
    if (!region) {
      countryEl.innerHTML = `<option value="">— Select region first —</option>`;
      countryEl.disabled  = true;
    } else {
      const countries = _kddCountryMap[region] || [];
      countryEl.innerHTML = `<option value="">— All countries in ${region} —</option>` +
        countries.map(c => `<option value="${c}">${c}</option>`).join("");
      countryEl.disabled = false;
    }
    renderItemList(_kddAllItems);
    _updateCountryInfo();
    await _updateLobCounts();
  };

  window.kddCountryChange = async (country) => {
    _kddCountry = country;
    renderItemList(_kddAllItems);
    _updateCountryInfo();
    await _updateLobCounts();
  };

  window.prefillKDD = (id) => {
    document.getElementById("kdd-id-input").value = id;
    kddAddByIds();
  };

  window.kddAddByIds = async () => {
    hideAC();
    const raw  = document.getElementById("kdd-id-input").value;
    const ids  = raw.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    const errs = [];
    for (const id of ids) {
      if (_kddSelected.has(id)) continue;
      const item = await api.get(`/api/catalog/item/${id}`);
      if (item.error) { errs.push(id); continue; }
      _kddSelected.set(id, item);
    }
    document.getElementById("kdd-id-input").value = "";
    if (errs.length) {
      setKddAlert(`warning`, `❌ Not found in the 657-process catalog: <strong>${errs.join(", ")}</strong>. Use the search below or browse by LOB.`);
    } else {
      setKddAlert("", "");
    }
    renderChips();
  };

  // ── Autocomplete on the ID input ─────────────────────────────────────────────
  const _acInput = document.getElementById("kdd-id-input");
  const _acDrop  = document.getElementById("kdd-ac-dropdown");
  let   _acTimer;

  function hideAC() { if (_acDrop) _acDrop.style.display = "none"; }

  _acInput.addEventListener("input", () => {
    clearTimeout(_acTimer);
    const val       = _acInput.value;
    const lastToken = val.split(/[\s,]+/).pop().trim();
    if (lastToken.length < 1) { hideAC(); return; }
    _acTimer = setTimeout(async () => {
      const results = await api.get(`/api/catalog/search?q=${encodeURIComponent(lastToken)}`);
      if (!results || !results.length) { hideAC(); return; }
      _acDrop.innerHTML = results.slice(0, 8).map(p => `
        <div class="ac-item" onmousedown="kddAcPick('${p.id}')">
          <span class="ac-id">${p.id}</span>
          <span class="ac-name">${p.name}</span>
          <span class="ac-lob">${p.lob}</span>
        </div>`).join("");
      _acDrop.style.display = "block";
    }, 180);
  });

  _acInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideAC();
    if (e.key === "Enter")  { e.preventDefault(); kddAddByIds(); }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".kdd-id-wrap")) hideAC();
  });

  window.kddAcPick = (id) => {
    const parts = _acInput.value.split(/[\s,]+/).filter(Boolean);
    parts[Math.max(0, parts.length - 1)] = id;
    _acInput.value = parts.join(", ") + ", ";
    hideAC();
    _acInput.focus();
  };

  window.kddLoadLOB = async (lob) => {
    if (!lob) return;
    const el    = document.getElementById("kdd-item-list");
    el.style.display = "block";
    el.innerHTML = `<div class="loader" style="padding:12px 14px"><div class="spinner"></div> Loading ${lob}…</div>`;
    const items = await api.get(`/api/catalog/lob/${encodeURIComponent(lob)}`);
    _kddAllItems = items;
    renderItemList(items);
  };

  window.kddFilter = (q) => {
    const textFiltered = q
      ? _kddAllItems.filter(i => i.id.toLowerCase().includes(q.toLowerCase()) || i.name.toLowerCase().includes(q.toLowerCase()))
      : _kddAllItems;
    renderItemList(textFiltered);
  };

  window.kddToggleItem = (id) => {
    const item = _kddAllItems.find(i => i.id === id);
    if (!item) return;
    if (_kddSelected.has(id)) _kddSelected.delete(id);
    else _kddSelected.set(id, item);
    // Update checkbox
    const cb = document.querySelector(`input[data-id="${id}"]`);
    if (cb) {
      cb.checked = _kddSelected.has(id);
      cb.closest(".item-row").classList.toggle("checked", _kddSelected.has(id));
    }
    renderChips();
  };

  window.kddRemoveChip = (id) => {
    _kddSelected.delete(id);
    // uncheck if visible
    const cb = document.querySelector(`input[data-id="${id}"]`);
    if (cb) { cb.checked = false; cb.closest(".item-row").classList.remove("checked"); }
    renderChips();
  };

  // ── Auto quality critique — runs immediately after generation, inline ────────
  window.autoRunCritique = async function autoRunCritique(scopeIds, sessionId) {
    const section = document.getElementById("auto-critique-section");
    if (!section) { console.warn("[autoRunCritique] auto-critique-section not found"); return; }

    const log = msg => {
      const s = document.getElementById("auto-critique-section");
      if (s) s.innerHTML = msg;
    };

    // Show spinner immediately — before any async work
    log(`<div class="flex items-center gap-2" style="color:var(--text-muted);font-size:13px">
      <div class="spinner" style="width:13px;height:13px;flex-shrink:0"></div>
      <span>🔍 Loading KDD data…</span>
    </div>`);

    try {
      const sid = sessionId || await _resolveSessionId();
      const data = await api.get(`/api/kdd/data?session_id=${encodeURIComponent(sid)}`);
      if (data.error) {
        log(`<div style="font-size:13px;color:var(--danger);padding:4px 0">⚠️ ${data.error}</div>`);
        return;
      }
      if (!data.rows || !data.rows.length) {
        log(`<div class="text-muted text-sm" style="padding:4px 0">⚠️ No rows to review.</div>`);
        return;
      }

      log(`<div class="flex items-center gap-2" style="color:var(--text-muted);font-size:13px">
        <div class="spinner" style="width:13px;height:13px;flex-shrink:0"></div>
        <span>🔍 Starting quality review for ${data.rows.length} questions…</span>
      </div>`);

      const response = await fetch("/api/kdd/critique", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: data.rows })
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`Server error ${response.status}: ${errText.slice(0, 100)}`);
      }

      const reader = response.body.getReader();
      const dec    = new TextDecoder();
      let   buf    = "";
      const results = [];     // { kddId, rating, reason }
      let   itemsDone = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop();
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          let evt; try { evt = JSON.parse(part.slice(6)); } catch { continue; }

          if (evt.type === "progress") {
            log(`<div class="flex items-center gap-2" style="color:var(--text-muted);font-size:13px">
              <div class="spinner" style="width:13px;height:13px;flex-shrink:0"></div>
              <span>🔍 Reviewing ${evt.item || ""}…</span>
            </div>`);
          } else if (evt.type === "item_done") {
            itemsDone++;
            log(`<div class="flex items-center gap-2" style="color:var(--text-muted);font-size:13px">
              <div class="spinner" style="width:13px;height:13px;flex-shrink:0"></div>
              <span>🔍 Reviewed ${itemsDone} / ${scopeIds.length} scope items…</span>
            </div>`);
          } else if (evt.type === "complete") {
            results.push(...(evt.results || []));
          } else if (evt.type === "item_error") {
            console.warn(`[critique] item error for ${evt.item}: ${evt.message}`);
          }
        }
      }

      if (!results.length) {
        log(`<div class="text-muted text-sm" style="padding:4px 0">🔍 Quality review finished — open editor to see badges.</div>`);
        return;
      }

      const generic  = results.filter(r => r.rating === "generic");
      const specific = results.filter(r => r.rating === "specific");
      const pct      = Math.round(specific.length / results.length * 100);
      const color    = pct >= 80 ? "var(--success)" : pct >= 60 ? "var(--warning)" : "var(--danger)";
      const emoji    = pct >= 80 ? "✅" : pct >= 60 ? "⚠️" : "🔴";

      const topWeak = generic.slice(0, 3).map(r =>
        `<li style="font-size:12px;color:var(--text-muted);margin:3px 0">${r.kddId} — ${r.reason || "too generic"}</li>`
      ).join("");

      log(`<div style="padding:4px 0">
        <div class="flex items-center gap-2 mb-2">
          <span>${emoji}</span>
          <span class="bold" style="font-size:13px">Quality Review Complete</span>
          <span style="margin-left:auto;font-size:12px;color:${color};font-weight:700">${pct}% specific</span>
        </div>
        <div style="font-size:12.5px;color:var(--text-muted)">
          ${specific.length} specific · ${generic.length} generic (out of ${results.length} questions reviewed)
        </div>
        ${topWeak ? `<ul style="margin:6px 0 6px 16px;padding:0">${topWeak}</ul>` : ""}
        <button class="btn btn-sm btn-outline" style="margin-top:6px" onclick="navigate('editor')">
          ✎ Open Editor to see quality badges →
        </button>
      </div>`);

    } catch (e) {
      console.error("[autoRunCritique] error:", e);
      log(`<div style="font-size:13px;color:var(--danger);padding:4px 0">
        ⚠️ Quality review failed: ${e.message.slice(0, 120)}
      </div>`);
    }
  }

  window.kddGenerate = async (mode = "ai") => {
    const client  = document.getElementById("kdd-client").value.trim();
    const project = document.getElementById("kdd-project").value.trim();
    const ids     = [..._kddSelected.keys()];

    if (!client || !project) { setKddAlert("warning", "Please enter client name and project name."); return; }
    if (!ids.length)         { setKddAlert("warning", "Select at least one scope item."); return; }
    setKddAlert("", "");

    const aiBtn = document.getElementById("kdd-ai-btn");
    if (aiBtn) { aiBtn.disabled = true; aiBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;display:inline-block"></div> Working…`; }

    // ── Live progress panel ──
    const res = document.getElementById("kdd-result");
    const modeLabel = `🤖 Claude generating KDDs — ${ids.length} scope item${ids.length === 1 ? "" : "s"}`;
    res.innerHTML = `
      <div class="card" id="kdd-progress-card">
        <div class="bold mb-3" style="font-size:14px">${modeLabel}</div>
        <div id="kdd-progress-rows"></div>
      </div>`;

    // Helper: add a row to the live panel
    const progressRows = () => document.getElementById("kdd-progress-rows");
    const addRow = (id, html) => {
      let row = document.getElementById(`pr-${id}`);
      if (!row) {
        row = document.createElement("div");
        row.id = `pr-${id}`;
        row.style.cssText = "display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:13px";
        progressRows().appendChild(row);
      }
      row.innerHTML = html;
    };

    // ── SSE stream reader ──
    // Server sends text/event-stream over the POST response body.
    // We read it chunk-by-chunk and parse events as they arrive.
    try {
      const response = await fetch("/api/kdd/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ client, project, scopeIds: ids, mode,
                   clientCountry: _kddCountry || "", clientRegion: _kddRegion || "" })
      });

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let   buf        = "";
      let   totalKDDs  = 0;
      let   filename   = null;
      let   fatalMsg   = null;
      let   totalTokensIn  = 0;
      let   totalTokensOut = 0;
      const _timers    = {};   // itemId → { startMs, intervalId }

      const startItemTimer = (itemId, startedAt) => {
        if (_timers[itemId]) return;                 // already running
        const t0 = startedAt || Date.now();
        const intervalId = setInterval(() => {
          const el = document.getElementById(`elapsed-${itemId}`);
          if (el) el.textContent = ((Date.now() - t0) / 1000).toFixed(0) + "s";
        }, 500);
        _timers[itemId] = { startMs: t0, intervalId };
      };
      const stopItemTimer = (itemId) => {
        if (_timers[itemId]) { clearInterval(_timers[itemId].intervalId); delete _timers[itemId]; }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines
        const parts = buf.split("\n\n");
        buf = parts.pop();                      // keep incomplete tail

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          let evt;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.type === "progress") {
            if (evt.item) {
              startItemTimer(evt.item, evt.startedAt);
              addRow(evt.item, `
                <div class="spinner" style="width:14px;height:14px;flex-shrink:0"></div>
                <span class="bold" style="color:var(--accent);min-width:42px">${evt.item}</span>
                <span style="flex:1">${evt.name || ""}</span>
                <span class="text-muted text-sm">${evt.message || "working…"}</span>
                <span id="elapsed-${evt.item}" class="text-muted text-sm" style="min-width:28px;text-align:right;font-variant-numeric:tabular-nums">0s</span>`);
            } else {
              addRow("__excel__", `
                <div class="spinner" style="width:14px;height:14px;flex-shrink:0"></div>
                <span>${evt.message}</span>`);
            }
          }

          else if (evt.type === "item_done") {
            stopItemTimer(evt.item);
            totalKDDs += evt.count || 15;
            totalTokensIn  += evt.inputTokens  || 0;
            totalTokensOut += evt.outputTokens || 0;

            const secs = evt.durationMs ? (evt.durationMs / 1000).toFixed(1) + "s" : "";
            const toks = (evt.inputTokens || evt.outputTokens)
              ? `<span class="text-muted text-sm" title="~${evt.inputTokens} input · ~${evt.outputTokens} output tokens">~${(evt.inputTokens||0)+(evt.outputTokens||0)} tok</span>`
              : "";
            const reason = evt.note ? evt.note.slice(0, 80) : "";
            const ricefBadge = (evt.ricef > 0)
              ? `<span class="badge badge-purple" title="${evt.ricef} RICEF objects identified">⚙ ${evt.ricef} RICEF</span>`
              : "";
            const badge = evt.source === "cache"
              ? `<span class="badge badge-yellow" title="${reason}">cache ⓘ</span>`
              : `<span class="badge badge-green">Claude ✓</span> ${ricefBadge}`;

            addRow(evt.item, `
              <span style="font-size:15px">✅</span>
              <span class="bold" style="color:var(--accent);min-width:42px">${evt.item}</span>
              <span style="flex:1">${evt.name}</span>
              <span class="text-muted text-sm">${evt.count} Qs</span>
              ${toks}
              <span class="text-muted text-sm" style="min-width:36px;text-align:right;font-variant-numeric:tabular-nums">${secs}</span>
              <span style="margin-left:4px">${badge}</span>`);
            const pr = document.getElementById(`pr-${evt.item}`);
            if (pr) { pr.dataset.source = evt.source; pr.dataset.name = evt.name || ""; }
          }

          else if (evt.type === "error") {
            const errId = evt.item || `err-${Date.now()}`;
            addRow(errId, `
              <span style="font-size:15px">⚠️</span>
              <span class="bold" style="color:var(--danger);min-width:42px">${evt.item || "?"}</span>
              <span class="text-muted text-sm">${evt.message}</span>`);
            const pr = document.getElementById(`pr-${errId}`);
            if (pr) { pr.dataset.source = "error"; pr.dataset.name = ""; }
          }

          else if (evt.type === "complete") {
            filename  = evt.filename;
            totalKDDs = evt.totalKDDs || totalKDDs;
            if (evt.sessionId) {
              window._lastKddSessionId = evt.sessionId;
              localStorage.setItem("kddSessionId", evt.sessionId);
            }
            // Remove the "Building Excel workbook…" spinner row — Excel is done
            const excelRow = document.getElementById("pr-__excel__");
            if (excelRow) excelRow.remove();
          }

          else if (evt.type === "fatal") {
            fatalMsg = evt.message;
          }
        }
      }

      // ── Stream finished — reset both buttons ──
      if (aiBtn) { aiBtn.disabled = false; aiBtn.innerHTML = "🤖 Generate KDDs with AI"; }

      if (fatalMsg) {
        document.getElementById("kdd-progress-card").innerHTML +=
          `<div class="alert alert-danger mt-3">⚠️ ${fatalMsg}</div>`;
        return;
      }

      // Add ↻ Retry buttons to any cache-fallback or error rows
      document.querySelectorAll("#kdd-progress-rows [data-source='cache'], #kdd-progress-rows [data-source='error']").forEach(row => {
        const rowId   = row.id.replace("pr-", "");
        const rowName = row.dataset.name || rowId;
        const retryBtn = document.createElement("button");
        retryBtn.className = "btn btn-sm btn-outline";
        retryBtn.style.marginLeft = "8px";
        retryBtn.textContent = "↻ Retry with Claude";
        retryBtn.onclick = () => retryItem(rowId, rowName, retryBtn);
        row.appendChild(retryBtn);
      });

      document.getElementById("kdd-progress-card").innerHTML += `
        <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:14px">
          <div class="flex items-center gap-2 mb-3">
            <span style="font-size:22px">✅</span>
            <div>
              <div class="bold" style="font-size:15px">KDD Log Ready</div>
              <div class="text-muted text-sm">${totalKDDs} questions · ${ids.length} scope items · generated by Claude using SAP for Me process data</div>
              ${(totalTokensIn + totalTokensOut) > 0 ? `<div class="text-muted text-sm" style="margin-top:3px;font-size:11px">🧮 ~${(totalTokensIn+totalTokensOut).toLocaleString()} tokens total · ~${totalTokensIn.toLocaleString()} in · ~${totalTokensOut.toLocaleString()} out</div>` : ""}
            </div>
          </div>
          ${filename ? `
            <div class="alert alert-success">
              📥 <strong>${filename}</strong><br>
              Sheets: Cover · Instructions · Scope Overview · KDD Master Log · Summary
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-primary" onclick="navigate('editor')">✎ Open in KDD Editor</button>
              <a href="/api/output/download/${encodeURIComponent(filename)}" class="btn btn-outline" download>⬇ Download Excel</a>
              <button class="btn btn-outline" onclick="navigate('output')">↓ All Output Files</button>
            </div>` : ""}
        </div>
        <div id="auto-critique-section" style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px">
          ${mode === "ai"
            ? `<div class="flex items-center gap-2" style="color:var(--text-muted);font-size:13px">
                <div class="spinner" style="width:13px;height:13px;flex-shrink:0"></div>
                <span>🔍 Auto-reviewing question quality…</span>
               </div>`
            : `<div class="flex items-center gap-8" style="font-size:13px;color:var(--text-muted)">
                <span>Quality review not run — cache questions are pre-validated.</span>
                <button class="btn btn-sm btn-outline" style="font-size:12px" onclick="autoRunCritique([${ids.map(i => `'${i}'`).join(",")}])">
                  🔍 Run Quality Check
                </button>
               </div>`
          }
        </div>`;

      // AI mode: auto-run critique. Cache mode: show opt-in button instead.
      if (mode === "ai") autoRunCritique(ids, window._lastKddSessionId);

    } catch (e) {
      if (aiBtn) { aiBtn.disabled = false; aiBtn.innerHTML = "🤖 Generate KDDs with AI"; }
      if (res) res.innerHTML = `<div class="alert alert-danger">⚠️ ${escHtml(e.message)}</div>`;
    }
  };

  // ── Retry a single scope item without re-running everything ──
  window.retryItem = async (id, name, btn) => {
    const row = document.getElementById(`pr-${id}`);
    if (btn) btn.remove();
    if (row) {
      row.innerHTML = `
        <div class="spinner" style="width:14px;height:14px;flex-shrink:0"></div>
        <span class="bold" style="color:var(--accent);min-width:42px">${id}</span>
        <span>${name}</span>
        <span class="text-muted text-sm" style="margin-left:auto">retrying Claude…</span>`;
    }
    try {
      const response = await fetch(`/api/kdd/retry/${encodeURIComponent(id)}`, { method: "POST" });
      const reader   = response.body.getReader();
      const decoder  = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          let evt; try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          if (evt.type === "item_done" && row) {
            const badge = evt.source === "cache"
              ? `<span class="badge badge-yellow">cache fallback</span>`
              : `<span class="badge badge-green">Claude ✓</span>`;
            row.innerHTML = `
              <span style="font-size:15px">✅</span>
              <span class="bold" style="color:var(--accent);min-width:42px">${id}</span>
              <span>${evt.name}</span>
              <span class="text-muted text-sm">${evt.count} questions regenerated</span>
              <span style="margin-left:auto">${badge}</span>`;
            row.dataset.source = evt.source;
            if (evt.source === "cache") {
              const retryBtn2 = document.createElement("button");
              retryBtn2.className = "btn btn-sm btn-outline";
              retryBtn2.style.marginLeft = "8px";
              retryBtn2.textContent = "↻ Retry again";
              retryBtn2.onclick = () => retryItem(id, name, retryBtn2);
              row.appendChild(retryBtn2);
            }
          } else if (evt.type === "error" && row) {
            row.innerHTML = `
              <span style="font-size:15px">⚠️</span>
              <span class="bold" style="color:var(--danger);min-width:42px">${id}</span>
              <span class="text-muted text-sm">${evt.message}</span>`;
            const retryBtn3 = document.createElement("button");
            retryBtn3.className = "btn btn-sm btn-outline";
            retryBtn3.style.marginLeft = "8px";
            retryBtn3.textContent = "↻ Retry";
            retryBtn3.onclick = () => retryItem(id, name, retryBtn3);
            row.appendChild(retryBtn3);
          }
        }
      }
    } catch (e) {
      if (row) row.innerHTML += `<span style="color:var(--danger);font-size:12px;margin-left:8px">Error: ${escHtml(e.message)}</span>`;
    }
  };

  function renderItemList(items) {
    const el = document.getElementById("kdd-item-list");
    if (!el) return;
    // Apply country/region filter on top of whatever list is passed in
    const countryFiltered = (_kddCountry || _kddRegion)
      ? items.filter(i => _itemAvailableInFilter(i))
      : items;

    if (!countryFiltered.length) {
      const hint = (_kddCountry || _kddRegion)
        ? `No items found for <strong>${_kddCountry || _kddRegion}</strong> in this LOB`
        : "No items found";
      el.innerHTML = `<div style="padding:12px 14px;color:var(--text-muted);font-size:13px">${hint}</div>`;
      return;
    }
    el.innerHTML = countryFiltered.map(i => `
      <div class="item-row ${_kddSelected.has(i.id) ? "checked" : ""}" onclick="kddToggleItem('${escHtml(i.id)}')">
        <input type="checkbox" data-id="${escHtml(i.id)}" ${_kddSelected.has(i.id) ? "checked" : ""} onclick="event.stopPropagation();kddToggleItem('${escHtml(i.id)}')" />
        <span class="item-id">${escHtml(i.id)}</span>
        <span class="item-name">${escHtml(i.name)}</span>
        <span class="item-lob">${escHtml(i.lob)}</span>
      </div>`).join("");
  }

  function renderChips() {
    const el = document.getElementById("kdd-chips");
    if (!_kddSelected.size) {
      el.innerHTML = `<span class="text-muted text-sm">No items selected yet</span>`;
      return;
    }
    el.innerHTML = [..._kddSelected.values()].map(i =>
      `<span class="chip">${i.id} <span class="chip-remove" onclick="kddRemoveChip('${i.id}')">✕</span></span>`
    ).join("");
  }

  function setKddAlert(type, msg) {
    const el = document.getElementById("kdd-alert");
    if (!type) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
  }
}

// ── REFERENCE page ────────────────────────────────────────────────────────────
async function pagReference() {
  return `
    <div class="page-header">
      <div class="page-title">Skills</div>
      <div class="page-sub">Built capabilities for SAP S/4HANA Cloud Public Edition — Explore phase</div>
    </div>

    <div class="section-divider">Invoke from Claude Code CLI</div>
    <div class="agent-list">
      ${agentCard(1,"BDCQ Enricher — <code>/s4pc-bdcq-enricher</code>",
        "Reads bdcq-questions.json and enriches every question across three lenses: (1) country statutory requirements — marks GST, VAT, e-invoicing, withholding tax items MANDATORY with the specific legal basis and standard Cloud PE config path; (2) industry context — injects manufacturing, pharma, retail or professional-services sub-questions; (3) Cloud PE constraints — flags where client expectations (custom ABAP, SM30, user exits) differ from Public Edition and provides the standard extension path. Output is a workshop brief where the consultant knows not just what to ask, but what answer to expect.",
        "Active","Explore","navigate('bdcq-agent')")}
      ${agentCard(2,"KDD Generator — <code>/s4pc-kdd-generator</code>",
        "4-stage pipeline per scope item: past decisions overlay → SAP context parsing → 3-call Claude generation (15 questions across 10 coverage areas: Fiori config, master data, approval workflow, outputs, integration, reporting, authorisation, data migration, org structure, number ranges) → Cloud PE validation with auto-fix. Exports a 5-sheet Excel: Cover, Instructions, Scope Overview, KDD Master Log, and Summary with RICEF classification.",
        "Active","SAP Activate","navigate('kdd-generator')")}
    </div>

    <div class="section-divider" style="margin-top:28px">Tools in this Session</div>
    <div class="agent-list">
      ${agentCard(3,"KDD Editor",
        "Row-level editing of generated KDD questions. Set Fit/Gap, Complexity, Decision Owner, Sign-off Status, Action Items, BPD Reference, and RICEF classification. Export to Excel or PowerPoint directly from the editor.",
        "Active","SAP Activate","navigate('editor')")}
      ${agentCard(4,"KDD Analysis",
        "Visual gap analysis across all generated KDDs — RAG status breakdown, Fit/Gap/Complexity matrix, RICEF inventory, scope item risk table, and module-level summaries. Exportable.",
        "Active","SAP Activate","navigate('gap-analysis')")}
      ${agentCard(5,"Decision Library",
        "Persistent store of approved KDD decisions across projects. Decisions saved here are automatically overlaid on future KDD generation runs for the same scope items — the system learns from past workshops.",
        "Active","SAP Activate","navigate('decision-library')")}
      ${agentCard(6,"Scope Catalog",
        "657 SAP S/4HANA Cloud Public Edition processes with descriptions, LOB, business benefits, and key process flows. Extracted by the SAPDeckAgent Chrome extension from SAP for Me Process Navigator.",
        "Active","Reference","navigate('catalog')")}
    </div>`;
}

// ── OUTPUT page ───────────────────────────────────────────────────────────────
async function pagOutput() {
  const data = await api.get("/api/output");
  const files  = Array.isArray(data.files) ? data.files : [];
  const folder = data.folder || "output/";

  const typeTag = t => {
    const colour = t === "XLSX"
      ? "background:#d1fae5;color:#065f46;border:1px solid #a7f3d0"
      : "background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd";
    return `<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;${colour}">${t}</span>`;
  };

  const rows = files.length
    ? files.map(f => {
        const kb   = ((f.size || 0) / 1024).toFixed(1);
        const date = f.modified ? new Date(f.modified).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
        const enc  = encodeURIComponent(f.name || "");
        const kind = f.type || (f.name || "").toUpperCase().endsWith(".PPTX") ? "PPTX" : "XLSX";
        return `<tr id="row-${enc}">
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              ${typeTag(kind)}
              <span class="bold" style="font-size:13px">${f.name || "—"}</span>
            </div>
          </td>
          <td style="white-space:nowrap">${kb} KB</td>
          <td style="white-space:nowrap">${date}</td>
          <td style="white-space:nowrap">
            <div style="display:flex;gap:6px">
              <a href="/api/output/download/${enc}" class="btn btn-sm btn-outline" download>⬇ Download</a>
              <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);background:#fff;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:600"
                onclick="deleteFile('${enc}', '${escHtml(f.name || '')}')">🗑 Delete</button>
            </div>
          </td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text-muted)">
         No output files yet — <a href="#kdd-generator" style="color:var(--accent)">generate a KDD log</a> first.
       </td></tr>`;

  const deleteAllBtn = files.length
    ? `<button class="btn btn-sm" style="color:var(--danger);border:1px solid #fca5a5;background:#fff2f2;padding:5px 14px;border-radius:6px;font-size:12.5px;font-weight:600"
         onclick="deleteAll()">🗑 Delete All Files</button>`
    : "";

  const xlsxCount = files.filter(f => (f.type || "XLSX") === "XLSX").length;
  const pptxCount = files.filter(f => f.type === "PPTX").length;
  const countLabel = files.length === 0
    ? "No output files"
    : [xlsxCount ? `${xlsxCount} Excel` : "", pptxCount ? `${pptxCount} PPT` : ""].filter(Boolean).join(" · ") + ` file${files.length !== 1 ? "s" : ""}`;

  return `
    <div class="page-header flex items-center justify-between">
      <div>
        <div class="page-title">Output Files</div>
        <div class="page-sub">
          ${countLabel} ·
          <span style="font-family:monospace;font-size:12px;background:#f3f4f6;padding:1px 7px;border-radius:4px" title="${escHtml(folder)}">${folder.length > 60 ? "…" + folder.slice(-55) : folder}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${deleteAllBtn}
        <button class="btn btn-primary" onclick="navigate('kdd-generator')">◈ New KDD Log</button>
      </div>
    </div>

    <div id="full-cache-msg"></div>

    <div class="alert alert-info" style="font-size:12.5px">
      📁 Files are saved to <code style="background:rgba(0,0,0,.06);padding:1px 6px;border-radius:3px" title="${escHtml(folder)}">${folder.length > 80 ? "…" + folder.slice(-75) : folder}</code>
      &nbsp;·&nbsp; kdd-data.json (raw KDD data) is kept separately and is never deleted here.
    </div>

    <div id="output-msg"></div>

    <div class="card" style="padding:0;overflow:hidden">
      <div class="table-wrap">
        <table id="output-table">
          <thead><tr><th>Filename</th><th>Size</th><th>Generated</th><th>Actions</th></tr></thead>
          <tbody id="output-body">${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function bindOutput() {
  window.deleteFile = async (enc, name) => {
    if (!confirm(`Delete "${name}"?\n\nkdd-data.json will not be affected.`)) return;
    const res = await fetch(`/api/output/${enc}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) {
      const row = document.getElementById(`row-${enc}`);
      if (row) {
        row.style.transition = "opacity .3s";
        row.style.opacity = "0";
        setTimeout(() => {
          row.remove();
          const tbody = document.getElementById("output-body");
          if (!tbody.children.length) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text-muted)">
              No Excel files — <a href="#kdd-generator" style="color:var(--accent)">generate a KDD log</a> first.
            </td></tr>`;
          }
        }, 300);
      }
      showOutputMsg(`✅ "${name}" deleted.`, "success");
    } else {
      showOutputMsg(`⚠️ ${data.error || data.detail || "Delete failed"}`, "danger");
    }
  };

  window.deleteAll = async () => {
    const rows = document.querySelectorAll("#output-body tr[id]").length;
    if (!rows) return;
    if (!confirm(`Delete all ${rows} Excel file${rows !== 1 ? "s" : ""}?\n\nkdd-data.json will not be affected.`)) return;
    const res  = await fetch("/api/output", { method: "DELETE" });
    const data = await res.json();
    if (data.ok) {
      document.getElementById("output-body").innerHTML =
        `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--text-muted)">
          No Excel files — <a href="#kdd-generator" style="color:var(--accent)">generate a KDD log</a> first.
        </td></tr>`;
      showOutputMsg(`✅ ${data.deleted} file${data.deleted !== 1 ? "s" : ""} deleted. kdd-data.json kept.`, "success");
      const btn = document.querySelector("[onclick='deleteAll()']");
      if (btn) btn.remove();
    } else {
      showOutputMsg(`⚠️ ${data.error || data.detail || "Delete failed"}`, "danger");
    }
  };

  function showOutputMsg(text, type) {
    const el = document.getElementById("output-msg");
    el.innerHTML = `<div class="alert alert-${type}" style="margin-bottom:12px">${text}</div>`;
    setTimeout(() => { el.innerHTML = ""; }, 4000);
  }

  window.exportFullCache = async () => {
    const btn = document.getElementById("fullCacheBtn");
    const msg = document.getElementById("full-cache-msg");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Building Excel…"; }
    msg.innerHTML = `<div class="alert alert-info" style="margin-bottom:12px">
      ⏳ Building full cache Excel — 9,855 KDDs across 657 scope items. This takes ~10 seconds…
    </div>`;
    try {
      const res  = await fetch("/api/kdd/export-full-cache", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: "All Scope Items", project: "Full Cache" })
      });
      const data = await res.json();
      if (data.ok) {
        const enc = encodeURIComponent(data.filename);
        msg.innerHTML = `<div class="alert alert-success" style="margin-bottom:12px">
          ✅ Full cache exported — <strong>${data.rows} KDDs</strong> across <strong>${data.scopeItems} scope items</strong>.
          &nbsp;<a href="/api/output/download/${enc}" class="btn btn-sm btn-outline" download style="margin-left:8px">⬇ Download ${data.filename}</a>
        </div>`;
        // Add file to table
        navigate("output");
      } else {
        msg.innerHTML = `<div class="alert alert-danger" style="margin-bottom:12px">⚠️ ${data.error}</div>`;
      }
    } catch (e) {
      msg.innerHTML = `<div class="alert alert-danger" style="margin-bottom:12px">⚠️ ${escHtml(e.message)}</div>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "⬇ Export Full Cache (9,855 KDDs)"; }
      setTimeout(() => { msg.innerHTML = ""; }, 8000);
    }
  };
}

// ── SETTINGS page ─────────────────────────────────────────────────────────────
async function pagSettings() {
  const s    = await api.get("/api/status");
  const info = await api.get("/api/catalog/info");

  const loadedAt = info.extractedAt
    ? new Date(info.extractedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "Unknown";

  const changedBanner = s.catalogChanged
    ? `<div class="alert alert-info" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <span>✨ <strong>New catalog detected</strong> — the Chrome extension just saved fresh SAP data.</span>
        <button class="btn btn-primary btn-sm" onclick="reloadCatalog()">Reload Now</button>
       </div>`
    : "";

  const catalogCard = info.exists ? `
    <table style="font-size:13.5px;width:100%">
      <tbody>
        <tr><td class="bold" style="width:200px;padding:7px 0;color:var(--text-muted)">Version</td>
            <td><strong>${info.version}</strong>
              ${s.catalogOutdated
                ? `<span class="badge badge-yellow" style="margin-left:8px">SAP ${s.expectedRelease} available</span>`
                : `<span class="badge badge-green" style="margin-left:8px">Current</span>`}
            </td></tr>
        <tr><td class="bold" style="padding:7px 0;color:var(--text-muted)">Processes</td>
            <td><strong>${info.processes.toLocaleString()}</strong> across ${info.lobs} Lines of Business</td></tr>
        <tr><td class="bold" style="padding:7px 0;color:var(--text-muted)">Country</td>
            <td>${info.country || "—"}</td></tr>
        <tr><td class="bold" style="padding:7px 0;color:var(--text-muted)">Loaded from SAP</td>
            <td>${loadedAt}</td></tr>
        <tr><td class="bold" style="padding:7px 0;color:var(--text-muted)">File size</td>
            <td>${(info.fileSize / 1024 / 1024).toFixed(1)} MB</td></tr>
      </tbody>
    </table>` : `<div class="alert alert-warning">⚠️ No catalog loaded. Use the Chrome extension to load data from SAP for Me.</div>`;

  return `
    <div class="page-header">
      <div class="page-title">Settings</div>
      <div class="page-sub">Catalog data management and system status</div>
    </div>

    ${changedBanner}

    <!-- ── Catalog Data ── -->
    <div class="card mb-4">
      <div class="section-divider" style="margin-top:0">Scope Catalog Data</div>
      ${catalogCard}

      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
        <div class="bold text-sm mb-2" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">How to reload fresh data from SAP for Me</div>
        <ol style="font-size:13px;color:var(--text);line-height:2.1;padding-left:18px;margin-bottom:16px">
          <li>Open Chrome → go to <code style="background:#f3f4f6;padding:1px 6px;border-radius:3px">me.sap.com/processnavigator</code></li>
          <li>Click the <strong>SAP Deck Agent</strong> extension icon</li>
          <li>Click <strong>Load Full Catalog</strong> <span class="text-muted text-sm">(this refreshes all 657 processes from SAP)</span></li>
          <li>Click <strong>📁 Save to Cartridge</strong> → select this project folder</li>
          <li>Come back here and click <strong>Reload Catalog</strong> below</li>
        </ol>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-primary" id="reload-btn" onclick="reloadCatalog()">
            🔄 Reload Catalog
          </button>
          <button class="btn btn-outline" id="clear-btn" onclick="clearCatalog()" style="color:var(--danger);border-color:var(--danger)">
            🗑 Clear Catalog Data
          </button>
          <span class="text-sm text-muted">You can reload at any time — not just at SAP releases.</span>
        </div>
        <div id="reload-result" class="mt-3"></div>
      </div>

      <!-- ── Upload catalog (no Chrome extension needed) ── -->
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
        <div class="bold text-sm mb-1" style="color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">
          📤 Upload catalog file <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-muted)">(alternative — no Chrome extension needed)</span>
        </div>
        <p class="text-sm text-muted" style="margin:4px 0 10px">
          If your project team sends you an updated <code>scope-catalog.json</code>, upload it here directly.
          Your current catalog is backed up automatically before replacement.
        </p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0">
            📂 Choose scope-catalog.json
            <input type="file" id="catalog-file-input" accept=".json" style="display:none" onchange="uploadCatalog(this)">
          </label>
          <span id="upload-filename" class="text-muted text-sm">No file selected</span>
        </div>
        <div id="upload-result" class="mt-3"></div>
      </div>
    </div>


    <!-- ── System ── -->
    <div class="card">
      <div class="section-divider" style="margin-top:0">System</div>
      <table style="font-size:13.5px">
        <tbody>
          <tr><td class="bold" style="width:200px;padding:7px 0;color:var(--text-muted)">Mode</td>
              <td><span class="dot dot-gray" style="margin-right:6px"></span>offline</td></tr>
          <tr><td class="bold" style="padding:7px 0;color:var(--text-muted)">Writes to SAP</td>
              <td><span class="dot dot-green" style="margin-right:6px"></span>disabled (double-locked)</td></tr>
          <tr><td class="bold" style="padding:7px 0;color:var(--text-muted)">LLM API key</td>
              <td><span class="dot dot-green" style="margin-right:6px"></span>none needed — Claude Code is the runtime</td></tr>
          <tr><td class="bold" style="padding:7px 0;color:var(--text-muted)">Output files</td>
              <td>${s.outputCount} Excel file${s.outputCount !== 1 ? "s" : ""} generated</td></tr>
        </tbody>
      </table>
    </div>`;
}

function bindSettings() {

  // ── Reload catalog (SSE stream — reads progress live) ──
  window.reloadCatalog = async () => {
    const btn = document.getElementById("reload-btn");
    const el  = document.getElementById("reload-result");
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;display:inline-block;margin-right:6px"></div> Reloading…`;
    el.innerHTML  = "";

    try {
      const response = await fetch("/api/catalog/reload", { method: "POST" });
      const reader   = response.body.getReader();
      const decoder  = new TextDecoder();
      let buf = "";

      const log = (html) => {
        el.innerHTML += `<div style="font-size:13px;padding:3px 0;color:var(--text)">${html}</div>`;
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          let evt;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.type === "progress") {
            log(`⟳ ${evt.message}`);
          } else if (evt.type === "complete") {
            log(`✅ Done — version <strong>${evt.version}</strong> · ${evt.processes.toLocaleString()} processes · ${evt.totalKDDs.toLocaleString()} KDDs cached`);
            el.innerHTML += `<div class="alert alert-success mt-2">Catalog and cache are up to date. <button class="btn btn-outline btn-sm" onclick="navigate('home')">Go to Home</button></div>`;
          } else if (evt.type === "error") {
            log(`⚠️ ${evt.message}`);
            el.innerHTML += `<div class="alert alert-danger mt-2">${evt.message}</div>`;
          }
        }
      }
    } catch (e) {
      document.getElementById("reload-result").innerHTML = `<div class="alert alert-danger">⚠️ ${escHtml(e.message)}</div>`;
    }

    btn.disabled = false;
    btn.innerHTML = "🔄 Reload Catalog";
  };

  // ── Upload catalog JSON (no Chrome extension needed) ──
  window.uploadCatalog = async (input) => {
    const file = input.files[0];
    if (!file) return;
    document.getElementById("upload-filename").textContent = file.name;
    const resultEl = document.getElementById("upload-result");
    resultEl.innerHTML = `<div class="text-muted text-sm"><div class="spinner" style="width:13px;height:13px;display:inline-block;margin-right:6px"></div> Reading file…</div>`;

    let data;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch (e) {
      resultEl.innerHTML = `<div class="alert alert-danger">❌ File is not valid JSON: ${escHtml(e.message)}</div>`;
      return;
    }

    if (!Array.isArray(data.processes) || data.processes.length === 0) {
      resultEl.innerHTML = `<div class="alert alert-danger">❌ Not a valid scope-catalog.json — missing processes array.</div>`;
      return;
    }

    resultEl.innerHTML = `<div class="text-muted text-sm"><div class="spinner" style="width:13px;height:13px;display:inline-block;margin-right:6px"></div> Uploading…</div>`;
    const res = await api.post("/api/catalog/upload", data);
    if (res.ok) {
      resultEl.innerHTML = `<div class="alert alert-success">
        ✅ Catalog updated — <strong>${res.processes} processes</strong> · version <strong>${res.version}</strong><br>
        <span class="text-sm">Previous catalog backed up automatically.</span>
      </div>`;
      setTimeout(() => navigate("settings"), 2000);
    } else {
      resultEl.innerHTML = `<div class="alert alert-danger">❌ Upload failed: ${res.error || "unknown error"}</div>`;
    }
  };

  // ── Clear catalog ──
  window.clearCatalog = async () => {
    if (!confirm("This will remove scope-catalog.json (a backup copy is kept).\n\nYou will need to reload from SAP for Me before generating KDDs.\n\nContinue?")) return;
    const el  = document.getElementById("reload-result");
    const res = await api.post("/api/catalog/clear", {});
    if (res.ok) {
      el.innerHTML = `<div class="alert alert-warning">
        🗑 Catalog cleared${res.backup ? ` (backup saved as <code>${res.backup}</code>)` : ""}.<br>
        Use the Chrome extension to load fresh data, then click <strong>Reload Catalog</strong>.
      </div>`;
      // Re-render to show empty state
      setTimeout(() => navigate("settings"), 1500);
    } else {
      el.innerHTML = `<div class="alert alert-danger">⚠️ ${res.error || "Clear failed"}</div>`;
    }
  };

  // ── Rebuild cache only ──
  window.rebuildCache = async () => {
    const btn = document.getElementById("cache-btn");
    const el  = document.getElementById("cache-result");
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;display:inline-block;margin-right:5px"></div> Building…`;
    const res = await api.post("/api/cache/rebuild", {});
    btn.disabled  = false;
    btn.innerHTML = "🔄 Rebuild Cache Only";
    el.innerHTML  = res.ok
      ? `<div class="alert alert-success">✅ ${res.cachedItems.toLocaleString()} items · ${res.totalKDDs.toLocaleString()} KDD questions cached.</div>`
      : `<div class="alert alert-danger">⚠️ ${res.error}</div>`;
  };

  // ── Poll for new catalog every 8s (file watcher sets a flag on server) ──
  const poller = setInterval(async () => {
    if (document.getElementById("reload-btn")) {
      const s = await api.get("/api/status").catch(() => null);
      if (s && s.catalogChanged) {
        const banner = document.querySelector(".alert-info");
        if (!banner) {
          const el = document.createElement("div");
          el.className = "alert alert-info";
          el.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px";
          el.innerHTML = `<span>✨ <strong>New catalog detected</strong> — the Chrome extension just saved fresh data.</span>
            <button class="btn btn-primary btn-sm" onclick="reloadCatalog()">Reload Now</button>`;
          document.getElementById("app").prepend(el);
        }
      }
    } else {
      clearInterval(poller); // left the settings page
    }
  }, 8000);
}

// ── GAP ANALYSIS page ─────────────────────────────────────────────────────────
async function pagGapAnalysis() {
  let data;
  try {
    const sid = await _resolveSessionId();
    data = await api.get(`/api/kdd/data?session_id=${encodeURIComponent(sid)}`);
  } catch (e) { data = { error: e.message }; }

  if (data.error) {
    return `
      <div class="page-header"><div class="page-title">KDD Analysis</div></div>
      <div class="alert alert-warning">📋 No KDD data yet.
        <a href="#kdd-generator" style="color:var(--accent);font-weight:600">Generate KDDs first →</a>
      </div>`;
  }

  const rows = data.rows || [];
  const meta = data.meta || {};

  // ── RAG ──────────────────────────────────────────────────────────────────────
  const rag = r => {
    if (r.fitGap === "Gap" && (r.complexity === "High" || r.complexity === "Medium")) return "Red";
    if (r.fitGap === "Gap" || (r.fitGap === "Partial Fit" && r.complexity !== "Low")) return "Amber";
    return "Green";
  };

  const fitRows      = rows.filter(r => r.fitGap === "Fit");
  const partRows     = rows.filter(r => r.fitGap === "Partial Fit");
  const gapRows      = rows.filter(r => r.fitGap === "Gap");
  const redRows      = rows.filter(r => rag(r) === "Red");
  const amberRows    = rows.filter(r => rag(r) === "Amber");
  const greenRows    = rows.filter(r => rag(r) === "Green");
  const approvedRows = rows.filter(r => r.signOffStatus === "Approved");
  const decidedRows  = rows.filter(r => r.decisionMade && r.decisionMade.trim());

  // ── WRICEF data ───────────────────────────────────────────────────────────────
  const ricefRows  = rows.filter(r => r.ricefType && r.ricefType !== "None");
  const ricefTypes = ["W","R","I","C","E_RAP","E_CAPM","E_RAP_CAPM","F"];
  const ricefLabels = {W:"Workflow",R:"Report",I:"Interface",C:"Conversion",E_RAP:"Extension BTP–RAP",E_CAPM:"Extension BTP–CAPM",E_RAP_CAPM:"Extension BTP–RAP & CAPM & UI",F:"Form"};
  const effortOrder = {S:0,M:1,L:2,XL:3,None:4};

  const ricefByType   = Object.fromEntries(ricefTypes.map(t => [t, ricefRows.filter(r => r.ricefType === t).length]));
  const effortCounts  = {S:0,M:0,L:0,XL:0};
  ricefRows.forEach(r => { if (effortCounts[r.effortEstimate] !== undefined) effortCounts[r.effortEstimate]++; });
  const btpCount      = ricefRows.filter(r => r.btpRequired === "Yes").length;
  const btpPossible   = ricefRows.filter(r => r.btpRequired === "Possible").length;

  // ── Phase distribution ────────────────────────────────────────────────────────
  const phaseCounts = { Explore: 0, Realize: 0, Deploy: 0 };
  rows.forEach(r => { if (phaseCounts[r.sapActivatePhase] !== undefined) phaseCounts[r.sapActivatePhase]++; });

  // ── Per-scope-item ────────────────────────────────────────────────────────────
  const scopeIds = [...new Set(rows.map(r => r.scopeItemId))];
  const byItem   = scopeIds.map(id => {
    const ir = rows.filter(r => r.scopeItemId === id);
    return {
      id, name: (ir[0]||{}).scopeItemName || id,
      module:       ir[0] ? modName(ir[0]) : "—",
      complexities: [...new Set(ir.map(r => r.complexity).filter(Boolean))].join(","),
      total:    ir.length,
      fit:      ir.filter(r => r.fitGap === "Fit").length,
      part:     ir.filter(r => r.fitGap === "Partial Fit").length,
      gap:      ir.filter(r => r.fitGap === "Gap").length,
      red:      ir.filter(r => rag(r) === "Red").length,
      amber:    ir.filter(r => rag(r) === "Amber").length,
      green:    ir.filter(r => rag(r) === "Green").length,
      approved: ir.filter(r => r.signOffStatus === "Approved").length,
      decided:  ir.filter(r => r.decisionMade && r.decisionMade.trim()).length,
      ricef:    ir.filter(r => r.ricefType && r.ricefType !== "None").length,
    };
  }).sort((a, b) => b.gap - a.gap || b.red - a.red);

  // ── Module pivot — group by full LOB name ─────────────────────────────────────
  const modules = [...new Set(rows.map(r => modName(r)))].filter(Boolean).sort();
  const byModule = modules.map(m => {
    const mr = rows.filter(r => modName(r) === m);
    return {
      m, total: mr.length,
      fit:   mr.filter(r => r.fitGap === "Fit").length,
      part:  mr.filter(r => r.fitGap === "Partial Fit").length,
      gap:   mr.filter(r => r.fitGap === "Gap").length,
      ricef: mr.filter(r => r.ricefType && r.ricefType !== "None").length,
      decided: mr.filter(r => r.decisionMade && r.decisionMade.trim()).length,
    };
  }).sort((a,b) => b.gap - a.gap || b.total - a.total);

  // ── Complexity × Fit/Gap matrix ───────────────────────────────────────────────
  const cx = ["High","Medium","Low"];
  const fg = ["Fit","Partial Fit","Gap"];
  const matrix = cx.map(c => fg.map(f => rows.filter(r => r.complexity===c && r.fitGap===f).length));
  const matrixCell = (c, f, n) => {
    const isRed   = f==="Gap"          && c!=="Low";
    const isAmber = f==="Partial Fit"  && c==="High";
    const bg = isRed ? "#fee2e2" : isAmber ? "#fef3c7" : n ? "#f0fdf4" : "#f9fafb";
    const col= isRed ? "#dc2626" : isAmber ? "#d97706" : n ? "#059669" : "#9ca3af";
    return `<div onclick="gaFilter('complexity_fitgap','${c}|${f}')"
      style="background:${bg};color:${col};font-size:18px;font-weight:800;
             padding:14px 6px;text-align:center;border-radius:8px;cursor:${n?"pointer":"default"};
             border:1.5px solid ${isRed?"#fca5a5":isAmber?"#fcd34d":"#e5e7eb"};
             transition:transform 0.1s" onmouseenter="if(${n})this.style.transform='scale(1.05)'" onmouseleave="this.style.transform=''">
      ${n||"—"}
    </div>`;
  };

  // ── Stacked bar SVG ───────────────────────────────────────────────────────────
  const ragBar = (fit, part, gap, total) => {
    if (!total) return "";
    const W = 120, fw = Math.round(fit/total*W), pw = Math.round(part/total*W), gw = W-fw-pw;
    return `<svg width="${W}" height="10" style="border-radius:4px;overflow:hidden">
      <rect x="0" y="0" width="${fw}" height="10" fill="#059669"/>
      <rect x="${fw}" y="0" width="${pw}" height="10" fill="#d97706"/>
      <rect x="${fw+pw}" y="0" width="${gw}" height="10" fill="#dc2626"/>
    </svg>`;
  };

  // ── Progress bar ──────────────────────────────────────────────────────────────
  const progBar = (done, total) => {
    if (!total) return "";
    const pct = Math.round(done/total*100);
    const col = pct >= 70 ? "#059669" : pct >= 40 ? "#d97706" : "#dc2626";
    return `<div style="display:flex;align-items:center;gap:6px">
      <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;min-width:50px">
        <div style="width:${pct}%;height:6px;background:${col};border-radius:3px"></div>
      </div>
      <span style="font-size:11px;color:${col};font-weight:600;white-space:nowrap">${done}/${total}</span>
    </div>`;
  };

  // ── Scope item tbody HTML ─────────────────────────────────────────────────────
  const itemRowHTML = it =>
    `<tr data-fit="${it.fit}" data-part="${it.part}" data-gap="${it.gap}"
         data-red="${it.red}" data-amber="${it.amber}"
         data-approved="${it.approved}" data-ricef="${it.ricef||0}"
         data-complexities="${it.complexities}"
         data-module="${it.module}" data-id="${it.id}">
      <td><span style="color:var(--accent);font-family:monospace;font-weight:700">${it.id}</span></td>
      <td style="font-size:12px;max-width:200px">${it.name}</td>
      <td style="font-size:11.5px;color:var(--text-muted)">${it.module}</td>
      <td style="text-align:center">${it.total}</td>
      <td style="text-align:center;color:var(--success);font-weight:700">${it.fit}</td>
      <td style="text-align:center;color:var(--warning);font-weight:700">${it.part}</td>
      <td style="text-align:center;color:var(--danger);font-weight:700">${it.gap}</td>
      <td style="text-align:center;color:#4f46e5;font-weight:700">${it.ricef||"—"}</td>
      <td>${ragBar(it.fit,it.part,it.gap,it.total)}</td>
      <td style="min-width:120px">${progBar(it.decided,it.total)}</td>
    </tr>`;

  // ── Top risks — Gap + High or Medium complexity, not yet approved ────────────
  const topRisks = rows
    .filter(r => r.fitGap === "Gap" && (r.complexity === "High" || r.complexity === "Medium") && r.signOffStatus !== "Approved")
    .sort((a,b) => (b.complexity==="High"?1:0)-(a.complexity==="High"?1:0) || (a.scopeItemId||"").localeCompare(b.scopeItemId||""))
    .slice(0, 15);
  const riskRows = topRisks.length
    ? topRisks.map((r,i) => {
        const cxColor = r.complexity==="High" ? "#dc2626" : "#d97706";
        return `<tr>
          <td style="font-size:11px;color:var(--text-muted);text-align:center">${i+1}</td>
          <td><span class="badge badge-purple" style="font-size:10px">${r.scopeItemId}</span></td>
          <td style="font-size:12px">${r.designQuestion}</td>
          <td><span style="background:${cxColor}15;color:${cxColor};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap">Gap · ${r.complexity}</span></td>
          <td style="font-size:11.5px;color:var(--text-muted)">${r.decisionOwner||"—"}</td>
          <td><button class="btn btn-sm btn-outline"
            onclick="navigate('editor');setTimeout(()=>{ window._editorJumpTo && window._editorJumpTo('${r.kddId}'); },500)">
            Edit</button></td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text-muted)">✅ No high/medium-complexity gaps without a sign-off</td></tr>`;

  // ── RICEF Register ────────────────────────────────────────────────────────────
  const ricefRegister = ricefRows.length
    ? [...ricefRows].sort((a,b) => (effortOrder[b.effortEstimate]||4)-(effortOrder[a.effortEstimate]||4) || (a.ricefType||"").localeCompare(b.ricefType||""))
        .map((r,i) => {
          const effortColor = r.effortEstimate==="XL"?"#dc2626":r.effortEstimate==="L"?"#d97706":r.effortEstimate==="M"?"#0369a1":"#059669";
          const fgBadge = r.fitGap==="Gap"?`<span class="badge badge-red" style="font-size:10px">Gap</span>`:
                          r.fitGap==="Partial Fit"?`<span style="background:#fef3c7;color:#d97706;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700">Partial</span>`:"";
          return `<tr data-fitgap="${r.fitGap||""}" data-module="${modName(r)}" data-riceftype="${r.ricefType||""}">
            <td style="text-align:center;color:var(--text-muted);font-size:11px">${i+1}</td>
            <td style="font-family:monospace;font-size:11px;color:var(--accent)">${r.ricefId||"—"}</td>
            <td><span style="background:#ede9fe;color:#4f46e5;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700">${ricefLabels[r.ricefType]||r.ricefType}</span></td>
            <td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.ricefTitle||""}">${r.ricefTitle||"—"}</td>
            <td><span class="badge badge-purple" style="font-size:10px">${r.scopeItemId}</span> ${fgBadge}</td>
            <td style="font-size:11.5px;color:var(--text-muted)">${modName(r)}</td>
            <td style="font-size:11px">${r.extensibilityType||"—"}</td>
            <td style="text-align:center">${r.btpRequired==="Yes"?`<span style="color:#dc2626;font-weight:700">Yes</span>`:r.btpRequired==="Possible"?`<span style="color:#d97706">Possible</span>`:"No"}</td>
            <td style="text-align:center;font-weight:700;color:${effortColor}">${r.effortEstimate||"—"}</td>
            <td><button class="btn btn-sm btn-outline" style="font-size:11px"
              onclick="navigate('editor');setTimeout(()=>{ window._editorJumpTo && window._editorJumpTo('${r.kddId}'); },400)">Edit</button></td>
          </tr>`;
        }).join("")
    : `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted)">No WRICEF items — all rows are Fit. Set WRICEF Type on Gap rows in the editor.</td></tr>`;

  const healthPct   = rows.length ? Math.round(greenRows.length/rows.length*100) : 0;
  const healthColor = healthPct >= 70 ? "var(--success)" : healthPct >= 40 ? "var(--warning)" : "var(--danger)";
  const decidedPct  = rows.length ? Math.round(decidedRows.length/rows.length*100) : 0;

  // ── Tile click helper (injected as onclick string — defined in bindGapAnalysis) ─
  const tile = (label, value, note, color, filterKey, filterVal, tooltip) => {
    const hasFilter = !!(filterKey && filterVal !== undefined && filterVal !== "");
    return `<div class="card" data-ga-tile="${filterKey}||${filterVal}"
      ${tooltip ? `title="${tooltip}"` : ""}
      style="cursor:${hasFilter?"pointer":"default"};transition:box-shadow 0.15s,border-color 0.15s;
             padding:10px 12px;border:1.5px solid transparent"
      ${hasFilter ? `onclick="gaFilter('${filterKey}','${filterVal}')"
        onmouseenter="this.style.boxShadow='0 4px 16px rgba(0,0,0,0.12)'"
        onmouseleave="this.style.boxShadow=''"` : ""}>
      <div style="color:${color||"var(--text-muted)"};font-size:10px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;font-weight:700">${label}</div>
      <div style="color:${color||"var(--text)"};font-size:22px;line-height:1.1;margin-bottom:2px;font-weight:800">${value}</div>
      ${note ? `<div style="font-size:10px;color:var(--text-muted)">${note}</div>` : ""}
    </div>`;
  };

  return `
    <div class="page-header flex items-center justify-between" style="flex-wrap:wrap;gap:10px">
      <div>
        <div class="page-title">KDD Analysis</div>
        <div class="page-sub">High Level Summary · ${meta.client||"—"} · ${meta.project||"—"} ·
          ${rows.length} KDDs · ${scopeIds.length} scope item${scopeIds.length!==1?"s":""}
          ${meta.generatedAt ? ` · Generated ${new Date(meta.generatedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}` : ""}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="gaFilter('','')">⊘ Clear Filter</button>
        <button class="btn btn-outline" onclick="navigate('editor')">✎ Open Editor</button>
        <button class="btn btn-outline" onclick="navigate('kdd-generator')">◈ Add Scope Items</button>
        <button class="btn btn-primary" id="run-ai-btn" onclick="window.runAIAnalysis()">🤖 Run AI Analysis</button>
      </div>
    </div>

    <div id="ga-filter-bar" style="display:none;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:8px 14px;margin-bottom:12px;font-size:12.5px;align-items:center;gap:10px">
      <span>🔍 Filtered: <strong id="ga-filter-label"></strong></span>
      <button onclick="gaFilter('','')" style="background:none;border:none;color:#d97706;font-size:13px;cursor:pointer;font-weight:700">✕ Clear</button>
    </div>

    <!-- ── Summary tiles ── -->
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(90px,1fr));margin-bottom:12px">
      ${tile("Health Score",  healthPct+"%",           `${greenRows.length}/${rows.length} · Fit or low-risk`,  healthColor,  "",  "",  "% of KDDs that are Green RAG. Green = Fit rows, plus Gap or Partial Fit rows where complexity is Low. Red = Gap + High/Medium complexity. Amber = everything else.")}
      ${tile("Total KDDs",    rows.length,             scopeIds.length+" scope items",         "",                                                    "",        "")}
      ${tile("✔ Fit",         fitRows.length,          rows.length?Math.round(fitRows.length/rows.length*100)+"%":"—",  "var(--success)",             "fitgap",  "Fit")}
      ${tile("≈ Partial Fit", partRows.length,         rows.length?Math.round(partRows.length/rows.length*100)+"%":"—","var(--warning)",              "fitgap",  "Partial Fit")}
      ${tile("✗ Gap",         gapRows.length,          rows.length?Math.round(gapRows.length/rows.length*100)+"%":"—",  "var(--danger)",              "fitgap",  "Gap")}
      ${tile("🔴 Red RAG",    redRows.length,          "Gap + High/Med",                      "var(--danger)",                                        "rag",     "Red")}
      ${tile("🟡 Amber RAG",  amberRows.length,        "",                                    "var(--warning)",                                       "rag",     "Amber")}
      ${tile("✅ Approved",   approvedRows.length,     "of "+rows.length,                     "var(--success)",                                       "approved","yes")}
      ${tile("📝 Decisions",  decidedPct+"%",          decidedRows.length+" of "+rows.length, decidedPct>=70?"var(--success)":decidedPct>=40?"var(--warning)":"var(--danger)","decisions","yes")}
      ${tile("🔧 RICEF",      ricefRows.length,        "items to build",                      "#4f46e5",                                              "ricef",   "yes")}
    </div>

    <!-- ── Phase distribution strip ── -->
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Phase:</span>
      ${[["Explore","#059669"],["Realize","#0369a1"],["Deploy","#7c3aed"]].map(([p,c]) =>
        phaseCounts[p] ? `<span style="background:${c}15;color:${c};border:1px solid ${c}30;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700">${p}: ${phaseCounts[p]}</span>` : ""
      ).join("")}
      <span style="font-size:11px;color:var(--text-muted);margin-left:4px">(SAP Activate phase of each KDD)</span>
    </div>

    <!-- ── Two-column: Matrix + RICEF effort ── -->
    <div style="display:grid;grid-template-columns:auto 1fr;gap:16px;margin-bottom:20px;align-items:start">

      <!-- Complexity × Fit/Gap matrix -->
      <div class="card" style="padding:16px;min-width:280px">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em">Risk Matrix — click to filter ↓</div>
        <div style="display:grid;grid-template-columns:60px 1fr 1fr 1fr;gap:6px;align-items:center">
          <div></div>
          ${fg.map(f => `<div style="text-align:center;font-size:11px;font-weight:700;color:${f==="Gap"?"var(--danger)":f==="Partial Fit"?"var(--warning)":"var(--success)"}">${f}</div>`).join("")}
          ${cx.map((c,ci) => `
            <div style="font-size:11px;font-weight:700;color:var(--text-muted)">${c}</div>
            ${fg.map((f,fi) => matrixCell(c,f,matrix[ci][fi])).join("")}
          `).join("")}
        </div>
      </div>

      <!-- RICEF effort summary -->
      <div class="card" style="padding:16px">
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:.05em">🔧 WRICEF Effort Summary — ${ricefRows.length} items total</div>
        ${ricefRows.length ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:14px">
          ${ricefTypes.filter(t => ricefByType[t]).map(t => `
            <div style="background:#f5f3ff;border-radius:8px;padding:10px 12px;border-left:3px solid #7c3aed">
              <div style="font-size:11px;color:#6d28d9;font-weight:700">${ricefLabels[t]||t}</div>
              <div style="font-size:22px;font-weight:800;color:#4f46e5">${ricefByType[t]}</div>
            </div>`).join("")}
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:8px">EFFORT DISTRIBUTION</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${[["S","#059669"],["M","#0369a1"],["L","#d97706"],["XL","#dc2626"]].filter(([e])=>effortCounts[e]).map(([e,c]) =>
              `<span style="background:${c}1a;color:${c};border:1px solid ${c}33;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">${e}: ${effortCounts[e]}</span>`
            ).join("")}
            <span style="margin-left:8px;font-size:12px;color:var(--text-muted)">|</span>
            <span style="font-size:12px;font-weight:600;color:#dc2626">BTP Required: ${btpCount}</span>
            ${btpPossible ? `<span style="font-size:12px;color:#d97706">Possible: ${btpPossible}</span>` : ""}
          </div>
        </div>` : `<div style="color:var(--text-muted);font-size:13px;padding:20px 0">No WRICEF items yet — set WRICEF Type on Gap rows in the editor.</div>`}
      </div>
    </div>

    <!-- ── Top Risks — moved near top for action visibility ── -->
    <div class="section-divider">🔴 Top Risks — Gap + High/Medium Complexity, not yet approved</div>
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="width:32px">#</th><th style="width:70px">Item</th>
            <th>Design Question</th>
            <th style="width:75px">Complexity</th>
            <th style="width:70px">Owner</th><th style="width:70px">Action</th>
          </tr></thead>
          <tbody>${riskRows}</tbody>
        </table>
      </div>
    </div>

    <!-- ── Scope item table ── -->
    <div class="section-divider" style="display:flex;align-items:center;justify-content:space-between">
      <span>Fit / Gap by Scope Item <span id="ga-scope-count" style="color:var(--text-muted);font-weight:400;font-size:12px">(${byItem.length} items)</span></span>
      <span style="font-size:11px;color:var(--text-muted)">Click a tile above to filter ↑</span>
    </div>
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>ID</th><th>Process</th><th>Module</th>
            <th style="text-align:center">Total</th>
            <th style="text-align:center;color:var(--success)">Fit</th>
            <th style="text-align:center;color:var(--warning)">Partial</th>
            <th style="text-align:center;color:var(--danger)">Gap</th>
            <th style="text-align:center;color:#4f46e5">RICEF</th>
            <th style="width:130px">Distribution</th>
            <th style="width:140px">Decisions Made</th>
          </tr></thead>
          <tbody id="ga-scope-tbody">${byItem.map(itemRowHTML).join("")}</tbody>
        </table>
      </div>
    </div>

    <!-- ── Module pivot ── -->
    <div class="section-divider">Fit / Gap by Line of Business / Module</div>
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Module / LoB</th>
            <th style="text-align:center">Total</th>
            <th style="text-align:center;color:var(--success)">Fit</th>
            <th style="text-align:center;color:var(--warning)">Partial</th>
            <th style="text-align:center;color:var(--danger)">Gap</th>
            <th style="text-align:center;color:#4f46e5">RICEF</th>
            <th style="width:160px">Distribution</th>
            <th style="width:160px">Decisions Made</th>
          </tr></thead>
          <tbody id="ga-module-tbody">
            ${byModule.map(m => `<tr data-fit="${m.fit}" data-part="${m.part}" data-gap="${m.gap}" data-ricef="${m.ricef}" data-module="${m.m}">
              <td style="font-weight:600;font-size:12.5px">${m.m}</td>
              <td style="text-align:center">${m.total}</td>
              <td style="text-align:center;color:var(--success);font-weight:700">${m.fit}</td>
              <td style="text-align:center;color:var(--warning);font-weight:700">${m.part}</td>
              <td style="text-align:center;color:var(--danger);font-weight:700">${m.gap}</td>
              <td style="text-align:center;color:#4f46e5;font-weight:700">${m.ricef||"—"}</td>
              <td>${ragBar(m.fit,m.part,m.gap,m.total)}</td>
              <td>${progBar(m.decided,m.total)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── WRICEF Inventory ── -->
    <div class="section-divider">🔧 WRICEF Inventory — ${ricefRows.length} items</div>
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="width:32px">#</th>
            <th style="width:80px">RICEF ID</th>
            <th style="width:130px">Type</th>
            <th style="max-width:180px">Title</th>
            <th style="width:100px">Scope Item</th>
            <th>Module</th>
            <th>Extensibility</th>
            <th style="width:60px;text-align:center">BTP</th>
            <th style="width:55px;text-align:center">Effort</th>
            <th style="width:55px">Action</th>
          </tr></thead>
          <tbody id="ga-ricef-tbody">${ricefRegister}</tbody>
        </table>
      </div>
    </div>

    <!-- AI Analysis panel -->
    <div id="ai-analysis-panel" style="margin-top:24px"></div>`;
}

function bindGapAnalysis() {
  // "Edit →" buttons in top-risks table jump to that KDD in the editor
  window._editorJumpTo = (kddId) => {
    if (window.toggleExpand) window.toggleExpand(kddId);
    const row = document.getElementById(`row-${kddId}`);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // ── Global filter — tiles, matrix, or clear ──────────────────────────────
  const FIELD_LABELS = {
    fitgap:           "Fit/Gap",
    rag:              "RAG",
    approved:         "Sign-off",
    decisions:        "Decisions",
    ricef:            "RICEF",
    complexity_fitgap:"Risk Matrix"
  };

  window.gaFilter = (field, value) => {
    const scopeTbody  = document.getElementById("ga-scope-tbody");
    const moduleTbody = document.getElementById("ga-module-tbody");
    const ricefTbody  = document.getElementById("ga-ricef-tbody");
    const filterBar   = document.getElementById("ga-filter-bar");
    const filterLbl   = document.getElementById("ga-filter-label");
    const countEl     = document.getElementById("ga-scope-count");
    if (!scopeTbody) return;

    const scopeRows = Array.from(scopeTbody.querySelectorAll("tr"));

    // ── Highlight active tile ──────────────────────────────────────────────
    document.querySelectorAll("[data-ga-tile]").forEach(el => {
      el.style.border = "1.5px solid transparent";
      el.style.boxShadow = "";
    });
    if (field && value) {
      const active = document.querySelector(`[data-ga-tile="${field}||${value}"]`);
      if (active) active.style.border = "1.5px solid var(--accent)";
    }

    if (!field || !value) {
      // Clear all filters
      scopeRows.forEach(tr => tr.style.display = "");
      if (moduleTbody) Array.from(moduleTbody.querySelectorAll("tr")).forEach(tr => tr.style.display = "");
      if (ricefTbody)  Array.from(ricefTbody.querySelectorAll("tr")).forEach(tr => tr.style.display = "");
      if (filterBar) filterBar.style.display = "none";
      if (countEl)   countEl.textContent = `(${scopeRows.length} items)`;
      return;
    }

    // ── Build friendly label ───────────────────────────────────────────────
    let labelText = `${FIELD_LABELS[field] || field}: ${value}`;

    // ── Row matcher — returns true if scope-item TR matches the filter ─────
    const matchRow = tr => {
      const fit  = parseInt(tr.dataset.fit  ||"0",10);
      const part = parseInt(tr.dataset.part ||"0",10);
      const gap  = parseInt(tr.dataset.gap  ||"0",10);
      switch (field) {
        case "fitgap":
          if (value==="Fit")         return fit  > 0;
          if (value==="Partial Fit") return part > 0;
          if (value==="Gap")         return gap  > 0;
          return false;
        case "rag":
          if (value==="Red")   return parseInt(tr.dataset.red  ||"0",10) > 0;
          if (value==="Amber") return parseInt(tr.dataset.amber||"0",10) > 0;
          return false;
        case "approved":
          return parseInt(tr.dataset.approved||"0",10) > 0;
        case "decisions":
          return parseInt(tr.dataset.approved||"0",10) > 0; // same proxy
        case "ricef":
          return parseInt(tr.dataset.ricef||"0",10) > 0;
        case "complexity_fitgap": {
          const [cxFilter, fgFilter] = value.split("|");
          // Filter by fit/gap AND by whether the scope item has rows of that complexity
          const cxList = (tr.dataset.complexities || "").split(",");
          let fgMatch = false;
          if (fgFilter==="Fit")         fgMatch = fit  > 0;
          if (fgFilter==="Partial Fit") fgMatch = part > 0;
          if (fgFilter==="Gap")         fgMatch = gap  > 0;
          labelText = `Risk Matrix: ${cxFilter} complexity, ${fgFilter}`;
          return fgMatch && cxList.includes(cxFilter);
        }
        default: return true;
      }
    };

    // ── Filter scope item table ────────────────────────────────────────────
    let shown = 0;
    scopeRows.forEach(tr => {
      const m = matchRow(tr);
      tr.style.display = m ? "" : "none";
      if (m) shown++;
    });
    if (filterBar) filterBar.style.display = "flex";
    if (filterLbl) filterLbl.textContent = labelText;
    if (countEl)   countEl.textContent = `(${shown} of ${scopeRows.length} items)`;

    // ── Filter module pivot table ──────────────────────────────────────────
    if (moduleTbody) {
      Array.from(moduleTbody.querySelectorAll("tr")).forEach(tr => {
        const fit  = parseInt(tr.dataset.fit  ||"0",10);
        const part = parseInt(tr.dataset.part ||"0",10);
        const gap  = parseInt(tr.dataset.gap  ||"0",10);
        let m = true;
        switch (field) {
          case "fitgap":
            if (value==="Fit")         m = fit  > 0; break;
            if (value==="Partial Fit") m = part > 0; break;
            if (value==="Gap")         m = gap  > 0; break;
          case "rag":
            if (value==="Red")   m = gap  > 0; break;  // red = gap rows exist
            if (value==="Amber") m = part > 0; break;
          case "ricef":
            m = parseInt(tr.dataset.ricef||"0",10) > 0; break;
          default: m = true;
        }
        tr.style.display = m ? "" : "none";
      });
    }

    // ── Filter RICEF register table ────────────────────────────────────────
    if (ricefTbody) {
      Array.from(ricefTbody.querySelectorAll("tr")).forEach(tr => {
        let m = true;
        switch (field) {
          case "fitgap":
            m = (tr.dataset.fitgap || "") === value; break;
          case "rag":
            if (value==="Red")   m = tr.dataset.fitgap === "Gap"; break;
            if (value==="Amber") m = tr.dataset.fitgap === "Partial Fit" || tr.dataset.fitgap === "Gap"; break;
          case "ricef":
            m = true; break; // register only shows RICEF items, all match
          default: m = true;
        }
        tr.style.display = m ? "" : "none";
      });
    }
  };

  // ── AI Gap Analysis — 3-step agentic SSE ─────────────────────────────────
  // Step 1: local stats (instant)
  // Step 2: Claude — cross-scope integration risks
  // Step 3: Claude — gap themes + prioritised recommendations
  // Step 2 result (risk scope items) feeds into the Step 3 prompt — this is the agentic chain.
  window.runAIAnalysis = async () => {
    const btn   = document.getElementById("run-ai-btn");
    const panel = document.getElementById("ai-analysis-panel");
    if (!panel) return;

    if (btn) { btn.disabled = true; btn.textContent = "⏳ Analysing…"; }

    panel.innerHTML = `
      <div class="section-divider">🤖 AI Gap Analysis — Powered by Claude</div>
      <div style="margin-bottom:16px">
        <div class="ai-step" id="ai-step-1" style="padding:8px 0;font-size:13px;color:var(--text-muted)">⬜ Step 1: Analysing KDD data…</div>
        <div class="ai-step" id="ai-step-2" style="padding:8px 0;font-size:13px;color:var(--text-muted)">⬜ Step 2: Identifying cross-scope integration risks (Claude)…</div>
        <div class="ai-step" id="ai-step-3" style="padding:8px 0;font-size:13px;color:var(--text-muted)">⬜ Step 3: Prioritising gaps and generating recommendations (Claude)…</div>
      </div>
      <div id="ai-output"></div>`;

    const STEP_LABELS = [
      "📊 Step 1: KDD data analysed",
      "🔗 Step 2: Integration risks identified",
      "🎯 Step 3: Gaps prioritised"
    ];

    const setStep = (n, state, warn) => {
      const el = document.getElementById(`ai-step-${n}`);
      if (!el) return;
      const icon = state === "done" ? "✅" : state === "warn" ? "⚠️" : "⏳";
      const color = state === "done" ? "var(--success)" : state === "warn" ? "var(--warning)" : "var(--accent)";
      el.style.color = color;
      el.textContent = `${icon} ${STEP_LABELS[n-1]}${warn ? " — " + warn : ""}`;
    };

    try {
      const sid = await _resolveSessionId();
      const resp = await fetch(`/api/kdd/gap-analysis?session_id=${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Server error " + resp.status }));
        throw new Error(err.error || "Server error " + resp.status);
      }

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();  // keep incomplete line for next chunk

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let evt;
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }

          if (evt.type === "step")      { setStep(evt.step, "active"); }
          if (evt.type === "step_done") { setStep(evt.step, "done"); }
          if (evt.type === "step_warn") { setStep(evt.step, "warn", evt.message); }
          if (evt.type === "error")     {
            document.getElementById("ai-output").innerHTML =
              `<div class="alert alert-warning">⚠️ ${evt.message}</div>`;
          }
          if (evt.type === "complete")  {
            renderAIResults(evt, document.getElementById("ai-output"));
          }
        }
      }
    } catch (e) {
      const out = document.getElementById("ai-output");
      if (out) out.innerHTML = `<div class="alert alert-warning">⚠️ ${escHtml(e.message)}</div>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "🤖 Run AI Analysis"; }
    }
  };

  // ── Render AI results into the output div ─────────────────────────────────
  function renderAIResults(evt, container) {
    if (!container) return;
    const { stats, risks, analysis } = evt;
    let html = "";

    // Stats strip
    if (stats) {
      html += `<div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr));margin-bottom:20px">
        <div class="card"><div class="card-title">🔴 Red RAG</div>
          <div class="card-value" style="color:var(--danger)">${stats.totalRed}</div></div>
        <div class="card"><div class="card-title">Total Gaps</div>
          <div class="card-value">${stats.totalGap}</div></div>
        <div class="card"><div class="card-title">RICEF Items</div>
          <div class="card-value">${stats.totalRICEF}</div></div>
        <div class="card"><div class="card-title">Open Decisions</div>
          <div class="card-value" style="color:var(--warning)">${stats.openDecisions}</div></div>
        <div class="card"><div class="card-title">✅ Approved</div>
          <div class="card-value" style="color:var(--success)">${stats.approved}</div></div>
      </div>`;
    }

    // Integration risks from Step 2
    if (risks && risks.length) {
      html += `<div class="section-divider" style="margin-top:0">🔗 Cross-Scope Integration Risks</div>
        <div style="display:grid;gap:10px;margin-bottom:20px">`;
      risks.forEach(r => {
        const sev = r.severity === "High" ? "var(--danger)" : r.severity === "Medium" ? "var(--warning)" : "var(--success)";
        html += `<div class="card" style="border-left:3px solid ${sev};padding:12px 16px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span class="badge" style="background:${sev};color:#fff;min-width:54px;text-align:center">${r.severity}</span>
            <strong style="font-size:13.5px">${r.title || ""}</strong>
            ${(r.scopeItems||[]).map(s=>`<span class="badge badge-purple">${s}</span>`).join("")}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:5px">⚙ ${r.integrationPoint || ""}</div>
          <div style="font-size:13px;margin-bottom:6px">${r.description || ""}</div>
          <div style="font-size:12.5px;color:var(--accent)">→ ${r.action || ""}</div>
        </div>`;
      });
      html += `</div>`;
    }

    // Gap themes + recommendations from Step 3
    if (analysis) {
      if (analysis.healthSummary) {
        html += `<div style="background:rgba(139,92,246,0.12);border:1px solid var(--accent);border-radius:8px;
                   padding:12px 16px;margin-bottom:14px;font-size:13.5px">
          💡 <strong>Health Summary:</strong> ${analysis.healthSummary}</div>`;
      }
      if (analysis.topAction) {
        html += `<div class="alert alert-warning" style="margin-bottom:14px">
          🎯 <strong>Top Priority Action:</strong> ${analysis.topAction}</div>`;
      }
      if (analysis.workshopFocus) {
        html += `<div style="background:rgba(5,150,105,0.1);border:1px solid var(--success);border-radius:8px;
                   padding:12px 16px;margin-bottom:20px;font-size:13px">
          📋 <strong>Workshop Focus:</strong> ${analysis.workshopFocus}</div>`;
      }
      if (analysis.themes && analysis.themes.length) {
        html += `<div class="section-divider" style="margin-top:0">🎯 Gap Themes — Prioritised by Business Impact</div>`;
        analysis.themes.forEach(theme => {
          const pClr = theme.priority === "Critical" ? "var(--danger)"
                     : theme.priority === "High"     ? "var(--warning)"
                     : "var(--accent)";
          html += `<div class="card" style="margin-bottom:12px;padding:0;overflow:hidden">
            <div style="padding:10px 16px;background:rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.06);
                        display:flex;align-items:center;gap:10px">
              <span class="badge" style="background:${pClr};color:#fff">${theme.priority}</span>
              <strong>${theme.theme}</strong>
              <span style="color:var(--text-muted);font-size:12px">${(theme.items||[]).length} items</span>
            </div>
            <div>
              ${(theme.items||[]).map(it=>`
                <div style="display:grid;grid-template-columns:130px 1fr;gap:8px;padding:10px 16px;
                            border-bottom:1px solid rgba(255,255,255,0.04)">
                  <div><span class="badge badge-purple" style="font-size:10.5px">${it.kddId||""}</span></div>
                  <div>
                    <div style="font-size:12.5px;margin-bottom:4px">${it.question||""}</div>
                    <div style="font-size:12px;color:var(--accent)">→ ${it.approach||""}</div>
                  </div>
                </div>`).join("")}
            </div>
          </div>`;
        });
      }
    }

    container.innerHTML = html ||
      `<div class="alert alert-warning">No AI results returned — Claude may be unavailable, try again.</div>`;
  }
}

// ── KDD EDITOR page ───────────────────────────────────────────────────────────
// Loads kdd-data.json, renders an editable table, saves changes back,
// runs Claude quality critique, exports final Excel, marks as ready.

async function _resolveSessionId() {
  if (window._lastKddSessionId) return window._lastKddSessionId;
  // No in-memory or localStorage session — ask the server for the latest saved session
  try {
    const s = await api.get("/api/kdd/sessions");
    if (s.sessions && s.sessions.length) {
      const latest = s.sessions[0].sessionId;
      window._lastKddSessionId = latest;
      localStorage.setItem("kddSessionId", latest);
      return latest;
    }
  } catch (_) {}
  return "default";
}

async function pagEditor() {
  let data;
  try {
    const sid = await _resolveSessionId();
    data = await api.get(`/api/kdd/data?session_id=${encodeURIComponent(sid)}`);
  } catch (e) {
    data = { error: e.message };
  }

  if (data.error) {
    return `
      <div class="page-header">
        <div class="page-title">KDD Editor</div>
        <div class="page-sub">Review · Edit · Export</div>
      </div>
      <div class="alert alert-warning" style="margin-top:8px">
        📋 No KDD data yet.
        <a href="#kdd-generator" style="color:var(--accent);font-weight:600">Generate a KDD log first →</a>
      </div>`;
  }

  const rows = data.rows || [];
  const meta = data.meta || {};

  // Stats
  const fitCount      = rows.filter(r => r.fitGap === "Fit").length;
  const gapCount      = rows.filter(r => r.fitGap === "Gap").length;
  const partialCount  = rows.filter(r => r.fitGap === "Partial Fit").length;
  const doneCount     = rows.filter(r => r.decisionMade && r.decisionMade.trim()).length;
  const approvedCount = rows.filter(r => r.signOffStatus === "Approved").length;
  const deferredCount = rows.filter(r => r.signOffStatus === "Deferred").length;
  const rejectedCount = rows.filter(r => r.signOffStatus === "Rejected").length;
  const bpdCount      = rows.filter(r => r.bpdRef && r.bpdRef.trim()).length;

  // Scope item filter options
  const scopeIds = [...new Set(rows.map(r => r.scopeItemId))];

  const ricefRows   = rows.filter(r => r.ricefType && r.ricefType !== "None");
  const ricefByMod  = {};  ricefRows.forEach(r => { const m = modName(r); ricefByMod[m] = (ricefByMod[m]||0)+1; });
  const ricefByType = {};  ricefRows.forEach(r => { ricefByType[r.ricefType] = (ricefByType[r.ricefType]||0)+1; });

  return `
    <!-- ── Page header (always visible above tabs) ──────────────────────────── -->
    <div class="page-header flex items-center justify-between" style="flex-wrap:wrap;gap:10px;margin-bottom:0">
      <div>
        <div class="page-title">KDD Editor</div>
        <div class="page-sub" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span>${meta.client || "—"} · ${meta.project || "—"} · ${rows.length} KDDs · ${scopeIds.length} scope items
          ${meta.lastEditedAt ? `· last saved ${new Date(meta.lastEditedAt).toLocaleTimeString("en-GB")}` : ""}</span>
          <button id="proj-switch-btn" onclick="toggleProjectPanel()"
            style="background:#ede9fe;color:#6d28d9;border:1px solid #ddd6fe;border-radius:6px;
                   padding:3px 10px;font-size:11.5px;font-weight:600;cursor:pointer">
            📁 Projects
          </button>
        </div>
      </div>
      <div class="editor-toolbar">
        <span id="save-indicator" class="save-indicator clean" title="Ctrl+S to save">✔ Saved</span>
        <button class="btn btn-outline btn-sm" id="view-toggle-btn" onclick="toggleViewMode()">⊞ Card View</button>
        <button class="btn btn-outline btn-sm" onclick="openWorkshopModal()">📋 Workshop</button>
        <button class="btn btn-outline btn-sm" id="critique-btn" onclick="runCritique()">⚡ Quality Check</button>
        <button class="btn btn-outline btn-sm" id="save-btn" onclick="saveEdits()">💾 Save</button>
        <button class="btn btn-primary btn-sm" id="export-btn" onclick="exportExcel()">⬇ Export Excel</button>
        <button class="btn btn-outline btn-sm" id="ppt-btn" onclick="exportPPT()">📊 PPT</button>
        <button class="btn btn-sm" style="background:#0f766e;color:#fff;padding:6px 14px;border-radius:6px;font-size:12.5px;font-weight:600"
          onclick="openPresenter()">🎭 Presenter</button>
      </div>
    </div>

    <!-- ── Tab bar ────────────────────────────────────────────────────────────── -->
    <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin:14px 0 18px">
      <button id="kdd-tab-overview" onclick="kddSwitchTab('overview')"
        style="padding:10px 20px;font-size:13px;font-weight:600;border:none;cursor:pointer;
               background:none;border-bottom:2px solid var(--border);color:var(--text-muted);
               margin-bottom:-2px;transition:color .15s">
        📊 Overview
      </button>
      <button id="kdd-tab-editor" onclick="kddSwitchTab('editor')"
        style="padding:10px 20px;font-size:13px;font-weight:600;border:none;cursor:pointer;
               background:none;border-bottom:2px solid var(--accent);color:var(--accent);
               margin-bottom:-2px;transition:color .15s">
        ✏️ Editor
      </button>
      <button id="kdd-tab-wricef" onclick="kddSwitchTab('wricef')"
        style="padding:10px 20px;font-size:13px;font-weight:600;border:none;cursor:pointer;
               background:none;border-bottom:2px solid transparent;color:var(--text-muted);
               margin-bottom:-2px;transition:color .15s">
        🔧 WRICEF Inventory
      </button>
    </div>

    <!-- ══ OVERVIEW TAB ══════════════════════════════════════════════════════════ -->
    <div id="kdd-panel-overview" style="display:none">

      <div class="editor-stats">
        <div class="editor-stat"><div class="editor-stat-val">${rows.length}</div><div class="editor-stat-lbl">Total KDDs</div></div>
        <div class="editor-stat"><div class="editor-stat-val" style="color:var(--success)">${fitCount}</div><div class="editor-stat-lbl">Fit</div></div>
        <div class="editor-stat"><div class="editor-stat-val" style="color:var(--warning)">${partialCount}</div><div class="editor-stat-lbl">Partial Fit</div></div>
        <div class="editor-stat"><div class="editor-stat-val" style="color:var(--danger)">${gapCount}</div><div class="editor-stat-lbl">Gap</div></div>
        <div class="editor-stat"><div class="editor-stat-val" style="color:var(--accent)">${doneCount}</div><div class="editor-stat-lbl">Decisions Made</div></div>
        <div class="editor-stat" style="border-top:2px solid #86efac">
          <div class="editor-stat-val" style="color:var(--success)">${approvedCount}</div>
          <div class="editor-stat-lbl">✅ Approved</div>
        </div>
        <div class="editor-stat" style="border-top:2px solid #fbbf24">
          <div class="editor-stat-val" style="color:var(--warning)">${deferredCount}</div>
          <div class="editor-stat-lbl">⏸ Deferred</div>
        </div>
        <div class="editor-stat" style="border-top:2px solid #f87171">
          <div class="editor-stat-val" style="color:var(--danger)">${rejectedCount}</div>
          <div class="editor-stat-lbl">❌ Rejected</div>
        </div>
        <div class="editor-stat" style="border-top:2px solid var(--accent)">
          <div class="editor-stat-val" style="color:var(--accent)">${bpdCount}</div>
          <div class="editor-stat-lbl">📋 BPD Refs</div>
        </div>
        <div class="editor-stat" style="border-top:2px solid #4f46e5">
          <div class="editor-stat-val" style="color:#4f46e5">${ricefRows.length}</div>
          <div class="editor-stat-lbl">🔧 WRICEF Items</div>
        </div>
      </div>

      ${ricefRows.length ? `
      <div class="card" style="margin-top:12px">
        <div class="card-title">WRICEF Breakdown</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:12px;font-weight:700;color:#4f46e5">By Module</span>
          ${Object.entries(ricefByMod).sort((a,b)=>b[1]-a[1]).map(([m,n])=>
            `<span style="background:#ede9fe;color:#4f46e5;padding:3px 10px;border-radius:10px;font-size:12px;font-weight:600">${m}: ${n}</span>`).join("")}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:700;color:#0369a1">By Type</span>
          ${Object.entries(ricefByType).sort((a,b)=>b[1]-a[1]).map(([t,n])=>
            `<span style="background:#f0f9ff;color:#0369a1;padding:3px 10px;border-radius:10px;font-size:12px;font-weight:600">${t}: ${n}</span>`).join("")}
        </div>
      </div>` : ""}

      <div class="card" style="margin-top:12px">
        <div class="card-title">Project Details</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;font-size:13px">
          <div><span style="color:var(--text-muted)">Client</span><br><strong>${meta.client || "—"}</strong></div>
          <div><span style="color:var(--text-muted)">Project</span><br><strong>${meta.project || "—"}</strong></div>
          <div><span style="color:var(--text-muted)">Scope Items</span><br><strong>${scopeIds.join(", ") || "—"}</strong></div>
          <div><span style="color:var(--text-muted)">Generated</span><br><strong>${meta.generatedAt ? new Date(meta.generatedAt).toLocaleDateString("en-GB") : "—"}</strong></div>
          <div><span style="color:var(--text-muted)">Last Saved</span><br><strong>${meta.lastEditedAt ? new Date(meta.lastEditedAt).toLocaleString("en-GB") : "—"}</strong></div>
        </div>
        <div style="margin-top:14px">
          <button class="btn btn-primary btn-sm" onclick="kddSwitchTab('editor')">Open Editor →</button>
        </div>
      </div>

    </div><!-- /kdd-panel-overview -->

    <!-- ══ EDITOR TAB (default active) ══════════════════════════════════════════ -->
    <div id="kdd-panel-editor">

    <!-- Filters -->
    <div class="card" style="padding:12px 16px;margin-bottom:12px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <select id="filter-scope" class="form-select" style="width:auto;min-width:150px" onchange="applyFilters()">
          <option value="">All Scope Items</option>
          ${scopeIds.map(id => `<option value="${id}">${id}</option>`).join("")}
        </select>
        <select id="filter-status" class="form-select" style="width:auto;min-width:130px" onchange="applyFilters()">
          <option value="">All Status</option>
          <option value="Open">Open</option>
          <option value="In Progress">In Progress</option>
          <option value="Deferred">Deferred</option>
          <option value="Approved">Approved</option>
          <option value="Decision Made">Decision Made</option>
          <option value="Closed">Closed</option>
        </select>
        <select id="filter-fitgap" class="form-select" style="width:auto;min-width:130px" onchange="applyFilters()">
          <option value="">All Fit/Gap</option>
          <option value="Fit">Fit</option>
          <option value="Partial Fit">Partial Fit</option>
          <option value="Gap">Gap</option>
        </select>
        <select id="filter-signoff" class="form-select" style="width:auto;min-width:140px" onchange="applyFilters()">
          <option value="">All Sign-off</option>
          <option value="Open">Open</option>
          <option value="Approved">✅ Approved</option>
          <option value="Deferred">⏸ Deferred</option>
          <option value="Rejected">❌ Rejected</option>
        </select>
        <input id="filter-search" class="form-input" placeholder="🔍 Search questions or BPD ref…"
          style="flex:1;min-width:180px" oninput="applyFilters()" />
      </div>
    </div>

    <div id="critique-panel"></div>
    <div id="export-result"></div>

    <!-- Editable table / card view -->
    <div id="kdd-table-wrap" class="card" style="padding:0;overflow:hidden">
      <div class="table-wrap">
        <table id="kdd-table">
          <thead>
            <tr>
              <th style="width:90px">KDD ID</th>
              <th style="width:70px">Item</th>
              <th style="width:130px">LoB</th>
              <th>Design Question</th>
              <th style="width:100px">Fit / Gap</th>
              <th style="width:115px">Resolution</th>
              <th style="width:100px">Status</th>
              <th style="width:120px">Owner</th>
              <th style="width:80px"></th>
            </tr>
          </thead>
          <tbody id="kdd-tbody"></tbody>
        </table>
      </div>
    </div>
    <div id="kdd-card-view" style="display:none">
      <div id="kdd-cards-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;padding:16px"></div>
    </div>

    </div><!-- /kdd-panel-editor -->

    <!-- ══ WRICEF INVENTORY TAB ═══════════════════════════════════════════════════ -->
    <div id="kdd-panel-wricef" style="display:none">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--text)">🔧 WRICEF Inventory</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">All Gap rows with a WRICEF resolution — ready for solution board review</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span id="wricef-count-badge" style="background:#ede9fe;color:#4f46e5;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700"></span>
          <button class="btn btn-primary btn-sm" id="wricef-export-btn" onclick="exportWRICEFExcel()">⬇ Export Excel</button>
        </div>
      </div>
      <div id="wricef-export-result"></div>

      <!-- Summary strip -->
      <div id="wricef-summary-strip" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"></div>

      <!-- Table -->
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table id="wricef-table">
            <thead><tr>
              <th style="width:90px">WRICEF ID</th>
              <th style="width:70px">KDD ID</th>
              <th style="width:70px">Item</th>
              <th style="width:120px">Module</th>
              <th>Design Question</th>
              <th style="width:110px">WRICEF Type</th>
              <th style="width:90px">Complexity</th>
              <th style="width:90px">Extensibility</th>
              <th style="width:70px;text-align:center">BTP</th>
              <th style="width:55px;text-align:center">Effort</th>
              <th style="width:100px">Status</th>
              <th style="width:110px">Owner</th>
            </tr></thead>
            <tbody id="wricef-tbody"></tbody>
          </table>
        </div>
      </div>
    </div><!-- /kdd-panel-wricef -->

    <!-- ── Workshop Presenter Overlay ── -->
    <div id="presenter-overlay">
      <div class="presenter-header">
        <div style="display:flex;align-items:center;gap:14px">
          <span style="font-size:18px">🎭</span>
          <div>
            <div style="font-weight:700;color:#e2d9f3;font-size:14px">Workshop Presenter</div>
            <div style="font-size:11px;color:#9d7fe5">Open decisions only · click a card to pre-fill · Esc to exit</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:14px">
          <span id="p-progress" style="color:#9d7fe5;font-size:13px;font-weight:600"></span>
          <button onclick="closePresenter()"
            style="background:#4c2b9e;color:#e2d9f3;border:none;padding:6px 14px;border-radius:6px;
                   font-size:13px;font-weight:600;cursor:pointer">✕ Exit</button>
        </div>
      </div>

      <div class="presenter-body">
        <!-- Left: context panel -->
        <div class="presenter-left">
          <div>
            <div class="p-label">KDD ID</div>
            <div id="p-kddid" class="p-value" style="font-family:monospace;color:#a78bfa;font-size:14px"></div>
          </div>
          <div>
            <div class="p-label">Scope Item</div>
            <div id="p-scope" class="p-value"></div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div>
              <div class="p-label">Fit / Gap</div>
              <div id="p-fitgap" class="p-value" style="font-weight:700"></div>
            </div>
            <div>
              <div class="p-label">Complexity</div>
              <div id="p-complexity" class="p-value"></div>
            </div>
            <div>
              <div class="p-label">RAG</div>
              <div id="p-rag" class="p-value" style="font-weight:700"></div>
            </div>
          </div>
          <div>
            <div class="p-label">Rationale</div>
            <div id="p-rationale" class="p-value" style="font-size:12px"></div>
          </div>
          <div>
            <div class="p-label">Impact if Not Decided</div>
            <div id="p-impact" class="p-value" style="font-size:12px"></div>
          </div>
          <div>
            <div class="p-label">Fiori App / Config</div>
            <div id="p-notes" class="p-value" style="font-size:12px;color:#a78bfa"></div>
          </div>
        </div>

        <!-- Right: question + decision panel -->
        <div class="presenter-right">
          <div id="p-question" class="p-question"></div>

          <div>
            <div class="p-label" style="color:#9d7fe5;margin-bottom:6px">📝 Decision Made</div>
            <textarea id="p-decision" class="p-decision-ta" rows="4"
              placeholder="Type or click a suggestion below to fill…"></textarea>
          </div>

          <div>
            <button id="p-suggest-btn" onclick="presenterSuggest()"
              style="background:#1a0f36;border:1.5px solid #4c2b9e;color:#a78bfa;padding:7px 16px;
                     border-radius:7px;font-size:13px;font-weight:600;cursor:pointer">
              💡 Suggest Decisions
            </button>
            <div id="p-suggest-cards" style="margin-top:10px"></div>
          </div>

          <div style="display:flex;gap:10px;align-items:center">
            <button id="p-save-btn" onclick="savePresenterDecision()"
              style="background:#7c3aed;color:#fff;padding:8px 20px;border-radius:7px;
                     font-size:13px;font-weight:600;cursor:pointer;border:none">
              💾 Save Decision
            </button>
            <span style="font-size:12px;color:#6b5fa0">Decision auto-saves to the editor · continue to next KDD</span>
          </div>
        </div>
      </div>

      <div class="presenter-footer">
        <button id="p-prev" class="presenter-nav-btn" onclick="presenterNav(-1)">◀ Previous</button>
        <div style="display:flex;gap:8px">
          <button onclick="togglePresenterFilter()"
            style="background:#2d1b6b;color:#9d7fe5;border:1px solid #4c2b9e;padding:6px 14px;
                   border-radius:6px;font-size:12px;cursor:pointer" id="p-filter-btn">
            Show: Open Only
          </button>
        </div>
        <button id="p-next" class="presenter-nav-btn" onclick="presenterNav(1)">Next ▶</button>
      </div>
    </div>`;
}

function bindEditor() {
  // State — loaded once, mutated on every edit, saved on demand
  let _rows          = [];
  let _meta          = {};
  let _dirty         = false;
  let _expanded      = null;   // currently expanded kddId
  let _ratings       = {};     // kddId → "specific" | "generic"
  let _autoSaveTimer = null;
  let _wsSelected    = new Set();
  let _viewMode      = "table"; // "table" | "cards"
  let _lobs          = [];      // LOB names from catalog — loaded on init

  // ── KDD tab switching ─────────────────────────────────────────────────────────
  window.kddSwitchTab = (tab) => {
    ["overview", "editor", "wricef"].forEach(t => {
      const btn   = document.getElementById(`kdd-tab-${t}`);
      const panel = document.getElementById(`kdd-panel-${t}`);
      const active = t === tab;
      if (btn) {
        btn.style.borderBottomColor = active ? "var(--accent)" : "transparent";
        btn.style.color             = active ? "var(--accent)" : "var(--text-muted)";
      }
      if (panel) panel.style.display = active ? "block" : "none";
    });
    if (tab === "wricef") renderWRICEFInventory();
  };

  // ── WRICEF Inventory ─────────────────────────────────────────────────────────
  const WRICEF_TYPE_LABELS = {
    W:"W – Workflow", R:"R – Report", I:"I – Interface", C:"C – Conversion",
    E_RAP:"E – BTP RAP", E_CAPM:"E – BTP CAPM", E_RAP_CAPM:"E – RAP & CAPM & UI", F:"F – Form"
  };

  function renderWRICEFInventory() {
    const wRows = _rows.filter(r => r.gapResolution === "WRICEF" && r.ricefType && r.ricefType !== "None");
    const tbody  = document.getElementById("wricef-tbody");
    const badge  = document.getElementById("wricef-count-badge");
    const strip  = document.getElementById("wricef-summary-strip");
    if (!tbody) return;

    // Count badge
    if (badge) badge.textContent = `${wRows.length} item${wRows.length !== 1 ? "s" : ""}`;

    // Summary strip — by type
    if (strip) {
      const byType = {};
      wRows.forEach(r => { byType[r.ricefType] = (byType[r.ricefType] || 0) + 1; });
      strip.innerHTML = Object.entries(byType).sort((a,b) => b[1]-a[1]).map(([t, n]) =>
        `<span style="background:#ede9fe;color:#4f46e5;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600">
           ${WRICEF_TYPE_LABELS[t]||t}: ${n}
         </span>`
      ).join("") + (wRows.length === 0 ? `<span style="color:var(--text-muted);font-size:13px">No WRICEF items yet — set Resolution = WRICEF on Gap rows in the Editor tab.</span>` : "");
    }

    if (!wRows.length) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:32px;color:var(--text-muted)">
        No WRICEF items yet — go to Editor tab and set Resolution = WRICEF on Gap rows.
      </td></tr>`;
      return;
    }

    tbody.innerHTML = wRows.map((r, i) => {
      const effortColor = {XL:"#dc2626",L:"#d97706",M:"#0369a1",S:"#059669"}[r.effortEstimate] || "var(--text-muted)";
      const btpEl = r.btpRequired === "Yes"
        ? `<span style="color:#dc2626;font-weight:700">Yes</span>`
        : r.btpRequired === "Possible"
          ? `<span style="color:#d97706">Possible</span>` : "No";
      return `<tr>
        <td style="font-family:monospace;font-size:11px;color:var(--accent);font-weight:700">${r.ricefId || "—"}</td>
        <td style="font-family:monospace;font-size:11px;color:var(--text-muted)">${r.kddId}</td>
        <td><span class="badge badge-purple" style="font-size:10px">${r.scopeItemId}</span></td>
        <td style="font-size:12px">${r.module || r.l1 || "—"}</td>
        <td style="font-size:12px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${(r.designQuestion||"").replace(/"/g,"&quot;")}">${r.designQuestion ? (r.designQuestion.length > 80 ? r.designQuestion.slice(0,80)+"…" : r.designQuestion) : "—"}</td>
        <td><span style="background:#ede9fe;color:#4f46e5;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:700">${WRICEF_TYPE_LABELS[r.ricefType]||r.ricefType}</span></td>
        <td style="font-size:12px">${r.complexity || "—"}</td>
        <td style="font-size:11px;color:var(--text-muted)">${r.extensibilityType && r.extensibilityType !== "None" ? r.extensibilityType : "—"}</td>
        <td style="text-align:center">${btpEl}</td>
        <td style="text-align:center;font-weight:700;color:${effortColor}">${r.effortEstimate && r.effortEstimate !== "None" ? r.effortEstimate : "—"}</td>
        <td style="font-size:12px">${r.status || "Open"}</td>
        <td style="font-size:12px">${r.decisionOwner || "—"}</td>
      </tr>`;
    }).join("");
  }

  // ── Export WRICEF Inventory to Excel ─────────────────────────────────────────
  window.exportWRICEFExcel = async () => {
    const btn = document.getElementById("wricef-export-btn");
    const el  = document.getElementById("wricef-export-result");
    btn.disabled = true;
    btn.textContent = "Building…";
    if (el) el.innerHTML = "";

    // Save first if dirty
    if (_dirty) await window.saveEdits();

    try {
      const res  = await fetch("/api/kdd/export-wricef", { method: "POST" });
      const data = await res.json();
      if (data.ok && data.filename) {
        if (el) el.innerHTML = `
          <div class="alert alert-success" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
            <span>✅ <strong>${data.filename}</strong> — ${data.rowCount} WRICEF items</span>
            <a href="/api/output/download/${encodeURIComponent(data.filename)}"
               class="btn btn-primary btn-sm" download>⬇ Download</a>
          </div>`;
      } else {
        if (el) el.innerHTML = `<div class="alert alert-danger">⚠️ ${data.error || "Export failed"}</div>`;
      }
    } catch (e) {
      if (el) el.innerHTML = `<div class="alert alert-danger">⚠️ ${escHtml(e.message)}</div>`;
    }
    btn.disabled = false;
    btn.textContent = "⬇ Export Excel";
    setTimeout(() => { if (el) el.innerHTML = ""; }, 8000);
  };

  // ── Project switcher ──
  window.toggleProjectPanel = async () => {
    let panel = document.getElementById("proj-panel");
    if (panel) { panel.remove(); return; }

    panel = document.createElement("div");
    panel.id = "proj-panel";
    panel.style.cssText = "background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.12);padding:16px 18px;margin-bottom:12px;min-width:360px;max-width:560px;position:relative";
    panel.innerHTML = `<div style="font-weight:700;font-size:13px;margin-bottom:12px;color:#6d28d9">📁 Saved Projects</div>
      <div id="proj-list" style="font-size:13px;color:var(--text-muted)">Loading…</div>`;

    // Insert after page-header
    const header = document.querySelector(".page-header");
    if (header && header.nextSibling) header.parentNode.insertBefore(panel, header.nextSibling);
    else document.getElementById("app").prepend(panel);

    const { projects } = await api.get("/api/projects").catch(() => ({ projects: [] }));
    const list = document.getElementById("proj-list");
    if (!list) return;

    if (!projects.length) {
      list.innerHTML = `<div style="color:var(--text-muted);font-size:12.5px">No saved projects yet — generate a KDD log to create one.</div>`;
      return;
    }
    list.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--text-muted);font-weight:600">Client · Project</th>
          <th style="text-align:center;padding:4px 8px;font-size:11px;color:var(--text-muted);font-weight:600">KDDs</th>
          <th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--text-muted);font-weight:600">Last saved</th>
          <th style="padding:4px 8px"></th>
        </tr></thead>
        <tbody>
          ${projects.map(p => `
            <tr style="border-bottom:1px solid #f3f4f6;${p.active?"background:#faf5ff;":""}" id="proj-row-${p.slug}">
              <td style="padding:7px 8px;font-weight:${p.active?700:400}">
                ${p.active?'<span style="color:#6d28d9;margin-right:5px">●</span>':''}${p.client} · ${p.project}
              </td>
              <td style="text-align:center;padding:7px 8px;color:var(--text-muted)">${p.rows}</td>
              <td style="padding:7px 8px;color:var(--text-muted);font-size:11.5px">
                ${p.savedAt ? new Date(p.savedAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"2-digit"}) : "—"}
              </td>
              <td style="padding:7px 8px;text-align:right;white-space:nowrap">
                ${p.active
                  ? `<span style="font-size:11px;color:#6d28d9;font-weight:600">Active</span>`
                  : `<button onclick="loadProject('${p.slug}')"
                       style="background:#6d28d9;color:#fff;border:none;border-radius:5px;padding:3px 10px;font-size:11.5px;font-weight:600;cursor:pointer;margin-right:4px">Load</button>`}
                <button onclick="deleteProject('${p.slug}','${p.client} · ${p.project}')"
                  style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer">✕</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  };

  window.loadProject = async (slug) => {
    if (!confirm("Load this project? Any unsaved changes to the current project will be lost.")) return;
    const data = await api.post("/api/projects/load", { slug });
    if (data.ok) {
      // Update the active session so the editor loads the right project
      window._lastKddSessionId = data.sessionId;
      localStorage.setItem("kddSessionId", data.sessionId);
      const panel = document.getElementById("proj-panel");
      if (panel) panel.remove();
      navigate("editor");
    } else {
      alert("Error: " + (data.error || "Could not load project"));
    }
  };

  window.deleteProject = async (slug, label) => {
    if (!confirm(`Delete "${label}"?\n\nThis removes it from the project list. Current active data is not affected.`)) return;
    const row = document.getElementById(`proj-row-${slug}`);
    if (row) row.style.opacity = "0.4";
    const data = await fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" }).then(r => r.json());
    if (data.ok) {
      if (row) row.remove();
    } else {
      if (row) row.style.opacity = "1";
      alert("Error: " + (data.error || "Could not delete"));
    }
  };

  // ── Keyboard shortcuts (Ctrl+S = save, Esc = close row) ──
  const keyHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      window.saveEdits();
    }
    if (e.key === "Escape" && _expanded) {
      window.toggleExpand(_expanded);
    }
  };
  document.addEventListener("keydown", keyHandler);
  // Remove listener when navigating away
  const _removeKeys = () => {
    document.removeEventListener("keydown", keyHandler);
    window.removeEventListener("hashchange", _removeKeys);
  };
  window.addEventListener("hashchange", _removeKeys);

  // ── Load data + LOBs ──
  (async () => {
    try {
      const sid = await _resolveSessionId();
      const [data, lobs] = await Promise.all([
        api.get(`/api/kdd/data?session_id=${encodeURIComponent(sid)}`),
        api.get("/api/catalog/lobs").catch(() => [])
      ]);
      _rows = data.rows || [];
      _meta = data.meta || {};
      _lobs = lobs.map(l => l.name || l).filter(Boolean);
      renderTable(_rows);
    } catch (e) {
      console.error("Editor load error:", e);
    }
  })();

  function showToast(msg, type) {
    const t = document.createElement("div");
    t.className = "toast";
    if (type === "warn") t.style.background = "#92400e";
    if (type === "error") t.style.background = "#7f1d1d";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  function markDirty() {
    _dirty = true;
    const ind = document.getElementById("save-indicator");
    if (ind) { ind.className = "save-indicator dirty"; ind.textContent = "● Unsaved changes"; }
    // Auto-save 3 seconds after last edit
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => { if (_dirty) window.saveEdits(); }, 3000);
  }
  function markSaved() {
    _dirty = false;
    const ind = document.getElementById("save-indicator");
    if (ind) { ind.className = "save-indicator clean"; ind.textContent = "✔ Saved"; }
  }

  // ── Render table ──
  function renderTable(rows) {
    const tbody = document.getElementById("kdd-tbody");
    if (!tbody) return;
    tbody.innerHTML = rows.map(r => rowHTML(r)).join("");
  }

  function rowHTML(r) {
    const qShort  = r.designQuestion ? r.designQuestion.slice(0, 90) + (r.designQuestion.length > 90 ? "…" : "") : "—";
    const hasDec  = r.decisionMade && r.decisionMade.trim();
    const decPrev = hasDec ? r.decisionMade.slice(0, 50) + (r.decisionMade.length > 50 ? "…" : "") : `<span class="text-muted">— click to add</span>`;
    const ratingBadge = _ratings[r.kddId]
      ? (_ratings[r.kddId] === "generic"
          ? `<span class="badge badge-weak" title="${(_ratings[r.kddId + "_reason"] || "")}">⚠ Generic</span>`
          : `<span class="badge badge-ok">✔ Specific</span>`)
      : "";
    const signOffBadge = r.signOffStatus === "Approved" ? `<span class="badge badge-green">✅ Approved</span>`
      : r.signOffStatus === "Deferred"  ? `<span class="badge badge-yellow">⏸ Deferred</span>`
      : r.signOffStatus === "Rejected"  ? `<span class="badge badge-red">❌ Rejected</span>`
      : "";
    const fitClass = r.fitGap === "Gap" ? "badge-red" : r.fitGap === "Partial Fit" ? "badge-yellow" : "badge-green";

    const inScope = r.inScope !== false;  // default true
    return `
      <tr id="row-${r.kddId}" class="${hasDec ? "row-has-decision" : ""} ${_expanded === r.kddId ? "row-expanded" : ""}"
          style="cursor:pointer;${inScope ? "" : "opacity:0.42;background:#f9fafb;"}" onclick="toggleExpand('${r.kddId}')">
        <td style="font-family:monospace;font-size:11.5px;color:var(--accent)">
          ${r.kddId} ${ratingBadge}
          ${!inScope ? `<div style="font-size:9px;font-weight:700;color:#9ca3af;letter-spacing:.04em;margin-top:1px">OUT OF SCOPE</div>` : ""}
        </td>
        <td><span class="badge badge-purple">${r.scopeItemId}</span></td>
        <td onclick="event.stopPropagation()">
          <select class="cell-select" style="font-size:11.5px" onchange="updateField('${r.kddId}','module',this.value);updateField('${r.kddId}','l1',this.value)">
            ${(_lobs.length ? _lobs : ["Finance","Sales","Sourcing and Procurement","Manufacturing","Human Resources","Supply Chain","Service","Asset Management","IT Management","Other"])
              .map(v => `<option ${modName(r)===v?"selected":""}>${v}</option>`).join("")}
          </select>
        </td>
        <td style="font-size:12.5px;max-width:280px">${qShort}</td>
        <td onclick="event.stopPropagation()">
          <select class="cell-select"
            title="SAP Standard process accepted = Fit · Requires extension or custom build = Gap"
            onchange="updateField('${r.kddId}','fitGap',this.value)">
            ${["Fit","Gap"].map(v => `<option ${r.fitGap===v?"selected":""}>${v}</option>`).join("")}
          </select>
        </td>
        <td onclick="event.stopPropagation()" id="ricef-cell-${r.kddId}">
          ${r.fitGap === "Fit"
            ? `<select class="cell-select" disabled style="opacity:0.35;cursor:not-allowed"><option>—</option></select>`
            : `<div style="display:flex;flex-direction:column;gap:3px">
                <select class="cell-select" style="font-size:11px"
                  title="How will this gap be resolved?"
                  onchange="updateField('${r.kddId}','gapResolution',this.value)">
                  <option value="None" ${(r.gapResolution||"None")==="None"?"selected":""}>— Resolution —</option>
                  <option value="WRICEF" ${(r.gapResolution||"None")==="WRICEF"?"selected":""}>WRICEF</option>
                  <option value="Config" ${(r.gapResolution||"None")==="Config"?"selected":""}>Config</option>
                </select>
                ${(r.gapResolution||"None") === "WRICEF" ? `
                  <select class="cell-select" style="font-size:10.5px"
                    onchange="updateField('${r.kddId}','ricefType',this.value)">
                    <option value="None" ${(r.ricefType||"None")==="None"?"selected":""}>— Type —</option>
                    <option value="W" ${(r.ricefType||"None")==="W"?"selected":""}>W – Workflow</option>
                    <option value="R" ${(r.ricefType||"None")==="R"?"selected":""}>R – Report</option>
                    <option value="I" ${(r.ricefType||"None")==="I"?"selected":""}>I – Interface</option>
                    <option value="C" ${(r.ricefType||"None")==="C"?"selected":""}>C – Conversion</option>
                    <option value="E_RAP"      ${(r.ricefType||"None")==="E_RAP"?"selected":""}>E – BTP RAP</option>
                    <option value="E_CAPM"     ${(r.ricefType||"None")==="E_CAPM"?"selected":""}>E – BTP CAPM</option>
                    <option value="E_RAP_CAPM" ${(r.ricefType||"None")==="E_RAP_CAPM"?"selected":""}>E – RAP &amp; CAPM &amp; UI</option>
                    <option value="F" ${(r.ricefType||"None")==="F"?"selected":""}>F – Form</option>
                  </select>
                  ${r.ricefId ? `<div style="font-size:10px;color:var(--accent);font-family:monospace">${r.ricefId}</div>` : ""}
                ` : (r.gapResolution === "Config" ? `<div style="font-size:10px;color:#059669;font-weight:600;padding:1px 0">✓ Standard Config</div>` : "")}
              </div>`
          }
        </td>
        <td onclick="event.stopPropagation()">
          <select class="cell-select" onchange="updateField('${r.kddId}','status',this.value)">
            ${["Open","In Progress","Deferred","Approved","Decision Made","Closed"].map(v => `<option ${r.status===v?"selected":""}>${v}</option>`).join("")}
          </select>
        </td>
        <td onclick="event.stopPropagation()">
          <input class="cell-input" value="${(r.decisionOwner||"").replace(/"/g,"&quot;")}"
            placeholder="Owner…" onchange="updateField('${r.kddId}','decisionOwner',this.value)" />
        </td>
        <td onclick="event.stopPropagation()" style="text-align:center;padding:4px 6px">
          <div style="display:flex;flex-direction:column;gap:3px;align-items:center">
            <button onclick="updateField('${r.kddId}','inScope',${inScope ? "false" : "true"})"
              style="background:${inScope?"#dcfce7":"#f3f4f6"};border:1px solid ${inScope?"#86efac":"#d1d5db"};
                     color:${inScope?"#15803d":"#9ca3af"};cursor:pointer;
                     font-size:10px;font-weight:700;padding:2px 6px;line-height:1.4;border-radius:4px;width:100%"
              title="${inScope?"Exclude from scope":"Include in scope"}">${inScope ? "✓ In Scope" : "Excluded"}</button>
            <button onclick="deleteKDDRow('${r.kddId}')"
              style="background:none;border:1px solid var(--border);color:#9ca3af;cursor:pointer;
                     font-size:10px;font-weight:600;padding:2px 6px;line-height:1.4;border-radius:4px;width:100%;
                     transition:color .15s,background .15s,border-color .15s"
              onmouseover="this.style.color='#dc2626';this.style.background='#fee2e2';this.style.borderColor='#fca5a5'"
              onmouseout="this.style.color='#9ca3af';this.style.background='none';this.style.borderColor='var(--border)'"
              title="Permanently delete KDD ${r.kddId}">Delete</button>
          </div>
        </td>
      </tr>
      ${_expanded === r.kddId ? expandHTML(r) : ""}`;
  }

  function expandHTML(r) {
    return `
      <tr class="row-expand-content">
        <td colspan="10" style="padding:0">
          <div class="expand-panel" style="position:relative;display:block;padding:0">
            <!-- ── Close button ── -->
            <button onclick="event.stopPropagation();toggleExpand('${r.kddId}')"
              style="position:absolute;top:10px;right:12px;z-index:10;background:#f3f4f6;border:1px solid var(--border);
                     border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;color:var(--text-muted)"
              title="Close (Esc)">✕</button>

            <!-- ── Section 1: Design ── -->
            <div style="padding:16px 20px 14px;border-bottom:1px solid #e0e7ff">
              <!-- Row A: LoB · Phase · [gap for close btn] -->
              <div style="display:grid;grid-template-columns:2fr 1fr 40px;gap:14px;margin-bottom:14px">
                <div>
                  <div class="expand-label">Line of Business / Module</div>
                  <select class="cell-select" style="width:100%;border:1px solid var(--border);padding:6px 8px"
                    onchange="updateField('${r.kddId}','module',this.value);updateField('${r.kddId}','l1',this.value)">
                    ${(_lobs.length ? _lobs : ["Finance","Sales","Sourcing and Procurement","Manufacturing","Human Resources","Supply Chain","Service","Asset Management","IT Management","Other"])
                      .map(v => `<option ${modName(r)===v?"selected":""}>${v}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <div class="expand-label">SAP Activate Phase</div>
                  <select class="cell-select" style="width:100%;border:1px solid var(--border);padding:6px 8px"
                    onchange="updateField('${r.kddId}','sapActivatePhase',this.value)">
                    ${["Explore","Realize","Deploy"].map(v => `<option ${r.sapActivatePhase===v?"selected":""}>${v}</option>`).join("")}
                  </select>
                </div>
                <div></div>
              </div>
              <!-- Row B: Design Question -->
              <div style="margin-bottom:14px">
                <div class="expand-label">Design Question <span style="color:var(--text-muted);font-weight:400;text-transform:none">(editable)</span></div>
                <textarea class="expand-textarea" rows="2"
                  onchange="updateField('${r.kddId}','designQuestion',this.value)"
                >${(r.designQuestion||"").replace(/</g,"&lt;")}</textarea>
              </div>
              <!-- Row C: Rationale | Impact -->
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
                <div>
                  <div class="expand-label">Rationale <span style="color:var(--text-muted);font-weight:400;text-transform:none">(editable)</span></div>
                  <textarea class="expand-textarea" rows="2"
                    onchange="updateField('${r.kddId}','rationale',this.value)"
                  >${(r.rationale||"").replace(/</g,"&lt;")}</textarea>
                </div>
                <div>
                  <div class="expand-label">Impact if Not Decided <span style="color:var(--text-muted);font-weight:400;text-transform:none">(editable)</span></div>
                  <textarea class="expand-textarea" rows="2"
                    onchange="updateField('${r.kddId}','impactActions',this.value)"
                  >${(r.impactActions||"").replace(/</g,"&lt;")}</textarea>
                </div>
              </div>
              <!-- Row D: Notes -->
              <div>
                <div class="expand-label">Notes / Fiori App</div>
                <textarea class="expand-textarea" rows="2"
                  onchange="updateField('${r.kddId}','notes',this.value)"
                >${(r.notes||"").replace(/</g,"&lt;")}</textarea>
              </div>
            </div>

            <!-- ── Section 2: Decision ── -->
            <div style="padding:14px 20px;border-bottom:1px solid #e0e7ff;background:#fdf8ff">
              <div class="expand-label" style="color:var(--accent)">📝 Decision Made <span style="color:var(--warning);font-weight:400;text-transform:none">← fill this in during workshop</span></div>
              <textarea id="decision-ta-${r.kddId}" class="expand-textarea decision-field" rows="3"
                placeholder="Enter the agreed decision here…"
                onchange="updateField('${r.kddId}','decisionMade',this.value)"
              >${(r.decisionMade||"").replace(/</g,"&lt;")}</textarea>
              <div id="suggest-box-${r.kddId}" style="margin-top:8px">
                <button onclick="event.stopPropagation();suggestDecisions('${r.kddId}')"
                  style="background:#faf5ff;border:1px solid #ddd6fe;color:#7c3aed;padding:5px 12px;
                         border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">
                  💡 Suggest Decisions
                </button>
                <div id="suggest-cards-${r.kddId}" style="margin-top:8px"></div>
              </div>
            </div>

            <!-- ── Section 3: WRICEF ── -->
            <div style="padding:14px 20px;border-bottom:1px solid #e0e7ff">
              <div class="expand-label" style="color:#4f46e5;margin-bottom:10px">
                🔧 WRICEF Details
                ${r.fitGap === "Fit"
                  ? `<span style="color:var(--text-muted);font-weight:400;text-transform:none;font-size:11px">&nbsp;— disabled for Fit items</span>`
                  : `<span style="color:var(--text-muted);font-weight:400;text-transform:none;font-size:11px">&nbsp;— set Resolution &amp; Type in the table row above</span>`}
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:12px;${r.fitGap === "Fit" ? "opacity:0.4;pointer-events:none;" : ""}">
                <div>
                  <div class="expand-label">WRICEF ID</div>
                  <div class="expand-readonly" style="font-family:monospace;font-size:13px;color:var(--accent);font-weight:700">${r.ricefId || (r.gapResolution==="WRICEF"?"auto-assigned on type select":"—")}</div>
                </div>
                <div>
                  <div class="expand-label">Complexity</div>
                  <select class="expand-textarea" style="min-height:unset;padding:6px 8px;cursor:pointer"
                    onchange="updateField('${r.kddId}','complexity',this.value)">
                    ${["Low","Medium","High"].map(v => `<option ${(r.complexity||"Low")===v?"selected":""}>${v}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <div class="expand-label">Extensibility</div>
                  <select class="expand-textarea" style="min-height:unset;padding:6px 8px;cursor:pointer"
                    onchange="updateField('${r.kddId}','extensibilityType',this.value)">
                    ${["None","Key User In-App","Developer ABAP Cloud","Side-by-Side BTP"].map(v =>
                      `<option ${(r.extensibilityType||"None")===v?"selected":""}>${v}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <div class="expand-label">BTP Required</div>
                  <select class="expand-textarea" style="min-height:unset;padding:6px 8px;cursor:pointer"
                    onchange="updateField('${r.kddId}','btpRequired',this.value)">
                    ${["No","Yes","Possible"].map(v => `<option ${(r.btpRequired||"No")===v?"selected":""}>${v}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <div class="expand-label">Effort</div>
                  <select class="expand-textarea" style="min-height:unset;padding:6px 8px;cursor:pointer"
                    onchange="updateField('${r.kddId}','effortEstimate',this.value)">
                    ${["None","S","M","L","XL"].map(v => `<option ${(r.effortEstimate||"None")===v?"selected":""}>${v}</option>`).join("")}
                  </select>
                </div>
              </div>
            </div>

            <!-- ── Section 4: Workshop Outcome ── -->
            <div style="padding:14px 20px">
              <div class="expand-label" style="color:#6d28d9;margin-bottom:12px">📋 Workshop Outcome</div>
              <!-- Row: Date · Decided By · Sign-off -->
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px">
                <div>
                  <div class="expand-label">Workshop Date</div>
                  <input type="date" class="expand-textarea" style="min-height:unset;padding:6px 8px"
                    value="${r.workshopDate || ""}"
                    onchange="updateField('${r.kddId}','workshopDate',this.value)" />
                </div>
                <div>
                  <div class="expand-label">Decided By</div>
                  <input type="text" class="expand-textarea" style="min-height:unset;padding:6px 8px"
                    placeholder="Name / role who signed off…"
                    value="${(r.decidedBy || "").replace(/"/g,"&quot;")}"
                    onchange="updateField('${r.kddId}','decidedBy',this.value)" />
                </div>
                <div>
                  <div class="expand-label">Sign-off Status</div>
                  <select class="expand-textarea" style="min-height:unset;padding:6px 8px;cursor:pointer"
                    onchange="updateField('${r.kddId}','signOffStatus',this.value)">
                    ${["Open","Approved","Deferred","Rejected"].map(v =>
                      `<option value="${v}" ${(r.signOffStatus||"Open")===v?"selected":""}>${
                        v==="Approved"?"✅ Approved":v==="Deferred"?"⏸ Deferred":v==="Rejected"?"❌ Rejected":v
                      }</option>`
                    ).join("")}
                  </select>
                </div>
              </div>
              <!-- Row: Action Items · BPD Ref · SAP Consultant -->
              <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:14px">
                <div>
                  <div class="expand-label">Action Items <span style="font-weight:400;text-transform:none;color:var(--text-muted)">from workshop</span></div>
                  <textarea class="expand-textarea" rows="3"
                    placeholder="e.g. • IT to confirm Fiori app availability by DD/MM&#10;• Finance lead to review with CFO"
                    onchange="updateField('${r.kddId}','actionItems',this.value)"
                  >${(r.actionItems||"").replace(/</g,"&lt;")}</textarea>
                </div>
                <div>
                  <div class="expand-label">BPD Reference</div>
                  <input type="text" class="expand-textarea" style="min-height:unset;padding:6px 8px"
                    placeholder="e.g. FIN-BPD-001…"
                    value="${(r.bpdRef || "").replace(/"/g,"&quot;")}"
                    onchange="updateField('${r.kddId}','bpdRef',this.value)" />
                </div>
                <div>
                  <div class="expand-label">SAP Consultant</div>
                  <input type="text" class="expand-textarea" style="min-height:unset;padding:6px 8px"
                    placeholder="Accenture consultant name…"
                    value="${(r.sapConsultant || "").replace(/"/g,"&quot;")}"
                    onchange="updateField('${r.kddId}','sapConsultant',this.value)" />
                </div>
              </div>
            </div>
          </div>
        </td>
      </tr>`;
  }

  // ── View mode toggle ──
  window.toggleViewMode = () => {
    _viewMode = _viewMode === "table" ? "cards" : "table";
    const btn   = document.getElementById("view-toggle-btn");
    const tWrap = document.getElementById("kdd-table-wrap");
    const cWrap = document.getElementById("kdd-card-view");
    if (_viewMode === "cards") {
      if (btn)   btn.textContent = "☰ Table View";
      if (tWrap) tWrap.style.display = "none";
      if (cWrap) cWrap.style.display = "block";
      renderCards(currentFiltered());
    } else {
      if (btn)   btn.textContent = "⊞ Card View";
      if (tWrap) tWrap.style.display = "block";
      if (cWrap) cWrap.style.display = "none";
      renderTable(currentFiltered());
    }
  };

  function renderCards(rows) {
    const grid = document.getElementById("kdd-cards-grid");
    if (!grid) return;
    const fgColor = fg => fg === "Gap" ? "#dc2626" : fg === "Partial Fit" ? "#d97706" : "#059669";
    const fgBg    = fg => fg === "Gap" ? "#fee2e2" : fg === "Partial Fit" ? "#fef3c7" : "#dcfce7";
    const cxColor = c  => c  === "High" ? "#dc2626" : c === "Medium" ? "#d97706" : "#059669";
    grid.innerHTML = rows.map(r => {
      const hasDec  = r.decisionMade && r.decisionMade.trim();
      const rating  = _ratings[r.kddId];
      const ratingH = rating === "generic"
        ? `<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600">⚠ Generic</span>`
        : rating === "specific"
          ? `<span style="background:#dcfce7;color:#166534;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600">✔ Specific</span>` : "";
      const wricefTypeLabel = {
        W:"W–Workflow", R:"R–Report", I:"I–Interface", C:"C–Conversion",
        E_RAP:"E–BTP RAP", E_CAPM:"E–BTP CAPM", E_RAP_CAPM:"E–RAP&CAPM", F:"F–Form"
      };
      const ricefH = r.gapResolution === "Config"
        ? `<span style="background:#dcfce7;color:#059669;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">Config</span>`
        : (r.ricefType && r.ricefType !== "None"
        ? `<span style="background:#ede9fe;color:#4f46e5;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">🔧 ${wricefTypeLabel[r.ricefType]||r.ricefType}${r.ricefId ? " · " + r.ricefId : ""}</span>` : "");
      const cardInScope = r.inScope !== false;
      return `<div class="card" style="padding:14px;cursor:pointer;border:1.5px solid var(--border);transition:box-shadow 0.15s,border-color 0.15s;${cardInScope?"":"opacity:0.42;background:#f9fafb;"}"
          onmouseenter="this.style.boxShadow='0 4px 16px rgba(0,0,0,0.1)';this.style.borderColor='var(--accent)'"
          onmouseleave="this.style.boxShadow='';this.style.borderColor='var(--border)'"
          onclick="switchToTableAndExpand('${r.kddId}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px">
          <span style="font-family:monospace;font-size:11px;color:var(--accent);font-weight:700">${r.kddId}${!cardInScope ? ' <span style="font-size:9px;color:#9ca3af;font-weight:400">OUT OF SCOPE</span>' : ""}</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
            <span class="badge badge-purple" style="font-size:10px">${r.scopeItemId}</span>
            ${r.module ? `<span style="background:#f0f9ff;color:#0369a1;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600">${r.module}</span>` : ""}
          </div>
        </div>
        <div style="font-size:12.5px;color:var(--text);margin-bottom:10px;line-height:1.5">
          ${r.designQuestion ? (r.designQuestion.length > 120 ? r.designQuestion.slice(0,120)+"…" : r.designQuestion) : "—"}
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
          <span style="background:${fgBg(r.fitGap)};color:${fgColor(r.fitGap)};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700">${r.fitGap}</span>
          <span style="background:#f3f4f6;color:${cxColor(r.complexity)};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${r.complexity}</span>
          ${ricefH}${ratingH}
          ${hasDec ? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">✔ Decision</span>` : ""}
          ${r.signOffStatus === "Approved" ? `<span style="font-size:11px">✅</span>` : ""}
        </div>
      </div>`;
    }).join("") || `<div style="padding:40px;text-align:center;color:var(--text-muted)">No KDDs match the current filters.</div>`;
  }

  window.switchToTableAndExpand = (kddId) => {
    _viewMode = "table";
    const btn   = document.getElementById("view-toggle-btn");
    const tWrap = document.getElementById("kdd-table-wrap");
    const cWrap = document.getElementById("kdd-card-view");
    if (btn)   btn.textContent = "⊞ Card View";
    if (tWrap) tWrap.style.display = "block";
    if (cWrap) cWrap.style.display = "none";
    _expanded = kddId;
    renderTable(currentFiltered());
    setTimeout(() => {
      const row = document.getElementById(`row-${kddId}`);
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  };

  // ── WRICEF counter — next available WRICEF-NNN ──
  function nextRicefId() {
    const nums = _rows
      .map(r => r.ricefId)
      .filter(Boolean)
      .map(id => parseInt((id.match(/(\d+)$/) || ["0","0"])[1], 10))
      .filter(n => !isNaN(n));
    return `WRICEF-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
  }

  // ── Expand / collapse ──
  window.toggleExpand = (kddId) => {
    _expanded = _expanded === kddId ? null : kddId;
    // Re-render only the affected rows for speed
    const filtered = currentFiltered();
    renderTable(filtered);
  };

  // ── Decision library — save an approved KDD to decisions.json ──
  // Called automatically when sign-off status is set to Approved with a decision text.
  // The server injects these into future Claude prompts for the same scope item.
  async function saveToLibrary(row) {
    try {
      const res  = await fetch("/api/decisions", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kddId:         row.kddId,
          scopeItemId:   row.scopeItemId,
          scopeItemName: row.scopeItemName,
          question:      row.designQuestion,
          decision:      row.decisionMade,
          rationale:     row.rationale,
          fitGap:        row.fitGap,
          complexity:    row.complexity,
          client:        (_meta || {}).client  || "",
          project:       (_meta || {}).project || ""
        })
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`📚 Saved to decision library (${data.count} decisions)`);
      } else {
        showToast(`⚠ Library save failed: ${data.error || "unknown error"}`, "warn");
      }
    } catch (e) {
      showToast(`⚠ Library save error: ${escHtml(e.message)}`, "warn");
    }
  }

  // ── Delete a KDD row ─────────────────────────────────────────────────────────
  window.deleteKDDRow = (kddId) => {
    const idx = _rows.findIndex(r => r.kddId === kddId);
    if (idx === -1) return;
    const row = _rows[idx];
    const preview = (row.designQuestion || "").slice(0, 80);
    if (!confirm(`Delete KDD ${kddId}?\n"${preview}${preview.length === 80 ? "…" : ""}"\n\nYou can regenerate from the KDD Generator to restore it.`)) return;
    _rows.splice(idx, 1);
    if (_expanded === kddId) _expanded = null;
    renderTable(_rows);
    markDirty();
  };

  // ── Inline field update ──
  window.updateField = (kddId, field, value) => {
    const row = _rows.find(r => r.kddId === kddId);
    if (!row) return;
    row[field] = value;
    markDirty();
    // Auto-save to decision library when Approved with a decision text
    if (field === "signOffStatus" && value === "Approved" && row.decisionMade && row.decisionMade.trim()) {
      saveToLibrary(row);
    }
    // WRICEF ID auto-assign: set when type selected, clear when reset to None
    if (field === "ricefType") {
      if (value !== "None" && !row.ricefId) row.ricefId = nextRicefId();
      if (value === "None") row.ricefId = "";
    }
    // When Resolution changes: clear WRICEF subtype if not WRICEF
    if (field === "gapResolution") {
      if (value !== "WRICEF") { row.ricefType = "None"; row.ricefId = ""; }
    }
    // When fitGap flips to Fit, clear resolution + WRICEF type + ID
    if (field === "fitGap" && value === "Fit") {
      row.gapResolution = "None";
      row.ricefType     = "None";
      row.ricefId       = "";
    }
    // When inScope toggled, re-render row for gray/active style
    if (field === "inScope") {
      const tr = document.getElementById(`row-${kddId}`);
      if (tr) tr.outerHTML = rowHTML(row);
      return;
    }
    // When fitGap, gapResolution or ricefType changes, re-render whole row so
    // Resolution/WRICEF cell is guaranteed to reflect the new state.
    if (field === "fitGap" || field === "gapResolution" || field === "ricefType") {
      const tr = document.getElementById(`row-${kddId}`);
      if (tr) {
        // If row is expanded, the next sibling is the stale expand <tr> — remove it
        // before setting outerHTML so the fresh expand panel from rowHTML is the only one.
        const next = tr.nextElementSibling;
        if (next && next.classList.contains("row-expand-content")) next.remove();
        tr.outerHTML = rowHTML(row);
      }
      return;
    }
    // For other fields, just update className on the existing tr
    const tr = document.getElementById(`row-${kddId}`);
    if (tr) {
      const hasDec = row.decisionMade && row.decisionMade.trim();
      tr.className = `${hasDec ? "row-has-decision" : ""} ${_expanded === kddId ? "row-expanded" : ""}`;
    }
  };

  // ── Filter ──
  function currentFiltered() {
    const scope   = (document.getElementById("filter-scope")   || {}).value || "";
    const status  = (document.getElementById("filter-status")  || {}).value || "";
    const fitgap  = (document.getElementById("filter-fitgap")  || {}).value || "";
    const signoff = (document.getElementById("filter-signoff") || {}).value || "";
    const q       = ((document.getElementById("filter-search") || {}).value || "").toLowerCase();
    return _rows.filter(r =>
      (!scope   || r.scopeItemId === scope) &&
      (!status  || r.status === status) &&
      (!fitgap  || r.fitGap === fitgap) &&
      (!signoff || (r.signOffStatus || "Open") === signoff) &&
      (!q || r.designQuestion.toLowerCase().includes(q)
          || r.kddId.toLowerCase().includes(q)
          || (r.bpdRef || "").toLowerCase().includes(q))
    );
  }

  window.applyFilters = () => {
    const filtered = currentFiltered();
    if (_viewMode === "cards") renderCards(filtered);
    else renderTable(filtered);
  };

  // ── Save ──
  window.saveEdits = async () => {
    const btn = document.getElementById("save-btn");
    const ind = document.getElementById("save-indicator");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    if (ind) { ind.className = "save-indicator saving"; ind.textContent = "⟳ Saving…"; }
    try {
      const sid = await _resolveSessionId();
      const res = await fetch(`/api/kdd/editor?session_id=${encodeURIComponent(sid)}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rows: _rows, meta: _meta })
      });
      const data = await res.json();
      if (data.ok) {
        _meta.lastEditedAt = data.savedAt;
        markSaved();
      } else {
        if (ind) { ind.className = "save-indicator dirty"; ind.textContent = "⚠ Save failed"; }
      }
    } catch (e) {
      if (ind) { ind.className = "save-indicator dirty"; ind.textContent = "⚠ Save failed"; }
    }
    if (btn) { btn.disabled = false; btn.textContent = "💾 Save Changes"; }
  };

  // ── Export Excel ──
  window.exportExcel = async () => {
    const btn = document.getElementById("export-btn");
    const el  = document.getElementById("export-result");
    btn.disabled = true;
    btn.textContent = "Building…";
    el.innerHTML = "";

    // Save first if dirty
    if (_dirty) await window.saveEdits();

    try {
      const sid  = await _resolveSessionId();
      const res  = await fetch(`/api/kdd/export?session_id=${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.ok && data.filename) {
        el.innerHTML = `
          <div class="alert alert-success" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <span>✅ <strong>${data.filename}</strong> ready</span>
            <a href="/api/output/download/${encodeURIComponent(data.filename)}"
               class="btn btn-primary btn-sm" download>⬇ Download</a>
          </div>`;
      } else {
        el.innerHTML = `<div class="alert alert-danger">⚠️ ${data.error || "Export failed"}</div>`;
      }
    } catch (e) {
      el.innerHTML = `<div class="alert alert-danger">⚠️ ${escHtml(e.message)}</div>`;
    }
    btn.disabled = false;
    btn.textContent = "⬇ Export Excel";
    setTimeout(() => { if (el) el.innerHTML = ""; }, 8000);
  };

  // ── Mark as Ready (save + export + confirmation banner) ──
  window.markReady = async () => {
    if (!confirm("Mark this KDD log as ready?\n\nThis will:\n• Save all changes\n• Export the final Excel\n• Flag the log as ready for Workshop Prep\n\nYou can still edit it afterwards.")) return;

    // Tag meta
    _meta.status      = "Ready for Workshop Prep";
    _meta.readyAt     = new Date().toISOString();

    await window.saveEdits();
    const res = await fetch("/api/kdd/export", { method: "POST" });
    const data = await res.json();

    const el = document.getElementById("export-result");
    if (data.ok) {
      el.innerHTML = `
        <div class="alert alert-success" style="margin-bottom:16px">
          <div class="bold" style="font-size:14px;margin-bottom:6px">🚀 KDD Log is Ready for Workshop Prep</div>
          <div style="font-size:13px;margin-bottom:10px">
            All changes saved · Excel exported ·
            <code style="background:rgba(0,0,0,.07);padding:1px 6px;border-radius:3px">kdd-data.json</code>
            flagged as ready — Workshop Prep skill will pick it up automatically when available.
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="/api/output/download/${encodeURIComponent(data.filename)}"
               class="btn btn-primary btn-sm" download>⬇ Download Final Excel</a>
            <button class="btn btn-outline btn-sm" onclick="navigate('output')">↓ Output Files</button>
          </div>
        </div>`;
    } else {
      el.innerHTML = `<div class="alert alert-danger">⚠️ ${data.error || "Export failed"}</div>`;
    }
  };

  // ── Workshop Session modal — bulk sign-off ────────────────────────────────────
  window.openWorkshopModal = () => {
    _wsSelected = new Set();
    const openRows = _rows.filter(r => !r.signOffStatus || r.signOffStatus === "Open");

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id        = "workshop-modal";
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <div class="bold" style="font-size:15px">📋 Workshop Session — Bulk Sign-off</div>
          <button class="btn btn-sm btn-outline" onclick="closeWorkshopModal()">✕ Close</button>
        </div>
        <div class="modal-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Session Date</label>
              <input type="date" id="ws-date" class="form-input"
                value="${new Date().toISOString().slice(0,10)}" />
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Facilitator</label>
              <input type="text" id="ws-facilitator" class="form-input" placeholder="Name or role…" />
            </div>
          </div>
          <div class="form-group" style="margin-bottom:16px">
            <label class="form-label">Attendees <span class="text-muted" style="font-weight:400;text-transform:none">(one per line)</span></label>
            <textarea id="ws-attendees" class="form-textarea" rows="2"
              placeholder="e.g.&#10;Jane Smith — Finance Lead&#10;Ali Hassan — IT Architect"></textarea>
          </div>

          <div class="section-divider" style="margin-top:0">
            Select KDDs to update
            <span class="text-muted" style="font-weight:400;text-transform:none">
              — ${openRows.length} open item${openRows.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
            <button class="btn btn-sm btn-outline" onclick="wsSelectAll()">Select All</button>
            <button class="btn btn-sm btn-outline" onclick="wsSelectNone()">Clear</button>
            <span id="ws-count" class="text-sm text-muted" style="margin-left:auto">0 selected</span>
          </div>
          <div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius)">
            ${openRows.length ? openRows.map(r => `
              <div class="item-row" onclick="wsToggle('${r.kddId}',this)">
                <input type="checkbox" id="ws-cb-${r.kddId}"
                  onclick="event.stopPropagation();wsToggle('${r.kddId}',this.closest('.item-row'))" />
                <span class="item-id">${r.kddId}</span>
                <span class="item-name" style="flex:1;font-size:12.5px">
                  ${(r.designQuestion||"").slice(0,72)}${r.designQuestion && r.designQuestion.length > 72 ? "…" : ""}
                </span>
                <span class="item-lob"><span class="badge badge-purple">${r.scopeItemId}</span></span>
              </div>`).join("")
            : `<div style="padding:24px;text-align:center;color:var(--text-muted)">
                ✅ All KDDs already have a sign-off status.
               </div>`}
          </div>
        </div>
        <div class="modal-footer">
          <span class="text-sm text-muted">Apply to selected:</span>
          <button class="btn btn-sm" style="background:var(--success);color:#fff"
            onclick="wsBulkApply('Approved')">✅ Approve</button>
          <button class="btn btn-sm" style="background:var(--warning);color:#fff"
            onclick="wsBulkApply('Deferred')">⏸ Defer</button>
          <button class="btn btn-sm" style="background:var(--danger);color:#fff"
            onclick="wsBulkApply('Rejected')">❌ Reject</button>
          <button class="btn btn-sm btn-outline" onclick="closeWorkshopModal()"
            style="margin-left:auto">Cancel</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) closeWorkshopModal(); });
  };

  window.closeWorkshopModal = () => {
    const m = document.getElementById("workshop-modal"); if (m) m.remove();
  };

  window.wsToggle = (kddId, rowEl) => {
    const cb = document.getElementById(`ws-cb-${kddId}`);
    if (_wsSelected.has(kddId)) {
      _wsSelected.delete(kddId);
      if (cb) cb.checked = false;
      if (rowEl) rowEl.classList.remove("checked");
    } else {
      _wsSelected.add(kddId);
      if (cb) cb.checked = true;
      if (rowEl) rowEl.classList.add("checked");
    }
    const cnt = document.getElementById("ws-count");
    if (cnt) cnt.textContent = `${_wsSelected.size} selected`;
  };

  window.wsSelectAll = () => {
    _rows.filter(r => !r.signOffStatus || r.signOffStatus === "Open").forEach(r => {
      _wsSelected.add(r.kddId);
      const cb = document.getElementById(`ws-cb-${r.kddId}`);
      if (cb) { cb.checked = true; cb.closest(".item-row").classList.add("checked"); }
    });
    const cnt = document.getElementById("ws-count");
    if (cnt) cnt.textContent = `${_wsSelected.size} selected`;
  };

  window.wsSelectNone = () => {
    _wsSelected = new Set();
    document.querySelectorAll("[id^='ws-cb-']").forEach(cb => {
      cb.checked = false; cb.closest(".item-row").classList.remove("checked");
    });
    const cnt = document.getElementById("ws-count");
    if (cnt) cnt.textContent = "0 selected";
  };

  window.wsBulkApply = (signOffStatus) => {
    if (!_wsSelected.size) { alert("Select at least one KDD first."); return; }
    const date      = (document.getElementById("ws-date")        || {}).value || "";
    const by        = (document.getElementById("ws-facilitator") || {}).value || "";
    const attendees = (document.getElementById("ws-attendees")   || {}).value || "";

    _wsSelected.forEach(kddId => {
      const row = _rows.find(r => r.kddId === kddId); if (!row) return;
      row.signOffStatus = signOffStatus;
      if (date) row.workshopDate = date;
      if (by)   row.decidedBy   = by;
      if (attendees && !row.actionItems) row.actionItems = `Attendees: ${attendees}`;
      // Save approved decisions with text to the learning library
      if (signOffStatus === "Approved" && row.decisionMade && row.decisionMade.trim()) {
        saveToLibrary(row);
      }
    });

    const count = _wsSelected.size;
    markDirty();
    closeWorkshopModal();
    renderTable(currentFiltered());
    window.saveEdits();
    showToast(`${count} KDD${count !== 1 ? "s" : ""} marked as ${signOffStatus}`);
    _wsSelected = new Set();
  };

  // ── Quality Critique (Claude scores each question) ──
  window.runCritique = async () => {
    const btn = document.getElementById("critique-btn");
    const el  = document.getElementById("critique-panel");
    btn.disabled = true;
    btn.textContent = "⚡ Checking…";

    el.innerHTML = `
      <div class="card mb-3" style="padding:14px 18px">
        <div class="bold mb-2" style="font-size:13.5px">⚡ Quality Check — Claude is reviewing each question for specificity</div>
        <div class="critique-log" id="critique-log"></div>
      </div>`;

    const log = (text, cls = "") => {
      const logEl = document.getElementById("critique-log");
      if (logEl) logEl.innerHTML += `<div class="line ${cls}">${text}</div>`;
    };

    try {
      const response = await fetch("/api/kdd/critique", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ rows: _rows })
      });

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          let evt;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.type === "progress") {
            log(`⟳ ${evt.message}`);
          } else if (evt.type === "item_done") {
            const cls = evt.generic > 0 ? "warn" : "ok";
            log(`${evt.item} — ${evt.total - evt.generic} specific · ${evt.generic} generic`, cls);
          } else if (evt.type === "item_error") {
            log(`⚠ ${evt.item}: ${evt.message}`, "warn");
          } else if (evt.type === "complete" && evt.results) {
            // Apply ratings to rows and re-render
            evt.results.forEach(s => {
              _ratings[s.kddId] = s.rating;
              _ratings[s.kddId + "_reason"] = s.reason || "";
            });
            const genericCount = evt.results.filter(s => s.rating === "generic").length;
            log(`✔ Done — ${evt.results.length - genericCount} specific · ${genericCount} need improvement`, genericCount > 0 ? "warn" : "ok");
            renderTable(currentFiltered());
            if (genericCount > 0) {
              el.innerHTML += `
                <div class="alert alert-warning mb-3" style="font-size:13px">
                  ⚠ <strong>${genericCount} question${genericCount !== 1 ? "s" : ""}</strong> flagged as generic —
                  marked with ⚠ in the table. Click the row to expand and improve the question.
                </div>`;
            } else {
              el.innerHTML += `<div class="alert alert-success mb-3" style="font-size:13px">✅ All questions are process-specific — no generic fillers found.</div>`;
            }
          }
        }
      }
    } catch (e) {
      el.innerHTML = `<div class="alert alert-danger">⚠️ ${escHtml(e.message)}</div>`;
    }

    btn.disabled = false;
    btn.textContent = "⚡ Quality Check";
  };

  // ── 💡 Decision Suggestions (editor row) ─────────────────────────────────────
  window.suggestDecisions = async (kddId) => {
    const r = _rows.find(x => x.kddId === kddId);
    if (!r) return;

    const btn     = document.querySelector(`#suggest-box-${kddId} button`);
    const cardsEl = document.getElementById(`suggest-cards-${kddId}`);
    if (!btn || !cardsEl) return;

    btn.disabled = true;
    cardsEl.innerHTML = "";

    // Live elapsed-time counter so users know it's working, not frozen
    const start   = Date.now();
    let timerInterval = setInterval(() => {
      const secs = Math.round((Date.now() - start) / 1000);
      btn.textContent = `⏳ Asking Claude… ${secs}s`;
    }, 1000);
    btn.textContent = "⏳ Asking Claude…";

    try {
      const res = await api.post("/api/kdd/suggest", {
        designQuestion: r.designQuestion, scopeItemId: r.scopeItemId,
        scopeItemName:  r.scopeItemName,  fitGap:       r.fitGap,
        rationale:      r.rationale,      notes:        r.notes,
        l1:             r.l1,             l2:           r.l2
      });
      clearInterval(timerInterval);
      if (!res.ok) throw new Error(res.error || "API error");

      window[`_sugg_${kddId}`] = res.suggestions;
      const tagColor  = { "SAP Standard": "#059669", "Common Variation": "#d97706", "Custom Path": "#7c3aed" };
      const fromLib   = res.source === "library";
      const sourceTag = fromLib
        ? `<span style="font-size:10px;color:#059669;background:#d1fae5;padding:1px 6px;
                        border-radius:8px;margin-left:4px">⚡ From library</span>`
        : `<span style="font-size:10px;color:#6b7280;margin-left:4px">(Claude)</span>`;

      cardsEl.innerHTML = `<div style="font-size:11px;color:#6b7280;margin-bottom:6px">
        ${fromLib ? "📚 From decision library — instant" : "🤖 Generated by Claude"}${sourceTag}
      </div>` + res.suggestions.map((s, i) => `
        <div onclick="event.stopPropagation();pickSuggestion('${kddId}',${i})"
          style="background:#faf5ff;border:1.5px solid #ddd6fe;border-radius:8px;padding:10px 14px;
                 margin-bottom:6px;cursor:pointer" class="suggest-hover">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
            <span style="font-size:10.5px;font-weight:700;color:${tagColor[s.tag]||"#7c3aed"};
                         background:#ede9fe;padding:2px 8px;border-radius:12px">${s.tag}</span>
          </div>
          <div style="font-size:12.5px;color:#111827;line-height:1.5;margin-bottom:3px">${s.text}</div>
          <div style="font-size:11px;color:#6b7280">${s.rationale}</div>
        </div>`).join("");

      btn.disabled = false;
      btn.textContent = fromLib ? "💡 Suggest Again (instant)" : "💡 Suggest Again";
    } catch (e) {
      clearInterval(timerInterval);
      cardsEl.innerHTML = `<div style="color:#dc2626;font-size:12px;padding:4px">⚠ ${escHtml(e.message)}</div>`;
      btn.disabled = false;
      btn.textContent = "💡 Suggest Decisions";
    }
  };

  window.pickSuggestion = (kddId, idx) => {
    const s = window[`_sugg_${kddId}`]?.[idx];
    if (!s) return;
    const ta = document.getElementById(`decision-ta-${kddId}`);
    if (ta) { ta.value = s.text; updateField(kddId, "decisionMade", s.text); }
  };

  // ── 📊 PPT Export ────────────────────────────────────────────────────────────
  window.exportPPT = async () => {
    const btn = document.getElementById("ppt-btn");
    btn.disabled = true;
    btn.textContent = "⏳ Building PPT…";
    try {
      const sid = await _resolveSessionId();
      const res = await api.post(`/api/kdd/ppt?session_id=${encodeURIComponent(sid)}`, {});
      if (res.ok && res.filename) {
        showToast("📊 PPT ready: " + res.filename);
        btn.textContent = "⬇ Download PPT";
        btn.disabled = false;
        btn.onclick = () => { window.location.href = `/api/output/download/${encodeURIComponent(res.filename)}`; };
      } else {
        throw new Error(res.error || "PPT build failed");
      }
    } catch (e) {
      showToast("⚠ PPT failed: " + e.message);
      btn.disabled = false;
      btn.textContent = "📊 PPT";
      btn.onclick = () => exportPPT();
    }
  };

  // ── 🎭 Workshop Presenter ─────────────────────────────────────────────────────
  let _pRows = [], _pIdx = 0, _pShowAll = false;

  function _presenterRAG(r) {
    if (r.fitGap === "Gap" && (r.complexity === "High" || r.complexity === "Medium")) return "Red";
    if (r.fitGap === "Gap" || (r.fitGap === "Partial Fit" && (r.complexity === "High" || r.complexity === "Medium"))) return "Amber";
    return "Green";
  }

  function _filterPresenterRows() {
    return _pShowAll
      ? [..._rows]
      : _rows.filter(r => !r.decisionMade || !r.decisionMade.trim());
  }

  function _renderPresenter() {
    if (!_pRows.length) {
      document.getElementById("p-question").textContent = "All decisions captured! 🎉";
      ["p-kddid","p-scope","p-fitgap","p-complexity","p-rag","p-rationale","p-impact","p-notes"]
        .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ""; });
      return;
    }
    const r   = _pRows[_pIdx];
    const rag = _presenterRAG(r);
    const ragColor  = rag === "Red" ? "#dc2626" : rag === "Amber" ? "#f59e0b" : "#10b981";
    const fitColor  = r.fitGap === "Gap" ? "#dc2626" : r.fitGap === "Partial Fit" ? "#f59e0b" : "#10b981";

    document.getElementById("p-progress").textContent   = `${_pIdx + 1} / ${_pRows.length}`;
    document.getElementById("p-kddid").textContent      = r.kddId;
    document.getElementById("p-scope").textContent      = `${r.scopeItemId} — ${r.scopeItemName}`;
    document.getElementById("p-fitgap").textContent     = r.fitGap;
    document.getElementById("p-fitgap").style.color     = fitColor;
    document.getElementById("p-complexity").textContent = r.complexity;
    document.getElementById("p-rag").textContent        = rag;
    document.getElementById("p-rag").style.color        = ragColor;
    document.getElementById("p-rationale").textContent  = r.rationale || "—";
    document.getElementById("p-impact").textContent     = r.impactActions || "—";
    document.getElementById("p-notes").textContent      = r.notes || "—";
    document.getElementById("p-question").textContent   = r.designQuestion || "";
    document.getElementById("p-decision").value         = r.decisionMade || "";
    document.getElementById("p-suggest-cards").innerHTML = "";
    document.getElementById("p-suggest-btn").textContent = "💡 Suggest Decisions";
    document.getElementById("p-suggest-btn").disabled   = false;
    document.getElementById("p-prev").disabled          = _pIdx === 0;
    document.getElementById("p-next").disabled          = _pIdx === _pRows.length - 1;
  }

  function _presenterKeyHandler(e) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") presenterNav(1);
    if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   presenterNav(-1);
    if (e.key === "Escape") closePresenter();
  }

  window.openPresenter = () => {
    _pRows = _filterPresenterRows();
    _pIdx  = 0;
    _renderPresenter();
    document.getElementById("presenter-overlay").style.display = "flex";
    document.addEventListener("keydown", _presenterKeyHandler);
  };

  window.closePresenter = () => {
    document.getElementById("presenter-overlay").style.display = "none";
    document.removeEventListener("keydown", _presenterKeyHandler);
  };

  window.presenterNav = (dir) => {
    _pIdx = Math.max(0, Math.min(_pRows.length - 1, _pIdx + dir));
    _renderPresenter();
  };

  window.togglePresenterFilter = () => {
    _pShowAll = !_pShowAll;
    _pRows = _filterPresenterRows();
    _pIdx  = 0;
    _renderPresenter();
    const btn = document.getElementById("p-filter-btn");
    if (btn) btn.textContent = _pShowAll ? "Show: All KDDs" : "Show: Open Only";
  };

  window.savePresenterDecision = () => {
    const r   = _pRows[_pIdx];
    if (!r) return;
    const val = document.getElementById("p-decision").value;
    updateField(r.kddId, "decisionMade", val);
    _pRows[_pIdx] = { ..._pRows[_pIdx], decisionMade: val };
    const saveBtn = document.getElementById("p-save-btn");
    saveBtn.textContent = "✅ Saved!";
    saveBtn.style.background = "#059669";
    setTimeout(() => { saveBtn.textContent = "💾 Save Decision"; saveBtn.style.background = "#7c3aed"; }, 1800);
  };

  window.presenterSuggest = async () => {
    const r   = _pRows[_pIdx];
    if (!r) return;
    const btn     = document.getElementById("p-suggest-btn");
    const cardsEl = document.getElementById("p-suggest-cards");

    btn.disabled = true;
    cardsEl.innerHTML = "";

    // Live timer — shows elapsed seconds so users know it's working
    const start = Date.now();
    let timerInterval = setInterval(() => {
      const secs = Math.round((Date.now() - start) / 1000);
      btn.textContent = `⏳ Asking Claude… ${secs}s`;
    }, 1000);
    btn.textContent = "⏳ Asking Claude…";

    try {
      const res = await api.post("/api/kdd/suggest", {
        designQuestion: r.designQuestion, scopeItemId: r.scopeItemId,
        scopeItemName:  r.scopeItemName,  fitGap:       r.fitGap,
        rationale:      r.rationale,      notes:        r.notes,
        l1:             r.l1,             l2:           r.l2
      });
      clearInterval(timerInterval);
      if (!res.ok) throw new Error(res.error || "API error");

      window._pSugg = res.suggestions;
      const fromLib  = res.source === "library";
      const tagColor = { "SAP Standard": "#10b981", "Common Variation": "#f59e0b", "Custom Path": "#a78bfa" };

      cardsEl.innerHTML =
        `<div style="font-size:10.5px;color:#9d7fe5;margin-bottom:8px">
          ${fromLib ? "⚡ From decision library — instant" : "🤖 Generated by Claude"}
        </div>` +
        res.suggestions.map((s, i) => `
          <div class="p-suggest-card" onclick="presenterPickSuggestion(${i})">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
              <span style="font-size:10.5px;font-weight:700;color:${tagColor[s.tag]||"#a78bfa"};
                           background:rgba(167,139,250,.15);padding:2px 8px;border-radius:12px">${s.tag}</span>
            </div>
            <div style="font-size:13px;color:#e2d9f3;line-height:1.5;margin-bottom:4px">${s.text}</div>
            <div style="font-size:11px;color:#9d7fe5">${s.rationale}</div>
          </div>`).join("");

      btn.textContent = fromLib ? "💡 Suggest Again (instant)" : "💡 Suggest Again";
      btn.disabled = false;
    } catch (e) {
      clearInterval(timerInterval);
      cardsEl.innerHTML = `<div style="color:#f87171;font-size:12px">⚠ ${escHtml(e.message)}</div>`;
      btn.textContent = "💡 Suggest Decisions";
      btn.disabled = false;
    }
  };

  window.presenterPickSuggestion = (idx) => {
    const s = window._pSugg?.[idx];
    if (!s) return;
    document.getElementById("p-decision").value = s.text;
  };
}

// ── DECISION LIBRARY page ─────────────────────────────────────────────────────
// Searchable view of decisions.json — all approved KDD decisions across projects.
// Stats strip → filter bar → decision table with expand-to-view detail.

async function pagDecisionLibrary(activeSlug) {
  // Pick up tab state set by dlSwitchClient (survives navigate() re-render)
  if (activeSlug === undefined) activeSlug = window._dlActiveSlug || "";
  const [clients, lib, data] = await Promise.all([
    api.get("/api/decisions/clients").catch(() => ({ clients: [] })),
    api.get(`/api/decisions/summary${activeSlug ? `?clientSlug=${encodeURIComponent(activeSlug)}` : ""}`).catch(() => ({ total: 0, scopeItems: 0, projects: 0, byFitGap: { Fit: 0, "Partial Fit": 0, Gap: 0 }, scopeBreakdown: [] })),
    api.get(`/api/decisions${activeSlug ? `?clientSlug=${encodeURIComponent(activeSlug)}` : ""}`).catch(() => ({ decisions: [], total: 0 }))
  ]);
  const clientList  = (clients && clients.clients) || [];
  // Normalise — old server may return array directly instead of {decisions:[]}
  const decisions   = (data && Array.isArray(data.decisions)) ? data.decisions
                    : Array.isArray(data) ? data : [];
  // Normalise lib — guard against missing fields
  if (!lib.byFitGap)       lib.byFitGap = { Fit: 0, "Partial Fit": 0, Gap: 0 };
  if (!lib.scopeBreakdown) lib.scopeBreakdown = [];

  const fitPct   = lib.total ? Math.round(((lib.byFitGap["Fit"] || 0) / lib.total) * 100) : 0;
  const gapPct   = lib.total ? Math.round(((lib.byFitGap["Gap"] || 0) / lib.total) * 100) : 0;
  const partPct  = lib.total ? Math.round(((lib.byFitGap["Partial Fit"] || 0) / lib.total) * 100) : 0;

  const empty = lib.total === 0;

  const emptyState = `
    <div class="card" style="text-align:center;padding:48px 24px;margin-top:16px">
      <div style="font-size:48px;margin-bottom:16px">📚</div>
      <div style="font-size:18px;font-weight:600;margin-bottom:8px">Decision Library is empty</div>
      <div style="color:var(--text-muted);font-size:14px;max-width:480px;margin:0 auto 20px;line-height:1.7">
        When you mark a KDD decision as <strong>Approved</strong> in the KDD Editor,
        it's automatically saved here for future projects.<br><br>
        <strong>Already approved decisions?</strong> Click Sync to import them now.
      </div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" id="dl-sync-empty-btn" onclick="dlSync()">🔄 Sync Approved Decisions</button>
        <button class="btn btn-outline" onclick="navigate('editor')">✎ Open KDD Editor</button>
      </div>
      <div id="dl-sync-msg" style="margin-top:14px;font-size:13px;color:var(--text-muted)"></div>
    </div>`;

  // ── Client tabs ───────────────────────────────────────────────────────────────
  const tabsHTML = clientList.length > 1 ? `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
      <span style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-right:4px">Client:</span>
      <button onclick="dlSwitchClient('')"
        style="padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid ${!activeSlug?"var(--accent)":"var(--border)"};background:${!activeSlug?"var(--accent)":"transparent"};color:${!activeSlug?"#fff":"var(--text)"}">
        All (${clientList.reduce((s,c)=>s+c.count,0)})
      </button>
      ${clientList.map(c => `
        <button onclick="dlSwitchClient('${c.slug}')"
          style="padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid ${activeSlug===c.slug?"var(--accent)":"var(--border)"};background:${activeSlug===c.slug?"var(--accent)":"transparent"};color:${activeSlug===c.slug?"#fff":"var(--text)"}">
          ${c.label} (${c.count})
        </button>`).join("")}
    </div>` : "";

  return `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div>
        <div class="page-title">📚 Decision Library</div>
        <div class="page-sub">Approved KDD decisions · ${activeSlug ? clientList.find(c=>c.slug===activeSlug)?.label || activeSlug : "All clients"} · client names not stored</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline btn-sm" id="dl-sync-btn" onclick="dlSync()">🔄 Sync</button>
        ${lib.total > 0 ? `<button class="btn btn-outline btn-sm" onclick="dlExport()">⬇ Export</button>` : ""}
        ${lib.total > 0 ? `<button class="btn btn-sm" style="background:#fff1f0;color:#c0392b;border:1px solid #f5c6cb" onclick="dlClear()">🗑 Clear</button>` : ""}
      </div>
    </div>

    ${tabsHTML}

    ${empty ? emptyState : `
    <!-- Stats strip -->
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      <div class="card">
        <div class="card-title">Total Decisions</div>
        <div class="card-value">${lib.total.toLocaleString()}</div>
        <div class="card-note">${activeSlug ? "this client" : "across all clients"}</div>
      </div>
      <div class="card">
        <div class="card-title">Scope Items</div>
        <div class="card-value">${lib.scopeItems}</div>
        <div class="card-note">unique SAP processes</div>
      </div>
      <div class="card">
        <div class="card-title">Projects</div>
        <div class="card-value">${lib.projects}</div>
        <div class="card-note">engagements</div>
      </div>
      <div class="card">
        <div class="card-title">Fit / Part / Gap</div>
        <div class="card-value" style="font-size:20px">
          <span style="color:#10b981">${fitPct}%</span>
          <span style="color:#f59e0b;margin:0 6px">${partPct}%</span>
          <span style="color:#ef4444">${gapPct}%</span>
        </div>
        <div class="card-note">Fit · Partial · Gap</div>
      </div>
    </div>

    <!-- Filter bar -->
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      <input id="dl-search" class="form-input" style="flex:1;min-width:200px"
        placeholder="Search questions or decisions…" oninput="dlFilter()" />
      <select id="dl-fitgap" class="form-input" style="width:150px" onchange="dlFilter()">
        <option value="">All Fit/Gap</option>
        <option value="Fit">✅ Fit</option>
        <option value="Partial Fit">⚠️ Partial Fit</option>
        <option value="Gap">🔴 Gap</option>
      </select>
      <select id="dl-scope" class="form-input" style="width:160px" onchange="dlFilter()">
        <option value="">All Scope Items</option>
        ${(lib.scopeBreakdown || []).map(s => `<option value="${s.id}">${s.id} (${s.count})</option>`).join("")}
      </select>
      <span id="dl-count" style="font-size:12px;color:var(--text-muted);white-space:nowrap">
        ${decisions.length} decision${decisions.length !== 1 ? "s" : ""}
      </span>
    </div>

    <!-- Decisions table -->
    <div class="card" style="padding:0;overflow:hidden">
      <div class="table-wrap">
        <table id="dl-table">
          <thead>
            <tr>
              <th style="width:70px">Scope</th>
              <th>Design Question</th>
              <th>Decision Made</th>
              <th style="width:100px">Fit/Gap</th>
              <th style="width:80px">Complexity</th>
              <th style="width:110px">Project</th>
              <th style="width:32px"></th>
            </tr>
          </thead>
          <tbody id="dl-tbody">
            ${renderDLRows(decisions)}
          </tbody>
        </table>
      </div>
    </div>

    <div id="dl-no-results" class="alert alert-info" style="display:none;margin-top:12px">
      No decisions match the current filter.
    </div>
    <div id="dl-sync-msg" style="margin-top:14px;font-size:13px;color:var(--text-muted);text-align:center"></div>
    `}`;
}

function renderDLRows(decisions) {
  if (!decisions || !decisions.length) return `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:32px">No decisions yet — sync approved decisions from the KDD Editor.</td></tr>`;

  const fitColors = { "Fit": "#10b981", "Partial Fit": "#f59e0b", "Gap": "#ef4444" };
  const compColors = { "Low": "#10b981", "Medium": "#f59e0b", "High": "#ef4444" };

  return decisions.map((d, i) => {
    const rowId = `dl-row-${i}`;
    const detailId = `dl-detail-${i}`;
    const qShort = (d.question || "").length > 80 ? d.question.slice(0, 80) + "…" : (d.question || "—");
    const decShort = (d.decision || "").length > 80 ? d.decision.slice(0, 80) + "…" : (d.decision || "—");
    const fitColor = fitColors[d.fitGap] || "#9ca3af";
    const compColor = compColors[d.complexity] || "#9ca3af";
    const savedDate = d.savedAt ? new Date(d.savedAt).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"2-digit" }) : "";

    return `
      <tr id="${rowId}" style="cursor:pointer" onclick="dlToggle(${i})">
        <td><span class="bold" style="color:var(--accent)">${d.scopeItemId || "—"}</span></td>
        <td style="font-size:12.5px">${qShort}</td>
        <td style="font-size:12.5px">${decShort}</td>
        <td><span style="font-size:11px;font-weight:700;color:${fitColor};background:${fitColor}22;
                         padding:2px 8px;border-radius:10px">${d.fitGap || "—"}</span></td>
        <td><span style="font-size:11px;color:${compColor}">${d.complexity || "—"}</span></td>
        <td style="font-size:11px;color:var(--text-muted)">${d.project || "—"}</td>
        <td style="text-align:center;font-size:11px;color:var(--text-muted)">▼</td>
      </tr>
      <tr id="${detailId}" style="display:none;background:var(--surface-raised)">
        <td colspan="7" style="padding:16px 20px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:12.5px">
            <div>
              <div style="font-weight:600;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Design Question</div>
              <div style="line-height:1.6">${d.question || "—"}</div>
            </div>
            <div>
              <div style="font-weight:600;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Decision Made</div>
              <div style="line-height:1.6">${d.decision || "—"}</div>
            </div>
            ${d.rationale ? `
            <div style="grid-column:1/-1">
              <div style="font-weight:600;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Rationale</div>
              <div style="line-height:1.6;color:var(--text-muted)">${d.rationale}</div>
            </div>` : ""}
          </div>
          <div style="display:flex;gap:16px;margin-top:12px;font-size:11px;color:var(--text-muted)">
            ${d.kddId         ? `<span>🔑 ${d.kddId}</span>` : ""}
            ${d.scopeItemName ? `<span>📋 ${d.scopeItemName}</span>` : ""}
            ${d.project       ? `<span>📁 ${d.project}</span>` : ""}
            ${savedDate       ? `<span>🗓 ${savedDate}</span>` : ""}
          </div>
        </td>
      </tr>`;
  }).join("");
}

function bindDecisionLibrary() {
  // Track which client tab is active — persisted across filter calls
  let _activeSlug = window._dlActiveSlug || "";

  window.dlToggle = (i) => {
    const detail = document.getElementById(`dl-detail-${i}`);
    const row    = document.getElementById(`dl-row-${i}`);
    if (!detail) return;
    const open = detail.style.display !== "none";
    detail.style.display = open ? "none" : "table-row";
    const arrow = row ? row.querySelector("td:last-child") : null;
    if (arrow) arrow.textContent = open ? "▼" : "▲";
  };

  // Switch client tab — re-renders the whole page with that client's data
  window.dlSwitchClient = (slug) => {
    window._dlActiveSlug = slug;
    navigate("decision-library");
  };

  window.dlFilter = async () => {
    const q     = (document.getElementById("dl-search")?.value || "").toLowerCase();
    const fg    = document.getElementById("dl-fitgap")?.value  || "";
    const scope = document.getElementById("dl-scope")?.value   || "";

    const params = new URLSearchParams();
    if (q)               params.set("q",           q);
    if (scope)           params.set("scopeItemId",  scope);
    if (_activeSlug)     params.set("clientSlug",   _activeSlug);
    const url = `/api/decisions?${params.toString()}`;

    try {
      const data = await api.get(url);
      let results = data.decisions || [];
      if (fg) results = results.filter(d => d.fitGap === fg);

      const tbody     = document.getElementById("dl-tbody");
      const noResults = document.getElementById("dl-no-results");
      const countEl   = document.getElementById("dl-count");

      if (tbody)     tbody.innerHTML = renderDLRows(results);
      if (noResults) noResults.style.display = results.length ? "none" : "block";
      if (countEl)   countEl.textContent = `${results.length} decision${results.length !== 1 ? "s" : ""}`;
    } catch { /* non-fatal */ }
  };

  window.dlSync = async () => {
    const btn      = document.getElementById("dl-sync-btn");
    const emptyBtn = document.getElementById("dl-sync-empty-btn");
    const msg = document.getElementById("dl-sync-msg");
    if (btn)      { btn.disabled = true;      btn.textContent = "⏳ Syncing…"; }
    if (emptyBtn) { emptyBtn.disabled = true; emptyBtn.textContent = "⏳ Syncing…"; }
    try {
      const data = await api.post("/api/decisions/sync", {});
      if (data.ok) {
        const text = data.message || `Synced ${data.synced} decisions.`;
        if (msg) { msg.style.color = "var(--success)"; msg.textContent = `✅ ${text}`; }
        // Switch to the client tab that was just synced and reload
        if (data.synced > 0) {
          window._dlActiveSlug = data.clientSlug || "";
          setTimeout(() => navigate("decision-library"), 1400);
        }
      } else {
        if (msg) { msg.style.color = "var(--warning)"; msg.textContent = `⚠ ${data.error || data.message}`; }
      }
    } catch (e) {
      if (msg) { msg.style.color = "var(--danger)"; msg.textContent = `⚠ ${escHtml(e.message)}`; }
    } finally {
      if (btn)      { btn.disabled = false;      btn.textContent = "🔄 Sync"; }
      if (emptyBtn) { emptyBtn.disabled = false; emptyBtn.textContent = "🔄 Sync Approved Decisions"; }
    }
  };

  window.dlExport = () => {
    const params = _activeSlug ? `?clientSlug=${encodeURIComponent(_activeSlug)}` : "";
    const label  = _activeSlug || "all-clients";
    api.get(`/api/decisions${params}`).then(data => {
      const blob = new Blob([JSON.stringify(data.decisions, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `kdd-decisions-${label}-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    }).catch(() => {});
  };

  window.dlClear = async () => {
    const scope = _activeSlug
      ? `all decisions for this client`
      : `ALL decisions across every client`;
    if (!confirm(`⚠ This will permanently delete ${scope}.\n\nThis cannot be undone. Continue?`)) return;
    const params = _activeSlug ? `?clientSlug=${encodeURIComponent(_activeSlug)}` : "";
    try {
      const data = await fetch(`/api/decisions${params}`, { method: "DELETE" }).then(r => r.json());
      if (data.ok) {
        window._dlActiveSlug = "";
        navigate("decision-library");
      } else {
        alert(`Error: ${data.error || "Could not clear decisions"}`);
      }
    } catch (e) {
      alert(`Error: ${escHtml(e.message)}`);
    }
  };
}

// ── MCP SERVER page ───────────────────────────────────────────────────────────
// Shows config status, registered tools, live data snapshot, and a "Try" panel.
// The actual mcp_server.py process is started by Claude CLI via .claude/settings.json.
// This page is purely for visibility — no writes happen here.

async function pagMCPServer() {
  const cfg = await api.get("/api/mcp/config").catch(() => null);
  if (!cfg) return `<div class="alert alert-danger">Could not load MCP config</div>`;

  const ok = cfg.settingsFound && cfg.mcpServerFound;
  const statusColor = ok ? "#10b981" : "#f59e0b";
  const statusLabel = ok ? "✅ Registered" : "⚠️ Check setup";

  const toolCards = cfg.tools.map(t => `
    <div class="card" id="mcp-tool-${t.name}"
         style="border:1px solid var(--border);cursor:pointer"
         onclick="mcpTryTool('${t.name}')">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="font-size:20px">${t.icon}</span>
        <div>
          <div style="font-weight:600;font-size:13px">${t.name}</div>
          <div style="font-size:11px;color:var(--text-muted)">${t.hint}</div>
        </div>
        <span style="margin-left:auto;font-size:11px;color:var(--accent)">▶ Try</span>
      </div>
      <div style="font-size:12.5px;color:var(--text-muted);line-height:1.5">${t.desc}</div>
    </div>`).join("");

  const servers = cfg.registeredServers.length
    ? cfg.registeredServers.map(s => `
        <div style="font-size:12.5px;padding:10px 14px;background:var(--surface-raised);
                    border-radius:6px;margin-bottom:6px">
          <span style="color:var(--accent);font-weight:600">${s.name}</span>
          <span style="color:var(--text-muted);margin-left:8px">${s.command}</span>
        </div>`).join("")
    : `<div class="alert alert-warning" style="margin:0">No servers in .claude/settings.json</div>`;

  return `
    <div class="page-header" style="display:flex;align-items:center;
         justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div>
        <div class="page-title">🔌 MCP Server</div>
        <div class="page-sub">Model Context Protocol — how Claude CLI reads application data</div>
      </div>
      <span style="font-size:12px;font-weight:600;color:${statusColor};
                   background:${statusColor}22;padding:4px 12px;border-radius:12px">
        ${statusLabel}
      </span>
    </div>

    <!-- Explainer -->
    <div class="card" style="border-left:3px solid var(--accent);margin-bottom:20px">
      <div style="font-size:13px;line-height:1.8;color:var(--text-muted)">
        <strong style="color:var(--text)">How it works:</strong>
        When you open Claude Code CLI in this folder, it reads
        <code style="background:var(--surface-raised);padding:1px 6px;border-radius:4px">.claude/settings.json</code>
        and starts
        <code style="background:var(--surface-raised);padding:1px 6px;border-radius:4px">mcp_server.py</code>
        as a background subprocess (Python/FastAPI). Claude can then call any of the 5 tools below — reading your SAP catalog,
        querying past decisions, or pulling cached KDDs —
        without any API key. The <strong style="color:var(--text)">Try</strong> panel below
        shows exactly the JSON Claude would receive.
      </div>
    </div>

    <!-- Data snapshot -->
    <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="card">
        <div class="card-title">Catalog Items</div>
        <div class="card-value">${(cfg.dataSnapshot.catalogItems || 0).toLocaleString()}</div>
        <div class="card-note">SAP processes Claude can look up</div>
      </div>

      <div class="card">
        <div class="card-title">Saved Decisions</div>
        <div class="card-value">${(cfg.dataSnapshot.savedDecisions || 0).toLocaleString()}</div>
        <div class="card-note">Approved decisions in learning store</div>
      </div>
    </div>

    <!-- Registered servers -->
    <div class="section-divider">.claude/settings.json — Registered MCP Servers</div>
    <div style="margin-bottom:20px">${servers}</div>

    <!-- Tool cards -->
    <div class="section-divider">5 Tools Claude Can Call · Click any to try it live</div>
    <div class="skills-grid" style="margin-bottom:20px">${toolCards}</div>

    <!-- Try panel — shown when a tool card is clicked -->
    <div id="mcp-try-panel" style="display:none">
      <div class="section-divider" id="mcp-try-title">▶ Try Tool</div>
      <div class="card" style="padding:16px">
        <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:8px">
          Edit the JSON arguments below then click Run — this calls the same logic
          Claude CLI calls when it uses this tool.
        </div>
        <div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-start">
          <textarea id="mcp-args-input" class="form-input" rows="4"
            style="flex:1;font-family:monospace;font-size:12px;resize:vertical"></textarea>
          <button class="btn btn-primary" onclick="mcpRunTool()" style="white-space:nowrap">
            ▶ Run
          </button>
        </div>
        <div id="mcp-running" style="display:none;color:var(--text-muted);font-size:12px;
             margin-bottom:8px">⏳ Running…</div>
        <pre id="mcp-result" style="background:var(--surface-raised);border-radius:6px;
             padding:14px;font-size:11.5px;overflow:auto;max-height:400px;margin:0;
             white-space:pre-wrap;display:none"></pre>
      </div>
    </div>`;
}

function bindMCPServer() {
  let _currentTool = null;

  const defaults = {
    "get_process_context":    '{\n  "scopeItemId": "BD6"\n}',
    "search_past_decisions":  '{\n  "scopeItemId": "",\n  "query": "payment",\n  "fitGap": ""\n}',
    "save_approved_decision": '{\n  "scopeItemId": "BD6",\n  "question": "Will standard process meet requirements?",\n  "decision": "Standard SAP process accepted",\n  "fitGap": "Fit"\n}',
    "get_cached_kdds":        '{\n  "scopeItemId": "J59"\n}',
    "list_decisions_summary": '{}'
  };

  window.mcpTryTool = (toolName) => {
    _currentTool = toolName;

    document.querySelectorAll("[id^='mcp-tool-']").forEach(el => {
      el.style.borderColor = el.id === "mcp-tool-" + toolName
        ? "var(--accent)" : "var(--border)";
    });

    const panel  = document.getElementById("mcp-try-panel");
    const title  = document.getElementById("mcp-try-title");
    const input  = document.getElementById("mcp-args-input");
    const result = document.getElementById("mcp-result");
    const run    = document.getElementById("mcp-running");

    if (panel)  panel.style.display  = "block";
    if (title)  title.textContent    = "▶ Try: " + toolName;
    if (input)  input.value          = defaults[toolName] || "{}";
    if (result) { result.textContent = ""; result.style.display = "none"; }
    if (run)    run.style.display    = "none";

    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  window.mcpRunTool = async () => {
    if (!_currentTool) return;
    const runEl    = document.getElementById("mcp-running");
    const resultEl = document.getElementById("mcp-result");
    const input    = document.getElementById("mcp-args-input");

    let args = {};
    try { args = JSON.parse(input?.value || "{}"); }
    catch { /* malformed JSON — send empty */ }

    if (runEl)    runEl.style.display    = "block";
    if (resultEl) resultEl.style.display = "none";

    try {
      const data = await api.post("/api/mcp/invoke", { tool: _currentTool, args });
      if (resultEl) {
        resultEl.textContent     = JSON.stringify(data.result, null, 2);
        resultEl.style.display   = "block";
        resultEl.style.color     = data.result?.error ? "#f87171" : "var(--text)";
      }
    } catch (e) {
      if (resultEl) {
        resultEl.textContent   = "Error: " + e.message;
        resultEl.style.display = "block";
        resultEl.style.color   = "#f87171";
      }
    } finally {
      if (runEl) runEl.style.display = "none";
    }
  };
}

// ── BDCQ Agent page ───────────────────────────────────────────────────────────
async function pagBDCQ() {
  const s = await api.get("/api/bdcq/status").catch(() => ({ found: false }));

  // ── Source strip (slim when loaded, upload zone when not) ──────────────────
  const sourceCard = s.found
    ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;
                   background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;
                   padding:6px 10px;margin-bottom:12px;font-size:12px;flex-wrap:wrap">
        <span style="color:#166534">
          ✓ <strong>bdcq-questions.json</strong> &nbsp;·&nbsp;
          ${s.totalDomains} domain${s.totalDomains !== 1 ? "s" : ""} &nbsp;·&nbsp;
          ${(s.totalQuestions || 0).toLocaleString()} questions
          ${s.generatedAt ? `&nbsp;·&nbsp; ${s.generatedAt.slice(0,10)}` : ""}
        </span>
        <label style="font-size:11px;color:var(--accent);cursor:pointer;white-space:nowrap;font-weight:600">
          ↺ Replace
          <input id="bdcq-replace-input" type="file" accept=".json" style="display:none" onchange="bdcqUploadFile(this.files[0])">
        </label>
      </div>`
    : `<div id="bdcq-upload-zone" style="border:2px dashed var(--border);border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:border-color .2s;margin-bottom:12px"
          ondragover="event.preventDefault();this.style.borderColor='var(--accent)'"
          ondragleave="this.style.borderColor='var(--border)'"
          ondrop="event.preventDefault();this.style.borderColor='var(--border)';bdcqDropFile(event.dataTransfer.files[0])"
          onclick="document.getElementById('bdcq-file-input').click()">
        <div style="font-size:28px;margin-bottom:6px">⊟</div>
        <div style="font-weight:600;margin-bottom:3px">Drop bdcq-questions.json here</div>
        <div style="font-size:12px;color:var(--text-muted)">or click to browse — generated by the SAPDeckAgent Chrome extension from SAP Roadmap Viewer</div>
        <input id="bdcq-file-input" type="file" accept=".json" style="display:none" onchange="bdcqUploadFile(this.files[0])">
      </div>`;

  // ── Domain meta (per-file columns) ─────────────────────────────────────────
  // Stored on window so bindBDCQ() can access it without re-fetching
  window._bdcqDomainMeta = s.domainMeta || [];

  // ── Country checkboxes ──────────────────────────────────────────────────────
  const countries = s.countries || [];
  const countrySection = countries.length > 0
    ? `<div class="section-divider" style="margin:8px 0 6px">Countries / Localisation</div>
       <div style="margin-bottom:8px">
         <div class="form-label" style="margin-bottom:4px">Include locale sheets</div>
         <div>
           ${countries.map(c => `
             <label style="display:inline-flex;align-items:center;gap:5px;margin:2px 8px 2px 0;font-size:12px">
               <input type="checkbox" class="bdcq-country-check" value="${c}"> ${c}
             </label>`).join("")}
         </div>
         <div class="form-hint" style="margin-top:3px">Leave all unchecked to include global sheets only</div>
       </div>`
    : "";

  // ── Domain multi-select — inline collapsible list ───────────────────────────
  const domainSection = s.found && window._bdcqDomainMeta.length > 0
    ? `<div class="section-divider" style="margin:8px 0 6px">BDCQ Files</div>
       <div style="margin-bottom:8px">
         <div class="form-label" style="margin-bottom:4px">Select domains to include</div>

         <!-- Trigger row -->
         <button id="bdcq-domain-trigger" onclick="bdcqToggleDropdown()"
           style="width:100%;display:flex;align-items:center;justify-content:space-between;
                  padding:8px 12px;background:var(--surface-2);border:1px solid var(--border);
                  border-radius:6px;color:var(--text);font-size:13px;cursor:pointer;text-align:left;
                  margin-bottom:0">
           <span id="bdcq-domain-label" style="color:var(--text-muted)">Select domains…</span>
           <span id="bdcq-domain-arrow" style="font-size:10px;color:var(--text-muted)">▼</span>
         </button>

         <!-- Inline list — hidden by default, expands below trigger -->
         <div id="bdcq-domain-panel" style="display:none;border:1px solid var(--border);
              border-top:none;border-radius:0 0 6px 6px;background:var(--surface-2);
              max-height:260px;overflow-y:auto">
           <div style="display:flex;align-items:center;justify-content:flex-end;gap:16px;
                       padding:8px 14px;border-bottom:1px solid var(--border);
                       background:var(--surface-1,#f5f5f5);min-height:36px">
             <button onclick="bdcqDomainAll(true);event.stopPropagation()"
               style="background:none;border:none;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer;padding:0">Select all</button>
             <span style="color:var(--border);font-size:12px">|</span>
             <button onclick="bdcqDomainAll(false);event.stopPropagation()"
               style="background:none;border:none;color:var(--text-muted);font-size:12px;cursor:pointer;padding:0">Clear</button>
           </div>
           ${window._bdcqDomainMeta.map(d => `
             <label style="display:flex;align-items:center;justify-content:space-between;
                            padding:9px 12px;cursor:pointer;font-size:13px;
                            border-bottom:1px solid rgba(255,255,255,.04)"
                    onmouseover="this.style.background='rgba(255,255,255,.05)'"
                    onmouseout="this.style.background=''">
               <span style="display:flex;align-items:center;gap:8px">
                 <input type="checkbox" class="bdcq-domain-check" value="${escHtml(d.domain)}"
                   style="accent-color:var(--accent);width:14px;height:14px;flex-shrink:0"
                   onchange="bdcqOnDomainChange()">
                 ${escHtml(d.domain)}
               </span>
               <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;margin-left:8px">${d.rowCount} q</span>
             </label>`).join("")}
         </div>
         <div class="form-hint">Select one or more — columns load automatically. Leave empty to include all files.</div>
       </div>`
    : "";

  return `
    <div style="background:linear-gradient(135deg,#460073 0%,#A100FF 100%);
                border-radius:10px;padding:16px 22px;margin-bottom:10px;
                display:flex;align-items:center;gap:16px">
      <div style="font-size:36px;font-weight:900;color:#A100FF;line-height:1;
                  text-shadow:0 0 20px rgba(161,0,255,0.5)">📋</div>
      <div>
        <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.3px">
          BDCQ Enricher</div>
        <div style="color:#E0C8FF;font-size:12px;margin-top:2px">
          Accenture · SAP S/4HANA Cloud Public Edition · Explore Phase</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="color:#E0C8FF;font-size:11px">Enriched with</div>
        <div style="display:flex;gap:6px;margin-top:3px;flex-wrap:wrap;justify-content:flex-end">
          <span style="background:rgba(255,255,255,${s.found ? "0.25" : "0.10"});color:${s.found ? "#fff" : "rgba(255,255,255,0.5)"};padding:2px 10px;border-radius:12px;font-size:11px">
            ${s.found ? "✓" : "⚠"} BDCQ Files</span>
          <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">🌍 Country Rules</span>
          <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">✦ Claude AI</span>
        </div>
      </div>
    </div>

    <!-- ── Tab bar ─────────────────────────────────────────────────────────────── -->
    <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:10px">
      <button id="bdcq-tab-configure" onclick="bdcqSwitchTab('configure')"
        style="padding:7px 16px;font-size:13px;font-weight:600;border:none;cursor:pointer;
               background:none;border-bottom:2px solid var(--accent);color:var(--accent);
               margin-bottom:-2px;transition:color .15s">
        ⚙️ Configure
      </button>
      <button id="bdcq-tab-grounding" onclick="bdcqSwitchTab('grounding')"
        style="padding:7px 16px;font-size:13px;font-weight:600;border:none;cursor:pointer;
               background:none;border-bottom:2px solid transparent;color:var(--text-muted);
               margin-left:0;position:relative">
        ◈ Grounding <span id="bdcq-grounding-badge" style="display:none;position:absolute;top:4px;right:4px;
          width:8px;height:8px;border-radius:50%;background:var(--accent)"></span>
      </button>
      <button id="bdcq-tab-editor" onclick="bdcqSwitchTab('editor')" disabled
        style="padding:7px 16px;font-size:13px;font-weight:600;border:none;cursor:not-allowed;
               background:none;border-bottom:2px solid transparent;color:var(--text-muted);
               margin-bottom:-2px;transition:color .15s;opacity:.5">
        📋 Editor
      </button>
    </div>

    <!-- ══ CONFIGURE TAB ════════════════════════════════════════════════════════ -->
    <div id="bdcq-panel-configure">

    <div class="card" style="padding:14px 16px">
      ${sourceCard}

      <!-- Project Details: 2-col tight row -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div>
          <label class="form-label">Client Name</label>
          <input id="bdcq-client" class="form-input" type="text" placeholder="e.g. Acme Corp">
        </div>
        <div>
          <label class="form-label">Output File Name <span style="color:#f87171">*</span> <span style="font-weight:400;color:var(--text-muted);font-size:11px">.xlsx</span></label>
          <input id="bdcq-filename" class="form-input" type="text" placeholder="e.g. Acme_BDCQ_Finance">
        </div>
      </div>

      <!-- Scope Filter: single-line + file upload + domain finder -->
      <div style="margin-bottom:8px">
        <label class="form-label">Scope IDs from DDA <span style="font-weight:400;color:var(--text-muted);font-size:11px">(optional — auto-selects domains)</span></label>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="bdcq-scope" class="form-input" type="text"
            placeholder="e.g. BD6, J59, BEI — or upload your DDA file →"
            style="flex:1">
          <!-- DDA file upload -->
          <label title="Upload DDA Excel or PDF to extract scope IDs automatically"
                 style="display:flex;align-items:center;gap:4px;padding:5px 10px;
                        border:1px solid var(--border);border-radius:6px;font-size:12px;
                        cursor:pointer;white-space:nowrap;color:var(--text-muted);
                        background:var(--surface-2);transition:border-color .2s;user-select:none"
                 onmouseover="this.style.borderColor='var(--accent);this.style.color=var(--accent)'"
                 onmouseout="this.style.borderColor='var(--border);this.style.color=var(--text-muted)'">
            <span id="bdcq-dda-upload-label">📎 DDA file</span>
            <input id="bdcq-dda-input" type="file" accept=".xlsx,.xls,.xlsm,.pdf"
                   style="display:none" onchange="bdcqExtractDDA(this.files[0])">
          </label>
          <button class="btn btn-outline btn-sm" style="white-space:nowrap;padding:5px 10px;font-size:12px"
            onclick="bdcqLookupScope()" title="Auto-select matching BDCQ domains">
            Find Domains →
          </button>
        </div>
        <div id="bdcq-scope-lookup-result" style="margin-top:4px"></div>
      </div>

      ${domainSection}

      <div id="bdcq-col-section" style="display:none">
        <div class="section-divider" style="margin:6px 0 6px">Columns</div>
        <div style="margin-bottom:6px;display:flex;gap:6px;align-items:center">
          <button class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 8px" onclick="bdcqColAll(true)">Select All</button>
          <button class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 8px" onclick="bdcqColAll(false)">Clear All</button>
        </div>
        <div id="bdcq-col-list"></div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:6px">
          <input id="bdcq-custom-col" class="form-input" type="text"
            placeholder="Add custom column…" style="max-width:220px;font-size:12px;padding:5px 8px">
          <button class="btn btn-outline btn-sm" style="font-size:11px;padding:3px 8px;white-space:nowrap"
            onclick="bdcqAddCustomCol()">+ Add</button>
        </div>
        <div class="form-hint" style="margin-top:3px">Custom columns appear in Excel empty — for manual fill-in.</div>
      </div>

      ${countrySection}

      <!-- AI Enrichment Context — compact 3-col layout -->
      <div class="section-divider" style="margin:8px 0 6px">
        ✨ Enrichment Context
        <span style="font-size:11px;font-weight:400;color:var(--text-muted);margin-left:6px">industry &amp; countries frame Claude's answers (do not filter questions)</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label class="form-label">Industry</label>
          <select id="bdcq-industry" class="form-input">
            <option value="">— Select industry —</option>
            <option value="retail">Retail</option>
            <option value="consumer goods">Consumer Goods / FMCG</option>
            <option value="chemicals">Chemicals / Process Industries</option>
            <option value="automotive">Automotive</option>
            <option value="pharma">Pharma / Life Sciences</option>
            <option value="healthcare">Healthcare / MedTech</option>
            <option value="high tech">High Tech</option>
            <option value="financial services">Financial Services</option>
            <option value="utilities">Utilities</option>
            <option value="oil & gas">Oil &amp; Gas</option>
          </select>
          <div id="bdcq-domain-suggest" style="display:none"></div>
        </div>
        <div>
          <label class="form-label">Countries in scope</label>
          <div style="border:1px solid var(--border);border-radius:6px;padding:6px 8px;max-height:120px;overflow-y:auto;background:var(--surface-2);display:grid;grid-template-columns:1fr 1fr;gap:0 6px">
            ${[
              "Argentina","Australia","Austria","Belgium","Brazil","Canada","China",
              "Denmark","Finland","France","Germany","India","Indonesia","Ireland",
              "Italy","Japan","Kuwait","Malaysia","Mexico","Netherlands","New Zealand",
              "Norway","Oman","Poland","Portugal","Qatar","Saudi Arabia","Singapore",
              "South Africa","South Korea","Spain","Sweden","Switzerland","Taiwan",
              "UAE","UK","USA","Vietnam"
            ].map(c => `
              <label style="display:flex;align-items:center;gap:4px;margin:1px 0;font-size:11px;cursor:pointer;white-space:nowrap;overflow:hidden">
                <input type="checkbox" class="bdcq-enrich-country" value="${c}" style="accent-color:var(--accent);flex-shrink:0"> ${c}
              </label>`).join("")}
          </div>
        </div>
      </div>

      <!-- Cover Sheet — collapsible -->
      <details style="margin-top:10px">
        <summary style="font-size:12px;font-weight:600;color:var(--text-muted);cursor:pointer;
                         padding:5px 0;border-top:1px solid var(--border);list-style:none;
                         display:flex;align-items:center;gap:6px">
          <span style="font-size:10px">▶</span> Cover Sheet <span style="font-weight:400">(optional — logos &amp; intro text)</span>
        </summary>
        <div style="padding-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label class="form-label">Client Logo</label>
            <label style="display:flex;align-items:center;gap:6px;padding:6px 8px;
                           border:1px dashed var(--border);border-radius:6px;cursor:pointer;font-size:12px;
                           color:var(--text-muted);transition:border-color .2s"
                   onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
              <span id="bdcq-client-logo-label">⊕ Upload logo (PNG/JPG)</span>
              <input id="bdcq-client-logo" type="file" accept="image/png,image/jpeg" style="display:none"
                onchange="bdcqLogoChange('client',this)">
            </label>
          </div>
          <div>
            <label class="form-label">Partner Logo</label>
            <label style="display:flex;align-items:center;gap:6px;padding:6px 8px;
                           border:1px dashed var(--border);border-radius:6px;cursor:pointer;font-size:12px;
                           color:var(--text-muted);transition:border-color .2s"
                   onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
              <span id="bdcq-partner-logo-label">⊕ Upload logo (PNG/JPG)</span>
              <input id="bdcq-partner-logo" type="file" accept="image/png,image/jpeg" style="display:none"
                onchange="bdcqLogoChange('partner',this)">
            </label>
          </div>
        </div>
        <div style="margin-top:6px">
          <label class="form-label">Cover Sheet Overview Text</label>
          <textarea id="bdcq-overview" class="form-input" rows="2"
            placeholder="e.g. This questionnaire covers configuration decisions for the SAP S/4HANA Cloud PE implementation at Acme Corp."
            style="resize:vertical"></textarea>
        </div>
      </details>

      <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary btn-generate" style="flex:1;padding:13px 16px" onclick="bdcqLoadEditor()">
          &gt;&nbsp;&nbsp;Generate &amp; Edit
        </button>
        <button class="btn btn-outline" style="padding:10px 14px;white-space:nowrap;font-size:13px;font-weight:600;border-radius:10px" onclick="bdcqGenerate()"
          title="Skip editor — generate and download Excel directly">
          Quick Export ↓
        </button>
      </div>
      <div id="bdcq-result" style="margin-top:10px"></div>
    </div>

    </div><!-- /bdcq-panel-configure -->

    <!-- ══ GROUNDING TAB ════════════════════════════════════════════════════════ -->
    <div id="bdcq-panel-grounding" style="display:none">

    <div class="card">
      <div class="card-title">Reference Grounding Library</div>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px">
        Upload Excel files containing your organisation's reference data — prior project answers, client-specific standards, functional team verified values, or SAP best practice documents. Claude uses the most relevant rows as primary sources when enriching BDCQ questions.
      </p>

      <!-- Upload zone -->
      <div id="bdcq-grounding-dropzone"
           style="border:2px dashed var(--border);border-radius:8px;padding:28px;text-align:center;
                  cursor:pointer;transition:border-color .2s;margin-bottom:16px"
           onclick="document.getElementById('bdcq-grounding-file').click()"
           ondragover="event.preventDefault();this.style.borderColor='var(--accent)'"
           ondragleave="this.style.borderColor='var(--border)'"
           ondrop="bdcqGroundingDrop(event)">
        <div style="font-size:28px;margin-bottom:8px">📂</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Drop Excel files here or click to browse</div>
        <div style="font-size:12px;color:var(--text-muted)">.xlsx or .xls · Multiple files supported · Each sheet becomes a searchable reference block</div>
        <input id="bdcq-grounding-file" type="file" accept=".xlsx,.xls" multiple style="display:none"
               onchange="bdcqGroundingUpload(this.files)">
      </div>

      <!-- Upload status -->
      <div id="bdcq-grounding-status" style="margin-bottom:16px"></div>

      <!-- Current grounding data preview -->
      <div id="bdcq-grounding-preview"></div>
    </div>

    </div><!-- /bdcq-panel-grounding -->

    <!-- ══ EDITOR TAB ═══════════════════════════════════════════════════════════ -->
    <div id="bdcq-panel-editor" style="display:none">
      <div class="card" style="padding:0;overflow:hidden">

        <!-- Toolbar -->
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:14px 18px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:10px">
          <div>
            <div id="bdcq-editor-meta" style="font-size:13px;font-weight:600;color:var(--text)"></div>
            <div id="bdcq-editor-sub" style="font-size:12px;color:var(--text-muted);margin-top:2px">
              Click ✨ Enrich to add AI values, then fill Answer &amp; Notes
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button class="btn btn-outline btn-sm" style="font-size:12px" onclick="bdcqSwitchTab('configure')">
              ← Back to Configure
            </button>
            <button id="bdcq-enrich-btn" class="btn btn-outline btn-sm"
              style="display:flex;align-items:center;gap:6px;border-color:var(--accent);color:var(--accent)"
              onclick="bdcqEnrich()">
              ✨ Enrich with Claude AI
            </button>
            <span id="bdcq-grounding-enrich-status" style="display:none;align-items:center;gap:4px;
              font-size:13px;font-weight:600;color:var(--accent);padding:7px 14px;
              border:1px solid var(--accent);border-radius:6px;cursor:pointer;
              background:rgba(99,102,241,.06)" onclick="bdcqSwitchTab('grounding')"
              title="Grounding data active — click to manage">
              ◈ Grounding active
            </span>
            <button class="btn btn-primary btn-sm" style="padding:7px 16px" onclick="bdcqExportExcel()">
              Export Excel ↓
            </button>
          </div>
        </div>

        <!-- Enrich progress bar -->
        <div id="bdcq-enrich-progress" style="display:none;padding:10px 18px;
             background:rgba(99,102,241,.08);border-bottom:1px solid var(--border);
             font-size:13px;color:var(--accent)"></div>

        <!-- Local questions hint (shown when countries selected but no grounding match) -->
        <div id="bdcq-local-hint" style="display:none;padding:10px 18px;
             border-bottom:1px solid var(--border)"></div>

        <!-- Question cards -->
        <div id="bdcq-editor-list" style="max-height:calc(100vh - 220px);overflow-y:auto;padding:0 20px 16px"></div>

        <div style="padding:10px 18px;border-top:1px solid var(--border);
                    font-size:11px;color:var(--text-muted);display:flex;gap:16px">
          <span>✨ AI fields — click to edit</span>
          <span>✏️ Answer &amp; Notes — fill in workshop</span>
          <span id="bdcq-editor-count"></span>
        </div>
      </div>
    </div>`;
}

function bindBDCQ() {
  // ── File upload helpers ─────────────────────────────────────────────────────
  async function uploadJSON(file) {
    if (!file) return;
    const resultEl = document.getElementById("bdcq-result");
    if (resultEl) resultEl.innerHTML = `<div class="alert alert-info">Uploading…</div>`;

    const reader = new FileReader();
    reader.onload = async e => {
      const base64 = btoa(String.fromCharCode(...new Uint8Array(e.target.result)));
      try {
        const r = await api.post("/api/bdcq/upload", { content: base64 });
        if (r.ok) {
          // Reload to refresh status card and column list
          navigate("bdcq-agent");
        } else {
          if (resultEl) resultEl.innerHTML = `<div class="alert alert-warning">Upload failed: ${r.error || "unknown error"}</div>`;
        }
      } catch (err) {
        if (resultEl) resultEl.innerHTML = `<div class="alert alert-warning">Upload error: ${err.message}</div>`;
      }
    };
    reader.readAsArrayBuffer(file);
  }

  window.bdcqUploadFile = file => uploadJSON(file);
  window.bdcqDropFile   = file => uploadJSON(file);

  // ── Logo helpers ────────────────────────────────────────────────────────────
  window._bdcqLogos = { client: null, partner: null };

  const LOGO_MAX_W  = 300;   // max width in px
  const LOGO_MAX_H  = 150;   // max height in px
  const LOGO_MAX_MB = 2;     // reject originals over 2 MB before even trying
  const LOGO_QUALITY = 0.82; // JPEG compression quality

  window.bdcqLogoChange = (which, input) => {
    const file    = input.files[0];
    if (!file) return;
    const labelEl = document.getElementById(`bdcq-${which}-logo-label`);

    // Reject files over 2 MB immediately
    if (file.size > LOGO_MAX_MB * 1024 * 1024) {
      if (labelEl) labelEl.textContent = `⚠ File too large (max ${LOGO_MAX_MB}MB)`;
      input.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        // Calculate scaled dimensions maintaining aspect ratio
        let w = img.width, h = img.height;
        if (w > LOGO_MAX_W || h > LOGO_MAX_H) {
          const ratio = Math.min(LOGO_MAX_W / w, LOGO_MAX_H / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        // Draw onto canvas and compress
        const canvas = document.createElement("canvas");
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL("image/jpeg", LOGO_QUALITY);
        window._bdcqLogos[which] = compressed;

        const kb = Math.round(compressed.length * 0.75 / 1024);
        if (labelEl) labelEl.textContent = `✓ ${file.name} (${kb} KB)`;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  // ── Domain dropdown toggle ───────────────────────────────────────────────────
  window.bdcqToggleDropdown = () => {
    const panel   = document.getElementById("bdcq-domain-panel");
    const trigger = document.getElementById("bdcq-domain-trigger");
    const arrow   = document.getElementById("bdcq-domain-arrow");
    if (!panel) return;
    const open = panel.style.display === "none";
    panel.style.display = open ? "block" : "none";
    if (arrow) arrow.textContent = open ? "▲" : "▼";
    if (trigger) trigger.style.borderRadius = open ? "6px 6px 0 0" : "6px";
  };

  // ── Domain selection → reactive column list ─────────────────────────────────
  function renderColsForDomains() {
    const meta      = window._bdcqDomainMeta || [];
    const colList   = document.getElementById("bdcq-col-list");
    const colSection= document.getElementById("bdcq-col-section");
    const label     = document.getElementById("bdcq-domain-label");
    if (!colList) return;

    // Preserve custom columns (they have a <span> "custom" tag) before rebuilding
    const savedCustomCols = [...colList.querySelectorAll(".bdcq-col-check")]
      .filter(cb => cb.parentElement?.querySelector("span"))
      .map(cb => ({ val: cb.value, checked: cb.checked }));

    const selected = [...document.querySelectorAll(".bdcq-domain-check")]
      .filter(cb => cb.checked).map(cb => cb.value);

    // Update trigger label
    if (label) {
      label.textContent = selected.length === 0
        ? "Select domains…"
        : selected.length === 1
          ? selected[0]
          : `${selected.length} domains selected`;
      label.style.color = selected.length > 0 ? "var(--text)" : "var(--text-muted)";
    }

    // Only show columns section after at least one domain is picked
    if (!colSection) return;
    if (selected.length === 0) {
      colSection.style.display = "none";
      colList.innerHTML = "";
      return;
    }
    colSection.style.display = "block";

    // Build column union from selected domains
    const source = meta.filter(d => selected.includes(d.domain));
    const colSet = new Set();
    source.forEach(d => (d.columns || []).forEach(c => { if (c) colSet.add(c); }));
    const cols = [...colSet];

    colList.innerHTML = cols.length === 0
      ? `<span class="text-muted" style="font-size:13px">No columns found for selected domains</span>`
      : cols.map(c =>
          `<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 8px 4px 0;font-size:13px">
            <input type="checkbox" class="bdcq-col-check" value="${escHtml(c)}" checked> ${escHtml(c)}
          </label>`
        ).join("");

    // Re-append custom columns that were there before the rebuild
    const existingVals = new Set([...colList.querySelectorAll(".bdcq-col-check")].map(cb => cb.value.toLowerCase()));
    savedCustomCols.forEach(({ val, checked }) => {
      if (existingVals.has(val.toLowerCase())) return;
      const lbl = document.createElement("label");
      lbl.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin:4px 8px 4px 0;font-size:13px";
      lbl.innerHTML = `<input type="checkbox" class="bdcq-col-check" value="${escHtml(val)}"${checked ? " checked" : ""}> ${escHtml(val)}<span style="font-size:10px;color:var(--accent);margin-left:2px">custom</span>`;
      colList.appendChild(lbl);
    });
  }

  window.bdcqOnDomainChange = () => { renderColsForDomains(); bdcqSaveState(); };

  window.bdcqDomainAll = (checked) => {
    document.querySelectorAll(".bdcq-domain-check").forEach(cb => { cb.checked = checked; });
    renderColsForDomains();
    bdcqSaveState();
  };

  // ── Persist setup state to localStorage ─────────────────────────────────────
  function bdcqSaveState() {
    try {
      const domains         = [...document.querySelectorAll(".bdcq-domain-check:checked")].map(cb => cb.value);
      const countries       = [...document.querySelectorAll(".bdcq-country-check:checked")].map(cb => cb.value);
      const enrichCountries = [...document.querySelectorAll(".bdcq-enrich-country:checked")].map(cb => cb.value);
      const state = {
        client:          document.getElementById("bdcq-client")?.value   || "",
        scope:           document.getElementById("bdcq-scope")?.value    || "",
        industry:        document.getElementById("bdcq-industry")?.value || "",
        domains,
        countries,
        enrichCountries,
      };
      sessionStorage.setItem("bdcq-state", JSON.stringify(state));
    } catch { /**/ }
  }

  function bdcqRestoreState() {
    try {
      localStorage.removeItem("bdcq-state");
      const raw = sessionStorage.getItem("bdcq-state");
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state.client) {
        const el = document.getElementById("bdcq-client");
        if (el) el.value = state.client;
      }
      if (state.scope) {
        const el = document.getElementById("bdcq-scope");
        if (el) el.value = state.scope;
      }
      if (state.industry) {
        const el = document.getElementById("bdcq-industry");
        if (el) el.value = state.industry;
      }
      if (state.domains?.length) {
        document.querySelectorAll(".bdcq-domain-check").forEach(cb => {
          cb.checked = state.domains.includes(cb.value);
        });
        renderColsForDomains();
      }
      if (state.countries?.length) {
        document.querySelectorAll(".bdcq-country-check").forEach(cb => {
          cb.checked = state.countries.includes(cb.value);
        });
      }
      if (state.enrichCountries?.length) {
        document.querySelectorAll(".bdcq-enrich-country").forEach(cb => {
          cb.checked = state.enrichCountries.includes(cb.value);
        });
      }
    } catch { /**/ }
  }

  // ── Domain suggestions based on industry ────────────────────────────────────
  // Keywords matched case-insensitively against the domain name from the BDCQ file.
  /* COMMENTED OUT — domain auto-selection by industry (keep for future use)
  const INDUSTRY_DOMAIN_KEYWORDS = {
    "professional services": ["project","professional","service","customer","finance","account","resource","billing","time","sales","contract"],
    "manufacturing":         ["production","manufactur","material","quality","inventory","procurement","supply","plant","warehouse","mrp","bom"],
    "retail":                ["sales","retail","store","inventory","customer","pricing","warehouse","order","point"],
    "pharma":                ["quality","batch","production","procurement","compliance","warehouse","sales","serial"],
    "utilities":             ["billing","customer","asset","maintenance","project","finance","meter","service","credit"],
    "financial services":    ["finance","account","treasury","payment","risk","compliance","customer","bank"],
    "oil & gas":             ["asset","maintenance","project","procurement","finance","inventory","warehouse","joint"],
    "high tech":             ["sales","production","material","quality","customer","service","finance","contract"]
  };

  window.bdcqSuggestDomains = (industry) => { ... };
  window.bdcqApplySuggestedDomains = (industry) => { ... };
  */

  // Auto-save on client/scope/industry field changes
  setTimeout(() => {
    document.getElementById("bdcq-client")?.addEventListener("input", bdcqSaveState);
    document.getElementById("bdcq-scope")?.addEventListener("input", bdcqSaveState);
    document.getElementById("bdcq-industry")?.addEventListener("change", bdcqSaveState);
    document.querySelectorAll(".bdcq-country-check").forEach(cb => cb.addEventListener("change", bdcqSaveState));
    document.querySelectorAll(".bdcq-enrich-country").forEach(cb => cb.addEventListener("change", bdcqSaveState));
    // Restore saved values after DOM is ready
    bdcqRestoreState();
  }, 100);

  // ── Column helpers ──────────────────────────────────────────────────────────
  window.bdcqColAll = (checked) => {
    document.querySelectorAll(".bdcq-col-check").forEach(cb => { cb.checked = checked; });
  };

  window.bdcqAddCustomCol = () => {
    const input = document.getElementById("bdcq-custom-col");
    const val   = (input?.value || "").trim();
    if (!val) return;
    const list  = document.getElementById("bdcq-col-list");
    if (!list) return;
    const existing = [...list.querySelectorAll(".bdcq-col-check")].map(cb => cb.value.toLowerCase());
    if (existing.includes(val.toLowerCase())) { input.value = ""; return; }
    const label = document.createElement("label");
    label.style.cssText = "display:inline-flex;align-items:center;gap:6px;margin:4px 8px 4px 0;font-size:13px";
    label.innerHTML = `<input type="checkbox" class="bdcq-col-check" value="${escHtml(val)}" checked> ${escHtml(val)}
      <span style="font-size:10px;color:var(--accent);margin-left:2px">custom</span>`;
    list.appendChild(label);
    input.value = "";
    // Track immediately in editor state so export picks it up even before re-generating
    if (window._bdcqEditorState && !window._bdcqEditorState.columns.includes(val)) {
      window._bdcqEditorState.columns.push(val);
    }
  };

  // ── Tab switching ────────────────────────────────────────────────────────────
  window.bdcqSwitchTab = (tab) => {
    const tabs   = ["configure", "grounding", "editor"];
    tabs.forEach(t => {
      const btn   = document.getElementById(`bdcq-tab-${t}`);
      const panel = document.getElementById(`bdcq-panel-${t}`);
      const active = t === tab;
      if (btn) {
        btn.style.borderBottomColor = active ? "var(--accent)" : "transparent";
        btn.style.color             = active ? "var(--accent)" : "var(--text-muted)";
        btn.style.opacity           = "1";
        btn.style.cursor            = "pointer";
        btn.disabled                = false;
      }
      if (panel) panel.style.display = active ? "block" : "none";
    });
  };

  // ── Grounding library functions ───────────────────────────────────────────────

  async function bdcqGroundingRefresh() {
    const preview  = document.getElementById("bdcq-grounding-preview");
    const badge    = document.getElementById("bdcq-grounding-badge");
    const enrichEl = document.getElementById("bdcq-grounding-enrich-status");
    try {
      const g = await api.get("/api/bdcq/grounding");
      if (!g.exists || !g.files.length) {
        if (preview)  preview.innerHTML  = `<div style="font-size:13px;color:var(--text-muted);padding:12px 0">No grounding files uploaded yet. Drop an Excel above to get started.</div>`;
        if (badge)    badge.style.display = "none";
        if (enrichEl) enrichEl.style.display = "none";
        return;
      }

      if (badge) badge.style.display = "block";

      // Build one card per file
      const fileCards = g.files.map(f => {
        const uploadedAt = f.uploadedAt ? new Date(f.uploadedAt).toLocaleString() : "—";
        const sheetRows  = (f.sheets || []).map(s => `
          <tr>
            <td style="padding:5px 10px;font-size:13px;font-weight:500">${escHtml(s.sheet)}</td>
            <td style="padding:5px 10px;font-size:11px;color:var(--text-muted)">${escHtml(s.columns.join(", "))}</td>
            <td style="padding:5px 10px;font-size:12px;text-align:right;white-space:nowrap">${s.rowCount.toLocaleString()} rows</td>
          </tr>`).join("");
        return `
          <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;
                        padding:10px 14px;background:var(--surface-2);border-bottom:1px solid var(--border)">
              <div>
                <div style="font-size:13px;font-weight:600">◈ ${escHtml(f.origName)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                  ${f.totalRows.toLocaleString()} rows · ${(f.sheets||[]).length} sheet(s) · uploaded ${uploadedAt}
                </div>
              </div>
              <button class="btn btn-outline btn-sm"
                style="font-size:11px;color:#f87171;border-color:#f87171;padding:4px 10px;white-space:nowrap"
                onclick="bdcqGroundingDelete('${escHtml(f.slug)}', this)">🗑 Remove</button>
            </div>
            <table style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;
                           background:var(--surface-1,rgba(255,255,255,.03))">
                  <th style="padding:5px 10px;text-align:left;font-weight:600">Sheet</th>
                  <th style="padding:5px 10px;text-align:left;font-weight:600">Columns</th>
                  <th style="padding:5px 10px;text-align:right;font-weight:600">Rows</th>
                </tr>
              </thead>
              <tbody>${sheetRows}</tbody>
            </table>
          </div>`;
      }).join("");

      if (preview) preview.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-size:13px;font-weight:600;color:var(--accent)">
            ✅ ${g.files.length} file(s) · ${g.totalRows.toLocaleString()} total rows · active during enrichment
          </div>
          <button class="btn btn-outline btn-sm" style="font-size:11px;color:#f87171;border-color:#f87171"
            onclick="bdcqGroundingClearAll()">🗑 Remove all</button>
        </div>
        ${fileCards}
        <div style="margin-top:4px;font-size:12px;color:var(--text-muted)">
          💡 Claude searches all rows above for context when you click <strong>✨ Enrich</strong>.
          Add more files any time — each is stored separately in <code>bdcq/grounding/</code>.
        </div>`;

      if (enrichEl) { enrichEl.style.display = "inline-flex"; enrichEl.title = `${g.totalRows} grounding rows active from ${g.files.length} file(s)`; }
    } catch { /* silent */ }
  }

  window.bdcqGroundingUpload = async (fileList) => {
    const statusEl = document.getElementById("bdcq-grounding-status");
    const zone     = document.getElementById("bdcq-grounding-dropzone");
    if (!fileList || !fileList.length) return;

    if (statusEl) statusEl.innerHTML = `<div style="font-size:13px;color:var(--accent);padding:8px 0">⏳ Parsing ${fileList.length} file(s)…</div>`;
    if (zone) zone.style.borderColor = "var(--accent)";

    const files = [];
    for (const f of fileList) {
      const buf   = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      bytes.forEach(b => { bin += String.fromCharCode(b); });
      files.push({ filename: f.name, content: btoa(bin) });
    }

    try {
      const r = await api.post("/api/bdcq/upload-grounding", { files });
      if (r.ok) {
        const totalRows = (r.saved || []).reduce((s, f) => s + f.totalRows, 0);
        if (statusEl) statusEl.innerHTML = `<div style="font-size:13px;color:#34d399;padding:8px 0">
          ✅ Saved ${r.saved.length} file(s) → <code>bdcq/grounding/</code> · ${totalRows.toLocaleString()} rows</div>`;
        await bdcqGroundingRefresh();
      } else {
        if (statusEl) statusEl.innerHTML = `<div style="font-size:13px;color:#f87171;padding:8px 0">❌ ${escHtml(r.error || "Upload failed")}</div>`;
      }
    } catch (e) {
      if (statusEl) statusEl.innerHTML = `<div style="font-size:13px;color:#f87171;padding:8px 0">❌ ${escHtml(e.message)}</div>`;
    } finally {
      if (zone) zone.style.borderColor = "var(--border)";
      const inp = document.getElementById("bdcq-grounding-file");
      if (inp) inp.value = "";
    }
  };

  window.bdcqGroundingDrop = async (event) => {
    event.preventDefault();
    document.getElementById("bdcq-grounding-dropzone").style.borderColor = "var(--border)";
    const files = event.dataTransfer?.files;
    if (files && files.length) await bdcqGroundingUpload(files);
  };

  window.bdcqGroundingDelete = async (slug, btn) => {
    if (!confirm(`Remove this grounding file?`)) return;
    if (btn) { btn.disabled = true; btn.textContent = "Removing…"; }
    try {
      await api.delete(`/api/bdcq/grounding/${encodeURIComponent(slug)}`);
      await bdcqGroundingRefresh();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "🗑 Remove"; }
      alert("Error: " + e.message);
    }
  };

  window.bdcqGroundingClearAll = async () => {
    if (!confirm("Remove all grounding files? Claude will no longer use them for enrichment.")) return;
    const statusEl = document.getElementById("bdcq-grounding-status");
    try {
      await api.delete("/api/bdcq/grounding");
      if (statusEl) statusEl.innerHTML = `<div style="font-size:13px;color:var(--text-muted);padding:8px 0">All grounding files removed.</div>`;
      await bdcqGroundingRefresh();
    } catch (e) {
      if (statusEl) statusEl.innerHTML = `<div style="font-size:13px;color:#f87171;padding:8px 0">❌ ${escHtml(e.message)}</div>`;
    }
  };

  // Load grounding status on page init
  bdcqGroundingRefresh();

  // ── DDA file upload → extract scope IDs ─────────────────────────────────────
  window.bdcqExtractDDA = async (file) => {
    if (!file) return;
    const resultEl = document.getElementById("bdcq-scope-lookup-result");
    const labelEl  = document.getElementById("bdcq-dda-upload-label");
    if (resultEl) resultEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">⏳ Reading ${file.name}…</span>`;
    if (labelEl)  labelEl.textContent = "⏳ Reading…";
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/bdcq/dda-extract", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Extract failed");

      const scopeEl = document.getElementById("bdcq-scope");
      if (scopeEl) scopeEl.value = data.ids.join(", ");

      const byLob = {};
      (data.items || []).forEach(it => { byLob[it.lob] = (byLob[it.lob] || 0) + 1; });
      const lobSummary = Object.entries(byLob).map(([l,n]) => `${l} (${n})`).join(", ");

      if (resultEl) resultEl.innerHTML = data.count === 0
        ? `<span style="color:var(--text-muted);font-size:12px">No recognised scope IDs found in <em>${file.name}</em>. Try pasting IDs manually.</span>`
        : `<span style="color:#16a34a;font-size:12px">✓ Extracted <strong>${data.count} scope IDs</strong> from <em>${file.name}</em>
           ${lobSummary ? `<br><span style="color:var(--text-muted)">${lobSummary}</span>` : ""}
           — click <strong>Find Domains →</strong> to auto-select</span>`;

      if (labelEl) labelEl.textContent = `📎 ${file.name.length > 20 ? file.name.slice(0,18)+"…" : file.name}`;
      // Reset file input so the same file can be re-uploaded if needed
      const inp = document.getElementById("bdcq-dda-input");
      if (inp) inp.value = "";
    } catch (err) {
      if (resultEl) resultEl.innerHTML = `<span style="color:#f87171;font-size:12px">❌ ${err.message}</span>`;
      if (labelEl)  labelEl.textContent = "📎 DDA file";
    }
  };

  // ── Scope ID → Domain auto-select (DDA optional) ────────────────────────────
  window.bdcqLookupScope = async () => {
    const scopeRaw  = (document.getElementById("bdcq-scope")?.value || "").trim();
    const resultEl  = document.getElementById("bdcq-scope-lookup-result");
    if (!scopeRaw) {
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--text-muted);font-size:12px">Enter scope IDs first.</span>`;
      return;
    }
    if (resultEl) resultEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">Looking up…</span>`;
    const ids = scopeRaw.split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    try {
      const r = await api.get(`/api/bdcq/scope-lookup?ids=${ids.join(",")}`);
      if (r.error) {
        if (resultEl) resultEl.innerHTML = `<span style="color:#f87171;font-size:12px">${r.error}</span>`;
        return;
      }
      if (!r.domains || r.domains.length === 0) {
        if (resultEl) resultEl.innerHTML = `<span style="color:var(--text-muted);font-size:12px">No matching BDCQ domains found for those IDs.</span>`;
        return;
      }
      // Auto-check matching domain checkboxes
      let matched = 0;
      document.querySelectorAll(".bdcq-domain-check").forEach(cb => {
        if (r.domains.includes(cb.value)) { cb.checked = true; matched++; }
      });
      renderColsForDomains();
      // Open dropdown so user sees selections
      const panel = document.getElementById("bdcq-domain-panel");
      if (panel && panel.style.display === "none") bdcqToggleDropdown();
      if (resultEl) resultEl.innerHTML =
        `<span style="color:var(--accent);font-size:12px">✓ Auto-selected ${matched} domain${matched !== 1 ? "s" : ""}` +
        ` from ${r.matchedIds?.length || 0} scope item${(r.matchedIds?.length || 0) !== 1 ? "s" : ""}` +
        ` (LOBs: ${(r.matchedLobs || []).join(", ")})</span>`;
    } catch (err) {
      if (resultEl) resultEl.innerHTML = `<span style="color:#f87171;font-size:12px">Lookup error: ${err.message}</span>`;
    }
  };

  // ── Editor state ─────────────────────────────────────────────────────────────
  // Holds the current rows (with AI enrichment merged in) and column list.
  window._bdcqEditorState = { rows: [], columns: [], questionCol: "Question" };

  // ── Generate & Edit — load editor ───────────────────────────────────────────
  window.bdcqLoadEditor = async () => {
    const resultEl = document.getElementById("bdcq-result");

    const scopeRaw      = (document.getElementById("bdcq-scope")?.value || "").trim();
    const selectedDomains = [...document.querySelectorAll(".bdcq-domain-check")].filter(cb => cb.checked).map(cb => cb.value);
    const selectedColumns = [...document.querySelectorAll(".bdcq-col-check")].filter(cb => cb.checked).map(cb => cb.value);
    // Merge both country selectors: per-domain sheet filter (.bdcq-country-check)
    // + enrichment countries (.bdcq-enrich-country) — so AllCountries local questions
    // are injected for whichever countries the user has ticked in either place.
    const countries = [...new Set([
      ...[...document.querySelectorAll(".bdcq-country-check:checked")].map(cb => cb.value),
      ...[...document.querySelectorAll(".bdcq-enrich-country:checked")].map(cb => cb.value),
    ])];
    const scopeIds        = scopeRaw ? scopeRaw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean) : [];

    // Domain selection is mandatory — prevents accidentally loading all 1400+ questions
    if (!selectedDomains.length) {
      if (resultEl) resultEl.innerHTML = `
        <div class="alert" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.4);color:#fca5a5;border-radius:8px;padding:14px 16px;font-size:13px;line-height:1.6">
          <strong style="font-size:14px">Select at least one domain to continue.</strong><br>
          Open <strong>BDCQ Files → Select domains</strong> above and tick the domains in your project scope.<br>
          <span style="color:var(--text-muted);font-size:11px;margin-top:6px;display:block">
            Tip: Pick an industry in <em>AI Enrichment Context</em> below — a domain suggestion button will appear to help you choose.
          </span>
        </div>`;
      // Scroll the domain picker into view so the user can act immediately
      document.getElementById("bdcq-domain-label")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (resultEl) resultEl.innerHTML = `<div class="alert alert-info">Loading questions…</div>`;

    try {
      const r = await api.post("/api/bdcq/preview", { scopeIds, selectedDomains, selectedColumns, countries });
      if (!r.ok) {
        if (resultEl) resultEl.innerHTML = `<div class="alert alert-warning">Error: ${r.error || "unknown"}</div>`;
        return;
      }
      if (r.rowCount === 0) {
        if (resultEl) resultEl.innerHTML = `<div class="alert alert-warning">No questions matched your filters. Try selecting more domains or clearing scope IDs.</div>`;
        return;
      }

      // Store state
      window._bdcqEditorState.columns    = r.columns;
      window._bdcqEditorState.questionCol = r.questionCol;
      const _qCol = r.questionCol || "Question";
      const INDUSTRY_LABELS = {
        "retail": "Retail", "consumer goods": "Consumer Goods / FMCG",
        "chemicals": "Chemicals / Process Industries", "automotive": "Automotive",
        "pharma": "Pharma / Life Sciences", "healthcare": "Healthcare / MedTech",
        "high tech": "High Tech", "financial services": "Financial Services",
        "utilities": "Utilities", "oil & gas": "Oil & Gas",
      };
      const _industryRaw   = document.getElementById("bdcq-industry")?.value || "";
      const _industryLabel = INDUSTRY_LABELS[_industryRaw] || _industryRaw;
      // Add AI + Answer + Notes fields to each row; normalize Level/Industry/questionCol for local rows;
      // override Industry for ALL rows with the UI-selected industry (so all rows show the client's vertical)
      window._bdcqEditorState.rows = r.rows.map(row => {
        const isLocal = row._fromAllCountries;
        return {
          ...row,
          // Ensure question text lands in whichever column the regular rows use
          ...(_qCol !== "Question" && !row[_qCol] && row.Question ? { [_qCol]: row.Question } : {}),
          // Override Industry for every row with the normalized UI selection
          ...(_industryLabel ? { Industry: _industryLabel } : {}),
          // Fill Level for local rows (country-specific items are always config-level L3)
          ...(isLocal && !row.Level ? { Level: "L3" } : {}),
          "SAP Standard Value":    "",
          "Watch Out / Constraint": "",
          "Country / Region":      row["Country / Region"] || "",
          "Answer": "",
          "Notes":  ""
        };
      });

      if (resultEl) resultEl.innerHTML = "";
      renderEditorCards();

      // Switch to editor tab first, then render (so DOM elements exist)
      bdcqSwitchTab("editor");
      window.scrollTo({ top: 0, behavior: "smooth" });

      const visibleCount  = renderEditorCards();
      const localCount    = (r.rows || []).filter(row => row._fromAllCountries).length;
      const metaEl  = document.getElementById("bdcq-editor-meta");
      const countEl = document.getElementById("bdcq-editor-count");
      if (metaEl) metaEl.textContent =
        `${visibleCount} question${visibleCount !== 1 ? "s" : ""} · ${selectedDomains.length ? selectedDomains.join(", ") : "all domains"}`;
      if (countEl) countEl.textContent = `${visibleCount} questions`;

      // Show local-question hint whenever countries are selected — regardless of grounding row count
      const enrichCountriesSel = [...document.querySelectorAll(".bdcq-enrich-country:checked")].map(cb => cb.value);
      const hintEl = document.getElementById("bdcq-local-hint");
      if (hintEl) {
        if (enrichCountriesSel.length > 0) {
          const domainsStr   = escHtml(selectedDomains.join(", "));
          const countriesStr = escHtml(enrichCountriesSel.join(", "));
          const hintHeading  = localCount > 0
            ? `${localCount} grounding row${localCount > 1 ? "s" : ""} found — ask Claude to add more local questions`
            : "No SAP reference data found for these countries";
          hintEl.style.display = "block";
          hintEl.innerHTML = `
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:4px 0">
              <div style="font-size:20px;flex-shrink:0">🌍</div>
              <div style="flex:1;min-width:180px">
                <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px">
                  ${hintHeading}
                </div>
                <div style="font-size:12px;color:var(--text-muted);line-height:1.5">
                  <strong>${domainsStr}</strong> + <strong>${countriesStr}</strong> —
                  AllCountries BDCQ covers Finance, HR/Payroll, Procurement, Manufacturing, Supply Chain.
                </div>
              </div>
              <button id="bdcq-ai-local-btn"
                style="background:linear-gradient(135deg,#6d28d9 0%,#7c3aed 100%);
                       color:#fff;border:none;border-radius:8px;padding:10px 20px;
                       font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;
                       box-shadow:0 2px 10px rgba(109,40,217,.4);letter-spacing:.01em;
                       flex-shrink:0;transition:opacity .15s">
                ✨ Ask Claude for Local Questions
              </button>
            </div>`;
          // Attach click handler directly — avoids JSON-in-onclick quote-escaping bug
          const aiLocalIndustry = document.getElementById("bdcq-industry")?.value || "";
          document.getElementById("bdcq-ai-local-btn")?.addEventListener("click", () => {
            window.bdcqGenerateAiLocalQuestions(selectedDomains, enrichCountriesSel, aiLocalIndustry);
          });
        } else {
          hintEl.style.display = "none";
          hintEl.innerHTML = "";
        }
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = `<div class="alert alert-warning">Error: ${err.message}</div>`;
    }
  };

  // ── Card-based editor renderer ───────────────────────────────────────────────
  const AI_COLS   = ["SAP Standard Value", "Watch Out / Constraint", "Country / Region", "Answer", "Notes"];
  const META_COLS = new Set(["Module", "Section", ...AI_COLS]);

  // Find the best question text from a row's own keys.
  // Priority: (1) col named "question", (2) longest text value > 20 chars,
  //           (3) any non-empty non-metadata value, (4) null → skip row.
  function getQuestionText(row) {
    const SKIP = META_COLS;
    const dataEntries = Object.entries(row).filter(([k, v]) => !SKIP.has(k) && String(v || "").trim().length > 0);
    if (!dataEntries.length) return null;

    // Priority 1 — col explicitly named "question"
    const qEntry = dataEntries.find(([k]) => k.toLowerCase() === "question");
    if (qEntry && String(qEntry[1]).trim().length > 2) return String(qEntry[1]).trim();

    // Priority 2 — longest value that reads like a question (>20 chars)
    const byLength = [...dataEntries]
      .map(([, v]) => String(v).trim())
      .filter(v => v.length > 20)
      .sort((a, b) => b.length - a.length);
    if (byLength.length) return byLength[0];

    // Priority 3 — any non-empty value (catches short answers like "Y/N")
    const anyVal = String(dataEntries[0][1]).trim();
    if (anyVal.length > 0) return anyVal;

    return null;
  }

  // Detail fields: short metadata shown as secondary labels under the question text.
  // Excludes the value already used as the question text.
  function getDetailFields(row, columns) {
    const DETAIL_KEYS = ["solution processes", "process area", "topic", "industry", "level",
                         "systems", "scope ref", "sap id", "project relevant", "business process"];
    const qText   = getQuestionText(row) || "";
    const results = [];

    for (const col of columns) {
      if (META_COLS.has(col)) continue;
      const v = String(row[col] || "").trim();
      if (!v || v === qText) continue;
      const colLow = col.toLowerCase();
      // Include if it's a known detail column OR a short categorical value
      if (DETAIL_KEYS.some(k => colLow.includes(k)) || (v.length < 80 && v !== qText)) {
        results.push({ col, val: v });
        if (results.length >= 4) break;
      }
    }
    return results;
  }

  function editableDiv(rowIdx, col, value, placeholder) {
    return `<div contenteditable="true"
      style="min-height:36px;outline:none;line-height:1.6;padding:6px 8px;
             border-radius:4px;border:1px solid var(--border);background:var(--surface-1,#fff1);
             font-size:12px;color:var(--text);transition:border-color .15s"
      data-row="${rowIdx}" data-col="${escHtml(col)}"
      oninput="bdcqEditorCell(this)"
      onfocus="this.style.borderColor='var(--accent)'"
      onblur="this.style.borderColor='var(--border)'"
      >${escHtml(value)}</div>
    ${!value ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${placeholder}</div>` : ""}`;
  }

  function renderEditorCards() {
    const { rows, columns } = window._bdcqEditorState;
    const listEl = document.getElementById("bdcq-editor-list");
    if (!listEl) return;

    if (!rows.length) { listEl.innerHTML = `<p style="color:var(--text-muted);padding:20px 0">No questions to display.</p>`; return; }

    // Group rows by Section (within Module)
    const groups = [];
    let lastKey = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = `${row.Module || ""}||${row.Section || ""}`;
      if (key !== lastKey) {
        groups.push({ module: row.Module || "", section: row.Section || "", startIdx: i, endIdx: i });
        lastKey = key;
      } else {
        groups[groups.length - 1].endIdx = i;
      }
    }

    // Sections that are NOT configuration questions — skip entirely
    const NON_QUESTION_SECTIONS = /^(template overview|change history|cover|instructions|overview|version history|revision history|changelog)$/i;

    let visibleQCounter = 0; // sequential number across all sections

    listEl.innerHTML = groups.map(g => {
      // Skip entire non-question sections upfront
      if (NON_QUESTION_SECTIONS.test((g.section || "").trim())) return "";

      const groupRows = rows.slice(g.startIdx, g.endIdx + 1);

      // Build question cards first so we know the real visible count
      const questionCards = groupRows.map((row) => {
        const qText = getQuestionText(row);
        if (!qText) return ""; // skip rows with no question content
        const rowIdx = rows.indexOf(row); // real index for editor state updates
        visibleQCounter++;
        const displayNum  = visibleQCounter;
        const details     = getDetailFields(row, columns);
        const sv          = row["SAP Standard Value"]    || "";
        const wo          = row["Watch Out / Constraint"] || "";
        const cr          = row["Country / Region"]       || "";
        const ans         = row["Answer"] || "";
        const notes       = row["Notes"]  || "";
        const isLocaleRow  = /^[A-Za-z]{2}$/.test(row.Section || "") || row.Section === "LC";
        const isAllCountry = row.Section === "LC";
        const isAiGen      = !!row._aiGenerated;
        const badgeLabel   = isAllCountry ? "Local – All Countries" : (row.Section || "");
        const badgeColor   = isAllCountry ? "#065f46" : "#1d4ed8";
        const badgeBg      = isAllCountry ? "#d1fae5"  : "#dbeafe";
        const localeBadge  = isLocaleRow
          ? `<span style="font-size:9px;font-weight:700;padding:2px 6px;background:${badgeBg};color:${badgeColor};border-radius:3px;flex-shrink:0;margin-top:2px">🌍 ${escHtml(badgeLabel)}</span>`
          : "";
        const aiBadge      = isAiGen
          ? `<span style="font-size:9px;font-weight:700;padding:2px 6px;background:#ede9fe;color:#6d28d9;border-radius:3px;flex-shrink:0;margin-top:2px">✨ AI Local Question</span>`
          : "";
        const borderColor  = isAiGen ? "#a78bfa" : isAllCountry ? "#6ee7b7" : "#93c5fd";

        return `
        <div style="padding:14px 0;border-bottom:1px solid var(--border)${(isLocaleRow || isAiGen) ? `;border-left:3px solid ${borderColor};padding-left:10px` : ""}">

          <!-- Question number + text + delete -->
          <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px">
            <div style="min-width:28px;height:22px;background:var(--surface-2);border-radius:4px;
                        display:flex;align-items:center;justify-content:center;
                        font-size:10px;font-weight:700;color:var(--text-muted);flex-shrink:0;margin-top:1px">
              ${displayNum}
            </div>
            <div style="flex:1">
              <div style="display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap">
                <div style="font-size:13px;font-weight:500;color:var(--text);line-height:1.5;flex:1">${escHtml(qText)}</div>
                ${localeBadge}${aiBadge}
              </div>
              ${details.map(d =>
                `<div style="font-size:11px;color:var(--text-muted);margin-top:3px">
                  <strong>${escHtml(d.col)}:</strong> ${escHtml(d.val)}
                </div>`).join("")}
            </div>
            <button onclick="bdcqDeleteRow(${rowIdx})"
              style="flex-shrink:0;align-self:flex-start;background:none;
                     border:1px solid var(--border);color:#9ca3af;cursor:pointer;
                     font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;
                     white-space:nowrap;transition:color .15s,background .15s,border-color .15s"
              onmouseover="this.style.color='#dc2626';this.style.background='#fee2e2';this.style.borderColor='#fca5a5'"
              onmouseout="this.style.color='#9ca3af';this.style.background='none';this.style.borderColor='var(--border)'"
              title="Delete this question">✕ Delete</button>
          </div>

          <!-- AI columns (2-col grid) -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div>
              <div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:4px">✨ SAP Standard Value</div>
              ${editableDiv(rowIdx, "SAP Standard Value", sv, "Click Enrich to auto-fill or type manually")}
            </div>
            <div>
              <div style="font-size:11px;font-weight:600;color:#f59e0b;margin-bottom:4px">⚠️ Watch Out / Constraint</div>
              ${editableDiv(rowIdx, "Watch Out / Constraint", wo, "Known constraints or irreversible settings")}
            </div>
          </div>

          <!-- Country / Region (from AllCountries grounding — shown only when populated) -->
          ${cr ? `
          <div style="margin-bottom:10px;padding:6px 10px;background:rgba(16,185,129,.06);
                      border:1px solid rgba(16,185,129,.25);border-radius:6px;
                      display:flex;align-items:flex-start;gap:8px">
            <span style="font-size:10px;font-weight:700;color:#10b981;white-space:nowrap;margin-top:1px">
              Country / Region
            </span>
            <span style="font-size:11px;color:var(--text);line-height:1.5">${escHtml(cr)}</span>
          </div>` : ""}

          <!-- Answer + Notes (2-col grid) -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px">✏️ Answer</div>
              ${editableDiv(rowIdx, "Answer", ans, "Fill in during Fit-to-Standard workshop")}
            </div>
            <div>
              <div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px">📝 Notes</div>
              ${editableDiv(rowIdx, "Notes", notes, "Open points, decisions, follow-ups")}
            </div>
          </div>

        </div>`;
      });

      const questionsHtml  = questionCards.join("");
      const visibleCount   = questionCards.filter(Boolean).length;

      // Skip section entirely if it has no visible questions
      if (visibleCount === 0) return "";

      const isLocaleSection = /^[A-Za-z]{2}$/.test(g.section || "");
      const sectionHtml = `
        <div style="background:${isLocaleSection ? "#eff6ff" : "var(--surface-2)"};
                    border:1px solid ${isLocaleSection ? "#bfdbfe" : "var(--border)"};
                    border-radius:6px;padding:8px 14px;margin:16px 0 4px">
          <span style="font-size:11px;font-weight:700;color:var(--accent);letter-spacing:.5px;text-transform:uppercase">
            ${escHtml(g.module)}
          </span>
          <span style="font-size:11px;color:var(--text-muted);margin:0 6px">›</span>
          ${isLocaleSection
            ? `<span style="font-size:11px;font-weight:700;color:#1d4ed8">🌍 Localization: ${escHtml(g.section)}</span>`
            : `<span style="font-size:11px;font-weight:600;color:var(--text)">${escHtml(g.section)}</span>`
          }
          <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${visibleCount} question${visibleCount !== 1 ? "s" : ""}</span>
        </div>`;

      return `<div style="margin-bottom:8px">${sectionHtml}${questionsHtml}</div>`;
    }).join("");

    return visibleQCounter; // total visible questions rendered
  }

  // ── Delete a BDCQ question row ──────────────────────────────────────────────
  window.bdcqDeleteRow = (rowIdx) => {
    const rows = window._bdcqEditorState.rows;
    if (rowIdx < 0 || rowIdx >= rows.length) return;
    const qText = getQuestionText(rows[rowIdx]) || "this question";
    if (!confirm(`Delete question?\n"${qText.slice(0, 100)}${qText.length > 100 ? "…" : ""}"\n\nClick Back to Configure → Generate & Edit to restore.`)) return;
    rows.splice(rowIdx, 1);
    const count  = renderEditorCards();
    const metaEl = document.getElementById("bdcq-editor-meta");
    if (metaEl) {
      const parts = metaEl.textContent.split(" · ");
      parts[0] = `${count} question${count !== 1 ? "s" : ""}`;
      metaEl.textContent = parts.join(" · ");
    }
    const countEl = document.getElementById("bdcq-editor-count");
    if (countEl) countEl.textContent = `${count} questions`;
  };

  // Called when user edits a cell
  window.bdcqEditorCell = (el) => {
    const rowIdx = parseInt(el.dataset.row, 10);
    const col    = el.dataset.col;
    if (isNaN(rowIdx) || !col) return;
    window._bdcqEditorState.rows[rowIdx][col] = el.innerText.trim();
  };

  // ── Enrich with Claude AI ────────────────────────────────────────────────────
  // ── AI-generated local questions (when AllCountries has no match) ─────────────
  window.bdcqGenerateAiLocalQuestions = async (domains, countries, industry) => {
    const btn     = document.getElementById("bdcq-ai-local-btn");
    const hintEl  = document.getElementById("bdcq-local-hint");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.7";
      btn.innerHTML = `<span style="display:inline-block;animation:spin 1s linear infinite;margin-right:6px">⟳</span> Asking Claude for Local Questions…`;
    }

    try {
      for (const domain of domains) {
        const r = await api.post("/api/bdcq/ai-local-questions", { domain, countries, industry });
        if (!r.ok) throw new Error(r.error || "Unknown error");

        // Inject rows into editor state — align with regular row schema
        const _qCol2 = window._bdcqEditorState.questionCol || "Question";
        const _INDUSTRY_LABELS = {
          "retail": "Retail", "consumer goods": "Consumer Goods / FMCG",
          "chemicals": "Chemicals / Process Industries", "automotive": "Automotive",
          "pharma": "Pharma / Life Sciences", "healthcare": "Healthcare / MedTech",
          "high tech": "High Tech", "financial services": "Financial Services",
          "utilities": "Utilities", "oil & gas": "Oil & Gas",
        };
        const _industryNorm = _INDUSTRY_LABELS[(industry || "").toLowerCase()] || industry || "";
        const newRows = (r.rows || []).map(row => ({
          ...row,
          // Copy question text into whichever column regular rows use
          ...(_qCol2 !== "Question" ? { [_qCol2]: row.Question || "" } : {}),
          Level:    row.Level    || "L3",
          Industry: _industryNorm || row.Industry || "",
          "SAP Standard Value":    row["Sample Value"] || "",
          "Watch Out / Constraint": "",
          "Country / Region":      row["Country / Region"] || "",
          "Answer": "",
          "Notes":  ""
        }));

        window._bdcqEditorState.rows.push(...newRows);
        // Ensure Level and Industry columns are registered (so they appear in Excel export)
        for (const col of ["Level", "Industry"]) {
          if (!window._bdcqEditorState.columns.includes(col)) {
            const aiColsSet = new Set(["SAP Standard Value","Watch Out / Constraint","Country / Region","Answer","Notes"]);
            const insertBefore = window._bdcqEditorState.columns.findIndex(c => aiColsSet.has(c));
            if (insertBefore >= 0) window._bdcqEditorState.columns.splice(insertBefore, 0, col);
            else window._bdcqEditorState.columns.push(col);
          }
        }
      }

      const hintEl2 = document.getElementById("bdcq-local-hint");
      if (hintEl2) { hintEl2.style.display = "none"; hintEl2.innerHTML = ""; }
      renderEditorCards();

      // Update meta count
      const total   = window._bdcqEditorState.rows.length;
      const metaEl  = document.getElementById("bdcq-editor-meta");
      const countEl = document.getElementById("bdcq-editor-count");
      const aiCount = window._bdcqEditorState.rows.filter(r => r._aiGenerated).length;
      if (metaEl) metaEl.textContent = metaEl.textContent.split("·")[0].trim() +
        ` · +${aiCount} AI-Generated Local Questions`;
      if (countEl) countEl.textContent = `${total} questions`;

    } catch (err) {
      if (hintEl) hintEl.innerHTML +=
        `<div style="margin-top:8px;padding:8px 12px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:6px;font-size:12px;color:#dc2626">
          ⚠️ Claude error: ${escHtml(err.message)}
        </div>`;
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.innerHTML = "✨ Ask Claude for Local Questions";
      }
    }
  };

  window.bdcqEnrich = async () => {
    const { rows, questionCol } = window._bdcqEditorState;
    if (!rows.length) return;

    // Read enrichment context — industry + countries selected on configure tab
    const enrichIndustry  = document.getElementById("bdcq-industry")?.value || "";
    const enrichCountries = [...document.querySelectorAll(".bdcq-enrich-country:checked")].map(cb => cb.value);

    const btnEl      = document.getElementById("bdcq-enrich-btn");
    const progressEl = document.getElementById("bdcq-enrich-progress");
    const BATCH      = 20;

    // Warn if enriching a large set — suggest scoping to relevant domains first
    if (rows.length > 300) {
      const domainCount = new Set(rows.map(r => r.Module || "General")).size;
      const proceed = confirm(
        `You are about to enrich ${rows.length} questions across ${domainCount} domains.\n\n` +
        `This will take approximately ${Math.ceil(rows.length / BATCH)} Claude calls and may run for 10–20 minutes.\n\n` +
        `Tip: Go back to Configure and select only the domains relevant to your project scope — typically 3–5 domains (200–300 questions) is enough.\n\n` +
        `Continue anyway?`
      );
      if (!proceed) {
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = "✨ Enrich with Claude AI"; }
        return;
      }
    }

    if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Enriching…"; }
    if (progressEl) progressEl.style.display = "block";

    const _enrichStart = Date.now();
    function _elapsed() {
      const s = Math.floor((Date.now() - _enrichStart) / 1000);
      return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
    }
    let _enrichStatusText = "";
    function _setStatus(html) {
      _enrichStatusText = html;
      if (progressEl) progressEl.innerHTML = `${html} &nbsp;·&nbsp; ⏱ <span id="bdcq-timer">${_elapsed()}</span>`;
    }
    const _timerTick = setInterval(() => {
      const t = document.getElementById("bdcq-timer");
      if (t) t.textContent = _elapsed();
    }, 1000);

    // Group rows by domain, then collect every batch as a flat list
    const domainGroups = {};
    rows.forEach((row, idx) => {
      const dom = row.Module || "General";
      if (!domainGroups[dom]) domainGroups[dom] = [];
      domainGroups[dom].push({ idx, row });
    });

    const allBatches = [];
    for (const [domain, entries] of Object.entries(domainGroups)) {
      for (let b = 0; b < entries.length; b += BATCH) {
        allBatches.push({ domain, batch: entries.slice(b, b + BATCH) });
      }
    }

    let done = 0;
    const total = rows.length;
    const errors = [];

    _setStatus(`✨ Enriching ${allBatches.length} batch${allBatches.length > 1 ? "es" : ""} in parallel — 0/${total} rows done`);

    // Fire all batches simultaneously — time = max(slowest batch) not sum of all
    await Promise.all(allBatches.map(async ({ domain, batch }) => {
      try {
        const r = await api.post("/api/bdcq/enrich", {
          domain, questionCol,
          rows:     batch.map(e => e.row),
          country:  enrichCountries,
          industry: enrichIndustry
        });
        if (r.ok && Array.isArray(r.enrichments)) {
          r.enrichments.forEach((e, i) => {
            if (!batch[i]) return;
            const globalIdx = batch[i].idx;
            window._bdcqEditorState.rows[globalIdx]["SAP Standard Value"]     = e.standardValue || "";
            window._bdcqEditorState.rows[globalIdx]["Watch Out / Constraint"] = e.watchOut      || "";
            if (e.countryRegion) window._bdcqEditorState.rows[globalIdx]["Country / Region"] = e.countryRegion;
          });
        } else {
          errors.push(`${domain}: ${r.error || "unknown error"}`);
        }
      } catch (err) {
        errors.push(`${domain}: ${err.message}`);
      }
      done += batch.length;
      _setStatus(`✨ Enriching — ${done}/${total} rows done`);
    }));

    clearInterval(_timerTick);

    if (errors.length) {
      if (progressEl) progressEl.innerHTML =
        `❌ Enrichment errors:<br>${errors.map(escHtml).join("<br>")}
         <br><span style="font-size:11px;color:var(--text-muted)">
         Check that Claude CLI is installed and START.bat added it to PATH.</span>`;
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = "✨ Re-Enrich"; }
      return;
    }

    // Re-render cards with enriched data
    renderEditorCards();

    if (progressEl) {
      progressEl.innerHTML = `✅ Enrichment complete — ${total} rows enriched in ${_elapsed()}. Review AI values before exporting.`;
      setTimeout(() => { if (progressEl) progressEl.style.display = "none"; }, 5000);
    }
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = "✨ Re-Enrich"; }

  };

  // ── Export Excel from editor state ──────────────────────────────────────────
  window.bdcqExportExcel = async () => {
    const { rows } = window._bdcqEditorState;
    if (!rows.length) return;

    // Build columns: Module + Section always first, then whatever the user has
    // ticked in the column list (standard + custom). Read directly from DOM so
    // custom columns added before OR after "Generate & Edit" are always included.
    const domChecked = [...document.querySelectorAll(".bdcq-col-check")]
      .filter(cb => cb.checked).map(cb => cb.value);
    const seen = new Set(["module", "section"]);
    const columns = [
      "Module", "Section",
      ...domChecked.filter(v => {
        const lc = v.toLowerCase();
        if (seen.has(lc)) return false;
        seen.add(lc);
        return true;
      })
    ];

    // Auto-generate filename if not filled in the configure tab
    let filename = (document.getElementById("bdcq-filename")?.value || "").trim();
    if (!filename) {
      const client = (document.getElementById("bdcq-client")?.value || "").trim().replace(/\s+/g, "_") || "Client";
      filename = `${client}_BDCQ_${new Date().toISOString().slice(0,10)}`;
    }

    // Show spinner on the export button (visible in editor tab)
    const exportBtn = document.querySelector("[onclick='bdcqExportExcel()']");
    if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = "Exporting…"; }

    try {
      const clientName   = (document.getElementById("bdcq-client")?.value   || "").trim();
      const overviewText      = (document.getElementById("bdcq-overview")?.value || "").trim();
      const clientLogo        = window._bdcqLogos?.client  || null;
      const partnerLogo       = window._bdcqLogos?.partner || null;
      const selectedCountries = [...document.querySelectorAll(".bdcq-enrich-country:checked")].map(cb => cb.value);
      const r = await api.post("/api/bdcq/export-editor", { filename, rows, columns, clientName, overviewText, clientLogo, partnerLogo, selectedCountries });
      if (r.ok) {
        // Show download toast — visible regardless of which tab is active
        const toast = document.createElement("div");
        toast.style.cssText = `
          position:fixed;bottom:24px;right:24px;z-index:99999;
          background:#0f172a;color:#f8fafc;border-radius:10px;
          padding:14px 18px;font-family:Segoe UI,Arial,sans-serif;
          font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,.35);
          display:flex;align-items:center;gap:12px;max-width:360px;
        `;
        toast.innerHTML = `
          <span style="font-size:18px">✅</span>
          <div>
            <div style="font-weight:600;margin-bottom:4px">Excel ready — ${r.rowCount} rows</div>
            <a href="/api/output/download/${encodeURIComponent(r.filename)}"
               style="color:#818cf8;font-size:12px;text-decoration:underline" download>
              ⬇ Download ${r.filename}
            </a>
          </div>
          <button onclick="this.parentElement.remove()" style="
            background:transparent;border:none;color:#64748b;
            font-size:16px;cursor:pointer;margin-left:auto;padding:2px">✕</button>
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 20000);
      } else {
        alert(`Export error: ${r.error || "unknown"}`);
      }
    } catch (err) {
      alert(`Export error: ${err.message}`);
    } finally {
      if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = "Export Excel ↓"; }
    }
  };

  // ── Quick Export (bypass editor) ────────────────────────────────────────────
  window.bdcqGenerate = async () => {
    const resultEl  = document.getElementById("bdcq-result");
    const filename    = (document.getElementById("bdcq-filename")?.value || "").trim();
    const clientName  = (document.getElementById("bdcq-client")?.value || "").trim();
    const scopeRaw    = (document.getElementById("bdcq-scope")?.value || "").trim();
    const overviewText= (document.getElementById("bdcq-overview")?.value || "").trim();
    const clientLogo  = window._bdcqLogos?.client  || null;
    const partnerLogo = window._bdcqLogos?.partner || null;

    if (!filename) {
      if (resultEl) resultEl.innerHTML = `<div class="alert alert-warning">Output File Name is required.</div>`;
      return;
    }

    // Parse scope IDs — split on comma, semicolon, or whitespace
    const scopeIds = scopeRaw
      ? scopeRaw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
      : [];

    // Collect selected domains
    const selectedDomains = [...document.querySelectorAll(".bdcq-domain-check")]
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    // Collect selected columns
    const selectedColumns = [...document.querySelectorAll(".bdcq-col-check")]
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    // Collect selected countries
    const countries = [...document.querySelectorAll(".bdcq-country-check")]
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    if (!selectedDomains.length) {
      if (resultEl) resultEl.innerHTML = `
        <div class="alert" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.4);color:#fca5a5;border-radius:8px;padding:14px 16px;font-size:13px;line-height:1.6">
          <strong style="font-size:14px">Select at least one domain to continue.</strong><br>
          Open <strong>BDCQ Files → Select domains</strong> above and tick the domains in your project scope.
        </div>`;
      document.getElementById("bdcq-domain-label")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (resultEl) resultEl.innerHTML = `<div class="alert alert-info">Generating Excel…</div>`;

    try {
      const r = await api.post("/api/bdcq/generate", {
        filename,
        scopeIds,
        selectedDomains,
        selectedColumns,
        countries,
        clientName,
        projectName: "",
        overviewText,
        clientLogo,
        partnerLogo
      });

      if (r.ok) {
        if (resultEl) resultEl.innerHTML = `
          <div class="alert alert-success">
            Generated &mdash; ${r.rowCount.toLocaleString()} rows &nbsp;
            <a href="/api/output/download/${encodeURIComponent(r.filename)}"
               style="color:var(--accent);font-weight:600;text-decoration:underline"
               download>Download ${r.filename}</a>
          </div>`;
      } else {
        if (resultEl) resultEl.innerHTML = `<div class="alert alert-warning">Error: ${r.error || "unknown error"}</div>`;
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = `<div class="alert alert-warning">Error: ${err.message}</div>`;
    }
  };
}


// ── BPD AGENT page ─────────────────────────────────────────────────────────────
// Faithful port of BPD_L1-L5_updated.jsx to vanilla JS / app.js SPA pattern

const _BPD_MODULES = ["Sales & Distribution","Finance & Controlling","Sourcing & Procurement","Manufacturing","Asset Management","Supply Chain","Human Resources","Professional Services","Customer Service","R&D & Engineering","Cross-Functional"];

// Module-specific coverage areas for FTS rule (4) — never hardcode SD terms for other modules
const _BPD_FTS_COVERAGE = {
  "Sales & Distribution":    "order management, pricing, shipping/delivery, billing, payment, output management, credit management, authorisation",
  "Finance & Controlling":   "journal entry, clearing, payment runs, bank reconciliation, period-end closing, tax, cost allocation, reporting",
  "Sourcing & Procurement":  "purchase requisition, purchase order, goods receipt, invoice verification, supplier evaluation, payment terms, contracts",
  "Manufacturing":           "production order, capacity planning, goods movements, backflushing, quality inspection, batch management, MRP",
  "Asset Management":        "asset creation, depreciation, maintenance order, equipment master, functional location, PM notification, plant maintenance",
  "Supply Chain":            "demand planning, stock transfer, inventory management, warehouse management, goods issue, goods receipt, physical inventory",
  "Human Resources":         "employee master data, payroll, time recording, leave management, organisational assignment, benefits, travel expense",
  "Professional Services":   "project creation, resource assignment, time confirmation, billing milestone, project cost, revenue recognition, WBS",
  "Customer Service":        "service order, service contract, SLA, repair order, field service, spare parts, customer complaint, warranty",
  "R&D & Engineering":       "product development, engineering change management, classification, document management, BOM, routing, specification",
  "Cross-Functional":        "master data governance, output management, workflow, authorisation, integration, reporting, data migration",
};
function _bpdFtsCoverage(module) {
  return _BPD_FTS_COVERAGE[module] || "all functional areas relevant to the scope items provided";
}

const _BPD_PC_RULES = `SAP S/4HANA PUBLIC CLOUD rules — MANDATORY for every output:
- No T-codes (VA01, ME21N, FB01 etc.) — use Fiori app name + (F-ID) e.g. Manage Journal Entries (F1348)
- No SPRO/IMG — use "Business Configuration > Area > Activity"
- No RFC/BAPI — use OData API via SAP Integration Suite CPI
- No Z-programs/Z-tables — use CFL (Tier-1) / BAS-RAP (Tier-2) / BTP CAP (Tier-3)
- All roles: SAP_BR_ prefix, assigned via Manage Business Users (F2709)
- Integration: SAP Integration Suite CPI only
- Migration: Migrate Your Data Fiori app only (no LSMW)
- Monitoring: SAP Cloud ALM (no Solution Manager)
- Background jobs: Application Jobs (F3508) (no SM36/SM37)`;

// BPD state
window._bpd = {
  form: { description:"", projectName:"", client:"", module:"Sales & Distribution", inScope:"", stakeholders:"", integrations:"" },
  data: null, progress: 0, activeTab:"full",
  autoFillTimer: null, autoFilled: new Set(),
  selectedIds: [],     // scope item IDs chosen in the catalog picker
  catalogData: null,   // response from /api/bpd/catalog-context
  matchTimer:  null,   // debounce for auto-match
  abortCtrl:   null    // AbortController for in-flight generation
};

async function pagBPD() {
  const modOpts = _BPD_MODULES.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join("");
  return `
    <div id="bpd-wrap">
      <style>
        #bpd-wrap .bpd-tab-btn { padding:10px 16px;font-size:12px;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--text-muted);border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap }
        #bpd-wrap .bpd-tab-btn.active { background:rgba(161,0,255,0.08);color:var(--accent);border-bottom:2px solid var(--accent) }
        @keyframes bpd-spin { to { transform:rotate(360deg) } }
      </style>

      <!-- ── INPUT PHASE ── -->
      <div id="bpd-input-view">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#460073 0%,#A100FF 100%);
                    border-radius:10px;padding:20px 28px;margin-bottom:16px;
                    display:flex;align-items:center;gap:18px">
          <div style="font-size:40px;font-weight:900;color:rgba(255,255,255,0.3);line-height:1">◉</div>
          <div>
            <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.3px">BPD Agent</div>
            <div style="color:#E0C8FF;font-size:12px;margin-top:2px">Accenture · SAP S/4HANA Cloud Public Edition · Business Process Documentation</div>
          </div>
          <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
            <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">&#9671; L2&#8211;L5 Hierarchy</span>
            <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">&#9670; BPMN Swimlanes</span>
            <span style="background:rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:12px;font-size:11px">&#10022; Claude AI</span>
          </div>
        </div>

        <div id="bpd-error-banner"></div>

        <!-- 2-column layout -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:stretch">

          <!-- LEFT: Process Description -->
          <div class="card" style="padding:18px 20px;display:flex;flex-direction:column">
            <div class="section-divider" style="margin-top:0;font-size:12px">
              1 · Process Requirement
              <span id="bpd-autofill-badge" style="display:none;margin-left:10px"></span>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
              <label class="btn btn-secondary" style="cursor:pointer;font-size:11px;padding:4px 10px;display:inline-flex;align-items:center;gap:5px">
                &#128206; Upload
                <input type="file" accept=".txt,.md,.doc,.docx" style="display:none" onchange="bpdHandleFile(this.files[0]);this.value=''">
              </label>
              <span style="font-size:10.5px;color:var(--text-muted)">.txt .md .docx</span>
            </div>
            <textarea id="bpd-desc" class="form-input" rows="7" style="resize:vertical;line-height:1.6;font-size:12.5px;flex:1"
              placeholder="e.g. Implement Order-to-Cash in SAP S/4HANA Cloud PE for Acme Corp — sales order, delivery, billing, payment clearing. Integration with WMS via SAP CPI."
              oninput="bpdOnDescInput(this.value)"></textarea>
            <div id="bpd-desc-hint" style="font-size:10.5px;color:var(--text-muted);margin-top:4px">Minimum 20 characters to enable generation</div>
          </div>

          <!-- RIGHT: Scope Picker -->
          <div class="card" style="padding:18px 20px;display:flex;flex-direction:column">
            <div class="section-divider" style="margin-top:0;font-size:12px">
              2 · Match SAP Scope Items
              <span style="font-size:10px;color:var(--text-muted);font-weight:400;margin-left:5px">657 real processes · auto-matched</span>
            </div>
            <input id="bpd-scope-search" class="form-input" style="font-size:12px;margin-bottom:8px" placeholder="Search by name or ID (e.g. BD9, J11, invoice)&#8230;" oninput="bpdSearchScope(this.value)">
            <div id="bpd-scope-list" style="border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg);flex:1;overflow-y:auto;min-height:120px">
              <div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px 0">Describe your process &#8212; scope items will auto-match from the SAP catalog</div>
            </div>
            <div id="bpd-selected-count" style="font-size:10.5px;color:var(--text-muted);margin-top:5px"></div>
          </div>

          <!-- FULL WIDTH: Project Details -->
          <div class="card" style="padding:18px 20px;grid-column:1 / -1">
            <div class="section-divider" style="margin-top:0;font-size:12px">
              3 · Project Details
              <span style="font-size:10px;color:var(--text-muted);font-weight:400;margin-left:5px">auto-filled · editable</span>
              <span id="bpd-step2-badge" style="display:none;margin-left:8px;background:#d4f6e8;color:#0FA968;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:600"></span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label" style="font-size:11px">Project Name</label>
                <input id="bpd-projectName" class="form-input" style="font-size:12px" placeholder="Acme S4HC Wave 1" oninput="window._bpd.form.projectName=this.value">
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label" style="font-size:11px">Client</label>
                <input id="bpd-client" class="form-input" style="font-size:12px" placeholder="Acme Corporation" oninput="window._bpd.form.client=this.value">
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label" style="font-size:11px">Line of Business</label>
                <select id="bpd-module" class="form-select" style="font-size:12px" onchange="window._bpd.form.module=this.value;_bpdAutoMatch()">${modOpts}</select>
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label" style="font-size:11px">In-Scope Processes</label>
                <input id="bpd-inScope" class="form-input" style="font-size:12px" placeholder="Sales order, delivery, billing" oninput="window._bpd.form.inScope=this.value">
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label" style="font-size:11px">Stakeholders</label>
                <input id="bpd-stakeholders" class="form-input" style="font-size:12px" placeholder="Sales Manager, Finance Lead" oninput="window._bpd.form.stakeholders=this.value">
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label" style="font-size:11px">Integrations</label>
                <input id="bpd-integrations" class="form-input" style="font-size:12px" placeholder="WMS, CRM via SAP CPI" oninput="window._bpd.form.integrations=this.value">
              </div>
            </div>
          </div>

        </div><!-- /grid -->

        <!-- Generate button -->
        <div style="text-align:center;margin:18px 0 8px">
          <button id="bpd-gen-btn" class="btn btn-primary btn-generate" style="opacity:0.5;cursor:not-allowed" disabled onclick="bpdGenerate()">
            &gt;&nbsp;&nbsp;<span id="bpd-gen-label">Generate L2&#8211;L5 Documentation</span>
          </button>
        </div>

      </div>

      <!-- ── LOADING PHASE ── -->
      <div id="bpd-loading-view" style="display:none">
        <div style="background:linear-gradient(135deg,#460073 0%,#A100FF 100%);
                    border-radius:10px;padding:24px 28px;margin-bottom:22px;
                    display:flex;align-items:center;gap:18px">
          <div style="font-size:48px;font-weight:900;color:#A100FF;line-height:1;
                      text-shadow:0 0 20px rgba(161,0,255,0.5)">◉</div>
          <div>
            <div style="color:#fff;font-size:22px;font-weight:700">BPD Agent — Generating</div>
            <div style="color:#E0C8FF;font-size:13px;margin-top:3px">Building L2/L3/L4/L5 hierarchy · Swimlane diagrams · Fiori app mappings</div>
          </div>
        </div>
        <div class="card" style="text-align:center;padding:36px 28px">
          <div style="background:var(--bg);border-radius:8px;height:10px;overflow:hidden;margin-bottom:10px;max-width:480px;margin-left:auto;margin-right:auto">
            <div id="bpd-prog-bar" style="height:10px;background:linear-gradient(90deg,#460073,#A100FF);border-radius:8px;width:0%;transition:width .4s"></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:22px">
            <div id="bpd-prog-pct" style="font-size:15px;color:var(--accent);font-weight:700">0%</div>
            <div id="bpd-timer" style="font-size:13px;color:var(--text-muted);font-variant-numeric:tabular-nums">0s</div>
          </div>
          <div id="bpd-phase-list" style="display:flex;flex-direction:column;gap:5px;max-width:420px;margin:0 auto;text-align:left">
            ${Array.from({length:9},(_,i)=>`
              <div id="bpd-ph-${i}" style="display:flex;align-items:center;gap:8px;opacity:0.25;transition:opacity .5s;font-size:12px">
                <span id="bpd-ph-ic-${i}" style="color:var(--text-muted);font-weight:700;width:14px;text-align:center">&#9675;</span>
                <span id="bpd-ph-lbl-${i}" style="color:var(--text-muted)">Initialising&#8230;</span>
              </div>`).join("")}
          </div>
        </div>
      </div>

      <!-- ── RESULT PHASE ── -->
      <div id="bpd-result-view" style="display:none">
        <!-- Result header — same gradient -->
        <div style="background:linear-gradient(135deg,#460073 0%,#A100FF 100%);
                    border-radius:10px;padding:18px 24px;margin-bottom:16px;
                    display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <button onclick="bpdResetToInput()" style="background:rgba(255,255,255,0.15);border:none;color:#fff;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600">&#8592; New</button>
          <div style="flex:1">
            <div id="bpd-result-title" style="font-size:16px;font-weight:700;color:#fff"></div>
            <div id="bpd-result-sub" style="font-size:11px;color:#E0C8FF"></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="background:rgba(255,255,255,0.15);color:#7dffb3;border-radius:12px;padding:3px 12px;font-size:11px;font-weight:600">&#10003; Generated</span>
            <button onclick="bpdExportPDF()" style="padding:7px 14px;border-radius:8px;background:rgba(255,255,255,0.9);color:#460073;border:none;font-weight:700;font-size:12px;cursor:pointer">&#128196; PDF</button>
            <button onclick="bpdDownloadWord()" style="padding:7px 14px;border-radius:8px;background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);font-weight:600;font-size:12px;cursor:pointer">&#128196; Word</button>
            <button onclick="bpdExportPPTX()" style="padding:7px 14px;border-radius:8px;background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);font-weight:600;font-size:12px;cursor:pointer">&#128202; PPTX</button>
          </div>
        </div>
        <!-- Tab bar — inside a card -->
        <div class="card" style="padding:0;overflow:hidden">
          <div style="overflow-x:auto;border-bottom:1px solid var(--border)">
            <div style="display:flex;min-width:640px">
              ${[["full","&#128209; L2&#8211;L5 Full"],["overview","&#9962; L2 Overview"],["l3","&#9783; L3 Areas"],["l4","&#128221; L4 Activities"],["l5","&#9881; L5 Config"],["e2e","&#9654; E2E Swimlane"],["compare","&#9889; As-Is vs To-Be"],["fts","&#10003; Fit-to-Standard"],["next","&#8594; Next Steps"]].map(([id,lbl])=>`
                <button class="bpd-tab-btn${id==="full"?" active":""}" data-tab="${id}" onclick="bpdSwitchTab('${id}')">${lbl}</button>`).join("")}
            </div>
          </div>
          <div id="bpd-tab-content" style="padding:24px;min-height:400px"></div>
        </div>
      </div>
    </div>`;
}

window.bpdResumeLast = function() {
  try {
    const savedData = localStorage.getItem("bpd_last_data");
    const savedForm = localStorage.getItem("bpd_last_form");
    if (!savedData || !savedForm) { bpdClearCache(); return; }
    const restoredData = JSON.parse(savedData);
    const restoredForm = JSON.parse(savedForm);
    window._bpd.data = restoredData;
    window._bpd.form = restoredForm;
    document.getElementById("bpd-input-view").style.display = "none";
    document.getElementById("bpd-loading-view").style.display = "none";
    document.getElementById("bpd-result-view").style.display = "";
    const titleEl = document.getElementById("bpd-result-title");
    const subEl   = document.getElementById("bpd-result-sub");
    if (titleEl) titleEl.textContent = restoredData.l2?.name || "Process Documentation";
    if (subEl)   subEl.textContent   = `${restoredForm.projectName||""} · ${restoredForm.client||""} · ${restoredForm.module}`;
    window._bpd.activeTab = "full";
    document.querySelectorAll(".bpd-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === "full");
    });
    const tc = document.getElementById("bpd-tab-content");
    if (tc) tc.innerHTML = _bpdRenderTab("full");
  } catch(_) {
    // Corrupted storage — wipe it and dismiss the banner cleanly
    bpdClearCache();
  }
};

window.bpdClearCache = function() {
  try { localStorage.removeItem("bpd_last_data"); localStorage.removeItem("bpd_last_form"); } catch(_) {}
  const banner = document.getElementById("bpd-resume-banner");
  if (banner) banner.remove();
};

function bindBPD() {
  // Show a non-intrusive resume banner if a previous session exists — never auto-restore
  try {
    const savedData = localStorage.getItem("bpd_last_data");
    const savedForm = localStorage.getItem("bpd_last_form");
    if (savedData && savedForm) {
      const sf = JSON.parse(savedForm);
      const label = [sf.projectName, sf.client, sf.module].filter(Boolean).join(" · ");
      // Inject banner above the input form
      setTimeout(() => {
        const inputView = document.getElementById("bpd-input-view");
        if (!inputView || document.getElementById("bpd-resume-banner")) return;
        const banner = document.createElement("div");
        banner.id = "bpd-resume-banner";
        banner.style.cssText = "background:linear-gradient(90deg,#460073,#7B00CC);color:#fff;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px";
        banner.innerHTML = `<span style="display:flex;align-items:center;gap:8px"><span style="font-size:15px">&#128221;</span><strong>Previous session:</strong> ${_bpdEsc(label)}</span><span style="display:flex;gap:8px"><button onclick="bpdResumeLast()" style="background:rgba(255,255,255,0.95);color:#460073;border:none;border-radius:6px;padding:5px 14px;font-weight:700;font-size:12px;cursor:pointer">Resume</button><button onclick="bpdClearCache()" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.4);border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer">&#10005; Clear</button></span>`;
        inputView.insertBefore(banner, inputView.firstChild);
      }, 50);
    }
  } catch(_) {}

  const f = window._bpd.form;
  const setVal = (id, v) => { const el=document.getElementById(id); if(el&&v) el.value=v; };
  setVal("bpd-desc", f.description);
  setVal("bpd-projectName", f.projectName);
  setVal("bpd-client", f.client);
  setVal("bpd-inScope", f.inScope);
  setVal("bpd-stakeholders", f.stakeholders);
  setVal("bpd-integrations", f.integrations);
  const modEl = document.getElementById("bpd-module");
  if (modEl && f.module) modEl.value = f.module;
  if (f.description) bpdOnDescInput(f.description);
}

window.bpdResetToInput = function() {
  if (window._bpd.abortCtrl) { window._bpd.abortCtrl.abort(); window._bpd.abortCtrl = null; }
  window._bpd.data        = null;
  window._bpd.progress    = 0;
  window._bpd.autoFilled  = new Set();
  window._bpd.selectedIds = [];
  window._bpd.catalogData = null;
  try { localStorage.removeItem("bpd_last_data"); localStorage.removeItem("bpd_last_form"); } catch(_) {}
  const banner = document.getElementById("bpd-resume-banner"); if (banner) banner.remove();
  // Reset scope picker
  const sl = document.getElementById("bpd-scope-list");
  if (sl) sl.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px 0">Type a process description above &#8212; scope items will auto-match from the SAP catalog</div>`;
  const sc = document.getElementById("bpd-selected-count");
  if (sc) { sc.textContent = ""; }
  const ss = document.getElementById("bpd-scope-search");
  if (ss) ss.value = "";
  const gl = document.getElementById("bpd-gen-label");
  if (gl) gl.textContent = "Generate L2–L5 Documentation";
  document.getElementById("bpd-input-view").style.display = "";
  document.getElementById("bpd-loading-view").style.display = "none";
  document.getElementById("bpd-result-view").style.display = "none";
};

function _bpdRefreshBtn() {
  const desc = window._bpd.form.description || "";
  const hasScope = window._bpd.selectedIds.length > 0;
  const ok = desc.length > 20 || hasScope;
  const btn  = document.getElementById("bpd-gen-btn");
  const hint = document.getElementById("bpd-desc-hint");
  if (btn)  { btn.disabled = !ok; btn.style.opacity = ok ? "1" : "0.5"; btn.style.cursor = ok ? "pointer" : "not-allowed"; }
  if (hint) {
    if (hasScope && desc.length <= 20) {
      hint.textContent = `${window._bpd.selectedIds.length} scope item${window._bpd.selectedIds.length>1?"s":""} selected — ready to generate`;
      hint.style.color = "var(--accent)";
    } else {
      hint.textContent = desc.length > 20 ? `${desc.length} characters` : `${desc.length} / 20 minimum`;
      hint.style.color = desc.length > 20 ? "var(--accent)" : "var(--text-muted)";
    }
  }
}

window.bpdOnDescInput = function(val) {
  const desc = (val || document.getElementById("bpd-desc")?.value || "").trim();
  window._bpd.form.description = desc;
  _bpdRefreshBtn();
  clearTimeout(window._bpd.autoFillTimer);
  clearTimeout(window._bpd.matchTimer);
  if (desc.length > 80) {
    window._bpd.autoFillTimer = setTimeout(_bpdAutoFill, 1200);
    // matchTimer fires after auto-fill has a chance to set the module (auto-fill starts at 1200ms + ~1s Claude round-trip)
    window._bpd.matchTimer    = setTimeout(_bpdAutoMatch, 2800);
  }
};

window.bpdHandleFile = async function(file) {
  if (!file) return;
  const name = file.name.toLowerCase();
  const ta = document.getElementById("bpd-desc");
  if (!ta) return;
  ta.value = "Reading " + file.name + "...";
  try {
    let text = "";
    if (name.endsWith(".txt") || name.endsWith(".md")) {
      text = await file.text();
    } else if (name.endsWith(".docx")) {
      if (typeof mammoth === "undefined") { ta.value = "mammoth.js not loaded — use .txt or .md instead."; return; }
      const buf = await file.arrayBuffer();
      const res = await mammoth.extractRawText({ arrayBuffer: buf });
      text = (res.value || "").trim() || "No text found in DOCX.";
    } else if (name.endsWith(".doc")) {
      ta.value = "Old .doc not supported. Save as .docx or .txt and re-upload.";
      return;
    } else {
      ta.value = "Unsupported format. Use .txt .md .docx";
      return;
    }
    ta.value = text.slice(0, 6000);
    bpdOnDescInput(ta.value);
  } catch(e) {
    ta.value = "Error reading file: " + e.message;
  }
};

async function _bpdAutoFill() {
  const desc = window._bpd.form.description;
  if (desc.length < 80) return;
  const badge = document.getElementById("bpd-autofill-badge");
  if (badge) { badge.style.display="inline-flex"; badge.innerHTML=`<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(161,0,255,0.1);color:var(--accent);border-radius:12px;padding:2px 10px;font-size:11px;font-weight:600"><span style="width:8px;height:8px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite;display:inline-block"></span>Auto-filling...</span>`; }
  try {
    const shortDesc = desc.length > 800 ? desc.slice(0,800)+"..." : desc;
    const prompt = `Extract metadata from this SAP project description. Return ONLY a JSON object — no markdown, no backticks.
Description: "${shortDesc.replace(/"/g,'\\"').replace(/\n/g,' ')}"
Return exactly: {"projectName":"short 2-5 word project name","client":"company name","module":"pick exactly one of: Sales & Distribution, Finance & Controlling, Sourcing & Procurement, Manufacturing, Asset Management, Supply Chain, Human Resources, Professional Services, Customer Service, R&D & Engineering, Cross-Functional","inScope":"comma-separated key processes (max 8)","stakeholders":"comma-separated roles (max 6)","integrations":"comma-separated external systems or empty"}
Start with { end with }.`;
    const resp = await fetch("/api/bpd/autofill", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({prompt,max_tokens:400}) });
    const d = await resp.json();
    const raw = (d.content||[]).map(c=>c.text||"").join("").trim().replace(/^```[a-z]*\n?/,"").replace(/\n?```$/,"").trim();
    const meta = _bpdSafeJSON(raw);
    if (!meta) return;
    let filled = 0;
    const fill = (id, k) => {
      const el=document.getElementById("bpd-"+id), f=window._bpd.form, v=(meta[k]||"").trim();
      if (el && v && (!f[k]||f[k]===""||f[k]===_BPD_MODULES[0])) {
        if (id==="module") {
          const m = _BPD_MODULES.find(m=>m===v) || _BPD_MODULES.find(m=>m.split(" - ")[0]===v.split(" - ")[0]) || _BPD_MODULES.find(m=>m.toLowerCase().includes(v.toLowerCase().split(" ")[0]));
          if (m) { el.value = m; f.module = m; filled++; }
        } else { el.value=v; f[k]=v; filled++; }
      }
    };
    const prevModule = window._bpd.form.module;
    fill("projectName","projectName"); fill("client","client"); fill("module","module");
    fill("inScope","inScope"); fill("stakeholders","stakeholders"); fill("integrations","integrations");
    const step2badge = document.getElementById("bpd-step2-badge");
    if (step2badge && filled>0) { step2badge.style.display="inline"; step2badge.textContent=`✓ ${filled} fields filled`; }
    if (badge && filled>0) badge.innerHTML=`<span style="background:#d4f6e8;color:#0FA968;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:600">&#10003; ${filled} fields auto-filled</span>`;
    else if (badge && filled===0) badge.style.display="none";
    // If auto-fill changed the module, clear any pre-selected scope items and re-run match with the correct module
    if (window._bpd.form.module !== prevModule) {
      window._bpd.selectedIds = [];
      _bpdUpdateScopeCheckboxes();
      _bpdUpdateCount();
      clearTimeout(window._bpd.matchTimer);
      _bpdAutoMatch();
    }
  } catch(_) { if(badge) badge.style.display="none"; }
}

// ── Scope catalog matching ─────────────────────────────────────────────────────

async function _bpdAutoMatch() {
  const desc   = window._bpd.form.description;
  const module = document.getElementById("bpd-module")?.value || window._bpd.form.module || _BPD_MODULES[0];
  if (desc.length < 40) return;
  const list = document.getElementById("bpd-scope-list");
  if (!list) return;
  list.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px 0;display:flex;align-items:center;justify-content:center;gap:8px"><span style="width:12px;height:12px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite;display:inline-block"></span>Matching against SAP catalog&#8230;</div>`;
  try {
    const resp = await fetch("/api/bpd/match", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({module, description: desc.slice(0, 600)})
    });
    const d = await resp.json();
    _bpdRenderScopeList(d.matches || [], d.total || 0);
    // Auto-select top 4 if nothing selected yet
    if (window._bpd.selectedIds.length === 0) {
      (d.matches || []).slice(0, 4).forEach(m => {
        if (!window._bpd.selectedIds.includes(m.id)) window._bpd.selectedIds.push(m.id);
      });
      _bpdUpdateScopeCheckboxes();
      _bpdUpdateCount();
    }
  } catch(e) {
    if (list) list.innerHTML = `<div style="color:#DC2626;font-size:12px;padding:10px">Match failed: ${_bpdEsc(e.message)}</div>`;
  }
}

window.bpdSearchScope = async function(val) {
  const module = document.getElementById("bpd-module")?.value || window._bpd.form.module || _BPD_MODULES[0];
  const desc   = window._bpd.form.description;
  const list   = document.getElementById("bpd-scope-list");
  if (!list) return;
  if (!val || val.trim().length < 2) {
    // Revert to auto-match results
    if (desc.length > 40) _bpdAutoMatch();
    return;
  }
  list.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:12px 0">Searching&#8230;</div>`;
  try {
    const resp = await fetch("/api/bpd/match", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({module, description: desc.slice(0,300), keywords: val.trim().split(/\s+/)})
    });
    const d = await resp.json();
    _bpdRenderScopeList(d.matches || [], d.total || 0, true);
  } catch(e) {
    list.innerHTML = `<div style="color:#DC2626;font-size:12px;padding:10px">Search failed: ${_bpdEsc(e.message)}</div>`;
  }
};

function _bpdRenderScopeList(matches, total, isSearch) {
  const list = document.getElementById("bpd-scope-list");
  if (!list) return;
  if (!matches.length) {
    list.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:16px 0">No matching scope items found. Try a different search term.</div>`;
    return;
  }
  const colors = ["#3B82F6","#8B5CF6","#059669","#EA580C","#DC2626","#0891B2","#7C3AED","#0D9488","#D97706","#6366F1"];
  list.innerHTML = matches.map((m, i) => {
    const isSelected = window._bpd.selectedIds.includes(m.id);
    const c = colors[i % colors.length];
    return `<div id="bpd-scope-item-${m.id}" onclick="bpdToggleScope('${m.id}')" style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:7px;cursor:pointer;background:${isSelected?"rgba(161,0,255,0.07)":"transparent"};border:1.5px solid ${isSelected?"var(--accent)":"var(--border)"};margin-bottom:5px;transition:all .15s">
      <div style="margin-top:2px">
        <div id="bpd-scope-chk-${m.id}" style="width:16px;height:16px;border-radius:4px;border:2px solid ${isSelected?"var(--accent)":"#CBD5E1"};background:${isSelected?"var(--accent)":"white"};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s">
          ${isSelected?'<span style="color:white;font-size:10px;font-weight:700">&#10003;</span>':""}
        </div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
          <span style="background:${c}18;color:${c};border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700;flex-shrink:0">${_bpdEsc(m.id)}</span>
          <span style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_bpdEsc(m.name)}</span>
        </div>
        <div style="font-size:10.5px;color:var(--text-muted)">${_bpdEsc(m.l2)} &#183; ${_bpdEsc(m.l1)}</div>
        ${m.hint?`<div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;line-height:1.4">${_bpdEsc(m.hint.slice(0,120))}&#8230;</div>`:""}
      </div>
    </div>`;
  }).join("") + (total > matches.length ? `<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:4px 0">+ ${total - matches.length} more — refine search to narrow down</div>` : "");
  _bpdUpdateCount();
}

window.bpdToggleScope = function(id) {
  const ids = window._bpd.selectedIds;
  const idx = ids.indexOf(id);
  if (idx >= 0) {
    ids.splice(idx, 1);
  } else {
    ids.push(id);
  }
  // Update just this item's visual state
  const item = document.getElementById(`bpd-scope-item-${id}`);
  const chk  = document.getElementById(`bpd-scope-chk-${id}`);
  const selected = ids.includes(id);
  if (item) {
    item.style.background = selected ? "rgba(161,0,255,0.07)" : "transparent";
    item.style.border = `1.5px solid ${selected?"var(--accent)":"var(--border)"}`;
  }
  if (chk) {
    chk.style.background = selected ? "var(--accent)" : "white";
    chk.style.borderColor = selected ? "var(--accent)" : "#CBD5E1";
    chk.innerHTML = selected ? '<span style="color:white;font-size:10px;font-weight:700">&#10003;</span>' : "";
  }
  _bpdUpdateCount();
};

function _bpdUpdateScopeCheckboxes() {
  const ids = window._bpd.selectedIds;
  ids.forEach(id => {
    const item = document.getElementById(`bpd-scope-item-${id}`);
    const chk  = document.getElementById(`bpd-scope-chk-${id}`);
    if (item) { item.style.background="rgba(161,0,255,0.07)"; item.style.border="1.5px solid var(--accent)"; }
    if (chk)  { chk.style.background="var(--accent)"; chk.style.borderColor="var(--accent)"; chk.innerHTML='<span style="color:white;font-size:10px;font-weight:700">&#10003;</span>'; }
  });
}

function _bpdUpdateCount() {
  const n    = window._bpd.selectedIds.length;
  const el   = document.getElementById("bpd-selected-count");
  const genLabel = document.getElementById("bpd-gen-label");
  if (el) {
    el.innerHTML = n > 0
      ? `${n} scope item${n>1?"s":""} selected &#8212; generation will be grounded in real SAP catalog data`
      : "Select scope items for catalog-grounded generation, or just describe your process";
    el.style.color = n > 0 ? "var(--accent)" : "var(--text-muted)";
  }
  if (genLabel) genLabel.textContent = n > 0 ? `Generate — Grounded (${n} items)` : "Generate L2–L5 Documentation";
  _bpdRefreshBtn();
}

function _bpdSafeJSON(raw) {
  raw = (raw||"").trim().replace(/^```[a-z]*\n?/,"").replace(/\n?```$/,"").trim();
  try { return JSON.parse(raw); } catch(_) {}
  let attempt = raw.replace(/,\s*$/,"").replace(/,\s*"[^"]*"?\s*$/,"");
  const stack=[];let inStr=false,esc=false;
  for(const ch of attempt){if(esc){esc=false;continue;}if(ch==="\\"){esc=true;continue;}if(ch==='"'){inStr=!inStr;continue;}if(inStr)continue;if(ch==="{"||ch==="[")stack.push(ch==="{"?"}":"]");else if(ch==="}"||ch==="]")stack.pop();}
  if(inStr)attempt+='"';while(stack.length)attempt+=stack.pop();
  try { return JSON.parse(attempt); } catch(_) { return null; }
}

function _bpdWrap(t, m) {
  if (!t||t.length<=m) return [t||""];
  const words=t.split(" "),lines=[];let cur="";
  for(const w of words){if((cur+" "+w).trim().length>m){if(cur)lines.push(cur.trim());if(lines.length>=3){lines[2]=lines[2].slice(0,m-1)+"...";return lines.slice(0,3);}cur=w;}else cur=cur?cur+" "+w:w;}
  if(cur)lines.push(cur.trim());
  if(lines.length>3){lines[2]=lines[2].slice(0,m-1)+"...";return lines.slice(0,3);}
  return lines.length?lines:[t.slice(0,m)];
}

function _bpdLaneColor(r){
  r=(r||"").toLowerCase();
  if(r.includes("s/4hana")||r.includes("system"))return{bg:"#F9F5FF",bd:"#7E57C2",tx:"#4A148C"};
  if(r.includes("approv")||r.includes("manager")||r.includes("director"))return{bg:"#FFF8E1",bd:"#FFB300",tx:"#E65100"};
  if(r.includes("financ")||r.includes("account")||r.includes("billing")||r.includes("treasury"))return{bg:"#F1F8E9",bd:"#7CB342",tx:"#33691E"};
  if(r.includes("warehouse")||r.includes("shipping")||r.includes("picking")||r.includes("receiving"))return{bg:"#E3F2FD",bd:"#42A5F5",tx:"#0D47A1"};
  return{bg:"#F5F5F5",bd:"#90A4AE",tx:"#37474F"};
}

function _bpdSvg(swimlane) {
  if (!swimlane?.lanes?.length) return "<div style='color:#9E96B8;font-size:12px;padding:12px'>No swimlane data</div>";
  const LW=52,CW=185,SG=22,LH=130,TH=52,BW=162,BH=84;
  const lanes = swimlane.lanes;
  // Cross-lane interleaving: step i from each lane in round-robin
  const seq=[];
  const maxLen=Math.max(...lanes.map(l=>(l.steps||[]).length),0);
  for(let si=0;si<maxLen;si++){for(let li=0;li<lanes.length;li++){const steps=(lanes[li].steps||[]).filter(s=>s&&s.text);if(si<steps.length)seq.push({...steps[si],laneIdx:li});}}
  const W=Math.max(900,LW+seq.length*(CW+SG)+100);
  const H=TH+lanes.length*LH+6;
  const positions=seq.map((step,si)=>({cx:LW+50+si*(CW+SG)+CW/2,cy:TH+step.laneIdx*LH+LH/2,step}));
  const es=s=>(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const uid="bpd"+Math.random().toString(36).slice(2,7);

  function rs(step,cx,cy){
    const lines=_bpdWrap(step.text||"",16),lh=14,hx=cx-BW/2,hy=cy-BH/2;
    if(step.type==="D"){const sz=28;return`<g><polygon points="${cx},${cy-sz} ${cx+sz},${cy} ${cx},${cy+sz} ${cx-sz},${cy}" fill="white" stroke="#455A64" stroke-width="2"/><text x="${cx}" y="${cy+2}" text-anchor="middle" font-size="16" font-weight="800" fill="#455A64">x</text>${lines.slice(0,2).map((l,i)=>`<text x="${cx}" y="${cy+sz+14+(i*12)}" text-anchor="middle" font-size="10" fill="#37474F" font-style="italic">${es(l)}</text>`).join("")}</g>`;}
    if(step.type==="Y")return`<g><rect x="${hx}" y="${hy}" width="${BW}" height="${BH}" rx="8" fill="#F1F8E9" stroke="#558B2F" stroke-width="1.2"/><rect x="${cx-16}" y="${hy-9}" width="32" height="16" rx="3" fill="#558B2F"/><text x="${cx}" y="${hy+2}" text-anchor="middle" font-size="9" font-weight="800" fill="white">YES</text>${lines.map((l,i)=>`<text x="${cx}" y="${cy-(lines.length-1)*lh/2+4+(i*lh)}" text-anchor="middle" font-size="11" fill="#33691E" font-weight="600">${es(l.replace(/^YES\s*[-→>]\s*/i,""))}</text>`).join("")}</g>`;
    if(step.type==="N")return`<g><rect x="${hx}" y="${hy}" width="${BW}" height="${BH}" rx="8" fill="#FBE9E7" stroke="#C62828" stroke-width="1.2"/><rect x="${cx-12}" y="${hy-9}" width="24" height="16" rx="3" fill="#C62828"/><text x="${cx}" y="${hy+2}" text-anchor="middle" font-size="9" font-weight="800" fill="white">NO</text>${lines.map((l,i)=>`<text x="${cx}" y="${cy-(lines.length-1)*lh/2+4+(i*lh)}" text-anchor="middle" font-size="11" fill="#B71C1C" font-weight="600">${es(l.replace(/^NO\s*[-→>]\s*/i,""))}</text>`).join("")}</g>`;
    if(step.type==="A")return`<g><rect x="${hx}" y="${hy}" width="${BW}" height="${BH}" rx="8" fill="#EDE7F6" stroke="#5E35B1" stroke-width="1" stroke-dasharray="6,3"/>${lines.map((l,i)=>`<text x="${cx+2}" y="${cy-(lines.length-1)*lh/2+4+(i*lh)}" text-anchor="middle" font-size="11" fill="#311B92">${es(l)}</text>`).join("")}<circle cx="${hx+13}" cy="${hy+13}" r="6" fill="none" stroke="#5E35B1" stroke-width="1"/></g>`;
    return`<g><rect x="${hx}" y="${hy}" width="${BW}" height="${BH}" rx="8" fill="white" stroke="#78909C" stroke-width="1.2"/><rect x="${hx}" y="${hy+4}" width="4" height="${BH-8}" rx="2" fill="#1E88E5"/>${lines.map((l,i)=>`<text x="${cx+2}" y="${cy-(lines.length-1)*lh/2+4+(i*lh)}" text-anchor="middle" font-size="11" fill="#263238" font-weight="600">${es(l)}</text>`).join("")}</g>`;
  }

  let svg=`<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;min-width:700px">`;
  svg+=`<defs><marker id="${uid}-arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0.5,8 3,0 5.5" fill="#455A64"/></marker></defs>`;
  svg+=`<rect x="0" y="0" width="${W}" height="${TH}" fill="#263238"/>`;
  svg+=`<text x="14" y="${TH/2+5}" font-size="16" font-weight="700" fill="white" font-family="Georgia,serif">${es((swimlane.title||"Process Flow").slice(0,90))}</text>`;
  lanes.forEach((lane,li)=>{
    const lc=_bpdLaneColor(lane.role||lane.name||""),ly=TH+li*LH;
    svg+=`<rect x="${LW}" y="${ly}" width="${W-LW}" height="${LH}" fill="${li%2===0?"#FAFAFA":"#FFFFFF"}"/>`;
    svg+=`<line x1="0" y1="${ly}" x2="${W}" y2="${ly}" stroke="#CFD8DC" stroke-width="0.8"/>`;
    svg+=`<line x1="0" y1="${ly+LH}" x2="${W}" y2="${ly+LH}" stroke="#CFD8DC" stroke-width="0.8"/>`;
    svg+=`<rect x="0" y="${ly}" width="${LW}" height="${LH}" fill="${lc.bg}"/>`;
    svg+=`<rect x="${LW-3}" y="${ly}" width="3" height="${LH}" fill="${lc.bd}"/>`;
    svg+=`<text x="${LW/2-2}" y="${ly+LH/2}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="${lc.tx}" transform="rotate(-90,${LW/2-2},${ly+LH/2})">${es((lane.role||lane.name||"Role").slice(0,22))}</text>`;
  });
  svg+=`<line x1="${LW}" y1="${TH}" x2="${LW}" y2="${H}" stroke="#B0BEC5" stroke-width="1"/>`;
  if(positions.length>0){svg+=`<circle cx="${LW+22}" cy="${positions[0].cy}" r="10" fill="white" stroke="#455A64" stroke-width="2.5"/>`;svg+=`<line x1="${LW+34}" y1="${positions[0].cy}" x2="${positions[0].cx-BW/2-4}" y2="${positions[0].cy}" stroke="#455A64" stroke-width="1.5" marker-end="url(#${uid}-arr)"/>`;}
  positions.forEach(({cx,cy,step},si)=>{
    svg+=rs(step,cx,cy);
    if(si<positions.length-1){const next=positions[si+1];const fromX=cx+(step.type==="D"?30:BW/2)+3;const toX=next.cx-BW/2-4;if(Math.abs(cy-next.cy)<2){svg+=`<line x1="${fromX}" y1="${cy}" x2="${toX}" y2="${next.cy}" stroke="#455A64" stroke-width="1.3" marker-end="url(#${uid}-arr)"/>`;}else{const midX=(fromX+toX)/2;svg+=`<path d="M${fromX},${cy} L${midX},${cy} L${midX},${next.cy} L${toX},${next.cy}" fill="none" stroke="#455A64" stroke-width="1.3" marker-end="url(#${uid}-arr)"/>`;}}
  });
  if(positions.length>0){const last=positions[positions.length-1],ex=last.cx+BW/2+28;svg+=`<line x1="${last.cx+BW/2+3}" y1="${last.cy}" x2="${ex-12}" y2="${last.cy}" stroke="#455A64" stroke-width="1.3" marker-end="url(#${uid}-arr)"/>`;svg+=`<circle cx="${ex}" cy="${last.cy}" r="10" fill="white" stroke="#455A64" stroke-width="3.5"/>`;}
  svg+=`<rect x="0" y="${H-4}" width="${W}" height="4" fill="#263238"/>`;
  svg+=`</svg>`;
  return`<div style="overflow-x:auto;border-radius:8px;border:1.5px solid #90A4AE;background:white;box-shadow:0 2px 12px rgba(0,0,0,0.06);margin:12px 0"><div style="padding:4px 10px;background:#263238;border-radius:8px 8px 0 0;font-size:10px;color:#80CBC4;font-weight:600">BPMN 2.0 — scroll to view full diagram</div>${svg}</div>`;
}

window.bpdSwitchTab = function(tab) {
  window._bpd.activeTab = tab;
  document.querySelectorAll(".bpd-tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  const tc = document.getElementById("bpd-tab-content");
  if (tc) tc.innerHTML = _bpdRenderTab(tab);
};

function _bpdEsc(s) { return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function _bpdL2Html(d) {
  if (!d.l2) return "";
  let html = `<div style="background:linear-gradient(135deg,#5B2FD4,#3E1FA3);border-radius:14px;padding:24px 28px;color:white;margin-bottom:18px;position:relative;overflow:hidden">
    <div style="position:absolute;top:-40px;right:-40px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,0.06)"></div>
    <div style="position:relative">
      <div style="font-size:9px;font-weight:700;letter-spacing:3px;opacity:0.6;margin-bottom:5px">L2 &#8212; END-TO-END PROCESS</div>
      <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;font-family:Georgia,serif">${_bpdEsc(d.l2.name)}</h2>
      <p style="font-size:13px;opacity:0.85;line-height:1.7;margin:0 0 12px;max-width:580px">${_bpdEsc(d.l2.description)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">${(d.l2.scopeItems||[]).map(s=>`<span style="background:rgba(255,255,255,0.15);border-radius:6px;padding:3px 10px;font-size:11px">&#128204; ${_bpdEsc(s)}</span>`).join("")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${(d.l2.kpis||[]).map(k=>`<span style="background:rgba(255,255,255,0.1);border-radius:6px;padding:3px 10px;font-size:11px">&#128202; ${_bpdEsc(k)}</span>`).join("")}</div>
    </div>
  </div>`;
  if (d.endToEndSwimlane) html += _bpdSvg(d.endToEndSwimlane);
  return html;
}

function _bpdL3Html(d) {
  const colors = ["#3B82F6","#8B5CF6","#059669","#EA580C","#DC2626","#0891B2"];
  let html = "";
  (d.l3Areas||[]).forEach((area,i) => {
    const c=colors[i%colors.length];
    html += `<div style="background:white;border:1px solid #E6E1F0;border-radius:14px;overflow:hidden;margin-bottom:12px">
      <div style="background:${c};padding:12px 16px;display:flex;align-items:center;gap:10px">
        <div style="width:30px;height:30px;border-radius:7px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:white">${i+1}</div>
        <div><div style="color:white;font-size:13px;font-weight:700">${_bpdEsc(area.name)}</div><div style="color:rgba(255,255,255,0.8);font-size:10.5px">${_bpdEsc(area.id)} &#183; ${_bpdEsc(area.scopeItem)} &#183; ${_bpdEsc(area.primaryRole)}</div></div>
      </div>
      <div style="padding:14px 16px">
        <p style="font-size:12.5px;color:#6E6494;line-height:1.6;margin-bottom:10px">${_bpdEsc(area.description)}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">${(area.fioriApps||[]).map(app=>`<span style="background:${c}18;color:${c};border-radius:5px;padding:3px 8px;font-size:10.5px;font-weight:600">&#128421; ${_bpdEsc(app)}</span>`).join("")}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          <div style="background:#F0FDF4;border-radius:7px;padding:8px 10px"><div style="font-size:9px;font-weight:600;color:#166534;text-transform:uppercase;margin-bottom:3px">Inputs</div>${(area.inputs||[]).map(inp=>`<div style="font-size:11px;color:#166534">&#8594; ${_bpdEsc(inp)}</div>`).join("")}</div>
          <div style="background:#EFF6FF;border-radius:7px;padding:8px 10px"><div style="font-size:9px;font-weight:600;color:#1E40AF;text-transform:uppercase;margin-bottom:3px">Outputs</div>${(area.outputs||[]).map(out=>`<div style="font-size:11px;color:#1E40AF">&#8592; ${_bpdEsc(out)}</div>`).join("")}</div>
        </div>
        ${area.swimlane ? _bpdSvg(area.swimlane) : ""}
      </div>
    </div>`;
  });
  return html;
}

function _bpdL4Html(d) {
  const colors = ["#3B82F6","#8B5CF6","#059669","#EA580C","#DC2626","#0891B2"];
  let html = "";
  (d.l4Activities||[]).forEach((act,i) => {
    const c=colors[i%colors.length];
    html += `<div style="background:white;border:1px solid #E6E1F0;border-radius:14px;overflow:hidden;margin-bottom:12px">
      <div style="background:linear-gradient(135deg,${c},${c}cc);padding:13px 18px;display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:white">${i+1}</div>
        <div style="flex:1"><div style="color:white;font-size:14px;font-weight:700">${_bpdEsc(act.name)}</div><div style="color:rgba(255,255,255,0.8);font-size:10.5px">${_bpdEsc(act.id)} &#183; ${_bpdEsc(act.scopeItem||act.parentL3)} &#183; ${_bpdEsc(act.role)}</div></div>
        <div style="background:rgba(255,255,255,0.2);border-radius:7px;padding:3px 10px;color:white;font-size:10.5px;font-weight:600">${_bpdEsc(act.fioriApp)}</div>
      </div>
      <div style="padding:15px 18px">
        ${act.preconditions?.length ? `<div style="background:#FFFBEB;border:1px solid #D97706;border-radius:8px;padding:10px 13px;margin-bottom:12px"><div style="font-size:9px;font-weight:600;color:#D97706;text-transform:uppercase;margin-bottom:3px">Preconditions</div>${(act.preconditions||[]).map(pc=>`<div style="font-size:12px;color:#92400E">&#8226; ${_bpdEsc(pc)}</div>`).join("")}</div>` : ""}
        <div style="font-size:9px;font-weight:600;color:#9E96B8;text-transform:uppercase;margin-bottom:8px">Step-by-Step</div>
        <div style="display:flex;flex-direction:column;gap:3px;margin-bottom:14px">
          ${(act.steps||[]).map((step,j)=>{const isSys=/s\/4hana|auto|system/i.test(step);return`<div style="display:flex;gap:0;align-items:stretch"><div style="width:28px;display:flex;flex-direction:column;align-items:center"><div style="width:22px;height:22px;border-radius:5px;background:${isSys?"#F3E5F5":c+"20"};color:${isSys?"#7B1FA2":c};font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center">${j+1}</div></div><div style="flex:1;background:${isSys?"#F3E5F5":"white"};border:1px solid ${isSys?"#9C27B044":"#E6E1F0"};border-radius:7px;padding:6px 11px;margin-left:5px;margin-bottom:2px"><div style="font-size:12px;color:#1B1340;line-height:1.5">${_bpdEsc(step)}</div></div></div>`;}).join("")}
        </div>
        ${act.keyFields?.length ? `<div style="font-size:9px;font-weight:600;color:#9E96B8;text-transform:uppercase;margin-bottom:6px">Key Fields</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px">${(act.keyFields||[]).map(f=>`<div style="background:#F7F5FB;border:1px solid #E6E1F0;border-radius:7px;padding:8px 10px"><div style="font-size:11px;font-weight:600;color:#1B1340">${_bpdEsc(f.label)}</div><div style="font-size:10px;color:#5B2FD4;font-family:monospace">${_bpdEsc(f.odata)}</div><div style="display:flex;justify-content:space-between;margin-top:3px"><span style="font-size:9px;color:#9E96B8">${_bpdEsc(f.entity)}</span><span style="background:${f.mandatory?"#FEF2F2":"#ECFDF3"};color:${f.mandatory?"#DC2626":"#0FA968"};border-radius:3px;padding:0 5px;font-size:9px;font-weight:600">${f.mandatory?"Required":"Optional"}</span></div></div>`).join("")}</div>` : ""}
        ${act.swimlane ? _bpdSvg(act.swimlane) : ""}
      </div>
    </div>`;
  });
  return html;
}

function _bpdL5Html(d) {
  let html = "";
  (d.l5Config||[]).forEach((cfg,i) => {
    html += `<div style="background:white;border:1px solid #E6E1F0;border-radius:12px;overflow:hidden;margin-bottom:10px">
      <div style="background:#EDE7FF;padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #E6E1F0">
        <span style="background:#5B2FD4;color:white;border-radius:5px;padding:3px 8px;font-size:10px;font-weight:700">${_bpdEsc(cfg.id)}</span>
        ${cfg.scopeItem?`<span style="background:#EBF5FF;color:#1565C0;border-radius:5px;padding:2px 8px;font-size:10px;font-weight:600">&#128204; ${_bpdEsc(cfg.scopeItem)}</span>`:""}
        <span style="font-size:13px;font-weight:600;color:#1B1340">${_bpdEsc(cfg.name)}</span>
      </div>
      <div style="padding:12px 14px">
        <div style="display:flex;align-items:center;gap:2px;flex-wrap:wrap;margin-bottom:8px">${(cfg.path||"").split(" > ").map((part,pi,arr)=>`<div style="background:${pi===arr.length-1?"#FFF9C4":"#F7F5FB"};border:1px solid ${pi===arr.length-1?"#F9A825":"#E6E1F0"};border-radius:5px;padding:3px 9px;font-size:10.5px;font-weight:${pi===arr.length-1?700:500};color:${pi===arr.length-1?"#E65100":"#1B1340"}">${_bpdEsc(part)}</div>${pi<arr.length-1?`<span style="font-size:13px;color:#5B2FD4;margin:0 2px">&#8250;</span>`:""}`).join("")}</div>
        <div style="font-size:11.5px;color:#6E6494;margin-bottom:8px">${_bpdEsc(cfg.purpose)}</div>
        ${(cfg.keySettings||[]).map(s=>`<div style="display:flex;gap:0;border-radius:7px;overflow:hidden;border:1px solid #E6E1F0;margin-bottom:5px"><div style="background:#F7F5FB;padding:7px 11px;min-width:120px"><div style="font-size:8.5px;color:#9E96B8;font-weight:600">FIELD</div><div style="font-size:11px;font-weight:600;color:#1B1340">${_bpdEsc(s.field)}</div></div><div style="padding:0 6px;display:flex;align-items:center"><span style="color:#5B2FD4">&#8594;</span></div><div style="background:#FFF9C4;padding:7px 11px;min-width:80px"><div style="font-size:8.5px;color:#92400E;font-weight:600">VALUE</div><div style="font-size:11px;font-weight:700;color:#E65100">${_bpdEsc(s.value)}</div></div><div style="padding:0 6px;display:flex;align-items:center"><span style="color:#0FA968">&#8594;</span></div><div style="flex:1;padding:7px 11px"><div style="font-size:8.5px;color:#9E96B8;font-weight:600">IMPACT</div><div style="font-size:11px;color:#1B1340">${_bpdEsc(s.impact||"")}</div></div></div>`).join("")}
      </div>
    </div>`;
  });
  return html;
}

function _bpdRenderTab(tab) {
  const d = window._bpd.data;
  if (!d) return "<p style='color:#9E96B8'>No data</p>";
  const hdr = (label, count) => `<div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#5B2FD4;text-transform:uppercase;margin:20px 0 10px;border-bottom:2px solid #5B2FD4;padding-bottom:5px">${_bpdEsc(label)}${count!==undefined?` (${count})`:""}</div>`;

  if (tab === "full") {
    let html = _bpdL2Html(d);
    if ((d.l3Areas||[]).length) { html += hdr("L3 — Process Areas", d.l3Areas.length); html += _bpdL3Html(d); }
    if ((d.l4Activities||[]).length) { html += hdr("L4 — Detailed Activities", d.l4Activities.length); html += _bpdL4Html(d); }
    if ((d.l5Config||[]).length) { html += hdr("L5 — Business Configuration", d.l5Config.length); html += _bpdL5Html(d); }
    return html || "<p style='color:#9E96B8'>No data generated</p>";
  }
  if (tab === "overview") return _bpdL2Html(d) || "<p style='color:#9E96B8'>No L2 data</p>";
  if (tab === "l3") {
    if (!(d.l3Areas||[]).length) return "<p style='color:#9E96B8'>No L3 data</p>";
    return hdr("L3 — Process Areas", d.l3Areas.length) + _bpdL3Html(d);
  }
  if (tab === "l4") {
    if (!(d.l4Activities||[]).length) return "<p style='color:#9E96B8'>No L4 data</p>";
    return hdr("L4 — Detailed Activities", d.l4Activities.length) + _bpdL4Html(d);
  }
  if (tab === "l5") {
    if (!(d.l5Config||[]).length) return "<p style='color:#9E96B8'>No L5 data</p>";
    return hdr("L5 — Business Configuration", d.l5Config.length) + _bpdL5Html(d);
  }
  if (tab === "e2e") {
    if (!d.endToEndSwimlane) return "<p style='color:#9E96B8'>E2E swimlane not generated</p>";
    return hdr("E2E — Master Process Swimlane") + _bpdSvg(d.endToEndSwimlane);
  }
  if (tab === "compare") {
    let html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">`;
    html += `<div><div style="background:#E53935;border-radius:8px;padding:8px 14px;color:white;font-weight:700;font-size:12px;margin-bottom:10px">AS-IS: Legacy Process</div>${_bpdSvg(d.asIsSwimlane||{lanes:[]})}</div>`;
    html += `<div><div style="background:#5B2FD4;border-radius:8px;padding:8px 14px;color:white;font-weight:700;font-size:12px;margin-bottom:10px">TO-BE: S/4HANA Public Cloud</div>${_bpdSvg(d.endToEndSwimlane||{lanes:[]})}</div>`;
    html += `</div>`;
    const deltas=[["UI","SAP GUI &#8594; Fiori","#1E88E5"],["Automation","Batch &#8594; Real-time","#7B1FA2"],["Approvals","Email &#8594; Workflow","#2E7D32"],["Integration","RFC &#8594; OData/CPI","#E65100"]];
    html += `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px">${deltas.map(([cat,desc,c])=>`<div style="background:#F8F6FF;border:1px solid #E6E1F0;border-radius:8px;padding:10px;text-align:center"><div style="font-size:11px;font-weight:700;color:${c};margin-bottom:4px">${cat}</div><div style="font-size:11px;color:#9E96B8">${desc}</div></div>`).join("")}</div>`;
    return html;
  }
  if (tab === "fts") {
    const items = d.fts?.assessments || [];
    if (!items.length) return "<p style='color:#9E96B8'>FTS data not generated</p>";
    const fitColors = {FIT:"#0FA968",PARTIAL_FIT:"#D97706",GAP:"#DC2626"};
    const fitBg = {FIT:"#ECFDF3",PARTIAL_FIT:"#FFFBEB",GAP:"#FEF2F2"};
    return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#5B2FD4;color:white">
        <th style="padding:8px 10px;text-align:left">ID</th>
        <th style="padding:8px 10px;text-align:left">Scope Item</th>
        <th style="padding:8px 10px;text-align:left">SAP Standard</th>
        <th style="padding:8px 10px;text-align:left">Client Req</th>
        <th style="padding:8px 10px;text-align:center">Assessment</th>
        <th style="padding:8px 10px;text-align:left">Resolution</th>
        <th style="padding:8px 10px;text-align:center">Effort</th>
      </tr></thead>
      <tbody>${items.map((a,i)=>{const c=fitColors[a.assessment]||"#9E96B8",bg=fitBg[a.assessment]||"#F7F5FB";return`<tr style="background:${i%2?"#F7F5FB":"white"};border-bottom:1px solid #E6E1F0">
        <td style="padding:7px 10px;font-size:10.5px;font-weight:700;color:#5B2FD4">${_bpdEsc(a.id)}</td>
        <td style="padding:7px 10px;font-size:11px">${_bpdEsc(a.scopeItem)}</td>
        <td style="padding:7px 10px;font-size:11px;color:#6E6494">${_bpdEsc(a.standardProcess)}</td>
        <td style="padding:7px 10px;font-size:11px">${_bpdEsc(a.clientRequirement)}</td>
        <td style="padding:7px 10px;text-align:center"><span style="background:${bg};color:${c};border-radius:12px;padding:3px 9px;font-size:10px;font-weight:700">${_bpdEsc(a.assessment)}</span></td>
        <td style="padding:7px 10px;font-size:11px">${_bpdEsc(a.resolution)}</td>
        <td style="padding:7px 10px;text-align:center;font-size:11px;font-weight:700">${_bpdEsc(a.effort)}</td>
      </tr>`}).join("")}</tbody>
    </table></div>`;
  }
  if (tab === "next") {
    const nx = d.next||{};
    let html = "";
    const thStyle = "padding:7px 10px;text-align:left;";
    const tdStyle = "padding:7px 10px;font-size:11px;border-bottom:1px solid #E6E1F0;";
    if ((nx.actionItems||[]).length) {
      html += hdr("Action Items");
      html += `<div style="overflow-x:auto;margin-bottom:20px"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#5B2FD4;color:white"><th style="${thStyle}">ID</th><th style="${thStyle}">Action</th><th style="${thStyle}">Category</th><th style="${thStyle}">Owner</th><th style="${thStyle}">Phase</th><th style="${thStyle}">Priority</th></tr></thead>
        <tbody>${(nx.actionItems||[]).map((a,i)=>{const pc=a.priority==="HIGH"?"#DC2626":a.priority==="MEDIUM"?"#D97706":"#0FA968";return`<tr style="background:${i%2?"#F7F5FB":"white"}"><td style="${tdStyle}font-weight:700;color:#5B2FD4">${_bpdEsc(a.id)}</td><td style="${tdStyle}">${_bpdEsc(a.action)}</td><td style="${tdStyle}color:#6E6494">${_bpdEsc(a.category)}</td><td style="${tdStyle}">${_bpdEsc(a.owner)}</td><td style="${tdStyle}">${_bpdEsc(a.phase)}</td><td style="${tdStyle}text-align:center"><span style="background:${pc}20;color:${pc};border-radius:10px;padding:2px 8px;font-size:10px;font-weight:700">${_bpdEsc(a.priority)}</span></td></tr>`;}).join("")}</tbody>
      </table></div>`;
    }
    if ((nx.risks||[]).length) {
      html += hdr("Risks & Mitigations");
      html += `<div style="overflow-x:auto;margin-bottom:20px"><table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#5B2FD4;color:white"><th style="${thStyle}">ID</th><th style="${thStyle}">Risk</th><th style="${thStyle}text-align:center">Prob</th><th style="${thStyle}text-align:center">Impact</th><th style="${thStyle}">Mitigation</th></tr></thead>
        <tbody>${(nx.risks||[]).map((r,i)=>`<tr style="background:${i%2?"#F7F5FB":"white"}"><td style="${tdStyle}font-weight:700">${_bpdEsc(r.id)}</td><td style="${tdStyle}">${_bpdEsc(r.description)}</td><td style="${tdStyle}text-align:center;font-weight:700;color:#DC2626">${_bpdEsc(r.probability)}</td><td style="${tdStyle}text-align:center;font-weight:700;color:#D97706">${_bpdEsc(r.impact)}</td><td style="${tdStyle}color:#6E6494">${_bpdEsc(r.mitigation)}</td></tr>`).join("")}</tbody>
      </table></div>`;
    }
    if ((nx.signOff||[]).length) {
      html += hdr("Workshop Sign-Off");
      html += `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#5B2FD4;color:white"><th style="${thStyle}">SAP Role</th><th style="${thStyle}">Title</th><th style="${thStyle}">Responsibility</th><th style="${thStyle}">Signature</th><th style="${thStyle}">Date</th></tr></thead>
        <tbody>${(nx.signOff||[]).map((so,i)=>`<tr style="background:${i%2?"#F7F5FB":"white"}"><td style="${tdStyle}font-weight:700;color:#5B2FD4">${_bpdEsc(so.role)}</td><td style="${tdStyle}">${_bpdEsc(so.title)}</td><td style="${tdStyle}">${_bpdEsc(so.responsibility)}</td><td style="${tdStyle};min-width:100px"></td><td style="${tdStyle};min-width:80px"></td></tr>`).join("")}</tbody>
      </table>`;
    }
    return html || "<p style='color:#9E96B8'>Next steps not generated</p>";
  }
  return "<p style='color:#9E96B8'>Select a tab</p>";
}

window.bpdGenerate = async function() {
  const desc = (document.getElementById("bpd-desc")?.value||"").trim();
  const hasScope = (window._bpd.selectedIds||[]).length > 0;
  if (desc.length < 20 && !hasScope) return;
  // Cancel any previous in-flight generation
  if (window._bpd.abortCtrl) window._bpd.abortCtrl.abort();
  window._bpd.abortCtrl = new AbortController();
  const f = window._bpd.form;
  f.description  = desc;
  f.projectName  = document.getElementById("bpd-projectName")?.value||f.projectName;
  f.client       = document.getElementById("bpd-client")?.value||f.client;
  f.module       = document.getElementById("bpd-module")?.value||f.module;
  f.inScope      = document.getElementById("bpd-inScope")?.value||f.inScope;
  f.stakeholders = document.getElementById("bpd-stakeholders")?.value||f.stakeholders;
  f.integrations = document.getElementById("bpd-integrations")?.value||f.integrations;

  document.getElementById("bpd-input-view").style.display="none";
  document.getElementById("bpd-loading-view").style.display="";
  document.getElementById("bpd-result-view").style.display="none";

  // Start elapsed timer
  const _timerEl = document.getElementById("bpd-timer");
  const _timerStart = Date.now();
  if(_timerEl) _timerEl.textContent = "0s";
  const _timerInterval = setInterval(()=>{
    if(!_timerEl) return;
    const s = Math.floor((Date.now()-_timerStart)/1000);
    _timerEl.textContent = s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
  }, 1000);

  // Set phase labels based on path
  const selectedIds = window._bpd.selectedIds || [];
  const _groundedLabels = ["Loading SAP catalog data","Building L2/L3/L4 from real catalog","AI enrichment: Fiori IDs & roles","Creating L5 Business Configuration","Generating process swimlanes","Building E2E master swimlane","Fit-to-Standard assessment","Next Steps & action items","As-Is legacy process"];
  const _aiLabels       = ["Building L2/L3/L4 structure","Mapping scope items & Fiori apps","Generating L5 Business Configuration","Creating swimlane diagrams","Building E2E master swimlane","Fit-to-Standard assessment","Next Steps & action items","As-Is legacy process","Assembling final documentation"];
  const _phLabels = selectedIds.length > 0 ? _groundedLabels : _aiLabels;
  _phLabels.forEach((s,i)=>{ const el=document.getElementById(`bpd-ph-lbl-${i}`); if(el) el.textContent=s; });

  const setProgress = pct => {
    window._bpd.progress = pct;
    const bar=document.getElementById("bpd-prog-bar"), pctEl=document.getElementById("bpd-prog-pct");
    if(bar) bar.style.width=pct+"%";
    if(pctEl) pctEl.textContent=Math.round(pct)+"%";
    for(let i=0;i<9;i++){
      const ph=document.getElementById(`bpd-ph-${i}`),ic=document.getElementById(`bpd-ph-ic-${i}`);
      if(ph) ph.style.opacity=pct>i*11?1:0.25;
      if(ic&&pct>i*11+10){ic.textContent="✓";ic.style.color="#0FA968";}
    }
  };

  async function callAI(prompt, maxTokens) {
    const signal = window._bpd.abortCtrl?.signal;
    const resp = await fetch("/api/bpd/proxy", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,max_tokens:maxTokens||4096}), signal});
    const d = await resp.json();
    if(d.error) throw new Error(d.error);
    if(!resp.ok) throw new Error(d.detail || `Server error ${resp.status}`);
    return (d.content||[]).map(c=>c.text||"").join("");
  }

  const ctx = `Project: ${f.projectName||"SAP Project"} | Client: ${f.client||"Client"} | Module: ${f.module} | In-Scope: ${f.inScope||"All"} | Stakeholders: ${f.stakeholders||"N/A"} | Integrations: ${f.integrations||"None"}`;
  let structure = null;

  if (selectedIds.length > 0) {
    // ── Catalog-grounded path ────────────────────────────────────────────────
    try {
      setProgress(8);
      const ctxResp = await fetch("/api/bpd/catalog-context", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ process_ids: selectedIds, module: f.module })
      });
      const ctxData = await ctxResp.json();
      window._bpd.catalogData = ctxData;
      const procs = ctxData.processes || [];

      const primaryProc = procs[0] || {};
      // Derive KPIs from catalog businessBenefits (take first 5 unique benefits)
      const _allBenefits = procs.flatMap(p => p.businessBenefits || []);
      const _kpis = [...new Set(_allBenefits)].slice(0, 5);
      const l2 = {
        name:        primaryProc.l2 || primaryProc.name || f.module,
        description: primaryProc.overview || f.description,
        kpis:        _kpis,
        scopeItems:  procs.map(p=>`${p.id} - ${p.name}`)
      };

      // L3 — one per selected process (up to 6), each with its own process-specific description
      const l3Areas = procs.slice(0,6).map((p,i)=>({
        id:`L3-00${i+1}`, name:p.name, scopeItem:`${p.id} - ${p.name}`,
        description: p.overview
          ? p.overview
          : `${p.name} process area within ${p.l2 || f.module} — covers ${(p.l4||[]).slice(0,3).join(", ") || "key activities"}.`,
        primaryRole:"SAP_BR_EMPLOYEE",
        fioriApps:[], inputs:[], outputs:[], l4Refs:(p.l4||[]).slice(0,4)
      }));

      // L4 — from catalog l4 arrays
      const l4Activities = [];
      procs.slice(0,4).forEach((p,pi)=>{
        (p.l4||[]).slice(0,3).forEach((l4name,li)=>{
          l4Activities.push({
            id:`L4-${String(pi*3+li+1).padStart(3,"0")}`, parentL3:`L3-00${pi+1}`,
            scopeItem:`${p.id} - ${p.name}`, name:l4name,
            role:"SAP_BR_EMPLOYEE", fioriApp:"See Fiori Launchpad", preconditions:[],
            steps:[`Navigate to ${l4name} in SAP Fiori Launchpad`,"Enter required header data","Add line items","Review and validate","Submit for processing","Confirm completion"],
            keyFields:[]
          });
        });
      });

      structure = { l2, l3Areas, l4Activities, l5Config:[] };
      setProgress(22);

      // AI enrichment: roles, Fiori IDs, L5 config
      const l3List = l3Areas.map(a=>`${a.id}: "${a.name}" — ${a.scopeItem}`).join("\n");
      const l4List = l4Activities.map(a=>`${a.id}: "${a.name}" — parent:${a.parentL3}`).join("\n");
      const raw2 = await callAI(`${_BPD_PC_RULES}

SAP S/4HANA Cloud Public Edition expert. Enrich this pre-built L3/L4 structure with real roles, Fiori IDs, and configuration.
${ctx}
Description: ${f.description.slice(0,400)}

L3 Areas (from SAP catalog):
${l3List}

L4 Activities (from SAP catalog):
${l4List}

KDD Context:
${(ctxData.kddContext||"").slice(0,2000)}

F2S Config Steps:
${(ctxData.f2sContext||"").slice(0,1500)}

Return ONLY valid JSON — no markdown:
{"l3Enriched":[{"id":"L3-001","primaryRole":"SAP_BR_...","description":"Process-level description DIFFERENT from the L2 overview — include specific variant in scope, business role, trigger event, and any ${f.client||"client"}-specific context","fioriApps":["App (F-XXXX)"],"inputs":["Input"],"outputs":["Output"]}],"l4Enriched":[{"id":"L4-001","role":"SAP_BR_...","fioriApp":"App (F-XXXX)","preconditions":["Condition"],"steps":["Step 1 in App (F-XXXX) — note any ${f.client||"client"}-specific requirement here"],"keyFields":[{"label":"","odata":"","entity":"A_Entity","mandatory":true}]}],"l5Config":[{"id":"L5-001","name":"","path":"Business Configuration > Area > Sub-Area","purpose":"","linkedL4":["L4-001"],"keySettings":[{"field":"","value":"","impact":""}]}]}

RULES:
(1) Real SAP_BR roles, real Fiori IDs from KDD context only — never invent F-IDs not in KDD context.
(2) l3Enriched.description MUST be different from the L2 overview — write at the process variant level, mention ${f.client||"client"} and the specific implemented variant.
(3) L4 steps must reference ${f.client||"client"} where a step is client-specific.
(4) 6 steps per L4, 3 keyFields per L4, 6-8 L5 items.
(5) L5 MUST include entries for: (a) any external system integration via SAP Integration Suite CPI, (b) output/forms management, (c) batch job scheduling via Application Jobs (F4234), (d) payment guarantee or financial guarantee procedure if payment processing is in scope, (e) standard document types (sales/purchase/delivery/billing as applicable). Do not limit L5 to only document types — cover all configuration work implied by the scope.
(6) Use consistent SAP_BR role names: SAP_BR_BILLING_SPECIALIST for billing document creation (never SAP_BR_BILLING_CLERK), SAP_BR_SALES_REP for order creation, SAP_BR_SHIPPING_SPECIALIST for delivery. Use the same role name in L3, L4, and everywhere else.`, 4096);
      setProgress(44);
      try {
        const enriched = _bpdSafeJSON(raw2)||{};
        (enriched.l3Enriched||[]).forEach(e=>{
          const a=structure.l3Areas.find(x=>x.id===e.id);
          if(a){a.primaryRole=e.primaryRole||a.primaryRole;if(e.description)a.description=e.description;a.fioriApps=e.fioriApps||[];a.inputs=e.inputs||[];a.outputs=e.outputs||[];}
        });
        (enriched.l4Enriched||[]).forEach(e=>{
          const a=structure.l4Activities.find(x=>x.id===e.id);
          if(a){a.role=e.role||a.role;a.fioriApp=e.fioriApp||a.fioriApp;a.preconditions=e.preconditions||[];a.steps=e.steps||a.steps;a.keyFields=e.keyFields||[];}
        });
        structure.l5Config=Array.isArray(enriched.l5Config)?enriched.l5Config:(enriched.l5Config?.l5Config||[]);
      } catch(_) {}

      // Swimlanes
      setProgress(52);
      const areaList=structure.l3Areas.map(a=>`${a.id}: "${a.name}" — role:${a.primaryRole}, apps:${(a.fioriApps||[]).join(", ")}`).join("\n");
      const firstId=structure.l3Areas[0]?.id||"L3-001";
      const raw3 = await callAI(`SAP S/4HANA Cloud Public Edition BPMN expert. Generate swimlane JSON for each process area.

Process areas:
${areaList}
Module: ${f.module}

Return ONLY a JSON object keyed by area ID. No markdown.

{"${firstId}":{"title":"${firstId}: Name — Scope","lanes":[{"role":"SAP_BR_XXX","steps":[{"type":"S","text":"Opens App (F-ID)"},{"type":"D","text":"Decision?"},{"type":"Y","text":"YES path"},{"type":"N","text":"NO path"}]},{"role":"S/4HANA System","steps":[{"type":"A","text":"Auto check"},{"type":"A","text":"Auto post"}]}]}}

RULES: 2-3 lanes per area, 4-6 steps per lane, S steps must include Fiori app + F-ID, D always followed by Y and N.`, 4096);
      setProgress(70);
      try {
        const sw=_bpdSafeJSON(raw3)||{};
        structure.l3Areas.forEach(a=>{if(sw[a.id])a.swimlane=sw[a.id];});
      } catch(_) {}

      // E2E swimlane
      setProgress(74);
      const e2eAreas=structure.l3Areas.map(a=>`${a.id}: ${a.name} (${a.scopeItem})`).join(", ");
      const raw4 = await callAI(`SAP S/4HANA Cloud Public Edition BPMN expert. Generate ONE end-to-end process swimlane.

E2E Process: ${structure.l2?.name||f.module}
Module: ${f.module} | Areas: ${e2eAreas}

Return ONLY JSON. No markdown.

{"title":"End-to-End: ${structure.l2?.name||f.module}","lanes":[{"role":"SAP_BR_INITIATOR","steps":[{"type":"S","text":"Step in App (F-ID)"},{"type":"D","text":"Decision?"},{"type":"Y","text":"YES"},{"type":"N","text":"NO"}]},{"role":"S/4HANA System","steps":[{"type":"A","text":"Auto action"}]},{"role":"SAP_BR_APPROVER","steps":[{"type":"S","text":"Reviews in App (F-ID)"},{"type":"S","text":"Approves"}]}]}

RULES: 3-4 lanes, 5-7 steps per lane, S steps MUST have Fiori app + F-ID.`, 4096);
      setProgress(86);
      try { structure.endToEndSwimlane=_bpdSafeJSON(raw4); } catch(_) {}

      // Parallel: FTS + Next Steps + As-Is
      setProgress(88);
      const procNames=procs.map(p=>`${p.id}: ${p.name}`).join("; ");
      const [rawFTS,rawNext,rawAsIs] = await Promise.all([
        callAI(`${_BPD_PC_RULES}\n\nFit-to-Standard assessment. Return ONLY JSON.\nProject: ${f.projectName} | Client: ${f.client||"Client"} | Module: ${f.module} | Scope: ${procNames.slice(0,400)}\nF2S: ${(ctxData.f2sContext||"").slice(0,800)}\n\n{"assessments":[{"id":"FTS-001","scopeItem":"Scope item name","description":"What specific capability/config decision is being assessed","standardProcess":"What SAP S/4HANA Cloud PE delivers standard","clientRequirement":"What the client needs","assessment":"FIT","delta":"","resolution":"Accept Standard","configPath":"Business Configuration > Area > Activity","effort":"S","priority":"HIGH","recommendation":"","idealAction":""}]}\n\nSTRICT RULES:\n(1) FIT + Accept Standard → effort MUST be S. Never M/L/XL for a straight FIT.\n(2) PARTIAL_FIT → resolution MUST be Configure, Process Change, Workaround, or Extend-Tier-N. NEVER Accept Standard for PARTIAL_FIT.\n(3) GAP → effort L or XL. Resolution must be Extend-Tier-N or Process Redesign.\n(4) Cover ALL aspects of this ${f.module} process: ${_bpdFtsCoverage(f.module)} — do not focus on just one area.\n(5) 12-15 items minimum. Use actual scope item names from Scope field.\n(6) If a PARTIAL_FIT/Configure item requires activating an ADDITIONAL scope item beyond what is already in Scope (e.g. digital payments requires 1Z1, payment media requires JG1, advanced credit management requires UKM), the delta field MUST state: "Requires activation of scope item [ID] — [name]" and effort should reflect the additional scope item work.`,4096).catch(()=>"{}"),
        callAI(`${_BPD_PC_RULES}\n\nNext steps, risks, sign-off. Return ONLY JSON.\nProject: ${f.projectName} | Module: ${f.module} | Scope: ${procNames.slice(0,300)}\n\n{"actionItems":[{"id":"ACT-001","action":"","category":"Config","owner":"","phase":"Realize","dueWeeks":"Go-live -8w","priority":"HIGH","deliverable":""}],"risks":[{"id":"RISK-001","description":"","probability":"HIGH","impact":"HIGH","mitigation":"","owner":""}],"signOff":[{"role":"SAP_BR_XXX","title":"","responsibility":""}]}\n\n10+ actions, 4+ risks, 5+ signoff.\nFiori app rule: if you reference a Fiori app in an action, you MUST use the exact F-ID that appeared in the L2-L4 structure above. NEVER invent or guess an F-ID. If unsure of the ID, describe the action without an app reference.\nRole rule: sign-off roles MUST match the SAP_BR role names used in L3/L4 above. Use SAP_BR_BILLING_SPECIALIST (not SAP_BR_BILLING_CLERK) for billing, SAP_BR_SALES_REP for order creation, SAP_BR_SHIPPING_SPECIALIST for delivery.`,4096).catch(()=>"{}"),
        callAI(`As-Is (legacy) swimlane BEFORE SAP S/4HANA. Module: ${f.module}. Description: ${f.description.slice(0,400)}.\n\nReturn ONLY JSON.\n{"title":"As-Is: Legacy Process","lanes":[{"role":"End User","steps":[{"type":"S","text":"Manual step"},{"type":"D","text":"Check?"},{"type":"Y","text":"Yes"},{"type":"N","text":"No"}]},{"role":"Legacy System","steps":[{"type":"A","text":"Batch job"}]},{"role":"Manager/Approver","steps":[{"type":"S","text":"Email approval"}]}]}\n\n3 lanes, 4-5 steps per lane, show manual/Excel/email pain points.`,4096).catch(()=>"{}")
      ]);
      setProgress(98);
      if (window._bpd.abortCtrl?.signal.aborted) return; // cancelled during parallel phase
      try { structure.fts=_bpdSafeJSON(rawFTS)||{}; } catch(_) {}
      try { structure.next=_bpdSafeJSON(rawNext)||{}; } catch(_) {}
      try { structure.asIsSwimlane=_bpdSafeJSON(rawAsIs)||{}; } catch(_) {}

    } catch(err) {
      if (err.name === "AbortError") return; // intentional cancel — no banner
      clearInterval(_timerInterval);
      const errBanner=document.getElementById("bpd-error-banner");
      document.getElementById("bpd-loading-view").style.display="none";
      document.getElementById("bpd-input-view").style.display="";
      if(errBanner) errBanner.innerHTML=`<div style="background:#FEF2F2;color:#DC2626;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:13px;font-weight:600">&#9888; Generation failed: ${_bpdEsc(err.message)}</div>`;
      return;
    }

  } else {
    // ── Pure-AI fallback (no scope items selected) ───────────────────────────
    try {
      setProgress(5);
      const raw1 = await callAI(`${_BPD_PC_RULES}

SAP S/4HANA PUBLIC CLOUD Process Architect. Generate L2, L3, and L4 structure as JSON.
${ctx}
Description: ${f.description}

Return ONLY valid JSON — no markdown, no backticks. Start with { end with }.

{"l2":{"name":"","description":"","kpis":[],"scopeItems":["BD9 - Sell from Stock"]},"l3Areas":[{"id":"L3-001","name":"","scopeItem":"BD9 - Sell from Stock","description":"","primaryRole":"SAP_BR_...","fioriApps":["App (F-ID)"],"inputs":[],"outputs":[]}],"l4Activities":[{"id":"L4-001","parentL3":"L3-001","scopeItem":"BD9 - Sell from Stock","name":"","role":"SAP_BR_...","fioriApp":"App (F-ID)","preconditions":[],"steps":["Step 1"],"keyFields":[{"label":"","odata":"","entity":"A_...","mandatory":true}]}]}

RULES: 4 l3Areas, 4 l4Activities, 6+ steps each, 3 keyFields each, real scope item IDs, every Fiori app must include (F-ID).`, 4096);
      setProgress(26);
      structure = _bpdSafeJSON(raw1);
      if(!structure) throw new Error("Could not parse L2/L3/L4 response. Try again.");
      if(!structure.l3Areas) structure.l3Areas=[];
      if(!structure.l4Activities) structure.l4Activities=[];
      structure.l5Config=[];

      setProgress(28);
      const l4ListAI=(structure.l4Activities||[]).map(a=>`${a.id}: ${a.name} (${a.fioriApp||""})`).join(", ");
      const raw2 = await callAI(`${_BPD_PC_RULES}

SAP S/4HANA PUBLIC CLOUD Configuration Expert. Generate L5 Business Configuration items.
Module: ${f.module} | In-Scope: ${f.inScope||"All"}
Description: ${(f.description||"").slice(0,400)}
L4 Activities: ${l4ListAI}

Return ONLY a JSON array — no markdown. Start with [ end with ].

[{"id":"L5-001","name":"","scopeItem":"","path":"Business Configuration > Area > Sub-Area > Activity","purpose":"","linkedL4":["L4-001"],"keySettings":[{"field":"","value":"","impact":""}]}]

RULES: 6 items, every path starts with "Business Configuration >", each item 2-3 keySettings.`, 4096);
      setProgress(50);
      try {
        const l5p=_bpdSafeJSON(raw2);
        structure.l5Config=Array.isArray(l5p)?l5p:(l5p?.l5Config||l5p?.config||[]);
      } catch(_) { structure.l5Config=[]; }

      setProgress(52);
      const areas=[
        ...(structure.l3Areas||[]).map(a=>({id:a.id,name:a.name,role:a.primaryRole,apps:(a.fioriApps||[]).join(", ")})),
        ...(structure.l4Activities||[]).slice(0,4).map(a=>({id:a.id,name:a.name,role:a.role,apps:a.fioriApp||""}))
      ];
      const areaList=areas.map(a=>`${a.id}: "${a.name}" — role: ${a.role}, apps: ${a.apps}`).join("\n");
      const firstId=areas[0]?.id||"L3-001";
      const raw3 = await callAI(`SAP S/4HANA PUBLIC CLOUD BPMN expert. Generate swimlane JSON for each process area.

Process areas:
${areaList}
Module: ${f.module}

Return ONLY a JSON object keyed by area ID. No markdown. Start with { end with }.

{"${firstId}":{"title":"${firstId}: Name — Scope","lanes":[{"role":"SAP_BR_XXX","steps":[{"type":"S","text":"Opens App (F-ID)"},{"type":"D","text":"Decision?"},{"type":"Y","text":"YES path"},{"type":"N","text":"NO path"}]},{"role":"S/4HANA System","steps":[{"type":"A","text":"Auto check"},{"type":"A","text":"Auto post"}]}]}}

RULES: 2-3 lanes, 4-6 steps per lane, S steps must include Fiori app + F-ID, D always followed by Y and N.`, 4096);
      setProgress(74);
      try {
        const sw=_bpdSafeJSON(raw3)||{};
        (structure.l3Areas||[]).forEach(a=>{if(sw[a.id])a.swimlane=sw[a.id];});
        (structure.l4Activities||[]).forEach(a=>{if(sw[a.id])a.swimlane=sw[a.id];});
      } catch(_) {}

      setProgress(76);
      const e2eAreas=(structure.l3Areas||[]).map(a=>`${a.id}: ${a.name} (${a.scopeItem})`).join(", ");
      const raw4 = await callAI(`SAP S/4HANA PUBLIC CLOUD BPMN expert. Generate ONE end-to-end process swimlane.

E2E Process: ${structure.l2?.name||f.module}
Module: ${f.module} | Areas: ${e2eAreas}

Return ONLY JSON. No markdown. Start with { end with }.

{"title":"End-to-End: ${structure.l2?.name||f.module} — Full Happy Path","lanes":[{"role":"SAP_BR_INITIATOR","steps":[{"type":"S","text":"Step in App (F-ID)"},{"type":"D","text":"Decision?"},{"type":"Y","text":"YES"},{"type":"N","text":"NO"}]},{"role":"S/4HANA System","steps":[{"type":"A","text":"Auto action"},{"type":"A","text":"Auto post"}]},{"role":"SAP_BR_APPROVER","steps":[{"type":"S","text":"Reviews in App (F-ID)"},{"type":"S","text":"Approves"}]}]}

RULES: 3-4 lanes, 5-7 steps per lane, S steps MUST have Fiori app + F-ID, 2+ decision points.`, 4096);
      setProgress(89);
      try { structure.endToEndSwimlane=_bpdSafeJSON(raw4); } catch(_) {}

      setProgress(90);
      const [rawFTS,rawNext,rawAsIs] = await Promise.all([
        callAI(`${_BPD_PC_RULES}\n\nFit-to-Standard assessment. Return ONLY JSON.\nProject: ${f.projectName} | Client: ${f.client||"Client"} | Module: ${f.module} | In-Scope: ${f.inScope}\nDescription: ${(f.description||"").slice(0,500)}\n\n{"assessments":[{"id":"FTS-001","scopeItem":"Scope item name","description":"What specific capability/config decision is being assessed","standardProcess":"What SAP Cloud PE delivers standard","clientRequirement":"What the client needs","assessment":"FIT","delta":"","resolution":"Accept Standard","configPath":"Business Configuration > Area > Activity","effort":"S","priority":"HIGH","recommendation":"","idealAction":""}]}\n\nSTRICT RULES:\n(1) FIT + Accept Standard → effort MUST be S.\n(2) PARTIAL_FIT → resolution MUST be Configure, Process Change, Workaround, or Extend-Tier-N. NEVER Accept Standard.\n(3) GAP → effort L or XL.\n(4) Cover ALL aspects of this ${f.module} process: ${_bpdFtsCoverage(f.module)} — do not focus on just one area.\n(5) 12-15 items minimum.\n(6) If a PARTIAL_FIT/Configure item requires activating an ADDITIONAL scope item beyond what is already in scope (e.g. digital payments = 1Z1, payment media = JG1, advanced credit = UKM), the delta field MUST state: "Requires activation of scope item [ID] — [name]" and effort should reflect that additional scope item work.`,4096).catch(()=>"{}"),
        callAI(`${_BPD_PC_RULES}\n\nNext steps, risks, sign-off. Return ONLY JSON.\nProject: ${f.projectName} | Module: ${f.module}\nDescription: ${(f.description||"").slice(0,400)}\n\n{"actionItems":[{"id":"ACT-001","action":"","category":"Config","owner":"","phase":"Realize","dueWeeks":"Go-live -8w","priority":"HIGH","deliverable":""}],"risks":[{"id":"RISK-001","description":"","probability":"HIGH","impact":"HIGH","mitigation":"","owner":""}],"signOff":[{"role":"SAP_BR_XXX","title":"","responsibility":""}]}\n\n10+ actions, 4+ risks, 5+ signoff.\nFiori app rule: if you reference a Fiori app in an action, you MUST use the exact F-ID that appeared in the L2-L4 structure above. NEVER invent or guess an F-ID. If unsure of the ID, describe the action without an app reference.\nRole rule: sign-off roles MUST match the SAP_BR role names used in L3/L4 above. Use SAP_BR_BILLING_SPECIALIST (not SAP_BR_BILLING_CLERK) for billing, SAP_BR_SALES_REP for order creation, SAP_BR_SHIPPING_SPECIALIST for delivery.`,4096).catch(()=>"{}"),
        callAI(`As-Is (legacy) process swimlane BEFORE SAP S/4HANA. Module: ${f.module}. Description: ${(f.description||"").slice(0,400)}.\n\nReturn ONLY JSON. Start with { end with }.\n{"title":"As-Is: Legacy Process","lanes":[{"role":"End User","steps":[{"type":"S","text":"Manual step"},{"type":"D","text":"Check?"},{"type":"Y","text":"Yes"},{"type":"N","text":"No"}]},{"role":"Legacy System","steps":[{"type":"A","text":"Batch job"},{"type":"A","text":"Nightly update"}]},{"role":"Manager/Approver","steps":[{"type":"S","text":"Email approval"},{"type":"S","text":"Manual sign-off"}]}]}\n\n3 lanes, 4-5 steps per lane, reference manual steps/Excel/email pain points.`,4096).catch(()=>"{}")
      ]);
      setProgress(98);
      if (window._bpd.abortCtrl?.signal.aborted) return; // cancelled during parallel phase
      try { structure.fts=_bpdSafeJSON(rawFTS)||{}; } catch(_) {}
      try { structure.next=_bpdSafeJSON(rawNext)||{}; } catch(_) {}
      try { structure.asIsSwimlane=_bpdSafeJSON(rawAsIs)||{}; } catch(_) {}

    } catch(err) {
      if (err.name === "AbortError") return; // intentional cancel — no banner
      clearInterval(_timerInterval);
      const errBanner=document.getElementById("bpd-error-banner");
      document.getElementById("bpd-loading-view").style.display="none";
      document.getElementById("bpd-input-view").style.display="";
      if(errBanner) errBanner.innerHTML=`<div style="background:#FEF2F2;color:#DC2626;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:13px;font-weight:600">&#9888; Generation failed: ${_bpdEsc(err.message)}</div>`;
      return;
    }
  }

  // ── Finalise & render ────────────────────────────────────────────────────────
  clearInterval(_timerInterval);
  setProgress(100);
  window._bpd.data = structure;
  // Persist so all three export formats always use the same generated data
  try {
    localStorage.setItem("bpd_last_data", JSON.stringify(structure));
    localStorage.setItem("bpd_last_form", JSON.stringify(f));
  } catch(e) {
    if (e && (e.name === "QuotaExceededError" || e.code === 22)) {
      // Storage full — save a stripped version without swimlane SVG data
      try {
        const slim = {...structure, endToEndSwimlane:null, asIsSwimlane:null,
          l3Areas:(structure.l3Areas||[]).map(a=>({...a,swimlane:null}))};
        localStorage.setItem("bpd_last_data", JSON.stringify(slim));
        localStorage.setItem("bpd_last_form", JSON.stringify(f));
      } catch(_) {
        console.warn("BPD: localStorage full, session will not persist across page loads");
      }
    }
  }

  const titleEl=document.getElementById("bpd-result-title");
  const subEl=document.getElementById("bpd-result-sub");
  if(titleEl) titleEl.textContent=structure.l2?.name||"Process Documentation";
  if(subEl) subEl.textContent=`${f.projectName||""} · ${f.client||""} · ${f.module}${selectedIds.length>0?" · Grounded":""}`;

  document.getElementById("bpd-loading-view").style.display="none";
  document.getElementById("bpd-result-view").style.display="";

  window._bpd.activeTab="full";
  document.querySelectorAll(".bpd-tab-btn").forEach(btn=>{btn.classList.toggle("active",btn.dataset.tab==="full");});
  const tc=document.getElementById("bpd-tab-content");
  if(tc) tc.innerHTML=_bpdRenderTab("full");
};

function _bpdRawSvg(swimlane) {
  const tmp = document.createElement("div");
  tmp.innerHTML = _bpdSvg(swimlane);
  const el = tmp.querySelector("svg");
  if (!el) return "";
  // Preserve viewBox aspect ratio: set width=100%, height from viewBox
  const vb = (el.getAttribute("viewBox") || "").split(/\s+/);
  const vbW = parseFloat(vb[2]) || 1200;
  const vbH = parseFloat(vb[3]) || 400;
  // aspect ratio as CSS padding-bottom trick ensures correct height on print
  el.setAttribute("width","100%");
  el.setAttribute("height","auto");
  el.style.display = "block";
  el.style.maxWidth = "100%";
  // Wrap in a div that enforces aspect ratio so print doesn't collapse the height
  const aspectPct = (vbH / vbW * 100).toFixed(2);
  return `<div style="position:relative;width:100%;padding-bottom:${aspectPct}%;overflow:hidden"><div style="position:absolute;top:0;left:0;width:100%;height:100%">${el.outerHTML}</div></div>`;
}

window.bpdExportPDF = function() {
  const d = window._bpd.data, f = window._bpd.form;
  if (!d) { alert("No data. Generate first."); return; }
  const now = new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});
  const ACC = "#5B2FD4", esc = _bpdEsc;

  const h2 = (t,c) => `<h2 style="color:${c||ACC};border-bottom:2px solid ${c||ACC};padding-bottom:5px;margin:28px 0 10px;font-family:Georgia,serif;font-size:15pt">${esc(t)}</h2>`;
  const tbl = (headers, rows, colStyle) => {
    let s=`<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>`;
    rows.forEach((r,i)=>{ s+=`<tr>${r.map((c,ci)=>`<td style="${colStyle?.[ci]||""}">${c}</td>`).join("")}</tr>`; });
    return s+`</tbody></table>`;
  };

  let body = `
  <!DOCTYPE html><html><head><meta charset="utf-8">
  <title>${esc(f.projectName||"BPD")} — SAP BPD</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Calibri,Arial,sans-serif;font-size:10.5pt;color:#1B1340;line-height:1.55}
    @page{margin:14mm 16mm;size:A4 landscape}
    @media print{.pb{page-break-before:always}.nb{page-break-inside:avoid}}
    .cover{background:linear-gradient(135deg,#460073,#A100FF);color:#fff;padding:55px 44px 44px;margin-bottom:28px}
    .cover h1{font-size:26pt;font-family:Georgia,serif;margin-bottom:10px}
    .cover .sub{font-size:13pt;opacity:.88;margin-bottom:6px}
    .cover .meta{font-size:10pt;opacity:.7;margin-top:16px}
    h2{color:${ACC};border-bottom:2px solid ${ACC};padding-bottom:5px;margin:28px 0 10px;font-family:Georgia,serif;font-size:14pt}
    h3{color:${ACC};font-size:11pt;margin:14px 0 4px}
    p{margin-bottom:7px}
    .muted{color:#6E6494;font-size:9.5pt}
    table{width:100%;border-collapse:collapse;margin:10px 0;font-size:9pt}
    th{background:${ACC};color:#fff;padding:6px 8px;text-align:left;font-size:8.5pt}
    td{padding:5px 8px;border:1px solid #E6E1F0;vertical-align:top}
    tr:nth-child(even) td{background:#F8F6FF}
    ol{padding-left:20px;margin:8px 0}li{margin-bottom:3px}
    .kpi{display:inline-block;background:#EDE8FF;color:${ACC};border-radius:4px;padding:2px 9px;font-size:9pt;font-weight:600;margin:2px}
    .tag{display:inline-block;background:#F0EBFF;color:${ACC};border-radius:4px;padding:1px 7px;font-size:8.5pt;margin:2px}
    .fit{color:#0FA968;font-weight:700}.gap{color:#DC2626;font-weight:700}.partial{color:#D97706;font-weight:700}
    svg{display:block;width:100%;height:auto;margin:12px 0}
    .swimlane-section{margin:16px 0}
    .sw-title{background:#263238;color:#80CBC4;font-size:9pt;font-weight:700;padding:4px 10px;border-radius:6px 6px 0 0}
    .sw-wrap{border:1.5px solid #90A4AE;border-radius:0 0 6px 6px;overflow:hidden}
  </style></head><body>`;

  // Cover
  body += `<div class="cover">
    <div style="font-size:8pt;letter-spacing:3px;font-weight:700;opacity:.75;margin-bottom:14px">ACCENTURE SAP PRACTICE</div>
    <h1>${esc(f.projectName||"SAP Workshop")}</h1>
    <div class="sub">SAP S/4HANA Public Cloud — Business Process Documentation</div>
    <div class="meta">${esc(f.client||"")} &nbsp;·&nbsp; ${esc(f.module)} &nbsp;·&nbsp; ${now}</div>
  </div>`;

  // Process Requirement (uploaded/entered description)
  if (f.description && f.description.trim()) {
    body += `<div class="nb" style="margin-bottom:20px">`;
    body += `<h2 style="color:${ACC};border-bottom:2px solid ${ACC};padding-bottom:5px;margin:0 0 12px;font-family:Georgia,serif;font-size:14pt">Process Requirement</h2>`;
    body += `<p class="muted" style="margin-bottom:8px">Client requirement document — source context used to generate this BPD</p>`;
    body += `<div style="white-space:pre-wrap;background:#F8F6FF;border-left:4px solid ${ACC};padding:14px 18px;border-radius:0 8px 8px 0;font-size:10pt;line-height:1.7;color:#1B1340">${esc(f.description.trim())}</div>`;
    body += `</div>`;
  }

  // Selected Scope Items from catalog
  const _catData = window._bpd?.catalogData;
  const _catProcs = _catData?.processes || [];
  if (_catProcs.length > 0) {
    body += `<div class="nb" style="margin-bottom:20px">`;
    body += `<h2 style="color:${ACC};border-bottom:2px solid ${ACC};padding-bottom:5px;margin:0 0 12px;font-family:Georgia,serif;font-size:14pt">Scope Items Selected</h2>`;
    body += `<table><thead><tr><th>ID</th><th>Process Name</th><th>L1 (LOB)</th><th>L2 (Area)</th></tr></thead><tbody>`;
    body += _catProcs.map((p,i) => `<tr><td style="font-weight:700;color:${ACC};width:70px">${esc(p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.l1)}</td><td>${esc(p.l2)}</td></tr>`).join("");
    body += `</tbody></table>`;
    if (_catData.f2sContext) {
      body += `<p class="muted" style="margin-top:8px;font-size:9pt">✓ Grounded with SAP F2S catalog context · ${_catProcs.length} process${_catProcs.length!==1?"es":""} from scope-catalog-f2s.json</p>`;
    }
    body += `</div>`;
  }

  // L2
  if(d.l2){
    body+=h2("L2: "+d.l2.name);
    body+=`<p>${esc(d.l2.description)}</p>`;
    if(d.l2.scopeItems?.length) body+=`<p><strong>Scope Items:</strong> ${d.l2.scopeItems.map(s=>`<span class="tag">${esc(s)}</span>`).join(" ")}</p>`;
    if(d.l2.kpis?.length) body+=`<p>${d.l2.kpis.map(k=>`<span class="kpi">${esc(k)}</span>`).join(" ")}</p>`;
  }

  // L3 areas — each with its own swimlane if available
  (d.l3Areas||[]).forEach(a=>{
    body+=`<div class="nb">`;
    body+=h2("L3: "+a.name);
    body+=`<p class="muted">${esc(a.id)} &middot; ${esc(a.scopeItem)} &middot; ${esc(a.primaryRole)}</p>`;
    body+=`<p>${esc(a.description)}</p>`;
    if(a.fioriApps?.length) body+=`<p><strong>Fiori Apps:</strong> ${a.fioriApps.map(x=>`<span class="tag">${esc(x)}</span>`).join(" ")}</p>`;
    if(a.inputs?.length) body+=`<p><strong>Inputs:</strong> ${a.inputs.map(esc).join(" &nbsp;|&nbsp; ")}</p>`;
    if(a.outputs?.length) body+=`<p><strong>Outputs:</strong> ${a.outputs.map(esc).join(" &nbsp;|&nbsp; ")}</p>`;
    if(a.swimlane?.lanes?.length){
      body+=`<div class="swimlane-section"><div class="sw-title">BPMN 2.0 — Process Swimlane</div><div class="sw-wrap">${_bpdRawSvg(a.swimlane)}</div></div>`;
    }
    body+=`</div>`;
  });

  // L4 activities
  body+=`<div class="pb">`;
  (d.l4Activities||[]).forEach(a=>{
    body+=`<div class="nb">`;
    body+=h2("L4: "+a.name);
    body+=`<p class="muted">${esc(a.id)} &middot; ${esc(a.fioriApp)} &middot; ${esc(a.role)}</p>`;
    if(a.preconditions?.length) body+=`<p><strong>Preconditions:</strong> ${a.preconditions.map(esc).join("; ")}</p>`;
    body+=`<ol>${(a.steps||[]).map(s=>`<li>${esc(s)}</li>`).join("")}</ol>`;
    if(a.keyFields?.length){
      body+=tbl(["Field","OData Property","Mandatory"],
        a.keyFields.map(kf=>[esc(kf.label),esc(kf.odata),kf.mandatory?"Yes":"No"]),
        ["font-weight:700","font-family:monospace;font-size:8pt","text-align:center"]);
    }
    body+=`</div>`;
  });
  body+=`</div>`;

  // L5
  if((d.l5Config||[]).length){
    body+=`<div class="pb">`;
    body+=h2("L5: Business Configuration");
    body+=tbl(["ID","Name","Configuration Path","Purpose"],
      d.l5Config.map(c=>[`<strong style="color:${ACC}">${esc(c.id)}</strong>`,esc(c.name),`<span style="color:#6E6494;font-size:8.5pt">${esc(c.path)}</span>`,esc(c.purpose)]),
      ["width:60px","","",""]
    );
    body+=`</div>`;
  }

  // E2E Swimlane — raw SVG renders perfectly in browser PDF
  if(d.endToEndSwimlane?.lanes?.length){
    body+=`<div class="pb">`;
    body+=h2("E2E Process Swimlane: "+(d.endToEndSwimlane.title||"End-to-End Process"));
    body+=`<p class="muted">BPMN 2.0 — roles, steps, Fiori applications, decision points</p>`;
    body+=`<div class="sw-wrap">${_bpdRawSvg(d.endToEndSwimlane)}</div>`;
    body+=`</div>`;
  }

  // As-Is
  if(d.asIsSwimlane?.lanes?.length){
    body+=`<div class="pb">`;
    body+=`<h2 style="color:#B71C1C;border-color:#B71C1C;font-family:Georgia,serif;font-size:14pt;padding-bottom:5px;margin:28px 0 10px">As-Is: Legacy Process</h2>`;
    body+=`<p class="muted">Current state before SAP S/4HANA Cloud — showing manual steps, system pain points</p>`;
    body+=`<div class="sw-wrap">${_bpdRawSvg(d.asIsSwimlane)}</div>`;
    body+=`</div>`;
  }

  // FTS
  if(d.fts?.assessments?.length){
    body+=`<div class="pb">`;
    body+=h2("Fit-to-Standard Assessment");
    const fitColor=a=>a==="FIT"?"#0FA968":a==="GAP"?"#DC2626":"#D97706";
    const fitBg=a=>a==="FIT"?"#ECFDF3":a==="GAP"?"#FEF2F2":"#FFFBEB";
    body+=tbl(
      ["ID","Scope Item","SAP Standard","Client Requirement","Assessment","Resolution","Effort","Recommendation"],
      d.fts.assessments.map(a=>[
        `<strong style="color:${ACC}">${esc(a.id)}</strong>`,
        esc(a.scopeItem||a.description||""),
        `<span style="color:#6E6494;font-size:8.5pt">${esc(a.standardProcess||"")}</span>`,
        esc(a.clientRequirement||""),
        `<span style="background:${fitBg(a.assessment)};color:${fitColor(a.assessment)};border-radius:10px;padding:2px 8px;font-weight:700;font-size:8pt">${esc(a.assessment)}</span>`,
        esc(a.resolution),
        `<strong>${esc(a.effort)}</strong>`,
        `<span style="font-size:8.5pt;color:#374151">${esc(a.recommendation||a.idealAction||"")}</span>`
      ]),
      ["width:55px","","","","text-align:center;width:90px","","text-align:center;width:40px",""]
    );
    body+=`</div>`;
  }

  // Next Steps
  const nx=d.next||{};
  if((nx.actionItems||[]).length){
    body+=`<div class="pb">`;
    body+=h2("Next Steps: Action Items");
    const pc=p=>p==="HIGH"?"#DC2626":p==="MEDIUM"?"#D97706":"#0FA968";
    body+=tbl(["ID","Action","Category","Owner","Phase","Priority"],
      nx.actionItems.map(a=>[
        `<strong style="color:${ACC}">${esc(a.id)}</strong>`,
        esc(a.action),esc(a.category),esc(a.owner),esc(a.phase),
        `<strong style="color:${pc(a.priority)}">${esc(a.priority)}</strong>`
      ]));
    body+=`</div>`;
  }
  if((nx.risks||[]).length){
    body+=h2("Risks & Mitigations");
    body+=tbl(["ID","Risk","Probability","Impact","Mitigation"],
      nx.risks.map(r=>[
        `<strong>${esc(r.id)}</strong>`,
        esc(r.description),
        `<strong style="color:#DC2626">${esc(r.probability)}</strong>`,
        `<strong style="color:#D97706">${esc(r.impact)}</strong>`,
        esc(r.mitigation)
      ]));
  }
  if((nx.signOff||[]).length){
    body+=h2("Workshop Sign-Off");
    body+=tbl(["SAP Role","Title","Responsibility","Signature","Date"],
      nx.signOff.map(so=>[
        `<strong style="color:${ACC}">${esc(so.role)}</strong>`,
        esc(so.title),esc(so.responsibility),"&nbsp;","&nbsp;"
      ]));
  }

  body+=`</body></html>`;

  const win=window.open("","_blank","width=1200,height=900");
  if(!win){alert("Please allow pop-ups for this page, then try again.");return;}
  win.document.write(body);
  win.document.close();
  win.addEventListener("load",()=>{ win.focus(); win.print(); });
};

window.bpdDownloadWord = function() {
  const d = window._bpd.data, f = window._bpd.form;
  if (!d) return;
  const now = new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});
  const ACC="#5B2FD4";
  let body=`<h1 style="color:${ACC}">${_bpdEsc(f.projectName||"SAP Workshop")} &#8212; L2-L5 Process Documentation</h1>`;
  body+=`<p style="color:#6E6494;font-size:10pt">${_bpdEsc(f.client)} &#183; ${_bpdEsc(f.module)} &#183; SAP S/4HANA Public Cloud &#183; ${now}</p><hr/>`;
  // Process Requirement
  if(f.description&&f.description.trim()){
    body+=`<h2 style="color:${ACC}">Process Requirement</h2>`;
    body+=`<p style="color:#6E6494;font-size:9.5pt;margin-bottom:6pt">Client requirement document — source context used to generate this BPD</p>`;
    body+=`<div style="white-space:pre-wrap;background:#F8F6FF;border-left:4px solid ${ACC};padding:10pt 14pt;font-size:10pt;line-height:1.7">${_bpdEsc(f.description.trim())}</div><br/>`;
  }
  // Scope items from catalog
  const _wCat=(window._bpd?.catalogData?.processes||[]);
  if(_wCat.length>0){
    body+=`<h2 style="color:${ACC}">Scope Items Selected</h2>`;
    body+=`<table border="1" style="border-collapse:collapse;width:100%;font-size:10pt"><tr style="background:${ACC};color:white"><th>ID</th><th>Process Name</th><th>LOB</th><th>Area</th></tr>`;
    body+=_wCat.map(p=>`<tr><td style="font-weight:700;color:#5B2FD4;padding:4px 8px">${_bpdEsc(p.id)}</td><td style="padding:4px 8px">${_bpdEsc(p.name)}</td><td style="padding:4px 8px">${_bpdEsc(p.l1)}</td><td style="padding:4px 8px">${_bpdEsc(p.l2)}</td></tr>`).join("");
    body+=`</table><br/>`;
  }
  // L2
  if(d.l2){body+=`<h2 style="color:${ACC}">L2: ${_bpdEsc(d.l2.name)}</h2><p>${_bpdEsc(d.l2.description)}</p>`;if(d.l2.scopeItems?.length)body+=`<p><b>Scope Items:</b> ${d.l2.scopeItems.map(_bpdEsc).join(" | ")}</p>`;if(d.l2.kpis?.length)body+=`<p><b>KPIs:</b> ${d.l2.kpis.map(_bpdEsc).join(" | ")}</p>`;}
  // L3
  (d.l3Areas||[]).forEach(a=>{body+=`<h2 style="color:${ACC}">L3: ${_bpdEsc(a.name)}</h2><p><b>${_bpdEsc(a.id)}</b> &middot; ${_bpdEsc(a.scopeItem)} &middot; ${_bpdEsc(a.primaryRole)}</p><p>${_bpdEsc(a.description)}</p>`;if(a.fioriApps?.length)body+=`<p><b>Fiori Apps:</b> ${a.fioriApps.map(_bpdEsc).join(", ")}</p>`;if(a.inputs?.length)body+=`<p><b>Inputs:</b> ${a.inputs.map(_bpdEsc).join(" | ")}</p>`;if(a.outputs?.length)body+=`<p><b>Outputs:</b> ${a.outputs.map(_bpdEsc).join(" | ")}</p>`;});
  // L4
  (d.l4Activities||[]).forEach(a=>{body+=`<h2 style="color:${ACC}">L4: ${_bpdEsc(a.name)}</h2><p><b>${_bpdEsc(a.id)}</b> &middot; ${_bpdEsc(a.fioriApp)} &middot; ${_bpdEsc(a.role)}</p>`;if(a.preconditions?.length)body+=`<p><b>Preconditions:</b> ${a.preconditions.map(_bpdEsc).join("; ")}</p>`;body+=`<ol>${(a.steps||[]).map(s=>`<li>${_bpdEsc(s)}</li>`).join("")}</ol>`;if(a.keyFields?.length)body+=`<table border="1" style="border-collapse:collapse;font-size:9pt;margin-bottom:8pt"><tr style="background:${ACC};color:white"><th>Field</th><th>OData</th><th>Mandatory</th></tr>${a.keyFields.map(kf=>`<tr><td>${_bpdEsc(kf.label)}</td><td>${_bpdEsc(kf.odata)}</td><td>${kf.mandatory?"Yes":"No"}</td></tr>`).join("")}</table>`;});
  // L5
  if((d.l5Config||[]).length){body+=`<h2 style="color:${ACC}">L5: Business Configuration</h2><table border="1" style="border-collapse:collapse;width:100%;font-size:10pt"><tr style="background:${ACC};color:white"><th>ID</th><th>Name</th><th>Configuration Path</th><th>Purpose</th></tr>${(d.l5Config||[]).map(c=>`<tr><td style="font-weight:700;color:#5B2FD4">${_bpdEsc(c.id)}</td><td>${_bpdEsc(c.name)}</td><td style="color:#6E6494;font-size:9pt">${_bpdEsc(c.path)}</td><td>${_bpdEsc(c.purpose)}</td></tr>`).join("")}</table>`;}
  // E2E Swimlane — rendered as lane-by-lane step table
  if(d.endToEndSwimlane?.lanes?.length){body+=`<h2 style="color:${ACC}">E2E Swimlane: ${_bpdEsc(d.endToEndSwimlane.title||"End-to-End Process")}</h2><table border="1" style="border-collapse:collapse;width:100%;font-size:9pt">`;body+=`<tr style="background:${ACC};color:white">${(d.endToEndSwimlane.lanes||[]).map(l=>`<th style="padding:5px 8px">${_bpdEsc(l.role||l.name)}</th>`).join("")}</tr>`;const maxSteps=Math.max(...(d.endToEndSwimlane.lanes||[]).map(l=>(l.steps||[]).length));for(let si=0;si<maxSteps;si++){body+=`<tr>${(d.endToEndSwimlane.lanes||[]).map(l=>{const st=(l.steps||[])[si];return st?`<td style="padding:4px 8px;vertical-align:top">${_bpdEsc(st.text||"")}</td>`:`<td></td>`}).join("")}</tr>`;}body+=`</table>`;}
  // As-Is vs To-Be
  if(d.asIsSwimlane?.lanes?.length){body+=`<h2 style="color:${ACC}">As-Is: Legacy Process</h2><table border="1" style="border-collapse:collapse;width:100%;font-size:9pt"><tr style="background:#B71C1C;color:white">${(d.asIsSwimlane.lanes||[]).map(l=>`<th style="padding:5px 8px">${_bpdEsc(l.role||l.name)}</th>`).join("")}</tr>`;const maxAS=Math.max(...(d.asIsSwimlane.lanes||[]).map(l=>(l.steps||[]).length));for(let si=0;si<maxAS;si++){body+=`<tr>${(d.asIsSwimlane.lanes||[]).map(l=>{const st=(l.steps||[])[si];return st?`<td style="padding:4px 8px;vertical-align:top">${_bpdEsc(st.text||"")}</td>`:`<td></td>`}).join("")}</tr>`;}body+=`</table>`;}
  // FTS
  if(d.fts?.assessments?.length){body+=`<h2 style="color:${ACC}">Fit-to-Standard Assessment</h2><table border="1" style="border-collapse:collapse;width:100%;font-size:9pt"><tr style="background:${ACC};color:white"><th>ID</th><th>Scope Item</th><th>SAP Standard</th><th>Client Requirement</th><th>Assessment</th><th>Resolution</th><th>Effort</th><th>Recommendation</th></tr>${(d.fts.assessments||[]).map(a=>`<tr><td style="font-weight:700;color:#5B2FD4;padding:4px 6px">${_bpdEsc(a.id)}</td><td style="padding:4px 6px">${_bpdEsc(a.scopeItem||a.description||"")}</td><td style="padding:4px 6px;color:#6E6494;font-size:8.5pt">${_bpdEsc(a.standardProcess||"")}</td><td style="padding:4px 6px">${_bpdEsc(a.clientRequirement||"")}</td><td style="padding:4px 6px;font-weight:700;color:${a.assessment==="FIT"?"#0FA968":a.assessment==="GAP"?"#DC2626":"#D97706"}">${_bpdEsc(a.assessment)}</td><td style="padding:4px 6px">${_bpdEsc(a.resolution)}</td><td style="padding:4px 6px;font-weight:700">${_bpdEsc(a.effort)}</td><td style="padding:4px 6px;font-size:8.5pt">${_bpdEsc(a.recommendation||a.idealAction||"")}</td></tr>`).join("")}</table>`;}
  // Next Steps
  const nx=d.next||{};
  if((nx.actionItems||[]).length){body+=`<h2 style="color:${ACC}">Next Steps: Action Items</h2><table border="1" style="border-collapse:collapse;width:100%;font-size:10pt"><tr style="background:${ACC};color:white"><th>ID</th><th>Action</th><th>Category</th><th>Owner</th><th>Phase</th><th>Priority</th></tr>${(nx.actionItems||[]).map(a=>`<tr><td style="font-weight:700;color:#5B2FD4">${_bpdEsc(a.id)}</td><td>${_bpdEsc(a.action)}</td><td>${_bpdEsc(a.category)}</td><td>${_bpdEsc(a.owner)}</td><td>${_bpdEsc(a.phase)}</td><td style="font-weight:700;color:${a.priority==="HIGH"?"#DC2626":a.priority==="MEDIUM"?"#D97706":"#0FA968"}">${_bpdEsc(a.priority)}</td></tr>`).join("")}</table>`;}
  if((nx.risks||[]).length){body+=`<h2 style="color:${ACC}">Risks &amp; Mitigations</h2><table border="1" style="border-collapse:collapse;width:100%;font-size:10pt"><tr style="background:${ACC};color:white"><th>ID</th><th>Risk</th><th>Probability</th><th>Impact</th><th>Mitigation</th></tr>${(nx.risks||[]).map(r=>`<tr><td style="font-weight:700">${_bpdEsc(r.id)}</td><td>${_bpdEsc(r.description)}</td><td>${_bpdEsc(r.probability)}</td><td>${_bpdEsc(r.impact)}</td><td>${_bpdEsc(r.mitigation)}</td></tr>`).join("")}</table>`;}
  if((nx.signOff||[]).length){body+=`<h2 style="color:${ACC}">Workshop Sign-Off</h2><table border="1" style="border-collapse:collapse;width:100%;font-size:10pt"><tr style="background:${ACC};color:white"><th>SAP Role</th><th>Title</th><th>Responsibility</th><th>Signature</th><th>Date</th></tr>${(nx.signOff||[]).map(so=>`<tr><td style="font-weight:700;color:#5B2FD4">${_bpdEsc(so.role)}</td><td>${_bpdEsc(so.title)}</td><td>${_bpdEsc(so.responsibility)}</td><td style="min-width:120px">&nbsp;</td><td style="min-width:80px">&nbsp;</td></tr>`).join("")}</table>`;}
  const blob=new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:Calibri,sans-serif;font-size:11pt;color:#1B1340">${body}</body></html>`],{type:"application/msword"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${(f.projectName||"SAP").replace(/\s+/g,"-")}_L2-L5_${new Date().toISOString().slice(0,10)}.doc`;document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(()=>URL.revokeObjectURL(a.href),2000);
};

function _bpdSvgToDataUrl(swimlane) {
  return new Promise(resolve => {
    try {
      const tmp = document.createElement("div");
      tmp.style.cssText = "position:absolute;left:-9999px;top:-9999px";
      document.body.appendChild(tmp);
      tmp.innerHTML = _bpdSvg(swimlane);
      const svgEl = tmp.querySelector("svg");
      if (!svgEl) { document.body.removeChild(tmp); resolve(null); return; }
      const vb = svgEl.getAttribute("viewBox")||"";
      const parts = vb.split(/\s+/);
      // Always derive from viewBox — getAttribute("width") returns "100%" which parseInt() truncates to 100
      const W = Math.round(parseFloat(parts[2]) || 1200);
      const H = Math.round(parseFloat(parts[3]) || 400);
      svgEl.setAttribute("width", W); svgEl.setAttribute("height", H);
      const svgStr = new XMLSerializer().serializeToString(svgEl);
      document.body.removeChild(tmp);
      // base64 data URL is more reliable than blob URL for canvas cross-origin restrictions
      const b64 = btoa(unescape(encodeURIComponent(svgStr)));
      const dataUrl = "data:image/svg+xml;base64," + b64;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width=W; c.height=H;
        const ctx = c.getContext("2d");
        ctx.fillStyle="#FFFFFF"; ctx.fillRect(0,0,W,H);
        ctx.drawImage(img,0,0,W,H);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch(_) { resolve(null); }
  });
}

window.bpdExportPPTX = function() {
  const tryBuild=()=>{ _bpdBuildPPTX().catch(e=>alert("PPT Error: "+e.message)); };
  if(window.PptxGenJS){tryBuild();return;}
  const CDNS=[
    "/js/pptxgen.bundle.js",
    "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js",
    "https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js",
    "https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js",
  ];
  let idx=0;
  function tryNext(){
    if(idx>=CDNS.length){alert("Cannot load PowerPoint library. Try Word export instead.");return;}
    const s=document.createElement("script");
    s.src=CDNS[idx++];
    s.onload=()=>setTimeout(()=>{if(window.PptxGenJS)tryBuild();else tryNext();},300);
    s.onerror=()=>tryNext();
    document.head.appendChild(s);
  }
  tryNext();
};

async function _bpdBuildPPTX() {
  const d=window._bpd.data, f=window._bpd.form;
  if(!d){alert("No data. Generate first.");return;}
  const pres=new window.PptxGenJS();
  pres.layout="LAYOUT_16x9";
  pres.author="Accenture SAP Practice";
  pres.title=(f.projectName||"Workshop")+" - SAP BPD";

  // ── Design tokens matching the UI ───────────────────────────────────────────
  const P="5B2FD4",    // accent purple (#5B2FD4)
        PD="460073",   // dark purple (header gradient start)
        PA="A100FF",   // bright purple (header gradient end)
        W="FFFFFF",
        BK="1B1340",   // dark ink
        MU="6E6494",   // muted
        LV="F0EBFF",   // lavender light bg
        GN="0FA968",   // green
        RD="DC2626",   // red
        AM="D97706",   // amber
        now=new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"});

  // Shared: add purple gradient header bar + title
  function hdr(sl, title, sub) {
    sl.background = {color:W};
    // gradient bar at top: two overlapping rects to fake gradient
    sl.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:10,h:0.72,fill:{color:PD}});
    sl.addShape(pres.shapes.RECTANGLE,{x:5,y:0,w:5,h:0.72,fill:{color:PA},transparency:50});
    sl.addText(title,{x:0.35,y:0.06,w:9.3,h:0.38,fontSize:17,fontFace:"Calibri",color:W,bold:true,margin:0});
    if(sub) sl.addText(sub,{x:0.35,y:0.44,w:9.3,h:0.25,fontSize:9,fontFace:"Calibri",color:"D0B0FF",margin:0});
    // bottom accent line
    sl.addShape(pres.shapes.RECTANGLE,{x:0,y:0.72,w:10,h:0.03,fill:{color:P}});
  }

  // Shared: build a purple-header table header row
  const th = (txt,extra={}) => ({text:txt, options:{bold:true,color:W,fill:{color:P},fontSize:8,fontFace:"Calibri",valign:"middle",...extra}});
  const td = (txt,opts={}) => ({text:String(txt||"").slice(0,120), options:{fontSize:8,fontFace:"Calibri",valign:"top",...opts}});

  // ── Slide 1: Title ──────────────────────────────────────────────────────────
  const s1=pres.addSlide();
  s1.background={color:PD};
  s1.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:10,h:5.625,fill:{color:PA},transparency:75});
  s1.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:0.1,h:5.625,fill:{color:PA}});
  s1.addText("ACCENTURE SAP PRACTICE",{x:0.5,y:0.55,w:7,h:0.3,fontSize:8.5,fontFace:"Calibri",color:"D0B0FF",bold:true,charSpacing:3,margin:0});
  s1.addText(f.projectName||"SAP Workshop",{x:0.5,y:1.05,w:8.5,h:1.1,fontSize:34,fontFace:"Calibri",color:W,bold:true,margin:0});
  s1.addText("Business Process Documentation\nSAP S/4HANA Cloud Public Edition — L2 / L3 / L4 / L5",{x:0.5,y:2.25,w:8.5,h:0.75,fontSize:13,fontFace:"Calibri",color:"E0C8FF",margin:0});
  s1.addText([
    {text:f.client||"",options:{fontSize:11,color:"D0B0FF",fontFace:"Calibri"}},
    {text:"   ·   ",options:{fontSize:11,color:"6040A0",fontFace:"Calibri"}},
    {text:f.module||"",options:{fontSize:11,color:"D0B0FF",fontFace:"Calibri"}},
    {text:"   ·   ",options:{fontSize:11,color:"6040A0",fontFace:"Calibri"}},
    {text:now,options:{fontSize:11,color:"9060C0",fontFace:"Calibri"}},
  ],{x:0.5,y:3.2,w:8.5,h:0.4});
  s1.addShape(pres.shapes.RECTANGLE,{x:0,y:5.2,w:10,h:0.425,fill:{color:"0D0520"}});
  s1.addText("BPMN 2.0  ·  Clean Core Compliant  ·  SAP Fiori Apps  ·  SAP Activate",{x:0.5,y:5.25,w:9,h:0.3,fontSize:8,fontFace:"Calibri",color:"6040A0"});

  // ── Slide 2: Process Requirement ────────────────────────────────────────────
  if(f.description&&f.description.trim()){
    const sl=pres.addSlide();
    hdr(sl,"Process Requirement","Client requirement — source context grounding this documentation");
    const descText=f.description.trim().slice(0,1200);
    sl.addText(descText,{x:0.4,y:0.85,w:9.2,h:4.3,fontSize:10,fontFace:"Calibri",color:BK,valign:"top",paraSpaceAfter:4,wrap:true});
    // sidebar tag
    sl.addShape(pres.shapes.RECTANGLE,{x:0,y:0.75,w:0.08,h:4.5,fill:{color:P}});
    // scope items selected
    const _cp=(window._bpd?.catalogData?.processes||[]);
    if(_cp.length>0){
      const scopeText=_cp.map(p=>`${p.id} — ${p.name}`).join("   |   ");
      sl.addText("Scope Items: "+scopeText.slice(0,200),{x:0.4,y:5.1,w:9.2,h:0.35,fontSize:8.5,fontFace:"Calibri",color:MU,italic:true});
    }
  }

  // ── Slide 3: L2 Overview ────────────────────────────────────────────────────
  if(d.l2){
    const sl=pres.addSlide();
    hdr(sl,"L2 — "+(d.l2.name||"End-to-End Process"),"Process overview · scope items · KPIs");
    // Description — hard-capped so it never bleeds into sections below
    const l2desc=(d.l2.description||"").slice(0,280);
    sl.addText(l2desc,{x:0.4,y:0.85,w:9.2,h:0.75,fontSize:9.5,fontFace:"Calibri",color:BK,valign:"top",wrap:true});
    // Scope items — rendered as a table row (cells, no shape+text overlap risk)
    const sItems=(d.l2.scopeItems||[]).slice(0,6);
    if(sItems.length){
      sl.addText("SCOPE ITEMS",{x:0.4,y:1.67,w:9.2,h:0.22,fontSize:7.5,fontFace:"Calibri",color:MU,bold:true,charSpacing:1});
      const siRow=sItems.map(si=>({text:si.slice(0,30),options:{bold:true,color:P,fill:{color:LV},fontSize:8.5,fontFace:"Calibri",border:[{pt:1,color:P},{pt:1,color:P},{pt:1,color:P},{pt:1,color:P}],margin:4}}));
      // Pad to 6 cells
      while(siRow.length<6) siRow.push({text:"",options:{fill:{color:W},border:[{pt:0,color:W}]}});
      sl.addTable([siRow],{x:0.4,y:1.9,w:9.2,h:0.38,colW:[1.53,1.53,1.54,1.53,1.53,1.54],border:{pt:0,color:W}});
    }
    // KPIs — vertical list below scope items
    const kpis=(d.l2.kpis||[]).slice(0,5);
    if(kpis.length){
      sl.addText("KEY PERFORMANCE INDICATORS",{x:0.4,y:2.38,w:9.2,h:0.22,fontSize:7.5,fontFace:"Calibri",color:MU,bold:true,charSpacing:1});
      kpis.forEach((k,i)=>{
        sl.addText("✓  "+k.slice(0,90),{x:0.4,y:2.62+i*0.38,w:9.2,h:0.36,fontSize:9.5,fontFace:"Calibri",color:BK,valign:"middle"});
      });
    }
  }

  // ── L3 Slides — info left, swimlane right ───────────────────────────────────
  for(const area of (d.l3Areas||[])){
    const sl=pres.addSlide();
    hdr(sl,"L3 — "+area.name, area.id+" · "+area.scopeItem);
    // Left panel (info)
    sl.addShape(pres.shapes.RECTANGLE,{x:0,y:0.75,w:0.06,h:4.6,fill:{color:P}});
    const l3desc=(area.description||"").slice(0,200);
    sl.addText(l3desc,{x:0.35,y:0.82,w:4.3,h:0.72,fontSize:9,fontFace:"Calibri",color:BK,valign:"top",wrap:true});
    // Role — single table cell (no shape+text layering)
    if(area.primaryRole){
      sl.addTable([[{text:"▶  "+area.primaryRole.slice(0,50),options:{bold:true,color:P,fill:{color:LV},fontSize:8.5,fontFace:"Calibri",margin:5}}]],{x:0.35,y:1.58,w:4.3,h:0.32,border:{pt:1,color:P}});
    }
    // Fiori Apps
    if((area.fioriApps||[]).length){
      sl.addText("FIORI APPS",{x:0.35,y:2.0,w:4.0,h:0.22,fontSize:7.5,fontFace:"Calibri",color:MU,bold:true,charSpacing:1});
      area.fioriApps.slice(0,4).forEach((a,i)=>{
        sl.addText("◈ "+a.slice(0,45),{x:0.35,y:2.22+i*0.3,w:4.2,h:0.28,fontSize:8.5,fontFace:"Calibri",color:BK});
      });
    }
    // Inputs / Outputs
    const ioY=(area.fioriApps||[]).length>0?3.45:2.1;
    if((area.inputs||[]).length){
      sl.addText("IN: "+(area.inputs||[]).slice(0,3).join("  ·  ").slice(0,70),{x:0.35,y:ioY,w:4.2,h:0.28,fontSize:8.5,fontFace:"Calibri",color:"076652"});
    }
    if((area.outputs||[]).length){
      sl.addText("OUT: "+(area.outputs||[]).slice(0,3).join("  ·  ").slice(0,70),{x:0.35,y:ioY+0.3,w:4.2,h:0.28,fontSize:8.5,fontFace:"Calibri",color:"7C3AED"});
    }
    // Divider
    sl.addShape(pres.shapes.RECTANGLE,{x:4.65,y:0.75,w:0.02,h:4.55,fill:{color:"E6E1F0"}});
    // Right panel: swimlane PNG or placeholder
    if(area.swimlane?.lanes?.length){
      const png=await _bpdSvgToDataUrl(area.swimlane);
      if(png){
        sl.addImage({data:png,x:4.72,y:0.82,w:5.05,h:4.4});
      } else {
        sl.addText("Swimlane: "+area.name,{x:4.75,y:2.5,w:4.9,h:0.5,fontSize:11,fontFace:"Calibri",color:MU,align:"center"});
      }
    } else {
      sl.addText("No swimlane generated for this area",{x:4.75,y:2.7,w:4.9,h:0.5,fontSize:10,fontFace:"Calibri",color:MU,align:"center",italic:true});
    }
  }

  // ── L4 Activity Slides ──────────────────────────────────────────────────────
  for(const act of (d.l4Activities||[])){
    const sl=pres.addSlide();
    hdr(sl,"L4 — "+act.name, act.id+" · "+act.role+" · "+act.fioriApp);
    sl.addShape(pres.shapes.RECTANGLE,{x:0,y:0.75,w:0.06,h:4.6,fill:{color:"7C3AED"}});
    const steps=(act.steps||[]);
    const half=Math.ceil(steps.length/2);
    const col1=steps.slice(0,half), col2=steps.slice(half);
    col1.forEach((s,i)=>{
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:0.35,y:0.85+i*0.65,w:0.35,h:0.35,fill:{color:P},rounding:0.15});
      sl.addText(String(i+1),{x:0.35,y:0.87+i*0.65,w:0.35,h:0.31,fontSize:10,fontFace:"Calibri",color:W,bold:true,align:"center",valign:"middle"});
      sl.addText(s.slice(0,90),{x:0.77,y:0.85+i*0.65,w:4.2,h:0.55,fontSize:9,fontFace:"Calibri",color:BK,valign:"top",wrap:true});
    });
    col2.forEach((s,i)=>{
      sl.addShape(pres.shapes.ROUNDED_RECTANGLE,{x:5.2,y:0.85+i*0.65,w:0.35,h:0.35,fill:{color:P},rounding:0.15});
      sl.addText(String(half+i+1),{x:5.2,y:0.87+i*0.65,w:0.35,h:0.31,fontSize:10,fontFace:"Calibri",color:W,bold:true,align:"center",valign:"middle"});
      sl.addText(s.slice(0,90),{x:5.62,y:0.85+i*0.65,w:4.0,h:0.55,fontSize:9,fontFace:"Calibri",color:BK,valign:"top",wrap:true});
    });
    // Key fields table if present
    if((act.keyFields||[]).length){
      const kfY=0.85+Math.max(col1.length,col2.length)*0.65;
      if(kfY<4.6){
        const kfRows=[[th("Field"),th("OData Property"),th("Mandatory")]];
        act.keyFields.slice(0,4).forEach((kf,i)=>{const f2={color:i%2?"F8F6FF":W};kfRows.push([td(kf.label,{fill:f2,bold:true}),td(kf.odata,{fill:f2,color:MU}),td(kf.mandatory?"Yes":"No",{fill:f2,align:"center"})]);});
        sl.addTable(kfRows,{x:0.35,y:kfY,w:9.3,colW:[3.2,4.5,1.6],border:{pt:0.5,color:"E6E1F0"},autoPage:false});
      }
    }
  }

  // ── L5 Business Configuration ───────────────────────────────────────────────
  if((d.l5Config||[]).length){
    const sl=pres.addSlide();
    hdr(sl,"L5 — Business Configuration",(d.l5Config.length)+" configuration items");
    const rows=[[th("ID"),th("Name"),th("Configuration Path"),th("Purpose"),th("Key Setting")]];
    (d.l5Config||[]).forEach((c,i)=>{
      const f2={color:i%2?"F8F6FF":W};
      const ks=(c.keySettings||[]).map(s=>s.field+": "+s.value).join(" · ").slice(0,80);
      rows.push([td(c.id,{bold:true,color:P,fill:f2}),td(c.name,{fill:f2}),td(c.path,{color:MU,fill:f2}),td(c.purpose,{fill:f2}),td(ks,{color:MU,fill:f2})]);
    });
    sl.addTable(rows,{x:0.3,y:0.85,w:9.4,colW:[0.55,1.7,2.6,2.7,2.35],border:{pt:0.5,color:"E6E1F0"},autoPage:true});
  }

  // ── E2E Process Swimlane ────────────────────────────────────────────────────
  if(d.endToEndSwimlane?.lanes?.length){
    const sl=pres.addSlide();
    hdr(sl,"End-to-End Process Swimlane: "+(d.endToEndSwimlane.title||"E2E"),"BPMN 2.0 — roles, steps, Fiori apps, decision points");
    const png=await _bpdSvgToDataUrl(d.endToEndSwimlane);
    if(png) sl.addImage({data:png,x:0.15,y:0.82,w:9.7,h:4.5});
    else sl.addText("Open in browser for swimlane visual",{x:0.5,y:2.8,w:9,fontSize:12,fontFace:"Calibri",color:MU,align:"center"});
  }

  // ── As-Is Legacy Process ────────────────────────────────────────────────────
  if(d.asIsSwimlane?.lanes?.length){
    const sl=pres.addSlide();
    hdr(sl,"As-Is: Legacy Process","Before SAP S/4HANA Cloud PE — manual steps, system pain points");
    sl.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:10,h:0.72,fill:{color:"7B1818"}});
    sl.addText("As-Is: Legacy Process",{x:0.35,y:0.06,w:9.3,h:0.38,fontSize:17,fontFace:"Calibri",color:W,bold:true,margin:0});
    sl.addText("Before SAP S/4HANA Cloud PE — manual steps, system pain points",{x:0.35,y:0.44,w:9.3,h:0.25,fontSize:9,fontFace:"Calibri",color:"FFAAAA",margin:0});
    sl.addShape(pres.shapes.RECTANGLE,{x:0,y:0.72,w:10,h:0.03,fill:{color:"DC2626"}});
    const png=await _bpdSvgToDataUrl(d.asIsSwimlane);
    if(png) sl.addImage({data:png,x:0.15,y:0.82,w:9.7,h:4.5});
  }

  // ── Fit-to-Standard Assessment ──────────────────────────────────────────────
  if((d.fts?.assessments||[]).length){
    const sl=pres.addSlide();
    hdr(sl,"Fit-to-Standard Assessment",(d.fts.assessments.length)+" items · FIT / PARTIAL_FIT / GAP");
    const rows=[[th("ID"),th("Scope Item"),th("Assessment"),th("Resolution"),th("Effort"),th("Recommendation")]];
    (d.fts.assessments||[]).forEach((a,i)=>{
      const f2={color:i%2?"F8F6FF":W};
      const ac=a.assessment==="FIT"?GN:a.assessment==="GAP"?RD:AM;
      rows.push([
        td(a.id,{bold:true,color:P,fill:f2}),
        td(a.scopeItem||a.description||"",{fill:f2}),
        td(a.assessment||"",{bold:true,color:ac,fill:f2}),
        td(a.resolution||"",{fill:f2}),
        td(a.effort||"",{bold:true,align:"center",fill:f2}),
        td((a.recommendation||a.idealAction||"").slice(0,90),{color:MU,fill:f2}),
      ]);
    });
    sl.addTable(rows,{x:0.3,y:0.85,w:9.4,colW:[0.55,1.6,1.0,1.6,0.5,4.15],border:{pt:0.5,color:"E6E1F0"},autoPage:true});
  }

  // ── Next Steps — Action Items ────────────────────────────────────────────────
  const nx=d.next||{};
  if((nx.actionItems||[]).length){
    const sl=pres.addSlide();
    hdr(sl,"Next Steps — Action Items",(nx.actionItems.length)+" actions · "+now);
    const rows=[[th("ID"),th("Action"),th("Category"),th("Owner"),th("Phase"),th("Priority")]];
    (nx.actionItems||[]).forEach((a,i)=>{
      const f2={color:i%2?"F8F6FF":W};
      const pc=a.priority==="HIGH"?RD:a.priority==="MEDIUM"?AM:GN;
      rows.push([td(a.id,{bold:true,color:P,fill:f2}),td(a.action,{fill:f2}),td(a.category,{color:MU,fill:f2}),td(a.owner,{fill:f2}),td(a.phase,{fill:f2}),td(a.priority,{bold:true,color:pc,fill:f2,align:"center"})]);
    });
    sl.addTable(rows,{x:0.3,y:0.85,w:9.4,colW:[0.55,3.4,1.1,1.3,1.05,0.9],border:{pt:0.5,color:"E6E1F0"},autoPage:true});
  }

  // ── Risks & Mitigations ──────────────────────────────────────────────────────
  if((nx.risks||[]).length){
    const sl=pres.addSlide();
    hdr(sl,"Risks & Mitigations",(nx.risks.length)+" risks identified");
    const rows=[[th("ID"),th("Risk"),th("Probability"),th("Impact"),th("Mitigation"),th("Owner")]];
    (nx.risks||[]).forEach((r,i)=>{
      const f2={color:i%2?"F8F6FF":W};
      rows.push([td(r.id,{bold:true,fill:f2}),td(r.description,{fill:f2}),td(r.probability,{bold:true,color:RD,fill:f2,align:"center"}),td(r.impact,{bold:true,color:AM,fill:f2,align:"center"}),td(r.mitigation,{fill:f2}),td(r.owner,{color:MU,fill:f2})]);
    });
    sl.addTable(rows,{x:0.3,y:0.85,w:9.4,colW:[0.5,2.5,0.9,0.75,3.8,0.95],border:{pt:0.5,color:"E6E1F0"},autoPage:true});
  }

  // ── Workshop Sign-Off ────────────────────────────────────────────────────────
  if((nx.signOff||[]).length){
    const sl=pres.addSlide();
    hdr(sl,"Workshop Sign-Off","Stakeholder approval · "+f.projectName);
    const rows=[[th("SAP Role"),th("Title"),th("Responsibility"),th("Signature",""),th("Date","")]];
    (nx.signOff||[]).forEach((so,i)=>{
      const f2={color:i%2?"F8F6FF":W};
      rows.push([td(so.role,{bold:true,color:P,fill:f2}),td(so.title,{fill:f2}),td(so.responsibility,{fill:f2}),td("",{fill:f2}),td("",{fill:f2})]);
    });
    sl.addTable(rows,{x:0.3,y:0.85,w:9.4,colW:[2.1,1.6,3.4,1.4,0.9],border:{pt:0.5,color:"E6E1F0"},autoPage:true});
  }

  // ── Closing Slide ────────────────────────────────────────────────────────────
  const sc=pres.addSlide();
  sc.background={color:PD};
  sc.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:10,h:5.625,fill:{color:PA},transparency:75});
  sc.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:0.1,h:5.625,fill:{color:PA}});
  sc.addText("Thank You",{x:0.5,y:1.5,w:9,h:1.1,fontSize:40,fontFace:"Calibri",color:W,bold:true,margin:0});
  sc.addText((f.projectName||"")+" · "+(f.client||"")+" · "+f.module,{x:0.5,y:2.85,w:9,h:0.5,fontSize:14,fontFace:"Calibri",color:"D0B0FF"});
  sc.addText("SAP S/4HANA Cloud Public Edition · Business Process Documentation · Clean Core · "+now,{x:0.5,y:3.55,w:9,h:0.4,fontSize:9.5,fontFace:"Calibri",color:"9060C0"});
  sc.addShape(pres.shapes.RECTANGLE,{x:0,y:5.2,w:10,h:0.425,fill:{color:"0D0520"}});
  sc.addText("Accenture SAP Practice · Confidential",{x:0.5,y:5.25,w:9,h:0.3,fontSize:8,fontFace:"Calibri",color:"6040A0",align:"center"});

  pres.writeFile({fileName:(f.projectName||"Workshop").replace(/\s+/g,"-")+"_BPD.pptx"}).catch(e=>alert("Error saving PPTX: "+e.message));
}
