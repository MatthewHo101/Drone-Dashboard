"use strict";
const $ = id => document.getElementById(id);
let actor = null;
let adding = false;

async function call(url, data) {
  const response = await fetch(url, data ? {method:"POST", headers:{"Content-Type":"application/json","X-Fieldbench":"1"}, body:JSON.stringify(data)} : {});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Request failed.");
  return result;
}
function draw() {
  $("heading").textContent = adding ? "Add a user" : actor ? "Your account" : "Sign in";
  $("hint").textContent = adding ? (actor ? "Choose a username and a password of at least 12 characters." : "Sign in as an existing founder to add a user.") :
    (actor ? "Signed in as " + actor : "Access your drone development workspace.");
  $("credentials").hidden = Boolean(actor);
  $("create").hidden = !(actor && adding);
  $("logout").hidden = !actor;
  $("open").hidden = !actor;
  $("add").textContent = adding ? "Cancel" : "Add user";
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
  actor = (await call("/auth/status")).actor;
  if (!actor) throw Error("The session cookie could not be saved. Use HTTPS or a localhost SSH tunnel.");
  $("credentials").reset();
  if (adding) draw();
  else location.replace(location.pathname === "/login" ? "/" : location.href);
});
bind("create","submit",async()=>{
  const {name,password,confirmation} = Object.fromEntries(new FormData($("create")));
  if (password !== confirmation) throw Error("The two passwords differ.");
  await call("/auth/register",{name,password});
  $("create").reset();
  adding = false;
  draw();
  $("message").textContent = "Created account for " + name + ".";
});
bind("logout","click",async()=>{await call("/auth/logout",{});location.replace("/login");});
call("/auth/status").then(status=>{
  actor = status.actor;
  draw();
  if (status.demo) { $("add").hidden = true; $("logout").hidden = true; }
}).catch(error=>{ $("message").textContent = error.message; });
