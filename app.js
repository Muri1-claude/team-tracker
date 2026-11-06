// Team Account Tracker
// All permissions are enforced by the database (see supabase/schema.sql).
// This file only decides what to *show*; hiding a button here is never the security.
(() => {
"use strict";

// ---------- helpers ----------
function h(tag, props, ...kids){
  const el=document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(v==null||v===false) continue;
    if(k==="class") el.className=v;
    else if(k==="text") el.textContent=v;
    else if(k.startsWith("on")&&typeof v==="function") el.addEventListener(k.slice(2),v);
    else if(["value","checked","disabled","hidden","rows","type"].includes(k)) el[k]=v;
    else el.setAttribute(k, v===true?"":v);
  }
  for(const c of kids.flat(Infinity)){ if(c==null||c===false) continue; el.append(c.nodeType?c:document.createTextNode(String(c))); }
  return el;
}
const pad=n=>String(n).padStart(2,"0");
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseD=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d);};
const mondayOf=d=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+6)%7));return x;};
const addDays=(s,n)=>{const d=parseD(s);d.setDate(d.getDate()+n);return iso(d);};
const fmtShort=s=>s?parseD(s).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"";
const fmtLong=s=>s?parseD(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"";
const weekLabel=wk=>`${fmtShort(wk)} – ${fmtShort(addDays(wk,6))}`;
const fmtStamp=t=>{if(!t)return"";const d=new Date(t);return d.toLocaleDateString("en-US",{month:"short",day:"numeric"})+", "+d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});};
const hm=min=>{min=Math.round(min||0);return `${Math.floor(min/60)}h ${pad(min%60)}m`;};
const hrs=min=>((min||0)/60).toFixed(2);
const money=n=>n==null||n===""?"":"$"+Number(n).toFixed(2).replace(/\.00$/,"");
const uid=()=>(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36));
function parseDur(s){
  s=String(s||"").trim().toLowerCase(); if(!s) return null;
  let m=s.match(/^(\d+)\s*:\s*(\d{1,2})$/); if(m) return +m[1]*60 + +m[2];
  m=s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?)?\s*(?:(\d+)\s*m(?:in)?s?)?$/); if(m&&(m[1]||m[2])) return Math.round((+m[1]||0)*60 + (+m[2]||0));
  if(/^\d+(\.\d+)?$/.test(s)) return Math.round(+s);
  return NaN;
}
const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
let toastT; function toast(msg){const t=document.getElementById("toast");t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,3600);}
function fail(error,what){
  console.error(what,error);
  const m=String(error?.message||"");
  if(error?.code==="42501"||/row-level security|not allowed|permission/i.test(m)) toast("You don't have permission to change that.");
  else toast((what?what+": ":"")+"couldn't save. Check your connection and try again.");
}
function autogrow(t){t.style.height="auto";t.style.height=Math.min(t.scrollHeight+2,400)+"px";}

// ---------- config / client ----------
const CFG=window.TT_CONFIG||{};
const configured=CFG.SUPABASE_URL&&!/PASTE/.test(CFG.SUPABASE_URL)&&CFG.SUPABASE_ANON_KEY&&!/PASTE/.test(CFG.SUPABASE_ANON_KEY);
const sb=configured&&window.supabase?window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY):null;

// ---------- state ----------
const S={session:null,me:null,isAdmin:false,loaded:false,authMode:"signin",recovery:false,
  settings:{share_logs:false,share_pay:false,share_hours:true,share_questions:true},
  people:[],emails:{},accounts:[],weeks:{},hoursRows:[],payments:[],posts:[],questions:[],
  logPid:store.get("tat.logPid")||"",week:iso(mondayOf(new Date())),view:"log",
  pending:{},chains:{},qFilter:"open",payPick:{},signed:{}};
// Display names come from the database after login, so no real names live in this public code.
const ADMIN=()=>S.settings.admin_name||"Admin";
const PARTNER=()=>S.settings.partner_name||"Partner";
const TEAMNAME=()=>S.settings.team_name||"Team Tracker";
const ALL_VIEWS=[["log","Weekly log"],["pay","Hours & pay"],["team","For the team"],["partner",()=>"For "+PARTNER(),true],["ask",()=>"Questions for "+ADMIN()],["people","People & accounts",true]];
const views=()=>ALL_VIEWS.filter(v=>!v[2]||S.isAdmin);
const activePeople=()=>S.people.filter(p=>!p.archived&&p.role!=="admin").sort((a,b)=>(a.sort??99)-(b.sort??99)||a.name.localeCompare(b.name));
const person=pid=>S.people.find(p=>p.id===pid);
const nameOf=pid=>person(pid)?.name||"Someone";
const accountsOf=pid=>S.accounts.filter(a=>a.person_id===pid&&!a.archived).sort((a,b)=>(a.sort??99)-(b.sort??99)||a.name.localeCompare(b.name));
const wkey=(pid,wk)=>`${pid}__${wk}`;
const weekDoc=(pid,wk)=>S.weeks[wkey(pid,wk)];
const myPid=()=>S.me?.person_id||null;
const canWriteLog=pid=>S.isAdmin||pid===myPid();
function weekTotal(doc){ if(!doc) return 0; if(doc.mode==="total") return doc.totalMin||0; return Object.values(doc.entries||{}).reduce((s,e)=>s+(+e.min||0),0); }
function paidFor(pid,wk){ return S.payments.find(p=>p.person_id===pid&&(p.weeks||[]).includes(wk)); }
function lastThrough(pid,accId,wk){
  const ks=Object.keys(S.weeks).filter(k=>k.startsWith(pid+"__")&&k.split("__")[1]<wk).sort().reverse();
  for(const k of ks){const t=S.weeks[k].entries?.[accId]?.through; if(t) return t;}
  return "";
}

// ---------- loading ----------
async function fetchAll(table){
  const out=[]; const step=1000;
  for(let from=0;;from+=step){
    const {data,error}=await sb.from(table).select("*").range(from,from+step-1);
    if(error) throw error; out.push(...data); if(data.length<step) break;
  }
  return out;
}
let loading=null;
async function loadAll(){
  if(loading) return loading;
  loading=(async()=>{
    const who=await sb.rpc("whoami");
    if(who.error) throw who.error;
    S.me=(who.data||[])[0]||null; S.isAdmin=S.me?.role==="admin";
    if(!S.me){S.loaded=true;return;}
    const [st,ppl,acc,logs,ents,pays,posts,qs,hrsR,em]=await Promise.all([
      sb.from("settings").select("*").eq("id",1).maybeSingle(),
      fetchAll("people"),fetchAll("accounts"),fetchAll("week_logs"),fetchAll("week_entries"),
      fetchAll("payments"),fetchAll("posts"),fetchAll("questions"),
      sb.rpc("team_hours"),
      S.isAdmin?sb.from("member_emails").select("*"):Promise.resolve({data:[]})]);
    if(st.data) S.settings=st.data;
    S.people=ppl; S.accounts=acc; S.payments=pays; S.posts=posts; S.questions=qs;
    S.hoursRows=hrsR.data||[];
    S.emails={}; (em.data||[]).forEach(r=>S.emails[r.person_id]=r.email);
    const weeks={};
    for(const l of logs){ weeks[wkey(l.person_id,l.week)]={pid:l.person_id,week:l.week,mode:l.mode,totalMin:l.total_min,weekNote:l.week_note||"",imported:l.imported,updatedAt:l.updated_at,updatedBy:l.updated_by,entries:{}}; }
    for(const e of ents){ const d=weeks[wkey(e.person_id,e.week)]; if(d) d.entries[e.account_id]={min:e.minutes,note:e.note||"",through:e.through||""}; }
    for(const k of Object.keys(S.weeks)) if(S.pending[k]) weeks[k]=S.weeks[k];
    S.weeks=weeks; S.loaded=true;
  })().finally(()=>{loading=null;});
  return loading;
}
async function refresh(){ try{await loadAll();}catch(e){console.error(e);toast("Couldn't load the latest data.");} requestRender(); }

