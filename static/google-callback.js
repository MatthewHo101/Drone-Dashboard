"use strict";
async function finish(){
  const query=new URLSearchParams(location.search);
  history.replaceState(null,"","/google/callback");
  if(!query.get("code")) throw Error("Google Calendar connection cancelled.");
  const response=await fetch("/api/google/finish",{method:"POST",headers:{"Content-Type":"application/json","X-Fieldbench":"1"},
    body:JSON.stringify({state:query.get("state"),code:query.get("code")})});
  const result=await response.json();
  if(!response.ok) throw Error(result.error||"Sign in and retry from Task details.");
  if(result.meeting && "BroadcastChannel" in window){
    const changes=new BroadcastChannel("lysim-calendar");
    changes.postMessage("saved");changes.close();
  }
  location.replace(result.url);
}
finish().catch(error=>document.querySelector("[role=status]").textContent=error.message);
