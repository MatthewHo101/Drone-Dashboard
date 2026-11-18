"use strict";
const $ = id => document.getElementById(id);
let actor = null;
let adding = false;
let admin = false;
let display = "";

async function call(url, data) {
  const response = await fetch(url, data ? {method:"POST", headers:{"Content-Type":"application/json","X-Fieldbench":"1"}, body:JSON.stringify(data)} : {});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Request failed.");
  return result;
}
function draw() {
  $("heading").textContent = adding ? (actor ? "Add a user" : "Register") : actor ? "Your account" : "Sign in";
  $("hint").textContent = adding ? (actor ? "Choose a username and a password of at least 12 characters." : "Choose a display name and a password of at least 12 characters. An administrator reviews each request.") :
    (actor ? "Signed in as " + display : "Access your drone development workspace.");
  $("credentials").hidden = Boolean(actor || adding);
  $("create").hidden = !adding;
  $("logout").hidden = !actor;
  $("security").hidden = !actor;
  $("add").hidden = Boolean(actor && !admin);
  $("open").hidden = !actor;
  $("add").textContent = adding ? "Back" : actor ? "Add user" : "Register";
  $("submit-create").textContent = actor ? "Create account" : "Request access";
}
function bind(id, eventName, action) {
  $(id).addEventListener(eventName, async event => {
    event.preventDefault();
    const button = event.submitter || event.currentTarget;
    button.disabled = true;
    $("message").textContent = "";
    try { await action(); } catch (error) { $("message").textContent = error.message; }
    finally { button.disabled = false; }
  });
}
bind("add","click",()=>{ adding = !adding; $("create").reset(); draw(); });
bind("credentials","submit",async()=>{
  const data = Object.fromEntries(new FormData($("credentials")));
  const result = await call("/auth/login",data);
  if (result.needs_code) {
    $("factor").hidden = false;
    $("credentials").elements.code.required = true;
    $("credentials").elements.code.focus();
    return;
  }
  const status = await call("/auth/status");
  actor = status.actor;
  admin = status.admin;
  display = status.display;
  if (status.enroll) { location.replace("/security"); return; }
  if (!admin) adding = false;
  if (!actor) throw Error("The session cookie could not be saved. Use HTTPS or a localhost SSH tunnel.");
  $("credentials").reset();
  if (adding) draw();
  else location.replace(location.pathname === "/login" ? "/" : location.href);
});
bind("create","submit",async()=>{
  const {name,display,password,confirmation} = Object.fromEntries(new FormData($("create")));
  if (password !== confirmation) throw Error("The two passwords differ.");
  await call(actor ? "/auth/register" : "/auth/request",{name,display,password});
  $("create").reset();
  adding = false;
  draw();
  $("message").textContent = actor ? "Created account for " + name + "." : "If this username is available, your request is awaiting administrator approval.";
});
bind("logout","click",async()=>{await call("/auth/logout",{});location.replace("/login");});
call("/auth/status").then(status=>{
  actor = status.actor;
  admin = status.admin;
  display = status.display;
  draw();
  if (status.demo) { $("security").hidden = true; $("add").hidden = true; $("logout").hidden = true; }
}).catch(error=>{ $("message").textContent = error.message; });

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