// ---------- rendering ----------
let renderQueued=false, renderHeld=false;
function editing(){const a=document.activeElement;return a&&document.getElementById("main").contains(a)&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);}
function requestRender(){ if(editing()){renderHeld=true;return;} if(renderQueued) return; renderQueued=true; requestAnimationFrame(()=>{renderQueued=false;render();}); }
document.addEventListener("focusout",()=>setTimeout(()=>{ if(renderHeld&&!editing()){renderHeld=false;render();} },0));

function renderHeader(){
  const bn=document.getElementById("brandName"); if(bn) bn.textContent=S.me?TEAMNAME():"Team Tracker"; document.title=S.me?TEAMNAME():"Team Tracker";
  const who=document.getElementById("who"); const tabs=document.getElementById("tabs");
  if(!S.session||!S.me){
    tabs.replaceChildren();
    who.replaceChildren(S.session?h("button",{class:"ghost",onclick:signOut},"Sign out"):"");
    return;
  }
  who.replaceChildren(h("span",{},S.me.name+(S.isAdmin?" (admin)":"")),h("button",{class:"ghost",onclick:signOut},"Sign out"));
  const openQ=S.questions.filter(q=>q.status!=="answered").length;
  tabs.replaceChildren(...views().map(([id,label])=>h("a",{href:"#"+id,"aria-current":S.view===id?"page":null},typeof label==="function"?label():label, id==="ask"&&openQ&&S.isAdmin?h("span",{class:"count"},openQ):null)));
}
function render(){
  renderHeader();
  const main=document.getElementById("main");
  let content;
  if(!configured) content=viewNotConfigured();
  else if(S.recovery) content=viewSetPassword();
  else if(!S.session) content=viewLogin();
  else if(!S.loaded) content=h("div",{class:"empty"},"Loading the tracker…");
  else if(!S.me) content=viewNotOnTeam();
  else {
    if(!views().some(v=>v[0]===S.view)) S.view="log";
    content=({log:viewLog,pay:viewPay,team:()=>viewBoard("team"),partner:()=>viewBoard("partner"),ask:viewAsk,people:viewPeople})[S.view]();
  }
  const y=window.scrollY;
  main.replaceChildren(...[].concat(content));
  main.querySelectorAll("textarea").forEach(autogrow);
  window.scrollTo(0,y);
}

// ----- auth screens -----
function viewNotConfigured(){
  return h("div",{class:"panel pad form",style:"max-width:560px"},h("h1",{},"Almost there"),
    h("p",{class:"sub"},"This site isn't connected to its database yet. Open config.js in the GitHub repo and paste in the Supabase project URL and anon key (see README, step 3)."));
}
function viewLogin(){
  const m=S.authMode;
  const email=h("input",{type:"email",id:"lgEmail",autocomplete:"email",placeholder:"you@example.com",value:store.get("tat.email")||""});
  const pw=h("input",{type:"password",id:"lgPw",autocomplete:m==="signup"?"new-password":"current-password",placeholder:m==="signup"?"Choose a password (8+ characters)":"Password"});
  const msg=h("div",{class:"status",id:"lgMsg"});
  async function go(ev){
    ev.preventDefault(); msg.textContent="";
    const e=email.value.trim().toLowerCase(); if(!e){msg.textContent="Enter your email.";return;}
    store.set("tat.email",e);
    const redirect=location.origin+location.pathname;
    btn.disabled=true;
    try{
      if(m==="reset"){
        const {error}=await sb.auth.resetPasswordForEmail(e,{redirectTo:redirect}); if(error) throw error;
        msg.textContent="If that email is on the team, a reset link is on its way. Open it on this device.";
      }else if(m==="signup"){
        if(pw.value.length<8){msg.textContent="Use at least 8 characters.";return;}
        const {data,error}=await sb.auth.signUp({email:e,password:pw.value,options:{emailRedirectTo:redirect}}); if(error) throw error;
        msg.textContent=data.session?"Account created.":"Check your email and click the confirmation link, then sign in here.";
      }else{
        const {error}=await sb.auth.signInWithPassword({email:e,password:pw.value}); if(error) throw error;
      }
    }catch(err){ msg.textContent=/confirm/i.test(err.message)?"Confirm your email first: click the link we sent you.":/invalid/i.test(err.message)?"Wrong email or password.":err.message; }
    finally{btn.disabled=false;}
  }
  const btn=h("button",{class:"primary",type:"submit"},m==="signup"?"Create account":m==="reset"?"Send reset link":"Sign in");
  return h("div",{class:"login"},
    h("form",{class:"panel pad form",onsubmit:go},
      h("h1",{},m==="signup"?"Create your account":m==="reset"?"Reset your password":"Sign in"),
      h("p",{class:"sub"},m==="signup"?"Use the email your admin added you with.":"Team members only."),
      h("label",{class:"label",for:"lgEmail"},"Email"),email,
      m!=="reset"?[h("label",{class:"label",for:"lgPw"},"Password"),pw]:null,
      btn,msg,
      h("div",{class:"row",style:"gap:4px"},
        m!=="signin"?h("button",{type:"button",class:"ghost",onclick:()=>{S.authMode="signin";render();}},"Back to sign in"):null,
        m==="signin"?h("button",{type:"button",class:"ghost",onclick:()=>{S.authMode="signup";render();}},"First time? Create account"):null,
        m==="signin"?h("button",{type:"button",class:"ghost",onclick:()=>{S.authMode="reset";render();}},"Forgot password"):null)));
}
function viewSetPassword(){
  const pw=h("input",{type:"password",id:"npw",autocomplete:"new-password",placeholder:"New password (8+ characters)"});
  const msg=h("div",{class:"status"});
  return h("div",{class:"login"},h("form",{class:"panel pad form",onsubmit:async ev=>{ev.preventDefault();
      if(pw.value.length<8){msg.textContent="Use at least 8 characters.";return;}
      const {error}=await sb.auth.updateUser({password:pw.value});
      if(error){msg.textContent=error.message;return;}
      S.recovery=false; toast("Password updated"); history.replaceState(null,"",location.pathname); await refresh();}},
    h("h1",{},"Set a new password"),pw,h("button",{class:"primary",type:"submit"},"Save password"),msg));
}
function viewNotOnTeam(){
  return h("div",{class:"panel pad form",style:"max-width:560px"},h("h1",{},"You're not on the team list yet"),
    h("p",{class:"sub"},`You're signed in as ${S.session?.user?.email||"this account"}, but that email hasn't been added to the tracker. Ask ${ADMIN()} to add it under People & accounts, then refresh this page.`),
    h("div",{class:"row"},h("button",{onclick:refresh},"Refresh"),h("button",{class:"ghost",onclick:signOut},"Sign out")));
}
async function signOut(){ await sb.auth.signOut(); S.me=null;S.isAdmin=false;S.loaded=false;S.weeks={};S.payments=[];S.posts=[];S.questions=[];S.people=[];S.accounts=[];render(); }

