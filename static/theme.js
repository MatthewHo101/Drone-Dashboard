"use strict";
(() => {
  const key = "lysim-theme";
  const system = matchMedia("(prefers-color-scheme: dark)");
  let preference = null;
  let toggle;
  try { preference = localStorage.getItem(key); } catch {}
  function apply() {
    const theme = ["light","dark"].includes(preference) ? preference : system.matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content",theme==="dark"?"#141c18":"#17251f");
    if (toggle) toggle.setAttribute("aria-pressed",String(theme==="dark"));
  }
  apply();
  system.addEventListener("change",apply);
  window.addEventListener("storage",event=>{
    if(event.key===key || event.key===null){ preference=event.newValue; apply(); }
  });
  document.addEventListener("DOMContentLoaded",()=>{
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "theme-switch";
    toggle.textContent = "Dark mode";
    toggle.addEventListener("click",()=>{
      preference = document.documentElement.dataset.theme==="dark" ? "light" : "dark";
      try { localStorage.setItem(key,preference); } catch {}
      apply();
    });
    const bar = document.querySelector(".topbar");
    if(bar)bar.append(toggle);
    else document.querySelector("main")?.prepend(toggle);
    apply();
  });
})();
