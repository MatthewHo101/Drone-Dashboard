"use strict";

const sections = {
  builds: { title: "Builds", singular: "build", description: "Track airframes and the revisions that went into testing.",
    statuses: ["Design", "Assembly", "Ready", "Retired"], date: "Build date" },
  tests: { title: "Tests", singular: "test", description: "Record bench and flight results against the exact build.",
    statuses: ["Planned", "Passed", "Failed", "Inconclusive"], date: "Test date" },
  issues: { title: "Issues", singular: "issue", description: "Assign fixes and keep the next action visible.",
    statuses: ["Open", "In progress", "Blocked", "Done"], date: "Due date" },
  parts: { title: "Parts", singular: "part", description: "See what needs ordering and what is due to arrive.",
    statuses: ["Needed", "Ordered", "Received"], date: "Expected arrival" },
};
const workspace = document.querySelector("#workspace");
const dialog = document.querySelector("#record-dialog");
const dialogContent = document.querySelector("#dialog-content");
const announcement = document.querySelector("#announcement");
let state;
let filter = "";
let lastHash = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
const safe = escapeHtml;

function today() {
  const current = new Date();
  return [current.getFullYear(), current.getMonth() + 1, current.getDate()]
    .map((part) => String(part).padStart(2, "0")).join("-");
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(value + "T00:00:00")) : "—";
}

function badge(status) {
  const tone = {
    Ready: "green", Passed: "green", Done: "green", Received: "green",
    Blocked: "red", Failed: "red", Ordered: "amber", Assembly: "amber", "In progress": "blue",
  }[status] || "neutral";
  return '<span class="badge ' + tone + '">' + safe(status) + '</span>';
}

function recordLink(record) {
  return "#" + record.kind + "/" + record.id;
}

function records(kind) {
  return state.records.filter((record) => record.kind === kind);
}

function getRecord(id) {
  return state.records.find((record) => record.id === id);
}

function buildLabel(record) {
  return record ? record.details.airframe + " · " + record.details.revision : "";
}

function rowHint(record) {
  if (record.kind === "builds") return buildLabel(record);
  if (record.kind === "tests") return [record.details.test_type, buildLabel(getRecord(record.build_id))].join(" · ");
  if (record.kind === "issues") return record.details.next_action;
  return record.details.supplier;
}

function list(items, empty, columns = false) {
  if (!items.length) return '<p class="empty">' + safe(empty) + '</p>';
  const heading = columns ? '<div class="list-head"><span>Record</span><span>Owner</span><span>Date</span><span>Status</span></div>' : "";
  return heading + items.map((record) => (
    '<a class="record-row ' + (columns ? "columns" : "") + '" href="' + recordLink(record) + '">' +
    '<span class="row-title"><strong>' + safe(record.title) + '</strong><small>' + safe(rowHint(record)) + '</small></span>' +
    (columns ? '<span class="row-owner">' + safe(record.owner) + '</span><span class="row-date">' + safe(formatDate(record.record_date)) + '</span>' : "") +
    badge(record.status) + '<span class="chevron" aria-hidden="true">›</span></a>'
  )).join("");
}

function panel(title, kind, items, empty) {
  return '<section class="panel"><div class="panel-head"><h2>' + safe(title) + '</h2><a href="#' + kind +
    '">View ' + kind + ' <span aria-hidden="true">↗</span></a></div>' + list(items, empty) + '</section>';
}