// ----- weekly log -----
function logPeople(){
  if(S.isAdmin||S.settings.share_logs) return activePeople();
  return activePeople().filter(p=>p.id===myPid());
}
function personPills(list,pid,onPick){
  if(list.length<2) return null;
  return h("div",{class:"people",role:"group","aria-label":"Team member"},list.map(x=>h("button",{"aria-pressed":String(x.id===pid),onclick:()=>onPick(x.id)},x.name)));
}
function viewLog(){
  const out=[];
  const people=logPeople();
  if(!people.length) return [h("h1",{},"Weekly log"), h("div",{class:"empty"},S.isAdmin?"No team members yet. Add people and their accounts under People & accounts.":"You don't have any accounts assigned yet.")];
  if(!people.some(p=>p.id===S.logPid)) S.logPid = people.some(p=>p.id===myPid())?myPid():people[0].id;
  const p=person(S.logPid), wk=S.week;
  const paidLock=!S.isAdmin && !!paidFor(p.id,wk);
  const editable=canWriteLog(p.id) && !paidLock;
  const doc=weekDoc(p.id,wk)||{pid:p.id,week:wk,mode:"perAccount",entries:{},weekNote:""};
  const thisWeek=iso(mondayOf(new Date()));
  out.push(h("div",{},h("h1",{},"Weekly log"),h("p",{class:"sub"},"Log production, notes and time for each account. Every week is kept.")));
  out.push(personPills(people,p.id,id=>{S.logPid=id;store.set("tat.logPid",id);render();}));
  if(paidLock && canWriteLog(p.id)) out.push(h("div",{class:"banner"},`This week has been paid, so it's locked. Ask ${ADMIN()} if something needs fixing.`));
  else if(!editable) out.push(h("div",{class:"banner"},`You're viewing ${p.name}'s log. Only ${p.name} and ${ADMIN()} can change it.`));
  const paid=paidFor(p.id,wk);
  out.push(h("div",{class:"row"},
    h("div",{class:"weeknav"},
      h("button",{class:"ghost","aria-label":"Previous week",onclick:()=>{S.week=addDays(wk,-7);render();}},"‹"),
      h("div",{class:"wk"},"Week of "+weekLabel(wk)),
      h("button",{class:"ghost","aria-label":"Next week",onclick:()=>{S.week=addDays(wk,7);render();}},"›"),
      wk!==thisWeek?h("button",{class:"ghost",onclick:()=>{S.week=thisWeek;render();}},"This week"):null),
    h("span",{class:"spacer"}),
    paid?h("span",{class:"chip ok"},"Paid · "+(paid.paid_on?fmtShort(paid.paid_on):paid.label)):(weekTotal(doc)>0&&(S.isAdmin||p.id===myPid()||S.settings.share_pay)?h("span",{class:"chip warn"},"Not paid yet"):null),
    editable?h("div",{class:"seg",role:"group","aria-label":"How to log time"},
      h("button",{"aria-pressed":String(doc.mode!=="total"),onclick:()=>{editWeek(p.id,wk,d=>d.mode="perAccount");render();}},"Time per account"),
      h("button",{"aria-pressed":String(doc.mode==="total"),onclick:()=>{editWeek(p.id,wk,d=>{if(d.mode!=="total"&&!d.totalMin)d.totalMin=weekTotal(d)||null;d.mode="total";});render();}},"Weekly total only")):null
  ));
  const accs=accountsOf(p.id);
  const log=h("div",{class:"panel log"+(doc.mode==="total"?" total-mode":"")});
  log.append(h("div",{class:"lrow head"},h("div",{class:"label"},"Account ("+accs.length+")"),h("div",{class:"label"},"Initial rule setup"),h("div",{class:"label"},"Production through"),h("div",{class:"label c-min",style:"text-align:right"},"Minutes"),h("div",{class:"label"},"Notes")));
  if(!accs.length) log.append(h("div",{class:"pad",style:"color:var(--muted)"},"No accounts assigned to "+p.name+" yet."));
  for(const a of accs){
    const e=(doc.entries||{})[a.id]||{};
    const prev=lastThrough(p.id,a.id,wk);
    const [brand,...rest]=a.name.split(" ");
    const done=!!a.setup_done;
    const tog=h("button",{class:"toggle"+(done?" on":""),type:"button",disabled:!editable,"aria-pressed":String(done),title:"Mark yes once you've reviewed the whole posted tab and made every rule you reasonably can",onclick:()=>toggleSetup(a)},h("span",{class:"box"},done?"✓":""),done?"Done":"Not yet");
    const thru=h("input",{type:"date",id:`th-${a.id}`,value:e.through||"",disabled:!editable,"aria-label":"Production through for "+a.name,onchange:ev=>editWeek(p.id,wk,d=>ent(d,a.id).through=ev.target.value)});
    const min=h("input",{type:"number",min:"0",step:"1",inputmode:"numeric",id:`mn-${a.id}`,value:e.min??"",placeholder:"0",disabled:!editable,"aria-label":"Minutes for "+a.name,oninput:ev=>{editWeek(p.id,wk,d=>{const v=ev.target.value;ent(d,a.id).min=v===""?null:Math.max(0,Math.round(+v));});updateTotal();}});
    const note=h("textarea",{rows:1,id:`nt-${a.id}`,value:e.note||"",disabled:!editable,placeholder:"Rules made, exceptions, questions…","aria-label":"Notes for "+a.name,oninput:ev=>{autogrow(ev.target);editWeek(p.id,wk,d=>ent(d,a.id).note=ev.target.value);}});
    log.append(h("div",{class:"lrow"},
      h("div",{class:"acct"},h("span",{class:"brandtag"},brand),rest.join(" ")||a.name),
      h("div",{class:"c-setup"},h("span",{class:"label mlabel"},"Initial rule setup"),tog),
      h("div",{class:"c-thru"},h("span",{class:"label mlabel"},"Production through"),thru,prev&&!e.through?h("div",{class:"hint"},"Last week: "+fmtShort(prev)):null),
      h("div",{class:"c-min"},h("span",{class:"label mlabel"},"Minutes"),min),
      h("div",{class:"c-note"},h("span",{class:"label mlabel"},"Notes"),note)));
  }
  const totalEl=h("span",{class:"big"});
  const detail=h("span",{class:"num",style:"color:var(--muted)"});
  function updateTotal(){const t=weekTotal(weekDoc(p.id,wk));totalEl.textContent=hm(t);detail.textContent=`${t} min · ${hrs(t)} h`;}
  const foot=h("div",{class:"lfoot"});
  if(doc.mode==="total"){
    const inp=h("input",{id:"wkTotalIn",disabled:!editable,value:doc.totalMin!=null?`${Math.floor(doc.totalMin/60)}:${pad(doc.totalMin%60)}`:"",placeholder:"h:mm, e.g. 1:35",style:"width:130px","aria-label":"Weekly total time",onchange:ev=>{const v=parseDur(ev.target.value);if(Number.isNaN(v)){toast("Type the total like 1:35, 95, or 1h 35m.");return;}editWeek(p.id,wk,d=>d.totalMin=v);updateTotal();}});
    foot.append(h("div",{},h("div",{class:"label"},"Weekly total"),h("div",{class:"row"},inp,h("span",{class:"hint",style:"margin:0"},"h:mm, minutes, or 1h 35m"))));
  }
  foot.append(h("div",{},h("div",{class:"label"},doc.mode==="total"?"Counts as":"Total this week"),h("div",{class:"row"},totalEl,detail)));
  foot.append(h("span",{class:"spacer"}));
  if(accs.length&&editable){
    const fillD=h("input",{type:"date",id:"fillDate","aria-label":"Date to apply to every account"});
    foot.append(h("div",{},h("div",{class:"label"},"Set every account's “through” date"),h("div",{class:"row"},fillD,h("button",{onclick:()=>{if(!fillD.value)return;editWeek(p.id,wk,d=>accs.forEach(a=>ent(d,a.id).through=fillD.value));render();toast("Applied to all "+accs.length+" accounts");}},"Apply"))));
  }
  log.append(foot);
  out.push(log);
  updateTotal();
  out.push(h("div",{class:"panel pad form"},
    h("label",{class:"label",for:"wkNote"},"Notes for the week"),
    h("textarea",{id:"wkNote",rows:2,disabled:!editable,value:doc.weekNote||"",placeholder:"Anything that isn't tied to one account",oninput:ev=>{autogrow(ev.target);editWeek(p.id,wk,d=>d.weekNote=ev.target.value);}}),
    h("div",{class:"status",id:"saveStatus"},doc.updatedAt?"Last saved "+fmtStamp(doc.updatedAt)+(doc.updatedBy?" by "+nameOf(doc.updatedBy):""):"")));
  return out;
}
function ent(d,accId){d.entries=d.entries||{};return d.entries[accId]=d.entries[accId]||{};}
function editWeek(pid,wk,fn){
  if(!canWriteLog(pid)) return;
  const key=wkey(pid,wk);
  const d=S.weeks[key]?structuredClone(S.weeks[key]):{pid,week:wk,mode:"perAccount",entries:{},weekNote:""};
  fn(d); S.weeks[key]=d; S.pending[key]=(S.pending[key]||0)+1;
  const st=document.getElementById("saveStatus"); if(st) st.textContent="Saving…";
  clearTimeout(S.pending["t_"+key]);
  S.pending["t_"+key]=setTimeout(()=>flushWeek(key),700);
}
function flushWeek(key){
  const prev=S.chains[key]||Promise.resolve();
  S.chains[key]=prev.then(async()=>{
    const d=S.weeks[key]; const n=S.pending[key]; const stamp=new Date().toISOString();
    const st=()=>document.getElementById("saveStatus");
    const r1=await sb.from("week_logs").upsert({person_id:d.pid,week:d.week,mode:d.mode,total_min:d.totalMin??null,week_note:d.weekNote||"",updated_at:stamp,updated_by:myPid()});
    if(r1.error){delete S.pending[key];fail(r1.error,"Weekly log");if(st())st().textContent="Not saved";return;}
    const mine=new Set(accountsOf(d.pid).map(a=>a.id));
    const rows=Object.entries(d.entries||{}).filter(([aid])=>S.isAdmin?S.accounts.some(a=>a.id===aid):mine.has(aid))
      .map(([aid,e])=>({person_id:d.pid,week:d.week,account_id:aid,minutes:e.min??null,note:e.note||"",through:e.through||null}));
    if(rows.length){const r2=await sb.from("week_entries").upsert(rows,{onConflict:"person_id,week,account_id"});
      if(r2.error){delete S.pending[key];fail(r2.error,"Account entries");if(st())st().textContent="Not saved";return;}}
    d.updatedAt=stamp; d.updatedBy=myPid();
    if(S.pending[key]===n) delete S.pending[key];
    if(st()) st().textContent="Saved "+fmtStamp(stamp);
  });
}
async function toggleSetup(a){
  const was=a.setup_done; a.setup_done=!was; render();
  const {error}=await sb.rpc("set_setup",{acc:a.id,done:!was});
  if(error){a.setup_done=was;render();fail(error,"Rule setup");}
}

