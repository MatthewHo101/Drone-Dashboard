"use strict";

const workspace = document.querySelector("#workspace");
let state;

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
  return "/team#task/" + record.id;
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

function person(name) {
  return Object.hasOwn(state.labels, name) ? state.labels[name] : name;
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
    (columns ? '<span class="row-owner">' + safe(person(record.owner)) + '</span><span class="row-date">' + safe(formatDate(record.record_date)) + '</span>' : "") +
    badge(record.status) + '<span class="chevron" aria-hidden="true">›</span></a>'
  )).join("");
}

function panel(title, items, empty) {
  return '<section class="panel"><div class="panel-head"><h2>' + safe(title) + '</h2><a href="/team#board">View tasks <span aria-hidden="true">↗</span></a></div>' + list(items, empty) + '</section>';
}

function overview() {
  const issues = records("issues").filter((record) => record.status !== "Done");
  const urgent = issues.filter((record) => record.status === "Blocked" || (record.record_date && record.record_date < today()));
  const leadRows = leads => leads.map(o=>'<a class="record-row" href="/team#commercial/'+o.id+'"><span class="row-title"><strong>'+safe(o.customer)+' · '+safe(o.title)+'</strong><small>'+safe(o.action)+' · '+safe(o.due||"No follow-up date")+'</small></span></a>').join("");
  const myIssues = issues.filter(i=>i.owner===state.actor).sort((a,b)=>(a.record_date||"9999").localeCompare(b.record_date||"9999"));
  const mine = state.leads.filter(o=>o.owner===state.actor);
  const myWork = '<section class="panel"><div class="panel-head"><h2>My work</h2></div>'+
    (myIssues.length?list(myIssues,""):"")+leadRows(mine)+
    (!myIssues.length&&!mine.length?'<p class="empty">No assigned work.</p>':'')+'</section>';
  const commercial = '<section class="panel"><div class="panel-head"><h2>Commercial follow-ups</h2><a href="/team#commercial">Open pipeline ↗</a></div>'+
    (leadRows(state.leads.slice(0,4))||'<p class="empty">No open opportunities.</p>')+'</section>';
  const meeting=state.latest_customer_meeting;
  const learning=meeting?'<section class="panel"><div class="panel-head"><h2>Latest customer meeting</h2><a href="/team#meetings">Open meetings ↗</a></div><div class="entries"><strong>'+safe(meeting.customer)+' · '+safe(meeting.title)+'</strong><p>'+safe(meeting.excerpt)+'</p><small>'+safe(meeting.day)+'</small></div></section>':"";
  return '<header class="intro"><h1>Home</h1><a class="primary" href="/team#board">Open Tasks</a></header>' +
    myWork + '<div class="panel-grid">' + panel("Engineering blockers", urgent, "No blocked or overdue tasks.") +
    commercial + learning + '</div>';
}

function render() {
  const legacy = /^#issues(?:\/(\d+))?$/.exec(location.hash);
  if (legacy) {
    location.replace(legacy[1] ? "/team#task/" + legacy[1] : "/team#board");
    return;
  }
  highlightNavigation();
  workspace.innerHTML = overview();
}

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The workspace request failed.");
  return data;
}

window.addEventListener("hashchange", () => { if (state) render(); });

request("/api/workspace").then((data) => {
  state = data;
  document.querySelector("#identity").innerHTML = '<span class="avatar" aria-hidden="true">' +
    safe(person(state.actor).slice(0, 1).toUpperCase()) + '</span><span><strong>' + safe(person(state.actor)) +
    '</strong><small>Founder</small></span>';
  document.querySelector("#environment").textContent = state.demo ? "Demo workspace" : "Private workspace";
  render();
}).catch((error) => {
  workspace.innerHTML = '<p class="empty" role="alert">Could not load the workspace. ' + safe(error.message) + '</p>';
}).finally(() => workspace.setAttribute("aria-busy", "false"));

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