function overview() {
  const builds = records("builds").filter((record) => record.status !== "Retired");
  const issues = records("issues").filter((record) => record.status !== "Done");
  const urgent = issues.filter((record) => record.status === "Blocked" || (record.record_date && record.record_date < today()));
  const planned = records("tests").filter((record) => record.status === "Planned")
    .sort((a, b) => a.record_date.localeCompare(b.record_date));
  const recent = records("tests").filter((record) => record.status !== "Planned")
    .sort((a, b) => b.record_date.localeCompare(a.record_date));
  const ordered = records("parts").filter((record) => record.status === "Ordered");
  const metrics = [
    ["builds", "Active builds", builds.length, "◇"],
    ["tests", "Planned tests", planned.length, "⌁"],
    ["issues", "Open issues", issues.length, "◎"],
    ["parts", "Parts on order", ordered.length, "▤"],
  ];
  return '<header class="intro"><div><h1>Development overview</h1><p>Build progress, test results, and the work that moves them forward.</p></div>' +
    '<button class="primary" data-new="tests">+ Log a test</button></header>' +
    '<div class="metrics">' + metrics.map(([kind, label, count, icon]) => (
      '<a class="metric" href="#' + kind + '"><span class="metric-icon" aria-hidden="true">' + icon +
      '</span><span class="metric-label">' + label + '</span><strong>' + count + '</strong><span class="metric-arrow" aria-hidden="true">↗</span></a>'
    )).join("") + '</div>' +
    '<div class="panel-grid">' + panel("Needs attention", "issues", urgent, "No blocked or overdue issues.") +
    panel("Recent test results", "tests", recent.slice(0, 4), "Completed test results will appear here.") +
    panel("Active builds", "builds", builds.slice(0, 4), "Add a build to start recording tests.") +
    panel("Upcoming tests", "tests", planned.slice(0, 4), "No tests planned.") + '</div>';
}

function section(kind) {
  const config = sections[kind];
  const items = records(kind).filter((record) => !filter || record.status === filter);
  const button = kind === "tests" ? "+ Log a test" : "+ Add " + config.singular;
  return '<header class="intro"><div><h1>' + config.title + '</h1><p>' + config.description + '</p></div>' +
    '<button class="primary" data-new="' + kind + '">' + button + '</button></header>' +
    '<section class="panel"><div class="panel-head"><h2>Records <span class="count">' + items.length + '</span></h2>' +
    '<label class="filter">Status <select id="status-filter">' + options(["", ...config.statuses], filter, "All statuses") +
    '</select></label></div>' + list(items, "No records match this view.", true) + '</section>';
}

function options(values, selected, emptyLabel = "Select…") {
  return values.map((entry) => {
    const [value, label] = Array.isArray(entry) ? entry : [entry, entry || emptyLabel];
    return '<option value="' + safe(value) + '"' + (String(value) === String(selected ?? "") ? " selected" : "") + '>' + safe(label) + '</option>';
  }).join("");
}

function field(name, label, value, { type = "text", required = false, max = 140, choices, wide = false } = {}) {
  const attrs = ' name="' + name + '"' + (required ? " required" : "");
  let input;
  if (choices) input = "<select" + attrs + ">" + options(choices, value) + "</select>";
  else if (type === "textarea") input = "<textarea" + attrs + ' maxlength="' + max + '">' + safe(value) + "</textarea>";
  else input = "<input" + attrs + ' type="' + type + '" maxlength="' + max + '" value="' + safe(value) + '">';
  return '<label class="' + (wide ? "wide" : "") + '">' + label + input + "</label>";
}

function formFields(kind, record) {
  const details = record.details || {};
  const config = sections[kind];
  const buildChoices = ["", ...records("builds").map((build) => [build.id, build.title + " · " + buildLabel(build)])];
  let fields =
    field("title", "Title", record.title, { required: true, wide: true }) +
    field("status", "Status", record.status, { choices: config.statuses, required: true }) +
    field("owner", "Owner", record.owner || state.actor, { choices: state.users, required: true }) +
    field("record_date", config.date, record.record_date ?? (kind === "tests" ? today() : ""), { type: "date", required: kind === "tests" });
  if (kind !== "builds") {
    fields += field("build_id", "Build revision", record.build_id, { choices: buildChoices, required: kind === "tests" });
  }
  if (kind === "builds") {
    fields += field("airframe", "Airframe ID", details.airframe, { max: 80, required: true }) +
      field("revision", "Revision", details.revision, { max: 40, required: true }) +
      field("firmware", "Firmware revision", details.firmware, { max: 200, wide: true });
  }
  if (kind === "tests") {
    fields += field("test_type", "Test type", details.test_type, { choices: ["Bench", "Flight"], required: true }) +
      field("expected", "Objective and expected result", details.expected, { type: "textarea", max: 2000, required: true, wide: true }) +
      field("actual", "Actual result", details.actual, { type: "textarea", max: 2000, wide: true });
  }
  if (kind === "issues") {
    fields += field("project", "Project", details.project, { max: 100 }) + field("test_id", "Linked test", record.test_id, {
      choices: ["", ...records("tests").map((test) => [test.id, test.title + " · " + buildLabel(getRecord(test.build_id))])],
    }) + field("next_action", "Next action", details.next_action, { max: 300, wide: true });
  } else {
    const label = { builds: "CAD, parts list, or revision notes link", tests: "Logs or photos link", parts: "Product or order link" }[kind];
    if (kind === "parts") fields += field("supplier", "Supplier", details.supplier, { max: 100, wide: true });
    fields += field("link", label, details.link, { type: "url", max: 600, wide: true });
  }
  return fields + field("notes", kind === "builds" ? "Configuration and changes" : "Notes", record.notes,
    { type: "textarea", max: 2000, wide: true });
}