// ----- hours & pay -----
function hoursFor(pid){
  // weekly totals: local logs (fresh edits) win over the server summary
  const m=new Map();
  for(const r of S.hoursRows) if(r.person_id===pid) m.set(r.week,r.minutes);
  for(const d of Object.values(S.weeks)) if(d.pid===pid) m.set(d.week,weekTotal(d));
  return [...m.entries()].filter(([,v])=>v>0).sort((a,b)=>b[0].localeCompare(a[0]));
}
function viewPay(){
  const out=[h("div",{},h("h1",{},"Hours & pay"),h("p",{class:"sub"},S.isAdmin?"Logged hours by week, and which weeks you've paid.":"Logged hours by week, and which of your weeks "+ADMIN()+" has paid."))];
  const everyone=activePeople();
  const hourPeople=everyone.filter(p=>S.isAdmin||p.id===myPid()||S.hoursRows.some(r=>r.person_id===p.id));
  const seesPay=pid=>S.isAdmin||pid===myPid()||S.settings.share_pay;
  if(!hourPeople.length) return out.concat(h("div",{class:"empty"},"No hours logged yet."));
  out.push(h("div",{class:"grid2"},hourPeople.map(p=>{
    const wks=hoursFor(p.id); const total=wks.reduce((s,[,v])=>s+v,0);
    const card=h("div",{class:"stat"+(p.id===myPid()?" mine":"")},h("p",{class:"who"},p.name+(p.id===myPid()?" (you)":"")));
    if(seesPay(p.id)){
      const unpaid=wks.filter(([w])=>!paidFor(p.id,w)); const um=unpaid.reduce((s,[,v])=>s+v,0);
      const last=S.payments.filter(x=>x.person_id===p.id).sort((a,b)=>(b.paid_on||b.created_at||"").localeCompare(a.paid_on||a.created_at||""))[0];
      card.append(h("div",{class:"row"},h("span",{class:"big"},hrs(um)+" h"),um>0?h("span",{class:"chip warn"},unpaid.length+" unpaid wk"):h("span",{class:"chip ok"},"All paid")),
        h("div",{class:"hint"},last?"Last payment: "+(money(last.amount)||"amount not recorded")+" · "+(last.paid_on?fmtLong(last.paid_on):last.label):"No payments yet"));
    }else{
      card.append(h("div",{class:"row"},h("span",{class:"big"},hrs(total)+" h"),h("span",{class:"chip mute"},wks.length+" wk logged")),
        h("div",{class:"hint"},wks[0]?"Latest week: "+fmtShort(wks[0][0])+" · "+hrs(wks[0][1])+" h":"No hours logged yet"));
    }
    return card;
  })));
  const pickList=hourPeople;
  if(!pickList.some(p=>p.id===S.logPid)) S.logPid=pickList.some(p=>p.id===myPid())?myPid():pickList[0].id;
  const pid=S.logPid;
  out.push(personPills(pickList,pid,id=>{S.logPid=id;store.set("tat.logPid",id);render();}));
  const wks=hoursFor(pid); const showPay=seesPay(pid);
  const pick=S.payPick[pid]=S.payPick[pid]||{};
  const tbl=h("table",{},h("thead",{},h("tr",{},S.isAdmin?h("th",{},""):null,h("th",{},"Week"),h("th",{class:"r"},"Time"),h("th",{class:"r"},"Hours"),showPay?h("th",{},"Status"):null)));
  const tb=h("tbody");
  if(!wks.length) tb.append(h("tr",{},h("td",{colspan:5,style:"color:var(--muted)"},"No time logged yet.")));
  for(const [w,t] of wks){
    const pd=paidFor(pid,w);
    tb.append(h("tr",{},
      S.isAdmin?h("td",{},pd?"":h("input",{type:"checkbox",id:`pk-${w}`,checked:!!pick[w],"aria-label":"Include week of "+weekLabel(w),onchange:ev=>{pick[w]=ev.target.checked;render();}})):null,
      h("td",{},(S.isAdmin||pid===myPid()||S.settings.share_logs)?h("a",{href:"#log",onclick:()=>{S.week=w;}},weekLabel(w)):weekLabel(w)),
      h("td",{class:"r num"},hm(t)),h("td",{class:"r num"},hrs(t)),
      showPay?h("td",{},pd?h("span",{class:"chip ok"},"Paid · "+(pd.paid_on?fmtShort(pd.paid_on):pd.label||"")):h("span",{class:"chip warn"},"Unpaid")):null));
  }
  tbl.append(tb);
  out.push(h("div",{class:"panel tblwrap"},tbl));
  if(S.isAdmin){
    const picked=Object.keys(pick).filter(k=>pick[k]).sort();
    const pm=picked.reduce((s,k)=>s+(wks.find(x=>x[0]===k)?.[1]||0),0);
    const amt=h("input",{type:"number",step:"0.01",min:"0",id:"payAmt",placeholder:"Amount ($)"});
    const dt=h("input",{type:"date",id:"payDate",value:iso(new Date())});
    const nt=h("input",{id:"payNote",placeholder:"Note (optional), e.g. Venmo"});
    const btn=h("button",{class:"primary",disabled:!picked.length,onclick:async()=>{
      btn.disabled=true;
      const label=picked.length===1?"Week of "+fmtShort(picked[0]):`${picked.length} weeks, ${fmtShort(picked[0])} to ${fmtShort(addDays(picked[picked.length-1],6))}`;
      const {error}=await sb.from("payments").insert({person_id:pid,weeks:picked,label,amount:amt.value===""?null:+amt.value,paid_on:dt.value||iso(new Date()),minutes:pm,note:nt.value||""});
      if(error){btn.disabled=false;return fail(error,"Payment");}
      S.payPick[pid]={}; toast("Payment recorded"); refresh();
    }},"Record payment");
    out.push(h("div",{class:"panel pad form"},h("h2",{},"Record a payment to "+nameOf(pid)),
      h("p",{class:"sub",style:"margin:0"},picked.length?`${picked.length} week${picked.length>1?"s":""} selected · ${hm(pm)} · ${hrs(pm)} h`:"Tick the unpaid weeks above that this payment covers."),
      h("div",{class:"row"},amt,dt,nt),h("div",{class:"row"},btn)));
  }
  if(showPay){
    const hist=S.payments.filter(x=>x.person_id===pid).sort((a,b)=>(b.paid_on||b.created_at||"").localeCompare(a.paid_on||a.created_at||""));
    out.push(h("h2",{class:"grouphead"},"Payment history"));
    if(!hist.length) out.push(h("div",{class:"empty"},"No payments recorded for "+nameOf(pid)+"."));
    else{
      const t=h("table",{},h("thead",{},h("tr",{},h("th",{},"Date"),h("th",{},"Covers"),h("th",{class:"r"},"Hours"),h("th",{class:"r"},"Amount"),h("th",{},"Note"),S.isAdmin?h("th",{},""):null)));
      const b=h("tbody");
      for(const x of hist){
        b.append(h("tr",{},h("td",{class:"num"},x.paid_on?fmtLong(x.paid_on):"–"),h("td",{},x.label||""),
          h("td",{class:"r num"},x.minutes!=null?hrs(x.minutes):(x.hours!=null?Number(x.hours).toFixed(2):"–")),
          h("td",{class:"r num"},money(x.amount)||"–"),h("td",{},x.note||""),
          S.isAdmin?h("td",{},h("div",{class:"row",style:"gap:2px;flex-wrap:nowrap"},h("button",{class:"ghost",onclick:()=>editPayment(x)},"Edit"),confirmBtn("Delete",async()=>{const {error}=await sb.from("payments").delete().eq("id",x.id);if(error)return fail(error,"Payment");toast("Payment deleted");refresh();}))):null));
      }
      t.append(b); out.push(h("div",{class:"panel tblwrap"},t));
    }
  }else{
    out.push(h("p",{class:"hint"},"Payment details are private to each person."));
  }
  return out;
}
let editingPay=null;
function editPayment(x){
  editingPay=x;
  const amt=h("input",{type:"number",step:"0.01",min:"0",id:"epAmt",value:x.amount??"",placeholder:"Amount ($)"});
  const dt=h("input",{type:"date",id:"epDate",value:x.paid_on||""});
  const lb=h("input",{id:"epLabel",value:x.label||"",placeholder:"Covers"});
  const nt=h("input",{id:"epNote",value:x.note||"",placeholder:"Note"});
  const dlg=h("div",{class:"overlay",onclick:e=>{if(e.target===dlg)dlg.remove();}},
    h("div",{class:"panel pad form",style:"max-width:440px;width:100%"},h("h2",{},"Edit payment to "+nameOf(x.person_id)),
      h("label",{class:"label",for:"epAmt"},"Amount"),amt,h("label",{class:"label",for:"epDate"},"Date paid"),dt,
      h("label",{class:"label",for:"epLabel"},"Covers"),lb,h("label",{class:"label",for:"epNote"},"Note"),nt,
      h("div",{class:"row"},h("button",{class:"primary",onclick:async()=>{
        const {error}=await sb.from("payments").update({amount:amt.value===""?null:+amt.value,paid_on:dt.value||null,label:lb.value,note:nt.value}).eq("id",x.id);
        if(error) return fail(error,"Payment"); dlg.remove(); toast("Payment updated"); refresh();}},"Save"),
        h("button",{class:"ghost",onclick:()=>dlg.remove()},"Cancel"))));
  document.body.append(dlg); amt.focus();
}
function confirmBtn(label,fn){
  const wrap=h("span",{class:"inline-confirm"});
  const b=h("button",{class:"ghost",onclick:()=>{wrap.replaceChildren(h("span",{},"Sure?"),h("button",{class:"danger",onclick:fn},label),h("button",{class:"ghost",onclick:()=>wrap.replaceChildren(b)},"Cancel"));}},label);
  wrap.append(b); return wrap;
}

