"use strict";
const $ = id => document.getElementById(id);
let adding = false;

async function call(url, data) {
  const response = await fetch(url, data ? {method:"POST", headers:{"Content-Type":"application/json","X-Fieldbench":"1"}, body:JSON.stringify(data)} : {});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Request failed.");
  return result;
}
function draw() {
  $("heading").textContent = adding ? "Register" : "Sign in";
  $("hint").textContent = adding ? "An administrator reviews each registration request." : "Access your drone development workspace.";
  $("credentials").hidden = adding;
  $("create").hidden = !adding;
  $("add").textContent = adding ? "Back to sign in" : "Register";
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
  if (data.replacement && data.replacement !== data.repeat) throw Error("The new passwords differ.");
  delete data.repeat;
  const result = await call("/auth/login",data);
  if (result.must_change) {
    $("first").hidden = false;
    $("first").disabled = false;
    $("add").hidden = true;
    $("sign-in").textContent = "Change password and sign in";
    $("credentials").elements.activation.focus();
    return;
  }
  if (result.needs_code) {
    $("factor").hidden = false;
    $("credentials").elements.code.required = true;
    $("credentials").elements.code.focus();
    return;
  }
  const status = await call("/auth/status");
  if (!status.actor) throw Error("The session cookie could not be saved. Use HTTPS.");
  $("credentials").reset();
  location.replace(status.enroll ? "/security" : location.pathname === "/login" ? "/" : location.href);
});
bind("create","submit",async()=>{
  const {name,display,password,confirmation} = Object.fromEntries(new FormData($("create")));
  if (password !== confirmation) throw Error("The two passwords differ.");
  await call("/auth/request",{name,display,password});
  $("create").reset();
  adding = false;
  draw();
  $("message").textContent = "If this username is available, your request is awaiting administrator approval.";
});
window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
