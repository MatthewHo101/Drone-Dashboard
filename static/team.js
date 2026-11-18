"use strict";
const view = document.querySelector("#view");
const feedback = document.querySelector("#feedback");
const stages = ["Open", "In progress", "Blocked", "Done"];
const orderStages = ["Ordered", "In transit", "Received", "Cancelled"];
const currencies = ["HKD","USD","EUR","GBP","CNY","AUD","CAD"];
let workspace, team, project = "";
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const choices = (values, selected) => values.map(value => {
  const [key,label] = Array.isArray(value) ? value : [value,value];
  return '<option value="'+esc(key)+'" '+(key===selected?"selected":"")+'>'+esc(label)+'</option>';
}).join("");
function input(name,label,type="text",attributes="required") {
  const control = type==="area" ? '<textarea name="'+name+'" '+attributes+'></textarea>' :
    '<input type="'+type+'" name="'+name+'" '+attributes+'>';
  return '<label>'+label+control+'</label>';
}
function select(name,label,values,selected) {
  return '<label>'+label+'<select name="'+name+'">'+choices(values,selected)+'</select></label>';
}
function form(op,title,fields) {
  return '<details class="panel entry"><summary>'+title+'</summary><form class="form-grid" data-op="'+op+'">'+fields+
    '<button class="primary">Save</button></form></details>';
}
function panel(title,body) {
  return '<section class="panel"><div class="panel-head"><h2>'+esc(title)+'</h2></div><div class="entries">'+body+'</div></section>';
}
const tasks = () => workspace.records.filter(r=>r.kind==="issues");
const taskSelect = () => select("task","Associated task",[["","Unassigned"],...tasks().map(t=>[t.id,t.title])]);
function calendar(title,day,notes="") {
  if (!day) return "";
  const end = new Date(day+"T00:00:00Z");
  end.setUTCDate(end.getUTCDate()+1);
  const dates = (day+"/"+end.toISOString().slice(0,10)).replaceAll("-","");
  const query = new URLSearchParams({action:"TEMPLATE",text:title,dates,details:notes});
  return '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://calendar.google.com/calendar/render?'+esc(query)+'">Add to Google Calendar ↗</a>';
}
function person(name) {
  return Object.hasOwn(workspace.labels,name) ? workspace.labels[name] : name;
}
function board() {
  const items = tasks();
  const projects = [...new Set(items.map(t=>t.details.project).filter(Boolean))].sort();
  const filtered = items.filter(t=>!project||project===t.details.project);
  const fields = input("title","Task")+input("project","Project","text",'maxlength="100"')+
    select("owner","Owner",workspace.users.map(name=>[name,person(name)]),workspace.actor)+input("record_date","Due date","date","")+
    input("next_action","Next action");
  return form("task","Add a task",fields)+'<label class="filter">Project <select id="project">'+
    choices([["","All projects"],...projects],project)+'</select></label><div class="board">'+stages.map(stage=>
    panel(stage,filtered.filter(t=>t.status===stage).map(t=>{
      const docs=team.documents.filter(d=>d.task===t.id);
      return '<article><a href="/#issues/'+t.id+'"><strong>'+esc(t.title)+'</strong></a><p>'+esc(t.details.next_action)+'</p><small>'+
        esc([t.details.project,person(t.owner),t.record_date].filter(Boolean).join(" · "))+'</small>'+
        '<label>Move to <select data-task="'+t.id+'">'+choices(stages,stage)+'</select></label>'+
        docs.map(download).join("")+calendar(t.title,t.record_date,t.details.next_action)+'</article>';
    }).join("")||"<small>No tasks</small>")).join("")+'</div>';
}
function download(doc) {
  return '<a class="text-link" href="/downloads/'+doc.id+'">'+esc(doc.name)+' ↓</a>';
}
function documents() {
  return form("document","Upload a document",taskSelect()+input("file","Document · up to 5 MiB","file"))+
    team.documents.map(d=>panel(d.name,download(d)+'<small>'+esc(tasks().find(t=>t.id===d.task)?.title||"Unassigned")+'</small>')).join("");
}
function meetings() {
  return form("meeting","Add meeting notes",input("title","Meeting")+input("day","Meeting date","date")+
    input("notes","Notes or transcript","area",'required maxlength="30000"'))+
    team.meetings.map(m=>panel(m.title,'<small>'+esc(m.day)+'</small>'+calendar(m.title,m.day)+
    '<details><summary>Meeting notes</summary><pre>'+esc(m.notes)+'</pre></details>'+
    (m.summary?'<h3>AI summary</h3><pre>'+esc(m.summary)+'</pre>':'')+
    '<button class="secondary" data-summary="'+m.id+'">'+(m.summary?"Regenerate":"Summarize notes")+'</button>')).join("");
}
function diagram(source) {
  const edges=source.split(/\r?\n/).map(line=>line.split("->").map(s=>s.trim()));
  const names=[...new Set(edges.flat())];
  // Place nodes around an ellipse so branches and cycles share the same nodes.
  const width=Math.max(520,names.length*100),height=Math.max(300,names.length*45);
  const point=name=>{
    const angle=2*Math.PI*names.indexOf(name)/names.length-Math.PI/2;
    return [width/2+(width/2-90)*Math.cos(angle),height/2+(height/2-45)*Math.sin(angle)];
  };
  const lines=edges.map(([from,to])=>{
    const [x,y]=point(from),[a,b]=point(to);
    if(from===to) return '<path d="M '+x+' '+(y-17)+' c 45 -45 60 20 26 0" marker-end="url(#arrow)"/>';
    const dx=a-x,dy=b-y;
    const fraction=Math.min(76/Math.max(Math.abs(dx),0.001),19/Math.max(Math.abs(dy),0.001),0.45);
    return '<path d="M '+x+' '+y+' L '+(a-dx*fraction)+' '+(b-dy*fraction)+'" marker-end="url(#arrow)"/>';
  }).join("");
  return '<div class="diagram"><svg role="img" aria-label="Directed flowchart" viewBox="0 0 '+width+' '+height+'">'+lines+
    names.map(name=>{const [x,y]=point(name);return '<g><title>'+esc(name)+'</title><rect x="'+(x-75)+'" y="'+(y-17)+'" width="150" height="34" rx="8"/><text x="'+x+'" y="'+(y+4)+'">'+esc(name.length>21?name.slice(0,20)+"…":name)+'</text></g>';}).join("")+'</svg></div>';
}
function charts() {
  return form("chart","Create a flowchart",input("title","Chart name")+input("edges","Connections, one per line","area",'required maxlength="4000" placeholder="Design -> Review&#10;Review -> Test"'))+
    '<svg class="defs" aria-hidden="true"><defs><marker id="arrow" orient="auto" markerWidth="8" markerHeight="8" refX="7" refY="4"><polygon points="0,0 8,4 0,8"/></marker></defs></svg>'+
    team.charts.map(c=>panel(c.title,diagram(c.edges)+'<details><summary>Connections</summary><pre>'+esc(c.edges)+'</pre></details>')).join("");
}
function amount(minor) {
  return (minor/100n).toString()+"."+(minor%100n).toString().padStart(2,"0");
}
function orders() {
  const totals=new Map();
  const cards=team.orders.map(o=>{
    const total=BigInt(o.quantity)*BigInt(o.unit_minor)+BigInt(o.extra_minor);
    if(o.status!=="Cancelled") totals.set(o.currency,(totals.get(o.currency)||0n)+total);
    return panel(o.supplier,"<small>Invoice "+esc(o.invoice)+"</small><p>"+o.quantity+" × "+amount(BigInt(o.unit_minor))+" + "+
      amount(BigInt(o.extra_minor))+" = <strong>"+esc(o.currency)+" "+amount(total)+'</strong></p><label>Status <select data-order="'+o.id+'">'+choices(orderStages,o.status)+'</select></label>'+
      download(team.documents.find(d=>d.id===o.document)));
  }).join("");
  return form("order","Record an invoice",input("supplier","Supplier")+input("invoice","Invoice reference")+select("currency","Currency",currencies)+
    input("quantity","Quantity","number",'required min="1" max="999999" value="1"')+
    input("unit","Unit cost","number",'required min="0" step=".01"')+input("extras","Tax and shipping combined","number",'required min="0" step=".01" value="0"')+
    taskSelect()+input("file","Invoice · up to 5 MiB","file"))+
    panel("Committed costs",[...totals].map(([currency,total])=>'<strong>'+esc(currency)+" "+amount(total)+'</strong>').join(" · ")||"No active orders.")+cards;
}
const pages={board:["Project board",board],meetings:["Meetings",meetings],charts:["Flowcharts",charts],documents:["Documents",documents],orders:["Orders & costs",orders]};
function render() {
  const key=location.hash.slice(1);
  const [title,display]=Object.hasOwn(pages,key)?pages[key]:pages.board;
  view.innerHTML='<header class="intro"><h1>'+title+'</h1></header>'+display();
  document.querySelectorAll("nav a").forEach(a=>a.toggleAttribute("aria-current",a.hash===(location.hash||"#board")));
}
async function api(url,data,method="POST") {
  const response=await fetch(url,data?{method,headers:{"Content-Type":"application/json","X-Fieldbench":"1"},body:JSON.stringify(data)}:{});
  const result=await response.json();
  if(!response.ok) throw Error(result.error||"Request failed.");
  return result;
}
async function refresh() {
  [workspace,team]=await Promise.all([api("/api/workspace"),api("/api/team")]);
  document.querySelector("#community").innerHTML=team.community?'<a target="_blank" rel="noopener noreferrer" href="'+esc(team.community)+'">WhatsApp community ↗</a>':"";
  render();
}
async function perform(control,action) {
  control.disabled=true;
  feedback.textContent="Working…";
  try { await action(); await refresh(); feedback.textContent="Saved."; }
  catch(error){feedback.textContent=error.message; control.disabled=false;}
}
view.addEventListener("submit",event=>{
  event.preventDefault();
  const form=event.target,op=form.dataset.op;
  perform(form.querySelector("button"),async()=>{
    const data=Object.fromEntries(new FormData(form));
    if(data.file instanceof File){
      if(!data.file.size||data.file.size>5*1024*1024) throw Error("Choose a nonempty file up to 5 MiB.");
      const file=data.file;
      data.filename=file.name;
      data.file=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(String(reader.result).split(",")[1]);
        reader.onerror=()=>reject(Error("File could not be read."));
        reader.readAsDataURL(file);
      });
    }
    if(op==="task") await api("/api/records",{...data,kind:"issues",status:"Open"});
    else await api("/api/team/"+op,data);
  });
});
view.addEventListener("change",event=>{
  const control=event.target;
  if(control.id==="project"){project=control.value; render();return;}
  if(control.dataset.task){
    const task=tasks().find(t=>t.id===Number(control.dataset.task));
    const status=control.value;
    control.value=task.status;
    perform(control,()=>api("/api/records/"+task.id,{...task,...task.details,status},"PUT"));
  }
  if(control.dataset.order){
    const id=Number(control.dataset.order),status=control.value;
    control.value=team.orders.find(o=>o.id===id).status;
    perform(control,()=>api("/api/team/order-status",{id,status}));
  }
});
view.addEventListener("click",event=>{
  const button=event.target.closest("[data-summary]");
  if(button) perform(button,()=>api("/api/team/summarize",{id:Number(button.dataset.summary)}));
});
window.addEventListener("hashchange",()=>{if(team)render();});
refresh().catch(error=>feedback.textContent=error.message);

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