// ----- images (private storage, short-lived signed links) -----
function imgEl(path){
  if(!path) return null;
  const a=h("a",{target:"_blank",rel:"noopener"}); const img=h("img",{class:"thumb",alt:"Attached screenshot",loading:"lazy"});
  a.append(img);
  const set=url=>{img.src=url;a.href=url;};
  const c=S.signed[path];
  if(c&&c.exp>Date.now()) set(c.url);
  else sb.storage.from("attachments").createSignedUrl(path,3600).then(({data,error})=>{ if(error||!data){img.alt="Screenshot unavailable";return;} S.signed[path]={url:data.signedUrl,exp:Date.now()+50*60e3}; set(data.signedUrl); });
  return a;
}
async function uploadImage(file,folder){
  const ext=(file.type.split("/")[1]||"png").replace(/[^a-z0-9]/gi,"").slice(0,5)||"png";
  const path=`${folder}/${uid()}.${ext}`;
  const {error}=await sb.storage.from("attachments").upload(path,file,{contentType:file.type||"image/png"});
  if(error) throw error; return path;
}
function attachPicker(holder,folder,ta){
  const lab=h("span",{class:"hint",style:"margin:0"});
  const doUpload=async f=>{ lab.textContent="Uploading…"; try{holder.path=await uploadImage(f,folder);lab.textContent="Screenshot attached";}catch(e){console.error(e);lab.textContent="Upload failed";} };
  const inp=h("input",{type:"file",accept:"image/*","aria-label":"Attach a screenshot",onchange:ev=>{const f=ev.target.files[0];if(f)doUpload(f);}});
  if(ta) ta.addEventListener("paste",ev=>{const it=[...(ev.clipboardData?.items||[])].find(i=>i.type.startsWith("image/"));if(!it)return;ev.preventDefault();doUpload(it.getAsFile());});
  return h("div",{class:"row"},h("span",{class:"btn filebtn"},"Attach screenshot",inp),lab,ta?h("span",{class:"hint",style:"margin:0"},"or paste one into the text box"):null);
}

