"use strict";
const byId = id => document.getElementById(id);
const controls = byId("controls");
const message = byId("message");

async function request(op, data) {
  const response = await fetch("/account/"+op, data ? {
    method:"POST", headers:{"Content-Type":"application/json","X-Fieldbench":"1"},body:JSON.stringify(data)
  } : {});
  if (response.status === 401) { location.replace("/login"); throw Error("Sign in again."); }
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Request failed.");
  return result;
}
async function refresh() {
  const info = await request("settings");
  controls.hidden = false;
  byId("state").textContent = (info.enrolled ? "Authenticator enabled." : "Set up an authenticator to protect your account.")+
    (info.mandatory ? " Two-factor authentication is required for workspace access." : "");
  byId("start").hidden = info.enrolled;
  byId("codes").hidden = !info.enrolled;
  byId("admin").hidden = !info.admin;
  if (info.admin) {
    byId("require").disabled = info.mandatory;
    controls.elements.target.replaceChildren(...info.users.map(user=>{
      const labels = [user.name, user.admin ? "admin" : "member",user.enrolled ? "2FA enrolled":"2FA pending"];
      if (user.disabled) labels.push("disabled");
      return new Option(labels.join(" · "),user.name);
    }));
    byId("events").replaceChildren(...info.events.map(event=>{
      const row = document.createElement("li");
      row.textContent = [new Date(event.stamp*1000).toLocaleString(),event.actor,event.event,event.subject].filter(Boolean).join(" · ");
      return row;
    }));
  }
}
controls.addEventListener("submit", async event=>{
  event.preventDefault();
  const button = event.submitter;
  if (!button) return;
  const op = button.value;
  const fields = controls.elements;
  const data = {password:fields.password.value};
  if (["reset","disable","enable","grant","demote"].includes(op)) {
    data.target = fields.target.value;
    if (!window.confirm(button.textContent+" for "+data.target+"?")) return;
  }
  if (op==="reset") data.replacement=fields.replacement.value;
  if (op==="confirm") data.code=fields.code.value;
  if (op==="codes" && !window.confirm("Replace every unused recovery code?")) return;
  button.disabled = true;
  try {
    const result = await request(op,data);
    if (result.signed_out) {location.replace("/login");return;}
    if (result.secret) {
      byId("key").textContent=result.secret;
      byId("setup").hidden=false;
    } else {
      byId("key").textContent="";
      byId("setup").hidden=true;
      fields.password.value="";
    }
    fields.code.value="";
    fields.replacement.value="";
    if(result.codes){
      byId("secrets").textContent=result.codes.join("\n");
      byId("recovery").hidden=false;
    }
    message.textContent="Saved.";
    await refresh();
  } catch(error){message.textContent=error.message;}
  finally {if(op!=="require" || message.textContent!=="Saved.")button.disabled=false;}
});
byId("dismiss").onclick=()=>{byId("secrets").textContent="";byId("recovery").hidden=true;};
refresh().catch(error=>message.textContent=error.message);

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