function showDialog(title, content, label = "") {
  dialogContent.innerHTML = '<div class="dialog-head"><div>' +
    (label ? '<p class="dialog-label">' + safe(label) + '</p>' : "") +
    '<h2 id="dialog-title">' + safe(title) + '</h2></div>' +
    '<button type="button" class="close" data-close aria-label="Close">×</button></div>' + content;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("[data-close]").focus();
}

function editor(kind, record = {}) {
  showDialog((record.id ? "Edit " : "New ") + sections[kind].singular,
    '<form id="record-form"><div class="form-grid">' + formFields(kind, record) + '</div>' +
    '<p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" data-cancel>Cancel</button>' +
    '<button class="primary" type="submit">Save ' + sections[kind].singular + '</button></div></form>');
  const form = dialog.querySelector("form");
  form.querySelector('[name="title"]').focus();
  if (kind === "issues") {
    form.elements.test_id.addEventListener("change", () => {
      const test = getRecord(Number(form.elements.test_id.value));
      if (test) form.elements.build_id.value = test.build_id;
    });
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    for (const key of ["build_id", "test_id"]) {
      if (data[key]) data[key] = Number(data[key]);
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    form.querySelector(".form-error").textContent = "";
    try {
      const result = await request(record.id ? "/api/records/" + record.id : "/api/records", {
        method: record.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "X-Fieldbench": "1" },
        body: JSON.stringify({ ...data, kind, updated_at: record.updated_at }),
      });
      const index = state.records.findIndex((item) => item.id === result.id);
      if (index < 0) state.records.unshift(result);
      else state.records[index] = result;
      announcement.textContent = "Saved " + result.title + ".";
      if (location.hash === recordLink(result)) render();
      else location.hash = recordLink(result);
    } catch (error) {
      form.querySelector(".form-error").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function detail(record) {
  const config = sections[record.kind];
  const build = getRecord(record.build_id);
  const test = getRecord(record.test_id);
  const linked = (item, label) => item ?
    '<a href="' + recordLink(item) + '">' + safe(label || item.title) + '</a>' : "";
  const item = (label, value) => value ? '<div class="detail-item"><dt>' + label + '</dt><dd>' + value + '</dd></div>' : "";
  const labels = {
    airframe: "Airframe ID", revision: "Revision", firmware: "Firmware",
    test_type: "Test type", expected: "Objective and expected result", actual: "Actual result",
    project: "Project", next_action: "Next action", supplier: "Supplier",
  };
  const children = state.records.filter((candidate) =>
    record.kind === "builds" && candidate.build_id === record.id ||
    record.kind === "tests" && candidate.test_id === record.id);
  showDialog(record.title,
    '<dl class="details">' + item("Status", badge(record.status)) + item("Owner", safe(record.owner)) +
    item(config.date, record.record_date ? safe(formatDate(record.record_date)) : "") +
    item("Build", linked(build, build ? build.title + " · " + buildLabel(build) : "")) + item("Test", linked(test)) +
    Object.entries(labels).map(([key, label]) => item(label, safe(record.details[key]))).join("") +
    item("Notes", safe(record.notes)) +
    item("Reference", record.details.link ?
      '<a href="' + safe(record.details.link) + '" target="_blank" rel="noopener noreferrer">Open reference ↗</a>' : "") +
    item("Last updated by", safe(record.updated_by)) + '</dl>' +
    (children.length ? '<section class="related"><h3>Linked records</h3>' + list(children, "") + '</section>' : "") +
    '<div class="dialog-actions"><button class="secondary" data-share="' + record.id + '">Share</button>' +
    (record.kind === "tests" ? '<button class="secondary" data-followup="' + record.id + '">Create follow-up issue</button>' : "") +
    '<button class="primary" data-edit="' + record.id + '">Edit ' + config.singular + '</button></div>',
    config.singular + " #" + record.id);
}

function shareRecord(record) {
  const url = new URL(recordLink(record), location.href).href;
  const text = record.title + " [" + record.status + "]\nOwner: " + record.owner + "\n" + url;
  showDialog("Share record",
    '<label class="share-label">Message<textarea id="share-text" readonly>' + safe(text) + '</textarea></label>' +
    '<p class="share-note">Recipients need access to this workspace to open the link.</p>' +
    '<div class="dialog-actions"><button class="secondary" data-copy>Copy message</button>' +
    '<a class="primary" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=' +
    encodeURIComponent(text) + '">Open WhatsApp ↗</a></div>');
  dialog.querySelector("[data-copy]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const textarea = dialog.querySelector("#share-text");
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      textarea.focus();
      textarea.select();
      button.textContent = "Text selected";
    }
  });
}

function route() {
  const [sectionName, id] = location.hash.slice(1).split("/");
  return { kind: Object.hasOwn(sections, sectionName) ? sectionName : "overview", id: Number(id) || null };
}

function render() {
  const { kind, id } = route();
  if (kind !== lastHash) filter = "";
  lastHash = kind;
  document.querySelectorAll("nav a").forEach((link) => {
    if (link.getAttribute("href") === "#" + kind) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  workspace.innerHTML = kind === "overview" ? overview() : section(kind);
  if (id) {
    const record = getRecord(id);
    if (record?.kind === kind) detail(record);
    else showDialog("Record unavailable", '<p class="empty">This record could not be found.</p>');
  } else if (dialog.open) {
    dialog.close();
  }
}

function dismiss() {
  const { kind, id } = route();
  dialog.close();
  if (id) location.hash = "#" + kind;
}

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The workspace request failed.");
  return data;
}

workspace.addEventListener("change", (event) => {
  if (event.target.id === "status-filter") {
    filter = event.target.value;
    render();
    workspace.querySelector("#status-filter").focus();
  }
});

workspace.addEventListener("click", (event) => {
  const button = event.target.closest("[data-new]");
  if (!button) return;
  const kind = button.dataset.new;
  if (kind === "tests" && !records("builds").length) {
    showDialog("Add a build first", '<p class="empty">Every test is linked to a build revision.</p>' +
      '<div class="dialog-actions"><button class="primary" data-add-build>+ Add build</button></div>');
  } else editor(kind);
});

dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  dismiss();
});
dialog.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if ("close" in button.dataset) dismiss();
  if ("cancel" in button.dataset) {
    const record = getRecord(route().id);
    if (record) detail(record);
    else dismiss();
  }
  if ("addBuild" in button.dataset) editor("builds");
  if (button.dataset.edit) {
    const record = getRecord(Number(button.dataset.edit));
    editor(record.kind, record);
  }
  if (button.dataset.share) shareRecord(getRecord(Number(button.dataset.share)));
  if (button.dataset.followup) {
    const test = getRecord(Number(button.dataset.followup));
    editor("issues", { test_id: test.id, build_id: test.build_id, owner: test.owner });
  }
});

window.addEventListener("hashchange", () => { if (state) render(); });

request("/api/workspace").then((data) => {
  state = data;
  document.querySelector("#identity").innerHTML = '<span class="avatar" aria-hidden="true">' +
    safe(state.actor.slice(0, 1).toUpperCase()) + '</span><span><strong>' + safe(state.actor) +
    '</strong><small>Founder</small></span>';
  document.querySelector("#environment").textContent = state.demo ? "Demo workspace" : "Private workspace";
  render();
}).catch((error) => {
  workspace.innerHTML = '<p class="empty" role="alert">Could not load the workspace. ' + safe(error.message) + '</p>';
}).finally(() => workspace.setAttribute("aria-busy", "false"));

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