// ----- boards -----
const weekOfStamp=t=>iso(mondayOf(new Date(t)));
function viewBoard(board){
  const title=board==="team"?"For the team":"For "+PARTNER();
  const blurb=board==="team"?"Updates, rules and guidance from "+ADMIN()+". Newest first, every past week kept.":"Questions and info for "+PARTNER()+", logged by week. Only you can see this tab.";
  const out=[h("div",{},h("h1",{},title),h("p",{class:"sub"},blurb))];
  if(S.isAdmin){
    const holder={};
    const ti=h("input",{id:"pTitle",placeholder:"Title (optional)"});
    const bd=h("textarea",{id:"pBody",rows:3,placeholder:board==="team"?"What does the team need to know?":"Question or info for "+PARTNER(),oninput:e=>autogrow(e.target)});
    const pin=h("input",{type:"checkbox",id:"pPin"});
    const btn=h("button",{class:"primary",onclick:async()=>{
      if(!bd.value.trim()&&!ti.value.trim()) return; btn.disabled=true;
      const {error}=await sb.from("posts").insert({board,title:ti.value.trim(),body:bd.value.trim(),pinned:pin.checked,img_path:holder.path||null});
      btn.disabled=false; if(error) return fail(error,"Post"); toast("Posted"); refresh();
    }},"Post");
    out.push(h("div",{class:"panel pad form"},ti,bd,attachPicker(holder,board,bd),
      h("div",{class:"row"},h("label",{class:"row",for:"pPin",style:"gap:6px;font-size:14px"},pin,"Pin to top"),h("span",{class:"spacer"}),btn)));
  }
  const posts=S.posts.filter(p=>p.board===board).sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));
  if(!posts.length){out.push(h("div",{class:"empty"},S.isAdmin?"Nothing posted yet. Your first post shows up here.":"Nothing posted yet."));return out;}
  const pinned=posts.filter(p=>p.pinned), rest=posts.filter(p=>!p.pinned);
  if(pinned.length){out.push(h("div",{class:"label grouphead"},"Pinned"));out.push(h("div",{class:"list"},pinned.map(postCard)));}
  let cur=null, grp=null;
  for(const p of rest){const w=weekOfStamp(p.created_at); if(w!==cur){cur=w;out.push(h("div",{class:"label grouphead"},"Week of "+weekLabel(w)));grp=h("div",{class:"list"});out.push(grp);} grp.append(postCard(p));}
  return out;
}
function postCard(p){
  const c=h("div",{class:"card"+(p.pinned?" pinned":"")});
  c.append(h("div",{class:"meta"},p.pinned?h("span",{class:"chip ok"},"Pinned"):null,h("span",{},fmtStamp(p.created_at)),p.imported?h("span",{class:"chip mute"},"From spreadsheet"):null));
  if(p.title) c.append(h("h2",{},p.title));
  if(p.body) c.append(h("div",{class:"body"},p.body));
  if(p.img_path) c.append(imgEl(p.img_path));
  if(S.isAdmin){
    c.append(h("div",{class:"row"},
      h("button",{class:"ghost",onclick:async()=>{const {error}=await sb.from("posts").update({pinned:!p.pinned}).eq("id",p.id);if(error)return fail(error,"Post");refresh();}},p.pinned?"Unpin":"Pin"),
      h("button",{class:"ghost",onclick:()=>editPost(c,p)},"Edit"),
      confirmBtn("Delete",async()=>{const {error}=await sb.from("posts").delete().eq("id",p.id);if(error)return fail(error,"Post");if(p.img_path)sb.storage.from("attachments").remove([p.img_path]);refresh();})));
  }
  return c;
}
function editPost(c,p){
  const holder={path:p.img_path||null};
  const ti=h("input",{id:"e-t-"+p.id,value:p.title||"",placeholder:"Title (optional)"});
  const bd=h("textarea",{id:"e-b-"+p.id,rows:4,value:p.body||"",oninput:e=>autogrow(e.target)});
  c.replaceChildren(ti,bd,p.img_path?h("div",{class:"hint"},"Attaching a new screenshot replaces the current one."):null,attachPicker(holder,p.board,bd),
    h("div",{class:"row"},h("button",{class:"primary",onclick:async()=>{
      const {error}=await sb.from("posts").update({title:ti.value.trim(),body:bd.value.trim(),img_path:holder.path,edited_at:new Date().toISOString()}).eq("id",p.id);
      if(error) return fail(error,"Post"); refresh();}},"Save"),h("button",{class:"ghost",onclick:()=>render()},"Cancel")));
  autogrow(bd); bd.focus();
}

