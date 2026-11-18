"use strict";
const view = document.querySelector("#view");
const feedback = document.querySelector("#feedback");
const stages = ["Open","Done"];
const orderStages = ["Ordered", "In transit", "Received", "Cancelled"];
const currencies = ["GBP","HKD","USD","EUR","CNY","AUD","CAD"];
let displayCurrency="GBP", meetingMonth=dateNow().slice(0,7);
let workspace, team, purchaseCategory = "", purchaseProject = "";
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
function taskFields(task={details:{}}) {
  return valueInput("title","Task",task.title)+
    select("owner","Owner",workspace.users.map(n=>[n,person(n)]),task.owner||workspace.actor)+
    valueInput("record_date","Due date",task.record_date,"date",false)+
    valueInput("next_action","Next action (optional)",task.details.next_action,"text",false);
}
function board() {
  const items=tasks();
  return form("task","Create task",taskFields())+'<div class="task-stack">'+stages.map(stage=>
    panel(stage,items.filter(t=>t.status===stage).map(t=>
      '<article><a class="task-card" href="#task/'+t.id+'"><strong>'+esc(t.title)+'</strong><small>'+
      esc([person(t.owner),t.record_date].filter(Boolean).join(" · "))+'</small></a>'+
      (stage==="Open"?'<button class="secondary" data-done="'+t.id+'">Done</button>':"")+'</article>' 
    ).join("")||"<small>No tasks</small>")).join("")+'</div>';
}
function taskDetail() {
  const task=tasks().find(t=>String(t.id)===location.hash.split("/")[1]);
  const back='<a class="text-link" href="#board">← All tasks</a>';
  if(!task)return back+'<p class="empty">Task unavailable.</p>';
  const updates=team.task_updates.filter(u=>u.task===task.id);
  const docs=team.documents.filter(d=>d.task===task.id);
  const files=new Map(docs.map(doc=>[doc.id,doc]));
  const history=updates.map(update=>{
    const doc=files.get(update.document);
    files.delete(update.document);
    const day=update.work_date ? '<p>Work date · <time>'+esc(update.work_date)+'</time></p>' : "";
    return '<article><strong>'+esc(person(update.author))+'</strong>'+day+
      '<small>Posted <time datetime="'+esc(update.posted_at)+'">'+esc(new Date(update.posted_at).toLocaleString())+
      '</time></small><pre>'+esc(update.body)+'</pre>'+(doc?attachment(doc):"")+'</article>';
  }).join("");
  const otherFiles=[...files.values()].map(doc=>'<article>Attached to task'+attachment(doc)+'</article>').join("");
  const updateFields=hiddenId("task",task.id)+valueInput("work_date","Work date",dateNow(),"date")+
    input("file","Document (optional, up to 5 MiB)","file","")+
    input("body","What was done?","area",'required maxlength="4000"');
  return '<div class="task-detail">'+back+panel(task.title,'<p>'+esc(task.status)+' · '+esc(person(task.owner))+'</p><p>Due date · '+esc(task.record_date||"Unscheduled")+
    '</p>'+(task.details.next_action?'<p>Next action · '+esc(task.details.next_action)+'</p>':"")+
    (task.notes?'<pre>'+esc(task.notes)+'</pre>':"")+
    form("edit-task","Edit task",hiddenId("task",task.id)+taskFields(task)+select("status","Status",stages,task.status)+
      '<label>Notes<textarea name="notes" maxlength="2000">'+esc(task.notes)+'</textarea></label>')+
    calendar(task.title,task.record_date,task.details.next_action)+
    '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text='+
    encodeURIComponent(task.title+" "+location.href)+'">Share task via WhatsApp ↗</a>')+
    panel("Work history",form("task-update","Add work update",updateFields)+
      (history+otherFiles||'<p>No work updates yet.</p>'))+'</div>';
}
function download(doc) {
  return '<a class="text-link" href="/downloads/'+doc.id+'">'+esc(doc.name)+' ↓</a>';
}
function attachment(doc) {
  const order=team.sales.find(s=>s.id===doc.sale);
  const preview=doc.preview?.startsWith("image/")?'<a href="/previews/'+doc.id+'" target="_blank" rel="noopener"><img class="order-photo" loading="lazy" src="/previews/'+doc.id+'" alt="'+esc(doc.name)+'"></a>':
    doc.preview==="application/pdf"?'<a class="text-link" target="_blank" rel="noopener" href="/previews/'+doc.id+'">View PDF ↗</a>':"";
  return '<div class="attachment">'+preview+download(doc)+(order?'<a class="text-link" href="#sales/'+order.id+'">SO-'+order.id+' · '+esc(order.title)+'</a>':"")+'</div>';
}
function documents() {
  const id=location.hash.split("/")[1];
  if(id){
    const doc=team.documents.find(d=>String(d.id)===id);
    const back='<a class="text-link" href="#documents">← Documents</a>';
    if(!doc)return back+'<p>Document unavailable.</p>';
    const task=tasks().find(t=>t.id===doc.task);
    const sale=team.sales.find(s=>s.id===doc.sale);
    const order=team.orders.find(o=>o.document===doc.id);
    const source=doc.source||(doc.update_id?"Task work update":order?"Purchase invoice":"Not recorded");
    const row=(label,value)=>'<div class="detail-item"><dt>'+label+'</dt><dd>'+value+'</dd></div>';
    return back+panel(doc.name,'<dl class="details">'+row("Uploaded from",esc(source))+
      row("Uploaded by",doc.uploader?esc(person(doc.uploader)):"Not recorded")+
      row("Upload time",doc.uploaded_at?esc(new Date(doc.uploaded_at).toLocaleString()):"Not recorded")+
      row("File size",doc.size.toLocaleString()+" bytes")+
      (task?row("Task",'<a href="#task/'+task.id+'">'+esc(task.title)+'</a>'):"")+
      (sale?row("Sales order",'<a href="#sales/'+sale.id+'">'+esc(sale.title)+'</a>'):"")+
      (order?row("Purchase invoice",esc(order.supplier)+" · "+esc(order.invoice)):"")+'</dl>'+attachment(doc));
  }
  return form("document","Upload a document",taskSelect()+select("sale","Sales order",[["","Unassigned"],...team.sales.map(s=>[s.id,"SO-"+s.id+" · "+s.title])])+input("file","Document · up to 5 MiB","file"))+
    '<div class="document-list">'+team.documents.map(d=>'<a class="record-row" href="#documents/'+d.id+'">'+
      '<strong>'+esc(d.name)+'</strong><span>View details →</span></a>').join("")+'</div>';
}
function meetingCalendar(){
  const [year,month]=meetingMonth.split("-").map(Number);
  const offset=(new Date(year,month-1,1).getDay()+6)%7;
  const count=new Date(year,month,0).getDate();
  const days=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>'<strong>'+d+'</strong>');
  for(let i=0;i<offset;i++)days.push('<div></div>');
  for(let n=1;n<=count;n++){
    const day=meetingMonth+"-"+String(n).padStart(2,"0");
    const meetings=team.meetings.filter(m=>m.day===day);
    days.push('<div class="cal-day"><time datetime="'+day+'">'+n+'</time>'+
      meetings.map(m=>'<button class="cal-meeting" data-meeting="'+m.id+'">'+esc(m.title)+'</button>').join("")+'</div>');
  }
  return panel("Calendar",'<div class="cal-controls"><button class="secondary" data-month-shift="-1" aria-label="Previous month">←</button>'+
    input("meetingMonth","Month","month",'value="'+meetingMonth+'"')+
    '<button class="secondary" data-month-shift="1" aria-label="Next month">→</button></div><div class="cal-scroll"><div class="cal-grid">'+days.join("")+'</div></div>');
}
function meetings() {
  return meetingCalendar()+form("meeting","Add meeting notes",input("project","Engineering project","text",'maxlength="100"')+select("opportunity","Commercial opportunity",[["","Unassigned"],...team.opportunities.map(o=>[o.id,o.title+" · "+o.customer])])+input("title","Meeting")+input("day","Meeting date","date")+
    input("notes","Notes or transcript","area",'required maxlength="30000"'))+
    team.meetings.map(m=>'<div tabindex="-1" id="meeting-'+m.id+'">'+panel(m.title,projectLink(m.project)+(m.opportunity?'<a class="text-link" href="#commercial/'+m.opportunity+'">'+esc(team.opportunities.find(o=>o.id===m.opportunity)?.title)+'</a>':"")+'<small>'+esc(m.day)+'</small>'+calendar(m.title,m.day)+
    '<details><summary>Meeting notes</summary><pre>'+esc(m.notes)+'</pre></details>'+
    (m.summary?'<h3>AI summary</h3><pre>'+esc(m.summary)+'</pre>':'')+
    '<button class="secondary" data-summary="'+m.id+'">'+(m.summary?"Regenerate":"Summarize notes")+'</button>')+'</div>').join("");
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
  return form("chart","Create a flowchart",input("project","Engineering project","text",'maxlength="100"')+input("title","Chart name")+input("edges","Connections, one per line","area",'required maxlength="4000" placeholder="Design -> Review&#10;Review -> Test"'))+
    '<svg class="defs" aria-hidden="true"><defs><marker id="arrow" orient="auto" markerWidth="8" markerHeight="8" refX="7" refY="4"><polygon points="0,0 8,4 0,8"/></marker></defs></svg>'+
    team.charts.map(c=>panel(c.title,projectLink(c.project)+diagram(c.edges)+'<details><summary>Connections</summary><pre>'+esc(c.edges)+'</pre></details>')).join("");
}
function amount(minor) {
  return (minor/100n).toString()+"."+(minor%100n).toString().padStart(2,"0");
}
function orders() {
  const totals=new Map();
  const cards=team.orders.filter(o=>(!purchaseCategory||o.category===purchaseCategory)&&(!purchaseProject||o.project===purchaseProject)).map(o=>{
    const total=BigInt(o.quantity)*BigInt(o.unit_minor)+BigInt(o.extra_minor);
    if(o.status!=="Cancelled") totals.set(o.currency,(totals.get(o.currency)||0n)+total);
    return panel(o.supplier,projectLink(o.project)+esc(o.category)+" · <small>Invoice "+esc(o.invoice)+"</small><p>"+o.quantity+" × "+amount(BigInt(o.unit_minor))+" + "+
      amount(BigInt(o.extra_minor))+" = <strong>"+esc(o.currency)+" "+amount(total)+'</strong></p><label>Status <select data-order="'+o.id+'">'+choices(orderStages,o.status)+'</select></label>'+
      download(team.documents.find(d=>d.id===o.document)));
  }).join("");
  return form("order","Record an invoice",select("category","Category",["General","R&D","Commercial"])+input("project","Project","text",'maxlength="100"')+input("supplier","Supplier")+input("invoice","Invoice reference")+select("currency","Currency",currencies)+
    input("quantity","Quantity","number",'required min="1" max="999999" value="1"')+
    input("unit","Unit cost","number",'required min="0" step=".01"')+input("extras","Tax and shipping combined","number",'required min="0" step=".01" value="0"')+
    taskSelect()+input("file","Invoice · up to 5 MiB","file"))+
    select("categoryFilter","Filter by category",[["","All categories"],"General","R&D","Commercial"],purchaseCategory)+select("purchaseProject","Filter by project",[["","All projects"],...new Set(team.orders.map(o=>o.project).filter(Boolean))],purchaseProject)+panel("Committed costs",[...totals].map(([currency,total])=>'<strong>'+esc(currency)+" "+amount(total)+'</strong>').join(" · ")||"No active orders.")+cards;
}
const pages={task:["Task details",taskDetail],board:["Tasks",board],meetings:["Meetings",meetings],charts:["Flowcharts",charts],documents:["Documents",documents],orders:["Purchases",orders],commercial:["Commercial overview",commercialOverview],sales:["Sales orders",salesPage]};
function render() {
  const [key]=location.hash.slice(1).split("/");
  const [title,display]=Object.hasOwn(pages,key)?pages[key]:pages.board;
  view.innerHTML='<header class="intro"><h1>'+title+'</h1></header>'+display();
  highlightNavigation();
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
    if (["lead","sale","convert","fulfillment","item","charge","payment","allocate","document","task-update"].includes(op)) {
      form.dataset.key ||= crypto.randomUUID();
      data.request_key=form.dataset.key;
    }
    if(op==="task-update" && data.file instanceof File && !data.file.name) delete data.file;
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
    if(op==="task") {
      const saved=await api("/api/records",{...data,kind:"issues",status:"Open"});
      workspace.records.push(saved);
      location.hash="#task/"+saved.id;
    } else if(op==="edit-task") {
      const task=tasks().find(t=>t.id===Number(data.task));
      await api("/api/records/"+task.id,{...task,...task.details,...data},"PUT");
    }
    else {
      await api("/api/team/"+op,data);
      if(op==="meeting")meetingMonth=data.day.slice(0,7);
    }
  });
});
view.addEventListener("change",event=>{
  const control=event.target;
  if(control.name==="categoryFilter"){purchaseCategory=control.value;render();return;}
  if(control.name==="purchaseProject"){purchaseProject=control.value;render();return;}
  if(control.name==="displayCurrency"){displayCurrency=control.value;render();return;}
  if(control.name==="meetingMonth" && control.value){meetingMonth=control.value;render();return;}
  if(control.dataset.order){
    const id=Number(control.dataset.order),status=control.value;
    control.value=team.orders.find(o=>o.id===id).status;
    perform(control,()=>api("/api/team/order-status",{id,status}));
  }
});
view.addEventListener("click",event=>{
  const done=event.target.closest("[data-done]");
  if(done){
    const task=tasks().find(t=>t.id===Number(done.dataset.done));
    perform(done,()=>api("/api/records/"+task.id,{...task,...task.details,status:"Done"},"PUT"));
    return;
  }
  const shift=event.target.closest("[data-month-shift]");
  if(shift){
    const [year,month]=meetingMonth.split("-").map(Number);
    const next=new Date(year,month-1+Number(shift.dataset.monthShift),1);
    meetingMonth=next.getFullYear()+"-"+String(next.getMonth()+1).padStart(2,"0");
    render();
    return;
  }
  const meeting=event.target.closest("[data-meeting]");
  if(meeting){
    const card=document.getElementById("meeting-"+meeting.dataset.meeting);
    card.querySelector("details").open=true;
    card.scrollIntoView({block:"start"});
    card.focus({preventScroll:true});
  }
  const button=event.target.closest("[data-summary]");
  if(button) perform(button,()=>api("/api/team/summarize",{id:Number(button.dataset.summary)}));
});
window.addEventListener("hashchange",()=>{if(team)render();});
refresh().catch(error=>feedback.textContent=error.message);

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
