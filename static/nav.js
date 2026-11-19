"use strict";
const navigation = document.querySelector(".sidebar nav");
navigation.innerHTML = '<a href="/#overview">Home</a>'+
  '<details open><summary>Engineering</summary><a href="/team#board">Tasks</a><a href="/team#charts">Flowcharts</a></details>'+
  '<details open><summary>Commercial</summary><a href="/team#commercial">Commercial overview</a><a href="/team#sales">Sales orders</a><a href="/team#orders">Purchases</a></details>'+
  '<details open><summary>Shared</summary><a href="/team#notes">Notes</a><a href="/team#documents">Documents</a><a href="/team#meetings">Meetings</a></details>';
const profile=document.createElement("a");
profile.className="identity";
profile.href="/security";
profile.setAttribute("aria-label","Open account");
profile.innerHTML='<span class="avatar" aria-hidden="true"></span><span><strong>Account</strong><small>Founder</small></span>';
navigation.after(profile);
function showProfile(display){
  if(!display)return;
  profile.querySelector(".avatar").textContent=Array.from(display)[0].toUpperCase();
  profile.querySelector("strong").textContent=display;
  profile.setAttribute("aria-label","Open account for "+display);
}
if(location.pathname==="/security"){
  profile.setAttribute("aria-current","page");
  fetch("/auth/status").then(r=>r.json()).then(info=>showProfile(info.display)).catch(()=>{});
}
const goBack=document.createElement("button");
goBack.type="button";
goBack.className="back-button";
goBack.textContent="← Back";
goBack.onclick=()=>{
  if(history.length>1)history.back();
  else location.assign("/#overview");
};
document.querySelector(".topbar").prepend(goBack);
function highlightNavigation() {
  const page = location.hash.split("/")[0] || (location.pathname==="/team"?"#board":location.pathname==="/"?"#overview":"");
  for(const link of navigation.querySelectorAll("a")){
    if(link.pathname===location.pathname && (link.hash===page || (["#task","#work-update"].includes(page) && link.hash==="#board"))) {
      link.setAttribute("aria-current","page");
      const group=link.closest("details");
      if(group) group.open=true;
    }
    else link.removeAttribute("aria-current");
  }
}
if (matchMedia("(max-width:740px)").matches) {
  for (const group of navigation.querySelectorAll("details")) group.open=false;
}
window.addEventListener("hashchange",highlightNavigation);
highlightNavigation();
