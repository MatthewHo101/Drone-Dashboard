"use strict";
const view = document.querySelector("#view");
const feedback = document.querySelector("#feedback");
const stages = ["Open","Done"];
const orderStages = ["Ordered", "In transit", "Received", "Cancelled"];
const currencies = ["GBP","HKD","USD","EUR","CNY","AUD","CAD"];
let displayCurrency="GBP", meetingMonth=dateNow().slice(0,7);
let workspace, team, purchaseCategory = "";
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const choices = (values, selected) => values.map(value => {
  const [key,label] = Array.isArray(value) ? value : [value,value];
  return '<option value="'+esc(key)+'" '+(key===selected?"selected":"")+'>'+esc(label)+'</option>';
}).join("");
function input(name,label,type="text",attributes="") {
  attributes=attributes.replace(/\brequired\b/g,"");
  const control = type==="area" ? '<textarea name="'+name+'" '+attributes+'></textarea>' :
    '<input type="'+type+'" name="'+name+'" '+attributes+'>';
  return '<label>'+label+control+'</label>';
}
function select(name,label,values,selected) {
  return '<label>'+label+'<select name="'+name+'">'+choices(values,selected)+'</select></label>';
}
function form(op,title,fields) {
  if(op!=="meeting-search"){
    return '<button type="button" class="workspace-action" data-show-form>'+esc(title)+'</button>'+
      '<dialog aria-label="'+esc(title)+'"><div class="dialog-head"><h2>'+esc(title)+'</h2>'+
      '<button type="button" class="close" data-close-form aria-label="Close">×</button></div>'+
      '<form class="form-grid" data-op="'+op+'">'+fields+'<p class="form-error wide" role="alert"></p><button class="primary">Save</button></form></dialog>';
  }
  return '<details class="panel entry"><summary>'+title+'</summary><form class="form-grid" data-op="'+op+'">'+fields+
    '<button class="primary">Save</button></form></details>';
}
function panel(title,body) {
  return '<section class="panel"><div class="panel-head"><h2>'+esc(title)+'</h2></div><div class="entries">'+body+'</div></section>';
}
const foldStates=new Map();
function fold(key,title,body,expanded=false){
  const open=foldStates.get(key)??expanded;
  return '<details class="panel workspace-fold" data-fold="'+esc(key)+'" '+(open?"open":"")+'><summary>'+esc(title)+'</summary><div class="entries">'+body+'</div></details>';
}
function recordRow(url,title,meta){
  return '<a class="record-row" href="'+esc(url)+'"><strong>'+esc(title)+'</strong><small>'+esc(meta)+'</small></a>';
}
function orderGroups(prefix,statuses,records,row){
  if(!records.length)return '<p class="empty">No matching orders.</p>';
  return statuses.map(status=>{
    const items=records.filter(o=>o.status===status);
    return items.length?fold(prefix+status,status+" ("+items.length+")",items.map(row).join(""),true):"";
  }).join("");
}
const tasks = () => workspace.records.filter(r=>r.kind==="issues");
const taskSelect = (selected="") => select("task","Associated task",[["","Unassigned"],...tasks().map(t=>[t.id,t.title])],selected||"");
function resourceTask(kind,id){
  return team.resource_links.find(l=>l.kind===kind && l.resource===id)?.task;
}
function taskAssociation(kind,id,current=resourceTask(kind,id)){
  const task=tasks().find(t=>t.id===current);
  return (task?'<a class="text-link" href="#task/'+task.id+'">'+esc(task.title)+'</a>':"")+
    form("resource-task",task?"Change linked task":"Link task",hiddenId("kind",kind)+hiddenId("resource",id)+taskSelect(current));
}
function relatedRecords(task){
  const sources={orders:[team.orders,"Purchase"],sales:[team.sales,"Sales order"],commercial:[team.opportunities,"Opportunity"],charts:[team.charts,"Flowchart"]};
  const rows=team.resource_links.filter(l=>l.task===task).map(l=>{
    const [records,label]=sources[l.kind];
    const record=records.find(r=>r.id===l.resource);
    return record?recordRow("#"+l.kind+"/"+record.id,record.title||record.invoice,label):"";
  }).join("");
  return rows?panel("Linked records",rows):"";
}
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
    '<fieldset class="liable wide"><legend>Liable people</legend>'+workspace.users.map(n=>
      '<label><input type="checkbox" name="liable" value="'+esc(n)+'" '+((task.details.liable||[]).includes(n)?"checked ":"")+
      (n===(task.owner||workspace.actor)?"disabled":"")+'>'+esc(person(n))+'</label>').join("")+'</fieldset>'+
    valueInput("record_date","Due date",task.record_date,"date",false)+
    select("priority","Priority",["High","Normal","Low"],task.details.priority||"Normal")+
    valueInput("next_action","Next action (optional)",task.details.next_action,"text",false);
}
const boardState={Open:{expanded:true,sort:"Due date"},Done:{expanded:false,sort:"Due date"}};
function taskRow(task){
  const priority=task.details.priority||"Normal";
  const people=(task.details.liable||[]).map(person).join(", ")||"None";
  const files=team.documents.filter(doc=>doc.task===task.id).map(doc=>{
    const src=doc.preview==="application/pdf"?"/thumbnails/":"/previews/";
    return '<a href="#documents/'+doc.id+'">'+(doc.preview?'<img loading="lazy" src="'+src+doc.id+'" alt="">':"")+
      '<span>'+esc(doc.name)+'</span></a>';
  }).join("");
  return '<article class="board-row"><div><a class="task-title" href="#task/'+task.id+'">'+esc(task.title)+'</a>'+
    '<p>Owner · '+esc(person(task.owner))+'　 Liable · '+esc(people)+'</p></div><div><strong class="priority-pill priority-'+esc(priority.toLowerCase())+'">'+esc(priority)+
    ' priority</strong><p>Due · '+esc(task.record_date||"Unscheduled")+'</p></div><div class="board-files">'+files+'</div></article>';
}
function boardGroup(stage){
  const state=boardState[stage];
  const rank={High:0,Normal:1,Low:2};
  const items=tasks().filter(t=>t.status===stage).sort((a,b)=>{
    const byName=a.title.localeCompare(b.title,undefined,{numeric:true,sensitivity:"base"});
    if(state.sort==="Name")return byName;
    if(state.sort==="Priority")return rank[a.details.priority||"Normal"]-rank[b.details.priority||"Normal"]||byName;
    return (a.record_date||"9999-99-99").localeCompare(b.record_date||"9999-99-99")||byName;
  });
  return '<section class="panel board-shell"><details class="board-group" data-stage="'+stage+'" '+(state.expanded?"open":"")+'><summary>'+stage+
    ' <span class="count">'+items.length+'</span></summary>'+ (items.map(taskRow).join("")||'<p class="empty">No '+stage.toLowerCase()+' tasks.</p>')+
    '</details><label class="sort-chip"><select name="taskSort" aria-label="Sort '+stage+' tasks by">'+
    choices(["Due date","Name","Priority"],state.sort)+'</select></label></section>';
}
function board(){
  return '<button type="button" class="create-task" data-create-task>+ Create task</button>'+
    '<dialog id="create-task" aria-labelledby="create-title"><div class="dialog-head"><h2 id="create-title">Create task</h2>'+
    '<button type="button" class="close" data-dismiss-task aria-label="Close">×</button></div>'+
    '<form class="form-grid" data-op="task">'+taskFields()+'<p class="wide form-error" role="alert"></p><button class="primary">Create task</button></form></dialog>'+
    '<div class="task-stack">'+stages.map(boardGroup).join("")+'</div>';
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
    input("file","Document (optional, up to 20 MiB)","file","")+
    input("body","What was done?","area",'required maxlength="4000"');
  const linkedMeetings=fold("task-meetings-"+task.id,"Linked meetings",team.meeting_tasks.filter(l=>l.task===task.id).map(l=>{
      const meeting=team.meetings.find(m=>m.id===l.meeting);
      return '<a class="text-link" href="#meetings/'+meeting.id+'">'+esc(meeting.day+" · "+meeting.title)+'</a>';
    }).join("")+(team.meetings.length?form("link-meeting","Link workspace meeting",hiddenId("task",task.id)+
      select("meeting","Meeting",team.meetings.map(m=>[m.id,m.day+" · "+m.title]))):"")+(team.calendar_account?form("meeting-search","Link Google meeting",input("query","Search upcoming meetings","search","")+hiddenId("task",task.id))+
      '<div id="meeting-results"></div>':'<a href="/security">Connect Google Calendar to link a meeting</a>'));
  return '<div class="task-detail">'+back+panel(task.title,'<p>'+esc(task.status)+' · '+esc(person(task.owner))+'</p><p>Due date · '+esc(task.record_date||"Unscheduled")+
    '</p>'+(task.details.next_action?'<p>Next action · '+esc(task.details.next_action)+'</p>':"")+
    '<p>Liable people · '+esc((task.details.liable||[]).map(person).join(", ")||"None")+'</p>'+
    (task.notes?'<pre>'+esc(task.notes)+'</pre>':"")+
    '<button class="primary" data-task-status="'+task.id+'">'+(task.status==="Done"?"Move to Open":"Mark as Complete")+'</button>'+
    form("edit-task","Edit task",hiddenId("task",task.id)+taskFields(task)+
      '<label>Notes<textarea name="notes" maxlength="2000">'+esc(task.notes)+'</textarea></label>')+
    '<button class="secondary" data-calendar-task="'+task.id+'">Add to Google Calendar</button>'+
    (task.record_date?"":'<small>The event will use today unless you set a due date.</small>')+
    '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text='+
    encodeURIComponent(task.title+" "+location.href)+'">Share task via WhatsApp ↗</a>')+
    '<aside class="meeting-side">'+linkedMeetings+'</aside>'+relatedRecords(task.id)+panel("Work history",form("task-update","Add work update",updateFields)+
      (history+otherFiles||'<p>No work updates yet.</p>'))+'</div>';
}
function download(doc) {
  if(doc?.size===null)return '<a class="text-link" href="#documents/'+doc.id+'">Draft · add file</a>';
  return '<a class="text-link" href="/downloads/'+doc.id+'">'+esc(doc.name)+' ↓</a>';
}
function attachment(doc) {
  const order=team.sales.find(s=>s.id===doc.sale);
  const preview=doc.preview?.startsWith("image/")?'<a href="/previews/'+doc.id+'" target="_blank" rel="noopener"><img class="order-photo" loading="lazy" src="/previews/'+doc.id+'" alt="'+esc(doc.name)+'"></a>':
    doc.preview==="application/pdf"?'<a class="text-link" target="_blank" rel="noopener" href="/previews/'+doc.id+'">View PDF ↗</a>':"";
  return '<div class="attachment">'+preview+download(doc)+(order?'<a class="text-link" href="#sales/'+order.id+'">SO-'+order.id+' · '+esc(order.title)+'</a>':"")+'</div>';
}
function reader(doc){
  if(doc.size===null)return form("draft-file","Add file",hiddenId("document",doc.id)+input("file","File","file"));
  if(doc.preview?.startsWith("image/"))return '<img class="reader-image" alt="'+esc(doc.name)+'" src="/previews/'+doc.id+'">';
  if(doc.reader)return '<div class="reader-body" data-reader="'+doc.id+'">Loading preview…</div>';
  return '<p>Preview unavailable for this format.</p>';
}
function pdfPage(host,page){
  host.dataset.page=page;
  const pages=Number(host.dataset.pages);
  host.innerHTML='<div class="page-controls"><button data-turn="-1" '+(page===1?"disabled":"")+'>Previous</button> Page '+page+' of '+pages+
    ' <button data-turn="1" '+(page===pages?"disabled":"")+'>Next</button></div><img class="reader-image" alt="Page '+page+'" src="/reader/'+host.dataset.reader+'/'+page+'">';
}
async function loadReader(host,excerpt=false){
  if(!host||host.dataset.loaded)return;
  host.dataset.loaded="1";
  try{
    const result=await api("/reader/"+host.dataset.reader);
    if(result.pages) {host.dataset.pages=result.pages;pdfPage(host,1);}
    else host.textContent=excerpt?result.text.slice(0,1000):result.text;
  }catch(error){host.textContent=error.message;}
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
      row("File size",doc.size===null?"Awaiting file":doc.size.toLocaleString()+" bytes")+
      (task?row("Task",'<a href="#task/'+task.id+'">'+esc(task.title)+'</a>'):"")+
      (sale?row("Sales order",'<a href="#sales/'+sale.id+'">'+esc(sale.title)+'</a>'):"")+
      (order?row("Purchase invoice",esc(order.supplier)+" · "+esc(order.invoice)):"")+'</dl>'+(doc.update_id?'':taskAssociation('documents',doc.id,doc.task))+reader(doc)+download(doc));
  }
  return form("document","Upload a document",taskSelect()+select("sale","Sales order",[["","Unassigned"],...team.sales.map(s=>[s.id,"SO-"+s.id+" · "+s.title])])+input("file","Document · up to 20 MiB","file"))+
    '<div class="document-list">'+team.documents.map(doc=>{
      const details="#documents/"+doc.id;
      const date=doc.uploaded_at?new Date(doc.uploaded_at).toLocaleDateString():"Not recorded";
      const uploader=doc.uploader?person(doc.uploader):"Not recorded";
      const src=doc.preview==="application/pdf"?"/thumbnails/":"/previews/";
      const thumb=doc.preview?'<img loading="lazy" src="'+src+doc.id+'" alt="">':'<span class="file-type">'+esc(doc.name.split(".").pop().slice(0,8).toUpperCase())+'</span>';
      const peek=doc.preview?'<img loading="lazy" src="'+src+doc.id+'" alt="">':doc.reader?'<div data-reader="'+doc.id+'">Loading preview…</div>':"";
      return '<article class="doc-card"><a class="doc-hit" href="'+details+'"><span class="doc-thumb">'+thumb+'</span><span><strong>'+esc(doc.name)+
        '</strong><small>'+esc(date)+' · '+esc(uploader)+'</small></span></a>'+
        (peek?'<div class="doc-peek" aria-hidden="true">'+peek+'</div>':"")+'</article>';
    }).join("")+'</div>';
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
  return fold("month-grid","Calendar",'<div class="cal-controls"><button class="secondary" data-month-shift="-1" aria-label="Previous month">←</button>'+
    input("meetingMonth","Month","month",'value="'+meetingMonth+'"')+
    '<button class="secondary" data-month-shift="1" aria-label="Next month">→</button></div><div class="cal-scroll"><div class="cal-grid">'+days.join("")+'</div></div>',true);
}
function agenda(m){
  const event=team.calendar_meetings.find(e=>e.meeting===m.id);
  const links=team.meeting_tasks.filter(l=>l.meeting===m.id).map(l=>tasks().find(t=>t.id===l.task)).filter(Boolean);
  return (event?'<p>'+esc(event.cancelled?"Cancelled":event.starts)+' '+(event.video?'<a href="'+esc(event.video)+'" target="_blank" rel="noopener">Join Google Meet</a> ':"")+
    (event.link?'<a href="'+esc(event.link)+'" target="_blank" rel="noopener">Google Calendar</a>':"")+'</p>':"")+
    links.map(t=>'<a class="text-link" href="#task/'+t.id+'">'+esc(t.title+" · "+t.status)+'</a>').join("")+
    form("task","Create follow-up task",hiddenId("meeting",m.id)+taskFields())+
    form("meeting-notes","Edit agenda and notes",hiddenId("meeting",m.id)+'<label>Agenda and notes<textarea name="notes" maxlength="30000">'+esc(m.notes)+'</textarea></label>');
}
function openMeeting(card){
  card.closest("details[data-fold]").open=true;
  card.querySelector("details").open=true;
  card.scrollIntoView({block:"start"});
  card.focus({preventScroll:true});
}
function meetings() {
  return (team.calendar_account?fold("calendar-sync","Google Calendar",esc(team.calendar_account.problem||(team.calendar_account.synced?"Last synced "+new Date(team.calendar_account.synced).toLocaleString():"Awaiting first sync"))):"")+meetingCalendar()+form("meeting","Add meeting notes",taskSelect()+select("opportunity","Commercial opportunity",[["","Unassigned"],...team.opportunities.map(o=>[o.id,o.title+" · "+o.customer])])+input("title","Meeting")+input("day","Meeting date","date")+
    input("notes","Notes or transcript","area",'required maxlength="30000"'))+
    fold("meeting-list","Meetings ("+team.meetings.length+")",team.meetings.map(m=>'<div tabindex="-1" id="meeting-'+m.id+'">'+fold("meeting-"+m.id,m.day+" · "+m.title,agenda(m)+(m.opportunity?'<a class="text-link" href="#commercial/'+m.opportunity+'">'+esc(team.opportunities.find(o=>o.id===m.opportunity)?.title)+'</a>':"")+'<small>'+esc(m.day)+'</small>'+calendar(m.title,m.day)+
    '<details><summary>Meeting notes</summary><pre>'+esc(m.notes)+'</pre></details>'+
    (m.summary?'<h3>AI summary</h3><pre>'+esc(m.summary)+'</pre>':'')+
    '<button class="secondary" data-summary="'+m.id+'">'+(m.summary?"Regenerate":"Summarize notes")+'</button>')+'</div>').join("")||'<p>No meetings yet.</p>',true);
}
function charts() {
  const create=form("chart","Create a flowchart",taskSelect()+input("title","Chart name")+
    '<div class="wide"><button type="button" data-open-editor>Open graphical editor</button><flow-canvas editable hidden></flow-canvas></div>');
  const selected=location.hash.split("/")[1];
  return create+team.charts.filter(c=>!selected||String(c.id)===selected).map(c=>
    fold("chart-"+c.id,c.title,taskAssociation("charts",c.id)+'<flow-canvas data-chart="'+c.id+'"></flow-canvas>',Boolean(selected))).join("");
}
function amount(minor) {
  return (minor/100n).toString()+"."+(minor%100n).toString().padStart(2,"0");
}
function orders() {
  const purchaseTotal=o=>BigInt(o.quantity)*BigInt(o.unit_minor)+BigInt(o.extra_minor);
  const id=location.hash.split("/")[1];
  if(id){
    const o=team.orders.find(order=>String(order.id)===id);
    const back='<a class="text-link" href="#orders">← All purchases</a>';
    if(!o)return back+"<p>Purchase unavailable.</p>";
    const total=purchaseTotal(o);
    return back+panel(o.supplier||o.invoice,taskAssociation("orders",o.id)+esc(o.category)+" · <small>Invoice "+esc(o.invoice)+"</small><p>"+o.quantity+" × "+amount(BigInt(o.unit_minor))+" + "+
      amount(BigInt(o.extra_minor))+" = <strong>"+esc(o.currency)+" "+amount(total)+'</strong></p><label>Status <select data-order="'+o.id+'">'+choices(orderStages,o.status)+'</select></label>'+
      download(team.documents.find(d=>d.id===o.document)));
  }
  const totals=new Map();
  const filtered=team.orders.filter(o=>(!purchaseCategory||o.category===purchaseCategory));
  for(const o of filtered){
    if(o.status!=="Cancelled")totals.set(o.currency,(totals.get(o.currency)||0n)+purchaseTotal(o));
  }
  const cards=orderGroups("orders",orderStages,filtered,o=>recordRow("#orders/"+o.id,[o.supplier,o.invoice].filter(Boolean).join(" · "),o.currency+" "+amount(purchaseTotal(o))));
  return form("order","Record an invoice",select("category","Category",["General","R&D","Commercial"])+input("supplier","Supplier (optional)","text","")+input("invoice","Invoice reference")+select("currency","Currency",currencies)+
    input("quantity","Quantity","number",'required min="1" max="999999" value="1"')+
    input("unit","Unit cost","number",'required min="0" step=".01"')+input("extras","Tax and shipping combined","number",'required min="0" step=".01" value="0"')+
    taskSelect()+input("file","Invoice · up to 20 MiB","file"))+
    select("categoryFilter","Filter by category",[["","All categories"],"General","R&D","Commercial"],purchaseCategory)+panel("Committed costs",[...totals].map(([currency,total])=>'<strong>'+esc(currency)+" "+amount(total)+'</strong>').join(" · ")||"No active orders.")+cards;
}
const pages={finances:["Finances",financeDetails],task:["Task details",taskDetail],board:["Tasks",board],meetings:["Meetings",meetings],charts:["Flowcharts",charts],documents:["Documents",documents],orders:["Purchases",orders],commercial:["Commercial overview",commercialOverview],sales:["Sales orders",salesPage]};
function render() {
  const [key]=location.hash.slice(1).split("/");
  const [title,display]=Object.hasOwn(pages,key)?pages[key]:pages.board;
  const detailTitle=location.hash.split("/")[1] && ({sales:"Sales order details",orders:"Purchase details"})[key];
  view.innerHTML='<header class="intro"><h1>'+(detailTitle||title)+'</h1></header>'+display();
  loadReader(view.querySelector(".reader-body"));
  highlightNavigation();
  if(key==="meetings"){
    const card=document.getElementById("meeting-"+location.hash.split("/")[1]);
    if(card)openMeeting(card);
  }
}
async function api(url,data,method="POST") {
  const response=await fetch(url,data?{method,headers:{"Content-Type":"application/json","X-Fieldbench":"1"},body:JSON.stringify(data)}:{});
  const result=await response.json();
  if(!response.ok) throw Error(result.error||"Request failed.");
  return result;
}
async function refresh() {
  [workspace,team]=await Promise.all([api("/api/workspace"),api("/api/team")]);
  showProfile(person(workspace.actor));
  document.querySelector("#community").innerHTML=team.community?'<a target="_blank" rel="noopener noreferrer" href="'+esc(team.community)+'">WhatsApp community ↗</a>':"";
  render();
}
async function perform(control,action) {
  control.disabled=true;
  feedback.textContent="Working…";
  try { await action(); await refresh(); feedback.textContent="Saved."; }
  catch(error){
    feedback.textContent=error.message;
    const local=control.closest("dialog")?.querySelector(".form-error");
    if(local)local.textContent=error.message;
    control.disabled=false;
  }
}
view.addEventListener("submit",event=>{
  event.preventDefault();
  const form=event.target,op=form.dataset.op;
  if(op==="meeting-search"){
    searchMeetings(form).catch(error=>feedback.textContent=error.message);
    return;
  }
  perform(form.querySelector("button.primary") || form.querySelector("button"),async()=>{
    const fields=new FormData(form);
    const data=Object.fromEntries(fields);
    if(op==="chart")data.graph=form.querySelector("flow-canvas").graph;
    if(op==="task"||op==="edit-task")data.liable=fields.getAll("liable");
    if (["lead","sale","convert","fulfillment","item","charge","payment","allocate","document","task-update"].includes(op)) {
      form.dataset.key ||= crypto.randomUUID();
      data.request_key=form.dataset.key;
    }
    if(data.file instanceof File && !data.file.name) delete data.file;
    if(data.file instanceof File){
      if(!data.file.size||data.file.size>20*1024*1024) throw Error("Choose a nonempty file up to 20 MiB.");
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
      if(op==="meeting" && data.day)meetingMonth=data.day.slice(0,7);
    }
  });
});
view.addEventListener("change",event=>{
  const control=event.target;
  if(control.name==="categoryFilter"){purchaseCategory=control.value;render();return;}
  if(control.name==="owner"){
    for(const box of control.form.querySelectorAll('[name="liable"]')){
      box.disabled=box.value===control.value;
      if(box.disabled)box.checked=false;
    }
  }
  if(control.name==="taskSort"){
    const shell=control.closest(".board-shell");
    const group=shell.querySelector("details");
    boardState[group.dataset.stage].sort=control.value;
    boardState[group.dataset.stage].expanded=group.open;
    const stage=group.dataset.stage;
    shell.outerHTML=boardGroup(stage);
    view.querySelector('[data-stage="'+stage+'"] + label select').focus();
    return;
  }
  if(control.name==="displayCurrency"){displayCurrency=control.value;render();return;}
  if(control.name==="meetingMonth" && control.value){meetingMonth=control.value;render();return;}
  if(control.dataset.order){
    const id=Number(control.dataset.order),status=control.value;
    control.value=team.orders.find(o=>o.id===id).status;
    perform(control,()=>api("/api/team/order-status",{id,status}));
  }
});
async function searchMeetings(form,page=""){
  const container=document.querySelector("#meeting-results");
  const task=form.elements.task.value;
  const result=await api("/api/google/search",{query:form.elements.query.value,page});
  if(!container.isConnected)return;
  container.innerHTML=(result.items||[]).map(e=>'<p>'+esc((e.start.dateTime||e.start.date)+" · "+(e.summary||"Untitled meeting"))+
    ' <button class="secondary" data-link-event="'+esc(e.id)+'" data-task="'+esc(task)+'">Link to task</button></p>').join("")||"<p>No matching meetings.</p>";
  if(result.nextPageToken)container.innerHTML+='<button class="secondary" data-events-page="'+esc(result.nextPageToken)+'">Next meetings</button>';
}
view.addEventListener("toggle",event=>{
  if(event.target.isConnected && event.target.dataset.fold)foldStates.set(event.target.dataset.fold,event.target.open);
  if(event.target.isConnected && event.target.dataset.stage)boardState[event.target.dataset.stage].expanded=event.target.open;
},true);
for(const trigger of ["pointerover","focusin"]){
  view.addEventListener(trigger,event=>loadReader(event.target.closest(".doc-card")?.querySelector(".doc-peek [data-reader]"),true));
}
view.addEventListener("click",async event=>{
  const opener=event.target.closest("[data-show-form]");
  if(opener){opener.nextElementSibling.showModal();return;}
  if(event.target.closest("[data-close-form]")){event.target.closest("dialog").close();return;}
  const turn=event.target.closest("[data-turn]");
  if(turn){const host=turn.closest(".reader-body");pdfPage(host,Number(host.dataset.page)+Number(turn.dataset.turn));return;}
  if(event.target.closest("[data-create-task]")){view.querySelector("#create-task").showModal();return;}
  if(event.target.closest("[data-dismiss-task]")){view.querySelector("#create-task").close();return;}
  const link=event.target.closest("[data-link-event]");
  if(link){perform(link,()=>api("/api/google/link",{task:link.dataset.task,event:link.dataset.linkEvent}));return;}
  const page=event.target.closest("[data-events-page]");
  if(page){searchMeetings(view.querySelector('[data-op="meeting-search"]'),page.dataset.eventsPage).catch(e=>feedback.textContent=e.message);return;}
  const calendarButton=event.target.closest("[data-calendar-task]");
  if(calendarButton){
    calendarButton.disabled=true;
    try {
      const result=await api("/api/google/add",{task:Number(calendarButton.dataset.calendarTask),today:dateNow()});
      location.assign(result.url);
    } catch(error){feedback.textContent=error.message;calendarButton.disabled=false;}
    return;
  }
  const toggle=event.target.closest("[data-task-status]");
  if(toggle){
    const task=tasks().find(t=>t.id===Number(toggle.dataset.taskStatus));
    const status=task.status==="Done"?"Open":"Done";
    perform(toggle,()=>api("/api/records/"+task.id,{...task,...task.details,status},"PUT"));
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
    openMeeting(card);
  }
  const button=event.target.closest("[data-summary]");
  if(button) perform(button,()=>api("/api/team/summarize",{id:Number(button.dataset.summary)}));
});
window.addEventListener("hashchange",()=>{if(team)render();});
refresh().catch(error=>feedback.textContent=error.message);

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
