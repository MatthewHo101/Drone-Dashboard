"use strict";

function legacyFlow(source) {
  const pairs = source.split(/\r?\n/).filter(Boolean).map(line => line.split("->").map(s => s.trim()));
  const labels = [...new Set(pairs.flat())];
  const radius = Math.max(140, labels.length * 34);
  const nodes = labels.map((label, id) => {
    const angle = 2 * Math.PI * id / labels.length;
    return {id, label, shape:"step", x:Math.round(radius*Math.cos(angle)), y:Math.round(radius*Math.sin(angle))};
  });
  return {nodes, links:pairs.map(pair => pair.map(label => labels.indexOf(label)))};
}

class FlowCanvas extends HTMLElement {
  connectedCallback() {
    this.editable = this.hasAttribute("editable");
    const chart = team.charts.find(c => String(c.id) === this.dataset.chart);
    this.graph = chart?.graph ? JSON.parse(chart.graph) : legacyFlow(chart?.edges || "");
    this.selected = null;
    this.connecting = false;
    const button = (action, label) => '<button type="button" data-tool="'+action+'">'+label+'</button>';
    this.history = [];
    this.linkIndex = null;
    const palette = [["step","Rectangle"],["decision","Diamond"],["terminal","Capsule"]].map(([key,name])=>{
      const icon = key==="decision" ? '<polygon points="2,12 24,1 46,12 24,23"/>' :
        '<rect x="2" y="2" width="44" height="20" rx="'+(key==="terminal"?10:1)+'"/>';
      return button(key,'<svg viewBox="0 0 48 24" width="48" height="24" aria-hidden="true">'+icon+'</svg>'+name);
    }).join("");
    const shapes = this.editable ? '<div class="flow-tools flow-palette">'+palette+'</div><div class="flow-tools">'+
      button("connect","Connect shapes")+button("reverse","Reverse connection")+button("undo","Undo")+button("delete","Delete shape")+'</div>'+
      '<label>Shape label<input data-label maxlength="100" disabled></label>' : "";
    this.innerHTML = shapes+'<div class="flow-tools">'+button("out","Zoom out")+button("in","Zoom in")+button("fit","Fit chart")+
      '</div><svg class="flow-surface" aria-label="Flowchart canvas" tabindex="0"><defs><marker id="flow-arrow-'+(this.editable?"edit-":"view-")+(chart?.id || "new")+
      '" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z"/></marker></defs><g></g></svg>'+
      '<small role="status"></small>';
    this.svg = this.querySelector(".flow-surface");
    this.layer = this.svg.querySelector("g");
    this.marker = this.svg.querySelector("marker").id;
    if (this.editable) {
      const grid = "grid-"+this.marker;
      this.svg.querySelector("defs").insertAdjacentHTML("beforeend",'<pattern id="'+grid+'" patternUnits="userSpaceOnUse" width="20" height="20"><path d="M20 0 H0 V20" fill="none" stroke="#d2ddd5"/></pattern>');
      this.layer.insertAdjacentHTML("beforebegin",'<rect data-grid fill="url(#'+grid+')"/>');
    }
    this.note(this.editable ? "Add a shape, drag it into place, or drag the background to pan." : "Drag to pan. Use the wheel or zoom buttons to change scale.");
    this.fit();
    if(this.hasAttribute("thumbnail")){
      this.querySelector(".flow-tools").remove();
      this.querySelector("small").remove();
      this.svg.removeAttribute("tabindex");
      return;
    }
    this.onclick = e => {
      const tool = e.target.closest("[data-tool]")?.dataset.tool;
      if (tool) this.tool(tool);
    };
    if (this.editable) this.querySelector("[data-label]").oninput = e => {
      const node = this.graph.nodes.find(n => n.id === this.selected);
      if (node) { if (!this.typing) this.remember(); this.typing=true; node.label = e.target.value; this.draw(); }
    };
    if (this.editable) this.querySelector("[data-label]").onblur = () => { this.typing=false; };
    this.svg.onpointerdown = e => this.start(e);
    this.svg.onpointermove = e => this.move(e);
    this.svg.onpointerup = this.svg.onpointercancel = () => { this.drag = null; this.guides=null; this.draw(); };
    this.svg.onwheel = e => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 0.85 : 1/0.85, this.point(e)); };
    this.svg.onkeydown = e => {
      const dirs = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
      if (dirs[e.key]) {
        e.preventDefault();
        this.cx += dirs[e.key][0]*this.width/10;
        this.cy += dirs[e.key][1]*this.width/10;
        this.camera();
      }
    };
  }
  note(text) { this.querySelector("small").textContent = text; }
  fit() {
    const nodes = this.graph.nodes;
    const xs = nodes.map(n=>n.x), ys = nodes.map(n=>n.y);
    const bounds = a => a.length ? [Math.min(...a),Math.max(...a)] : [0,0];
    const [left,right] = bounds(xs), [top,bottom] = bounds(ys);
    this.cx = (left+right)/2; this.cy = (top+bottom)/2;
    this.width = Math.max(600,right-left+220,(bottom-top+110)*2);
    this.camera(); this.draw();
  }
  camera() {
    const grid=this.svg.querySelector("[data-grid]");
    if(grid) {
      grid.setAttribute("x",this.cx-this.width*5); grid.setAttribute("y",this.cy-this.width*5);
      grid.setAttribute("width",this.width*10); grid.setAttribute("height",this.width*10);
    }
    this.svg.setAttribute("viewBox",[this.cx-this.width/2,this.cy-this.width/4,this.width,this.width/2].join(" "));
  }
  point(e) { return new DOMPoint(e.clientX,e.clientY).matrixTransform(this.svg.getScreenCTM().inverse()); }
  zoom(factor, anchor={x:this.cx,y:this.cy}) {
    const w = Math.min(5000000, Math.max(120,this.width*factor));
    this.cx = anchor.x+(this.cx-anchor.x)*w/this.width;
    this.cy = anchor.y+(this.cy-anchor.y)*w/this.width;
    this.width = w; this.camera();
  }
  remember() {
    this.history.push(JSON.stringify(this.graph));
    if(this.history.length>60)this.history.shift();
  }
  select(id) {
    this.linkIndex=null;
    this.selected = id;
    const field = this.querySelector("[data-label]");
    const node = this.graph.nodes.find(n=>n.id===id);
    field.disabled = !node; field.value = node?.label || "";
    this.draw();
  }
  tool(action) {
    if (action==="fit") return this.fit();
    if (action==="in" || action==="out") return this.zoom(action==="in"?0.8:1.25);
    if (action==="connect") {
      this.connecting = !this.connecting; this.source = null;
      this.note(this.connecting?"Select the starting shape, then the destination.":"Connection cancelled.");
      this.querySelector('[data-tool="connect"]').setAttribute("aria-pressed",String(this.connecting));
      return;
    }
    if (this.connecting) this.tool("connect");
    if (action==="undo") {
      if(this.history.length)this.graph=JSON.parse(this.history.pop());
      this.select(null); this.note("Last edit undone."); return;
    }
    if (action==="reverse") {
      const link=this.graph.links[this.linkIndex];
      if(!link)return;
      if(this.graph.links.some(([a,b])=>a===link[1] && b===link[0]))return this.note("That direction already exists.");
      this.remember(); link.reverse(); this.draw(); this.note("Connection reversed."); return;
    }
    if (action==="delete") {
      if(this.selected===null)return;
      this.remember();
      this.graph.nodes = this.graph.nodes.filter(n=>n.id!==this.selected);
      this.graph.links = this.graph.links.filter(link=>!link.includes(this.selected));
      this.select(null); return;
    }
    if (this.graph.nodes.length>=200) return this.note("Shape limit reached.");
    this.remember();
    const id = Math.max(0,...this.graph.nodes.map(n=>n.id))+1;
    let x=20*Math.round(this.cx/20), y=20*Math.round(this.cy/20);
    while(this.graph.nodes.some(n=>n.x===x && n.y===y)){ x+=40; y+=40; }
    this.graph.nodes.push({id,x,y,shape:action,label:{step:"Rectangle",decision:"Diamond",terminal:"Capsule"}[action]});
    this.select(id);
    const field = this.querySelector("[data-label]"); field.focus(); field.select();
  }
  start(e) {
    if (e.button!==0) return;
    const edge=e.target.closest("[data-link]");
    if(this.editable && edge && !this.connecting){
      this.select(null); this.linkIndex=Number(edge.dataset.link); this.draw();
      this.note("Connection selected."); return;
    }
    const group=e.target.closest("[data-node]");
    const node=this.editable && group && this.graph.nodes.find(n=>n.id===Number(group.dataset.node));
    if (node && this.connecting) {
      if (this.source===null) { this.source=node.id; this.select(node.id); this.note("Select the destination shape."); }
      else {
        if (this.graph.links.length>=500) return this.note("Connection limit reached.");
        if (!this.graph.links.some(([a,b])=>a===this.source && b===node.id)) { this.remember(); this.graph.links.push([this.source,node.id]); }
        this.tool("connect"); this.note("Shapes connected."); this.select(node.id);
      }
      return;
    }
    if (node) this.select(node.id);
    this.drag={node,point:this.point(e),x:node?.x,y:node?.y};
    this.svg.setPointerCapture(e.pointerId);
  }
  move(e) {
    if (!this.drag) return;
    const p=this.point(e), dx=p.x-this.drag.point.x, dy=p.y-this.drag.point.y;
    if (this.drag.node) {
      const node=this.drag.node;
      const tolerance=8/this.svg.getScreenCTM().a;
      const guides={};
      const snap=(axis,value)=>{
        let distance=tolerance;
        for(const other of this.graph.nodes){
          const gap=Math.abs(other[axis]-value);
          if(other!==node && gap<=distance){ guides[axis]=other[axis]; distance=gap; }
        }
        return guides[axis] ?? Math.round(value/20)*20;
      };
      const x=snap("x",this.drag.x+dx), y=snap("y",this.drag.y+dy);
      if(x===node.x && y===node.y)return;
      if(!this.drag.changed){ this.remember(); this.drag.changed=true; }
      node.x=x; node.y=y; this.guides=guides; this.draw();
    } else { this.cx-=dx; this.cy-=dy; this.camera(); }
  }
  draw() {
    const nodes=new Map(this.graph.nodes.map(n=>[n.id,n]));
    const lines=this.graph.links.map(([a,b],index)=>{
      const from=nodes.get(a), to=nodes.get(b);
      const dx=to.x-from.x, dy=to.y-from.y;
      const fraction=to.shape==="decision"?1/(Math.abs(dx)/76+Math.abs(dy)/32):Math.min(76/Math.abs(dx),28/Math.abs(dy));
      const path=dx||dy?'M '+from.x+' '+from.y+' L '+(to.x-dx*fraction)+' '+(to.y-dy*fraction):
        'M '+from.x+' '+(from.y-24)+' c -60 -70 60 -70 12 -8';
      const hit=this.editable?'<path data-link="'+index+'" d="'+path+'" fill="none" stroke="transparent" stroke-width="16" vector-effect="non-scaling-stroke"/>':"";
      return hit+'<path class="flow-link '+(this.linkIndex===index?"chosen":"")+'" pointer-events="none" d="'+path+'" marker-end="url(#'+this.marker+')"/>';
    });
    const shapes=this.graph.nodes.map(n=>{
      const shape=n.shape==="decision"?'<polygon points="-76,0 0,-32 76,0 0,32"/>':
        '<rect x="-76" y="-28" width="152" height="56" rx="'+(n.shape==="terminal"?28:5)+'"/>';
      const label=n.label.length>17?n.label.slice(0,16)+"…":n.label;
      return '<g data-node="'+n.id+'" class="'+(n.id===this.selected?"selected":"")+'" transform="translate('+n.x+' '+n.y+')"><title>'+
        esc(n.label)+'</title>'+shape+'<text text-anchor="middle" dominant-baseline="middle">'+esc(label)+'</text></g>';
    });
    let guides="";
    if(this.editable){
      this.querySelector('[data-tool="undo"]').disabled=!this.history.length;
      this.querySelector('[data-tool="reverse"]').disabled=this.linkIndex===null;
      this.querySelector('[data-tool="delete"]').disabled=this.selected===null;
      if(this.guides?.x!==undefined)guides+='<path d="M '+this.guides.x+' '+(this.cy-this.width)+' v '+2*this.width+'"/>';
      if(this.guides?.y!==undefined)guides+='<path d="M '+(this.cx-this.width)+' '+this.guides.y+' h '+2*this.width+'"/>';
    }
    this.layer.innerHTML='<g class="flow-guides">'+guides+'</g>'+lines.join("")+shapes.join("");
  }
}
customElements.define("flow-canvas",FlowCanvas);
document.addEventListener("click", e=>{
  const button=e.target.closest("[data-open-editor]");
  if(button){button.hidden=true;button.nextElementSibling.hidden=false;}
});