// ----- questions for the admin -----
function viewAsk(){
  const out=[h("div",{},h("h1",{},"Questions for "+ADMIN()),h("p",{class:"sub"},S.settings.share_questions?"Ask anything. "+ADMIN()+"'s answers stay here so the whole team can learn from them.":"Ask anything. Your questions and "+ADMIN()+"'s answers are only visible to you and "+ADMIN()+"."))];
  if(!S.isAdmin){
    const holder={};
    const accSel=h("select",{id:"qAcc","aria-label":"Account (optional)"},h("option",{value:""},"No specific account"),accountsOf(myPid()).map(a=>h("option",{value:a.name},a.name)));
    const ta=h("textarea",{id:"qText",rows:3,placeholder:"Type your question…",oninput:e=>autogrow(e.target)});
    const btn=h("button",{class:"primary",onclick:async()=>{
      if(!ta.value.trim()) return; btn.disabled=true;
      const {error}=await sb.from("questions").insert({person_id:myPid(),account:accSel.value,body:ta.value.trim(),img_path:holder.path||null});
      btn.disabled=false; if(error) return fail(error,"Question"); toast("Question sent to "+ADMIN()); refresh();
    }},"Ask");
    out.push(h("div",{class:"panel pad form"},h("div",{class:"row"},h("span",{class:"label"},"Asking as "+S.me.name),accSel),ta,attachPicker(holder,"q/"+myPid(),ta),h("div",{class:"row"},h("span",{class:"spacer"}),btn)));
  }
  const counts={open:S.questions.filter(q=>q.status!=="answered").length,answered:S.questions.filter(q=>q.status==="answered").length};
  out.push(h("div",{class:"seg",role:"group","aria-label":"Filter questions"},[["open","Open ("+counts.open+")"],["answered","Answered ("+counts.answered+")"],["all","All"]].map(([k,l])=>h("button",{"aria-pressed":String(S.qFilter===k),onclick:()=>{S.qFilter=k;render();}},l))));
  let qs=S.questions.slice().sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));
  if(S.qFilter==="open") qs=qs.filter(q=>q.status!=="answered"); else if(S.qFilter==="answered") qs=qs.filter(q=>q.status==="answered");
  if(!qs.length){out.push(h("div",{class:"empty"},S.qFilter==="open"?"No open questions.":"Nothing here yet."));return out;}
  out.push(h("div",{class:"list"},qs.map(qCard)));
  return out;
}
function qCard(q){
  const mine=q.person_id===myPid();
  const c=h("div",{class:"card"});
  c.append(h("div",{class:"meta"},h("strong",{style:"color:var(--ink)"},nameOf(q.person_id)),q.account?h("span",{},"· "+q.account):null,h("span",{},"· "+fmtStamp(q.created_at)),q.status==="answered"?h("span",{class:"chip ok"},"Answered"):h("span",{class:"chip warn"},"Open"),q.imported?h("span",{class:"chip mute"},"From spreadsheet"):null));
  c.append(h("div",{class:"body"},q.body));
  if(q.img_path) c.append(imgEl(q.img_path));
  if(q.answer) c.append(h("div",{class:"answer"},h("div",{class:"label"},ADMIN()+" · "+fmtStamp(q.answered_at)),h("div",{class:"body"},q.answer)));
  const acts=h("div",{class:"row"});
  const upd=async patch=>{const {error}=await sb.from("questions").update(patch).eq("id",q.id);if(error)return fail(error,"Question");refresh();};
  if(S.isAdmin){
    const ta=h("textarea",{id:"ans-"+q.id,rows:2,value:"",placeholder:q.answer?"Update your answer…":"Write an answer…",oninput:e=>autogrow(e.target)});
    c.append(ta);
    acts.append(h("button",{class:"primary",onclick:()=>{if(ta.value.trim())upd({answer:ta.value.trim(),answered_at:new Date().toISOString(),status:"answered"}).then(()=>toast("Answer posted"));}},q.answer?"Update answer":"Answer"));
  }
  if(S.isAdmin||mine){
    if(q.status==="answered") acts.append(h("button",{class:"ghost",onclick:()=>upd({status:"open"})},"Reopen"));
    else acts.append(h("button",{class:"ghost",onclick:()=>upd({status:"answered"})},"Mark resolved"));
    acts.append(confirmBtn("Delete",async()=>{const {error}=await sb.from("questions").delete().eq("id",q.id);if(error)return fail(error,"Question");refresh();}));
  }
  if(acts.childNodes.length) c.append(acts);
  return c;
}

