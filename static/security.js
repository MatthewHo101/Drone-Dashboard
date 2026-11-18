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
  controls.elements.display.value = info.display;
  byId("state").textContent = (info.enrolled ? "Authenticator enabled." : "Set up an authenticator to protect your account.")+
    (info.mandatory ? " Two-factor authentication is required for workspace access." : "");
  byId("start").hidden = info.enrolled;
  byId("codes").hidden = !info.enrolled;
  byId("identity-label").textContent = info.display;
  byId("identity").textContent = info.display;
  byId("approvals").hidden = !info.admin;
  byId("admin").hidden = !info.admin;
  if (info.admin) {
    byId("require").disabled = info.mandatory;
    controls.elements.request_id.replaceChildren(...info.requests.map(r=>new Option(r.display+" ("+r.name+")",r.id)));
    if (!info.requests.length) controls.elements.request_id.add(new Option("No pending requests",""));
    for (const op of ["approve","reject"]) controls.querySelector('[value="'+op+'"]').disabled = !info.requests.length;
    controls.elements.target.replaceChildren(...info.users.map(user=>{
      const labels = [user.display+" ("+user.name+")", user.admin ? "admin" : "member",user.enrolled ? "2FA enrolled":"2FA pending"];
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
  if (op==="profile") data.display=fields.display.value;
  if (op==="approve" || op==="reject") {
    if (!fields.request_id.value) return;
    data.request_id=Number(fields.request_id.value);
    if (!window.confirm(button.textContent+" for "+fields.request_id.selectedOptions[0].text+"?")) return;
  }
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
  finally {if ((op==="approve" || op==="reject") && !fields.request_id.value) button.disabled=true; else if(op!=="require" || message.textContent!=="Saved.")button.disabled=false;}
});
byId("dismiss").onclick=()=>{byId("secrets").textContent="";byId("recovery").hidden=true;};
refresh().catch(error=>message.textContent=error.message);

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});

byId("sign-out").onclick = async () => {
  try {
    const response = await fetch("/auth/logout",{method:"POST",headers:{"Content-Type":"application/json","X-Fieldbench":"1"},body:"{}"});
    if (!response.ok) throw Error("Sign-out failed. Try again.");
    location.replace("/login");
  } catch(error){ message.textContent=error.message; }
};
