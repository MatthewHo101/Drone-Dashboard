"use strict";

const pipelineStages = ["Discovery","Qualified","Quoted","Lost"];
const deliveryStages = ["Confirmed","In progress","Delivered","Cancelled"];
const hiddenId = (name,value) => '<input type="hidden" name="'+name+'" value="'+esc(value)+'">';
const dateNow = () => {
  const now = new Date();
  return [now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
};
function cash(minor) {
  const value = BigInt(minor);
  return (value<0n ? "-" : "")+amount(value<0n ? -value : value);
}
function moneyInput(name,label,minor,required=true) {
  return input(name,label,"number",(required?"required ":"")+'min="0" step="0.01" max="100000000" value="'+(minor==null?"":cash(minor))+'"');
}
function valueInput(name,label,value="",type="text",required=true) {
  return input(name,label,type,(required?"required ":"")+'value="'+esc(value)+'"');
}
function saleTotals(sale) {
  const items=team.sale_items.filter(i=>i.sale===sale.id);
  let revenue=0n, costs=0n, paid=0n;
  for(const item of items) {
    revenue+=BigInt(item.quantity)*BigInt(item.price);
    costs+=BigInt(item.quantity)*BigInt(item.cost??0);
  }
  for(const entry of team.sale_entries.filter(e=>e.sale===sale.id)){
    if(entry.kind==="charge") costs+=BigInt(entry.amount);
    else paid+=BigInt(entry.amount);
  }
  for(const entry of team.allocations.filter(e=>e.sale===sale.id)) costs+=BigInt(entry.amount);
  return {revenue,costs,paid,profit:revenue-costs,balance:revenue-paid,complete:items.length>0&&items.every(i=>i.cost!==null)};
}
function margin(profit,revenue) {
  return revenue ? (Number(profit*1000n/revenue)/10).toFixed(1)+"%" : "—";
}
function leadFields(o={}) {
  return (o.id?hiddenId("lead",o.id):"")+valueInput("customer","Customer",o.customer)+valueInput("title","Opportunity",o.title)+
    select("owner","Owner",workspace.users.map(n=>[n,person(n)]),o.owner||workspace.actor)+select("stage","Stage",pipelineStages,o.stage)+
    select("currency","Currency",currencies,o.currency)+moneyInput("quote","Expected revenue",o.quote??0,false)+moneyInput("estimate","Estimated cost",o.estimate??0,false)+
    valueInput("due","Follow-up date",o.due,"date",false)+taskSelect(resourceTask("commercial",o.id))+
    '<label class="wide">Description<textarea name="action" rows="5" maxlength="4000">'+esc(o.action||"")+'</textarea></label>';
}
function commercialOverview() {
  const linked=new Map(team.sales.filter(s=>s.opportunity).map(s=>[s.opportunity,s]));
  const report=team.overview;
  const values=report.totals[displayCurrency];
  const format=value=>value===null?"Rate unavailable":esc(displayCurrency)+" "+cash(value);
  const detailUrl="#finances/"+displayCurrency;
  const summaries='<section class="panel"><div class="finance-head"><a href="'+detailUrl+'">Finances <span aria-hidden="true">›</span></a>'+
    '<label class="sort-chip currency-chip"><select aria-label="Display currency" name="displayCurrency">'+choices(currencies,displayCurrency)+'</select></label></div>'+
    '<a class="finance-summary" href="'+detailUrl+'" aria-label="View finance details in '+displayCurrency+'"><dl class="delivery-totals">'+
    '<div><dt>Revenue</dt><dd>'+format(values.revenue)+'</dd></div><div><dt>Cost</dt><dd>'+format(values.cost)+'</dd></div></dl></a></section>';
  const selected=Number(location.hash.split("/")[1]);
  const cards=team.opportunities.filter(o=>!selected||o.id===selected).map(o=>{
    const sale=linked.get(o.id);
    if(!selected)return recordRow("#commercial/"+o.id,o.title,[sale?"Won":o.stage,o.action?.length>140?o.action.slice(0,137)+"…":o.action].filter(Boolean).join(" · "));
    const actions=sale?'<a class="text-link" href="#sales/'+sale.id+'">Open sales order SO-'+sale.id+'</a>':
      form("lead","Edit opportunity",leadFields(o))+(o.stage==="Lost"?"":form("convert","Convert quote to sales order",hiddenId("lead",o.id)));
    return panel(o.title,'<p>'+esc(o.customer)+' · '+esc(sale?"Won":o.stage)+' · '+esc(person(o.owner))+'</p><p>'+esc(o.currency)+' '+cash(o.quote)+
      ' expected revenue · '+cash(BigInt(o.quote)-BigInt(o.estimate))+' estimated profit</p><p>'+esc(o.action)+' · '+esc(o.due||"No follow-up date")+'</p>'+
      taskAssociation("commercial",o.id)+actions);
  }).join("");
  if(selected)return '<a class="text-link" href="#commercial">← Pipeline</a>'+(cards||"<p>Opportunity unavailable.</p>");
  return summaries+form("lead","New opportunity",leadFields()) +fold("pipeline","Pipeline ("+team.opportunities.length+")",
    cards||'<p class="empty">No opportunities yet.</p>',true);
}
function financeDetails(){
  const report=team.overview;
  const requested=location.hash.split("/")[1];
  const code=currencies.includes(requested)?requested:"GBP";
  const amounts=report.totals[code];
  displayCurrency=code;
  return '<a class="text-link" href="#commercial">← Commercial overview</a>'+(report.rate_day?'<p>Exchange rates · '+esc(report.rate_day)+'</p>':"")+["Revenue","Cost"].map(kind=>{
    const grouped=new Map();
    for(const line of report.lines.filter(l=>l.kind===kind)){
      const entries=grouped.get(line.currency)||[];
      entries.push(line);
      grouped.set(line.currency,entries);
    }
    const breakdown=[...grouped].map(([currency,entries])=>{
      const subtotal=entries.reduce((sum,l)=>sum+BigInt(l.amount),0n);
      const rows=entries.map(l=>recordRow("#"+l.route,l.label,currency+" "+cash(l.unit)+" × "+l.quantity+
        (BigInt(l.extra)?" + "+cash(l.extra)+" tax/shipping":"")+" = "+cash(l.amount))).join("");
      const rate=currency===code?"":report.rates[code]&&report.rates[currency]?
        " × "+report.rates[code]+" ÷ "+report.rates[currency]+" ("+code+")":" · Rate unavailable";
      return rows+"<p>Subtotal · "+currency+" "+cash(subtotal)+esc(rate)+"</p>";
    }).join("");
    const total=amounts[kind.toLowerCase()];
    return fold("finance-"+kind,kind+" · "+(total===null?"Rate unavailable":code+" "+cash(total)),breakdown||"<p>No entries.</p>");
  }).join("");
}
function itemFields(sale,item={}) {
  return hiddenId("sale",sale.id)+(item.id?hiddenId("item",item.id):"")+valueInput("label","Item",item.label)+
    input("quantity","Quantity","number",'required min="1" max="999999" value="'+esc(item.quantity??1)+'"')+
    moneyInput("price","Net unit price · "+sale.currency,item.price)+moneyInput("cost","Other direct cost per unit (exclude allocated purchases)",item.cost,false);
}
function salePanel(s) {
  const t=saleTotals(s), money=n=>esc(s.currency)+" "+cash(n), saleId=hiddenId("sale",s.id);
  const entries=team.sale_entries.filter(e=>e.sale===s.id);
  const docs=team.documents.filter(d=>d.sale===s.id);
  const linked=team.opportunities.find(o=>o.id===s.opportunity);
  const costs=team.allocations.filter(a=>a.sale===s.id).map(a=>{
    const p=team.orders.find(p=>p.id===a.purchase);
    return '<p>'+esc(p.supplier)+' · '+esc(p.invoice)+' · '+a.quantity+' units · '+money(a.amount)+'</p>';
  }).join("");
  const purchases=team.orders.filter(o=>o.currency===s.currency&&o.status!=="Cancelled");
  const allocations=purchases.length?form("allocate","Allocate purchased units",saleId+select("purchase","Purchase",purchases.map(p=>[p.id,p.invoice+" · "+p.supplier]))+
    input("quantity","Units assigned","number",'required min="1" max="999999"')):"";
  const items=team.sale_items.filter(i=>i.sale===s.id).map(i=>'<p><strong>'+esc(i.label)+'</strong> · '+i.quantity+' × '+money(i.price)+'</p>'+
    form("item","Edit item",itemFields(s,i))).join("");
  const entryForm=(op,title)=>form(op,title,saleId+input("label","Description")+moneyInput("amount","Amount · "+s.currency)+valueInput("day","Date",dateNow(),"date"));
  return panel("SO-"+s.id+" · "+s.title,'<p>'+esc(s.customer)+' · '+esc(s.status)+(s.due?" · Due "+esc(s.due):"")+'</p>'+
    (linked?'<p>From opportunity: '+esc(linked.title)+'</p>':"")+taskAssociation("sales",s.id)+
    '<dl class="details">'+[["Net sales",money(t.revenue)],["Recorded costs",money(t.costs)],["Gross profit",t.complete?money(t.profit):"Awaiting item costs"],
    ["Margin",t.complete?margin(t.profit,t.revenue):"—"],["Payments received",money(t.paid)],["Balance",money(t.balance)]].map(([l,v])=>'<div class="detail-item"><dt>'+l+'</dt><dd>'+v+'</dd></div>').join("")+'</dl>'+
    form("fulfillment","Update delivery",saleId+select("status","Fulfillment",deliveryStages,s.status)+valueInput("due","Delivery date",s.due,"date",false))+
    '<h3>Order items</h3>'+items+form("item","Add item",itemFields(s))+
    '<h3>Costs and payments</h3>'+entries.map(e=>'<p>'+esc(e.day)+' · '+(e.kind==="charge"?"One-time cost":"Payment")+' · '+esc(e.label)+' · '+money(e.amount)+'</p>').join("")+
    costs+entryForm("charge","Add one-time cost")+entryForm("payment","Record payment")+allocations+
    '<h3>Photos and documents</h3>'+docs.map(attachment).join("")+form("document","Attach file",hiddenId("origin","sale")+saleId+taskSelect(resourceTask("sales",s.id))+input("file","Photo or order document · up to 20 MiB","file")));
}
function salesPage() {
  const selected=Number(location.hash.split("/")[1]);
  if(selected){
    const sale=team.sales.find(s=>s.id===selected);
    return '<a class="text-link" href="#sales">← All sales orders</a>'+(sale?salePanel(sale):'<p>Order unavailable.</p>');
  }
  return form("sale","New sales order",input("customer","Customer")+input("title","Order description")+select("currency","Currency",currencies)+
    moneyInput("received","Amount received",0,false)+valueInput("paid_on","Payment date",dateNow(),"date")+
    valueInput("due","Delivery date","","date",false)+taskSelect())+
    orderGroups("sales",deliveryStages,team.sales,s=>recordRow("#sales/"+s.id,"SO-"+s.id+" · "+s.title,
      s.customer+" · "+s.currency+" "+cash(saleTotals(s).revenue)));
}