// ----- people & accounts (admin) -----
function viewPeople(){
  const out=[h("div",{},h("h1",{},"People & accounts"),h("p",{class:"sub"},"Add team members and their login emails, assign accounts, and choose what interns can see."))];
  const s=S.settings;
  const tog=(key,label,desc)=>h("label",{class:"setting",for:"set-"+key},
    h("input",{type:"checkbox",id:"set-"+key,checked:!!s[key],onchange:async ev=>{const v=ev.target.checked;const {error}=await sb.from("settings").update({[key]:v}).eq("id",1);if(error){ev.target.checked=!v;return fail(error,"Setting");}S.settings={...S.settings,[key]:v};toast("Saved");}}),
    h("span",{},h("strong",{},label),h("span",{class:"hint",style:"display:block;margin:0"},desc)));
  out.push(h("div",{class:"panel pad form"},h("h2",{},"What interns can see"),
    h("p",{class:"hint",style:"margin:0"},"Interns always see their own accounts, logs, payments and questions, plus the For the team board. They never see For "+PARTNER()+", this page, or anyone's email."),
    h("div",{class:"settings"},
      tog("share_hours","Everyone's weekly hours","Interns see each other's hour totals by week. No notes or pay."),
      tog("share_logs","Everyone's accounts and logs","Interns can read each other's accounts, notes and times (read only)."),
      tog("share_pay","Everyone's payments","Interns see what each person was paid."),
      tog("share_questions","Everyone's questions","Interns see each other's questions and your answers."))));
  const nmField=(key,label)=>h("label",{class:"form",style:"gap:4px",for:"nm-"+key},h("span",{class:"label"},label),h("input",{id:"nm-"+key,value:s[key]||"",onchange:async ev=>{const v=ev.target.value.trim();if(!v)return;const {error}=await sb.from("settings").update({[key]:v}).eq("id",1);if(error)return fail(error,"Name");S.settings={...S.settings,[key]:v};toast("Saved");render();}}));
  out.push(h("div",{class:"panel pad form"},h("h2",{},"Display names"),
    h("p",{class:"hint",style:"margin:0"},"Shown only to signed-in team members. They're stored in the database, not in the site's public code."),
    h("div",{class:"settings"},nmField("team_name","Site name"),nmField("admin_name","Your name (admin)"),nmField("partner_name","Partner board name"))));
  const people=activePeople();
  const nm=h("input",{id:"newPerson",placeholder:"Name"});
  const em=h("input",{id:"newEmail",type:"email",placeholder:"Login email"});
  out.push(h("div",{class:"panel pad form"},h("h2",{},"Add a team member"),
    h("div",{class:"row"},nm,em,h("button",{class:"primary",onclick:async()=>{
      const n=nm.value.trim(); const e=em.value.trim().toLowerCase(); if(!n) return;
      const id=n.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,20)+"-"+Math.random().toString(36).slice(2,6);
      const r=await sb.from("people").insert({id,name:n,role:"intern",sort:people.length+1}); if(r.error) return fail(r.error,"Person");
      if(e){const r2=await sb.from("member_emails").insert({person_id:id,email:e}); if(r2.error) fail(r2.error,"Email");}
      toast(n+" added"+(e?". They can now create an account with "+e:"")); refresh();
    }},"Add")),
    h("p",{class:"hint",style:"margin:0"},"Once their email is here, they go to this site, click “First time? Create account”, and sign up with that exact email.")));
  if(!people.length) out.push(h("div",{class:"empty"},"No team members yet."));
  for(const p of people) out.push(personPanel(p,people));
  const archived=S.people.filter(p=>p.archived);
  if(archived.length){out.push(h("div",{class:"label grouphead"},"Removed from team (no access)"));out.push(h("div",{class:"list"},archived.map(p=>h("div",{class:"card row"},h("span",{style:"flex:1"},p.name),h("button",{onclick:async()=>{const {error}=await sb.from("people").update({archived:false}).eq("id",p.id);if(error)return fail(error);refresh();}},"Restore")))));}
  return out;
}
function personPanel(p,people){
  const accs=accountsOf(p.id); const done=accs.filter(a=>a.setup_done).length;
  const panel=h("div",{class:"panel pad",style:"display:grid;gap:10px"});
  const head=h("div",{class:"row"},h("h2",{},p.name),h("span",{class:"chip mute"},accs.length+" accounts"),h("span",{class:"chip "+(done===accs.length&&accs.length?"ok":"warn")},done+"/"+accs.length+" setup done"),h("span",{class:"spacer"}),
    h("button",{class:"ghost",onclick:()=>{const n=h("input",{id:"rn-"+p.id,value:p.name});head.replaceChildren(n,h("button",{class:"primary",onclick:async()=>{if(!n.value.trim())return;const {error}=await sb.from("people").update({name:n.value.trim()}).eq("id",p.id);if(error)return fail(error);refresh();}},"Save"),h("button",{class:"ghost",onclick:()=>render()},"Cancel"));n.focus();}},"Rename"),
    confirmBtn("Remove from team",async()=>{const {error}=await sb.from("people").update({archived:true}).eq("id",p.id);if(error)return fail(error);toast(p.name+" removed. They can no longer see anything.");refresh();}));
  panel.append(head);
  const email=S.emails[p.id]||"";
  const ei=h("input",{type:"email",id:"em-"+p.id,value:email,placeholder:"Login email (required to sign in)",style:"flex:1 1 240px"});
  panel.append(h("div",{class:"row"},h("span",{class:"label"},"Login email"),ei,h("button",{onclick:async()=>{
    const e=ei.value.trim().toLowerCase();
    const {error}=e?await sb.from("member_emails").upsert({person_id:p.id,email:e}):await sb.from("member_emails").delete().eq("person_id",p.id);
    if(error) return fail(error,"Email"); toast(e?"Email saved":"Email removed. "+p.name+" can no longer sign in."); refresh();}},"Save"),
    email?null:h("span",{class:"chip warn"},"Can't sign in yet")));
  const list=h("div",{class:"acclist"});
  for(const a of accs){
    const row=h("div",{class:"accitem"},h("span",{class:"nm"},a.name),a.setup_done?h("span",{class:"chip ok"},"Setup done"):h("span",{class:"chip mute"},"Setup not yet"));
    const mv=h("select",{"aria-label":"Move "+a.name+" to",id:"mv-"+a.id},h("option",{value:""},"Move to…"),people.filter(x=>x.id!==p.id).map(x=>h("option",{value:x.id},x.name)));
    mv.addEventListener("change",async()=>{if(!mv.value)return;const {error}=await sb.from("accounts").update({person_id:mv.value,sort:99}).eq("id",a.id);if(error)return fail(error,"Account");toast(a.name+" moved to "+nameOf(mv.value));refresh();});
    row.append(mv,
      h("button",{class:"ghost",onclick:()=>{const n=h("input",{id:"ra-"+a.id,value:a.name,style:"flex:1 1 220px"});row.replaceChildren(n,h("button",{class:"primary",onclick:async()=>{if(!n.value.trim())return;const {error}=await sb.from("accounts").update({name:n.value.trim()}).eq("id",a.id);if(error)return fail(error);refresh();}},"Save"),h("button",{class:"ghost",onclick:()=>render()},"Cancel"));n.focus();}},"Rename"),
      confirmBtn("Remove",async()=>{const {error}=await sb.from("accounts").update({archived:true}).eq("id",a.id);if(error)return fail(error);refresh();}));
    list.append(row);
  }
  if(!accs.length) list.append(h("div",{class:"hint"},"No accounts yet."));
  panel.append(list);
  const ta=h("textarea",{id:"add-"+p.id,rows:1,placeholder:"Add accounts, one per line (e.g. Brand ST - City (Owner))",oninput:e=>autogrow(e.target)});
  panel.append(h("div",{class:"row",style:"align-items:flex-start"},h("div",{style:"flex:1 1 260px"},ta),h("button",{onclick:async()=>{
    const names=ta.value.split("\n").map(s=>s.trim()).filter(Boolean); if(!names.length) return;
    const {error}=await sb.from("accounts").insert(names.map((n,i)=>({person_id:p.id,name:n,sort:accs.length+i+1})));
    if(error) return fail(error,"Accounts"); toast(names.length+" account"+(names.length>1?"s":"")+" added"); refresh();}},"Add accounts")));
  return panel;
}

// ---------- routing & boot ----------
function route(){const v=(location.hash||"").slice(1);if(ALL_VIEWS.some(x=>x[0]===v))S.view=v;render();}
window.addEventListener("hashchange",route);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&S.me&&!editing())refresh();});
setInterval(()=>{if(document.visibilityState==="visible"&&S.me&&!editing()&&!Object.keys(S.pending).some(k=>!k.startsWith("t_")))refresh();},90000);

async function boot(){
  const v=(location.hash||"").slice(1); if(ALL_VIEWS.some(x=>x[0]===v)) S.view=v;
  if(!sb){render();return;}
  sb.auth.onAuthStateChange((event,session)=>{
    const was=S.session?.user?.id; S.session=session;
    if(event==="PASSWORD_RECOVERY"){S.recovery=true;render();return;}
    if(session&&session.user.id!==was){S.loaded=false;render();refresh();}
    else if(!session){S.me=null;S.loaded=false;render();}
  });
  const {data}=await sb.auth.getSession(); S.session=data.session;
  render(); if(S.session) refresh();
}
boot();
})();
