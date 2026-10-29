"use strict";Object.defineProperties(exports,{__esModule:{value:!0},[Symbol.toStringTag]:{value:"Module"}});const W=require("@opencode/plugin/gui"),pt='[data-slot="session-timeline-scroll"]',ut="data-pomx-rail",k="data-pomx-item",mt="pomx-message-flash",U="is-active",Z="reveal",Y=20,gt=110,ht=100,j=56,J=110,ft=40,X=160,xt=560,vt=400,bt=2e3,wt=`
/* Workbuddy-style rail: chromeless tick track on the right edge. The
   container is pointer-transparent so the native scrollbar, buttons and
   wheel scrolling of the underlying timeline keep working; only the tick
   buttons capture the pointer. */
[data-pomx-rail] {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding: 0;
  background: transparent;
  border: none;
  backdrop-filter: none;
  z-index: 45;
  pointer-events: none;
  user-select: none;
}
[data-pomx-rail] .pomx-head {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 2px;
  font-size: 10px;
  line-height: 1;
  padding: 0 6px 5px 0;
  width: 100%;
  white-space: nowrap;
  color: var(--v2-text-text-faint, var(--v2-alpha-dark-40, rgba(0, 0, 0, 0.4)));
}
[data-pomx-rail] .pomx-head .pomx-idx-current {
  color: var(--v2-text-text-accent, currentColor);
  font-weight: 600;
}
[data-pomx-rail] .pomx-track {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  min-height: 12px;
  width: 40px; /* 22px tick column + 18px reserved numeral column: layers never overlap */
  overflow: hidden auto;
  scrollbar-width: none;
  pointer-events: none;
  padding: 4px 2px;
  border-radius: 8px;
  mask-image: linear-gradient(to bottom, transparent, #000 10px, #000 calc(100% - 10px), transparent);
}
[data-pomx-rail] [${k}] {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 22px;
  height: 10px;
  padding: 0 1px;
  border: none;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  pointer-events: auto;
}
[data-pomx-rail] [${k}]:hover {
  background: var(--v2-overlay-simple-overlay-hover, rgba(0, 0, 0, 0.04));
}
[data-pomx-rail] .pomx-tick {
  display: block;
  width: 10px;
  height: 2px;
  border-radius: 2px;
  background: var(--v2-alpha-dark-20, rgba(0, 0, 0, 0.2));
  transition: width 0.15s ease, height 0.15s ease, background-color 0.15s ease;
}
[data-pomx-rail] [${k}]:hover .pomx-tick {
  width: 14px;
  height: 3px;
  background: var(--v2-alpha-dark-60, rgba(0, 0, 0, 0.6));
}
[data-pomx-rail] [${k}].is-active {
  background: var(--v2-overlay-simple-overlay-hover, rgba(0, 0, 0, 0.04));
}
[data-pomx-rail] [${k}].is-active .pomx-tick {
  width: 18px;
  height: 3px;
  background: var(--v2-icon-icon-accent, var(--v2-background-bg-accent, currentColor));
}
[data-pomx-rail] .pomx-num {
  position: absolute;
  right: 25px; /* lives in its own column, left of the 22px tick column */
  font-size: 9px;
  line-height: 10px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--v2-text-text-faint, var(--v2-alpha-dark-40, rgba(0, 0, 0, 0.4)));
  opacity: 0;
  transition: opacity 0.12s ease;
  pointer-events: none;
}
[data-pomx-rail]:hover .pomx-num.${Z} {
  opacity: 1;
}
[data-pomx-rail] .pomx-tip {
  position: absolute;
  right: calc(100% + 10px);
  top: 0;
  max-width: 280px;
  display: none;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--v2-background-bg-inverse, #161616);
  color: var(--v2-text-text-inverse, #f5f5f5);
  font-size: 11px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: var(--v2-elevation-floating, 0 4px 12px rgba(0, 0, 0, 0.2));
  pointer-events: none;
  z-index: 2;
}
[data-pomx-rail] .pomx-tip.is-shown {
  display: block;
}
[data-pomx-rail] .pomx-tip .pomx-tip-idx {
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
  margin-inline-end: 6px;
}
/* Locate flash on the target message — a subtle accent frame with app tokens. */
[data-message-id].pomx-message-flash {
  background: color-mix(in oklab, var(--v2-background-bg-accent, #2563eb) 9%, transparent) !important;
  box-shadow: inset 2px 0 0 0 var(--v2-background-bg-accent, #2563eb);
  border-radius: 6px;
  transition: background-color 0.25s ease;
}
`,yt=(u,h=110)=>{const C=u.replace(/\s+/g," ").trim();return C.length>h?`${C.slice(0,h-1)}…`:C||"(empty input)"},kt=u=>{if(!u)return"";const h=new Date(u);return`${String(h.getHours()).padStart(2,"0")}:${String(h.getMinutes()).padStart(2,"0")}`},Mt=u=>u.replace(/[^\w-]/g,h=>`\\${h}`),Q=u=>`[data-timeline-key="user-message:${Mt(u)}"]`,St=W.Plugin.define({i18n:{en:{"command.navigator.toggle":"Toggle prompt navigation rail","command.navigator.description":"Show or hide the input-history navigation rail beside the timeline"}},setup(u){const h=u.options??{},C=typeof h.inset=="number"?h.inset:16,f=new Map;let y=0,$,E="",R=0,M;const A={value:h.enabled!==!1},tt=()=>A.value;u.add(W.Command,()=>({id:"toggle-rail",title:u.t("command.navigator.toggle"),description:u.t("command.navigator.description"),group:"Prompt",bind:"mod+alt+n",run:()=>{A.value=!A.value,A.value?H():V()}})),u.add(W.Style,wt);const L=t=>u.servers.get(t||"sidecar")?.data,N=t=>{const n=t.slice(0,t.indexOf(`
`))||"sidecar",e=t.slice(t.indexOf(`
`)+1),s=L(n);if(!s||!e)return[];const a=s.session.message.list(e)??[],o=[];for(const r of a){if(r.type!=="user")continue;const i=r;o.push({id:i.id,idx:o.length+1,text:yt(i.text??""),created:i.time?.created??0})}return o},F=t=>{const n=t.slice(0,t.indexOf(`
`))||"sidecar",e=t.slice(t.indexOf(`
`)+1),s=L(n);!s||!e||s.session.message.sync(e).catch(()=>{})},D=()=>{const t=u.sessions.current();return t?`${t.server.id}
${t.id}`:""},et="[data-scrollable], .scroll-view__viewport",G=t=>t.querySelector(et)??(getComputedStyle(t).overflowY.split(" ").some(n=>n==="auto"||n==="scroll"),t),nt=t=>{let n=t.parentElement;for(;n&&getComputedStyle(n).position==="static";)n=n.parentElement;const e=n??t.parentElement;if(!e)return;const s=document.createElement("div");s.setAttribute(ut,"inline");const a=document.createElement("div");a.className="pomx-head";const o=document.createElement("span");o.className="pomx-idx-current",o.textContent="–";const r=document.createElement("span");r.textContent="/ 0",a.append(o,document.createTextNode(" "),r);const i=document.createElement("div");i.className="pomx-track";const c=document.createElement("div");c.className="pomx-tip";const l=document.createElement("span");l.className="pomx-tip-idx";const p=document.createElement("span");return c.append(l,p),s.append(a,i,c),s.addEventListener("pointerdown",d=>d.stopPropagation()),e.appendChild(s),{scroller:t,viewport:G(t),root:s,headCurrent:o,headTotal:r,track:i,tip:c,tipIdx:l,tipText:p,items:new Map,entries:[],activeId:"",sessionKey:"",geo:{left:NaN,top:NaN,height:NaN},jumpToken:0,turns:{byUser:new Map,byMessage:new Map,count:0}}},q=t=>{M?.rail===t&&(t.tip.classList.remove("is-shown"),M=void 0)},ot=(t,n,e)=>{M&&M.rail!==t&&M.rail.tip.classList.remove("is-shown"),t.tipIdx.textContent=`#${e.idx}`,t.tipText.textContent=`${kt(e.created)} · ${e.text}`;const s=n.getBoundingClientRect(),a=t.root.getBoundingClientRect();t.tip.style.top=`${Math.max(0,Math.round(s.top-a.top-4))}px`,t.tip.classList.add("is-shown"),M={rail:t}},st=(t,n,e,s)=>{n.el.setAttribute(k,String(e.idx)),n.el.setAttribute("aria-label",`Input ${e.idx}: ${e.text}`);let a=n.el.querySelector(".pomx-num");const o=s||e.idx%10===0;o&&!a?(a=document.createElement("span"),a.className=`pomx-num ${Z}`,n.el.appendChild(a)):!o&&a&&a.remove(),a&&(a.textContent=String(e.idx)),n.el.dataset.entryId=e.id},K=t=>{const n=t.entries,e=new Set(n.map(o=>o.id));for(const[o,r]of[...t.items])e.has(o)||(r.el.remove(),t.items.delete(o));const s=n.length<=32;let a=t.track.firstElementChild;for(const o of n){let r=t.items.get(o.id);if(!r){const i=document.createElement("button");i.type="button",i.setAttribute(k,String(o.idx));const c=document.createElement("span");c.className="pomx-tick",i.appendChild(c),i.addEventListener("click",()=>rt(t,o)),i.addEventListener("pointerenter",()=>ot(t,i,o)),i.addEventListener("pointerleave",()=>q(t)),t.track.appendChild(i),r={el:i},t.items.set(o.id,r)}st(t,r,o,s),a!==r.el&&t.track.insertBefore(r.el,a),a=r.el.nextElementSibling}},B=t=>{const n=t.sessionKey.slice(0,t.sessionKey.indexOf(`
`))||"sidecar",e=t.sessionKey.slice(t.sessionKey.indexOf(`
`)+1),s=L(n),a=new Map,o=new Map;let r=-1;for(const i of s?.session.message.list(e)??[]){const c=i;c.id&&(c.type==="user"&&(r+=1,a.set(c.id,r)),r>=0&&o.set(c.id,r))}t.turns={byUser:a,byMessage:o,count:r+1}},it=(t,n)=>{const e=t.dataset.timelineKey??"",s=n.turns.byUser,a=n.turns.byMessage;if(e.startsWith("user-message:")||e.startsWith("turn-divider:")||e.startsWith("turn-gap:")||e.startsWith("error:")||e.startsWith("retry:")||e.startsWith("thinking:"))return s.get(e.slice(e.indexOf(":")+1))??-1;if(e.startsWith("shell:")||e.startsWith("notice:")||e.startsWith("turn-diff:")){const i=e.slice(e.indexOf(":")+1),c=i.slice(0,i.indexOf(":")>=0?i.indexOf(":"):void 0);return a.get(c)??-1}const r=t.querySelector("[data-message-id]")?.getAttribute("data-message-id");return(r?a.get(r):void 0)??-1},at=t=>{const n=t.viewport,e=n.getBoundingClientRect(),s=new Map;for(const a of n.querySelectorAll("[data-timeline-key]")){const o=it(a,t);if(o<0)continue;const r=a.getBoundingClientRect().top-e.top+n.scrollTop,i=Number.parseFloat(a.style.height)||a.getBoundingClientRect().height,c=s.get(o);if(!c)s.set(o,{turn:o,top:r,height:i});else{const l=Math.min(c.top,r),p=Math.max(c.top+c.height,r+i);c.top=l,c.height=p-l}}return[...s.values()].sort((a,o)=>a.turn-o.turn)},P=()=>new Promise(t=>{requestAnimationFrame(()=>requestAnimationFrame(()=>window.setTimeout(t,gt)))}),rt=(t,n)=>{const e=t.jumpToken+=1;let s=0,a=-1,o=0;const r=()=>e===t.jumpToken&&t.viewport.isConnected;t.activeId=n.id;for(const[l,p]of t.items)p.el.classList.toggle(U,l===n.id);t.headCurrent.textContent=String(n.idx);const i=l=>{const p=performance.now(),d=Q(n.id),x=()=>{if(e!==t.jumpToken||!t.viewport.isConnected)return;const b=t.viewport,S=b.querySelector(d);if(!S){performance.now()-p<l&&requestAnimationFrame(x);return}const g=b.getBoundingClientRect(),w=S.getBoundingClientRect(),m=b.querySelector("[data-session-title]"),O=(m instanceof HTMLElement?m.offsetHeight:0)+8,T=w.top-(g.top+O);Math.abs(T)>1&&(b.scrollTop+=Math.round(T)),S.classList.add(mt),performance.now()-p<l&&requestAnimationFrame(x)};requestAnimationFrame(x)};(async()=>{for(;r()&&s<=Y;){const l=t.viewport;if(l.querySelector(Q(n.id))){i(900);return}if(s+=1,s>Y)return;const d=at(t);let x;if(d.length>=2){let g=d[0],w=d[d.length-1];for(let m=0;m<d.length-1;m+=1)if(d[m].turn<=n.idx&&d[m+1].turn>=n.idx){g=d[m],w=d[m+1];break}if(g===w){const m=d.reduce((v,I)=>Math.abs(I.turn-n.idx)<Math.abs(v.turn-n.idx)?I:v);let O=0,T=0;for(let v=1;v<d.length;v+=1){const I=d[v].turn-d[v-1].turn;I>0&&(O+=(d[v].top-d[v-1].top)/I,T+=1)}const lt=T>0?O/T:480;x=m.top+(n.idx-m.turn)*lt}else{const m=w.turn-g.turn;x=m>0?g.top+(n.idx-g.turn)/m*(w.top-g.top):g.top}}else if(d.length===1){const g=Math.max(1,t.turns.count),w=Math.max(240,l.scrollHeight/g);x=d[0].top+(n.idx-d[0].turn)*w}else{const g=Math.max(1,t.turns.count);x=l.scrollHeight*(n.idx/g)}const b=Math.max(0,Math.round(x));l.scrollTo({top:b,behavior:"auto"}),await P();const S=t.viewport.scrollTop;Math.abs(S-a)<1?(o+=1,o>=2&&(t.viewport.scrollTo({top:Math.max(0,b-l.clientHeight*2),behavior:"auto"}),await P(),t.viewport.scrollTo({top:b,behavior:"auto"}),await P(),o=0)):o=0,a=S}})()};let _=!1;const z=()=>{_||f.size===0||(_=!0,y=requestAnimationFrame(()=>{_=!1,y=0;let t=!1;for(const[n,e]of[...f]){if(!n.isConnected){e.root.remove(),f.delete(n),q(e);continue}t=!0,ct(e),dt(e)}t&&z()}))},H=()=>{if(!tt())return;const t=D();document.querySelectorAll(pt).forEach(n=>{if(f.has(n))return;const e=n.getBoundingClientRect();if(e.width===0&&e.height===0)return;const s=nt(n);s&&(s.sessionKey=t,f.set(n,s),s.entries=N(t),B(s),K(s),F(t),E=t)}),z()},V=()=>{for(const t of f.values())t.root.remove(),q(t);f.clear(),y&&(cancelAnimationFrame(y),y=0),_=!1},ct=t=>{const n=t.scroller.getBoundingClientRect();if(n.width===0&&n.height===0){t.root.style.display!=="none"&&(t.root.style.display="none");return}t.root.style.display==="none"&&(t.root.style.display="");const s=(t.root.offsetParent??document.body).getBoundingClientRect(),a=Math.round(Math.max(X,Math.min(xt,n.height-j-J))),o=Math.round(n.height-j-J),r=Math.round(n.top-s.top+j),i=Math.round(n.right-s.left-ft-C),c=Math.min(a,Math.max(X,o));i!==t.geo.left&&(t.root.style.left=`${i}px`),r!==t.geo.top&&(t.root.style.top=`${r}px`),c!==t.geo.height&&(t.root.style.height=`${c}px`),t.geo={left:i,top:r,height:c}},dt=t=>{const n=t.viewport,e=n.getBoundingClientRect(),s=e.top+ht,a=new Map(t.entries.map(c=>[c.id,c.idx]));let o="",r=0,i;for(const c of n.querySelectorAll("[data-message-id]")){const l=c.dataset.messageId,p=l?a.get(l):void 0;if(!l||p===void 0)continue;const d=c.getBoundingClientRect();if(!(d.bottom<=e.top||d.top>=e.bottom)){if(d.top<=s&&d.bottom>=s){o=l,r=p;break}(!i||d.top<i.top)&&(i={id:l,idx:p,top:d.top})}}if(!o&&i&&(o=i.id,r=i.idx),!(!o||o===t.activeId)){t.activeId=o;for(const[c,l]of t.items){const p=c===o;l.el.classList.toggle(U,p),p&&l.el.scrollIntoView({block:"nearest"})}t.headCurrent.textContent=String(r)}};return $=setInterval(()=>{H();for(const e of f.values()){const s=D();if(s&&s!==e.sessionKey){e.sessionKey=s,e.entries=N(s),e.activeId="",B(e),K(e),F(s),E=s,R=Date.now();continue}const a=N(e.sessionKey);(a.length!==e.entries.length||a.some((i,c)=>(e.entries[c]?.id??null)!==i.id))&&(e.entries=a,B(e),K(e));const r=`/ ${e.entries.length}`;if(e.headTotal.textContent!==r&&(e.headTotal.textContent=r),!e.activeId){const i=e.entries[0];i&&(e.activeId=i.id,e.items.get(i.id)?.el.classList.add(U),e.headCurrent.textContent="1")}}for(const e of f.values())e.viewport.isConnected||(e.viewport=G(e.scroller));const t=f.values().next().value,n=Date.now();if(t&&t.sessionKey&&n-R>800){const e=L(t.sessionKey.slice(0,t.sessionKey.indexOf(`
`)))?.session.status(t.sessionKey.slice(t.sessionKey.indexOf(`
`)+1))==="running";(t.sessionKey!==E||e&&n-R>bt)&&(E=t.sessionKey,R=n,F(t.sessionKey))}},vt),H(),console.error("[prompt-navigator] GUI part loaded"),()=>{$&&clearInterval($),y&&cancelAnimationFrame(y),V()}}});exports.default=St;
