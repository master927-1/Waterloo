import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { WaterlooInputMesh } from "./netcode.js";

const CFG = window.WATERLOO_CONFIG || {};
const configured = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY;
const supabase = configured ? createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

const app = document.querySelector("#app");
let user = null, profile = null, friends = [], requests = [], players = [], games = [], hydroBalance = 0;
let scene = { mode:"3d", objects:[] };
let selected = null, editorTool = "block", playState = null, keys = {}, raf = 0, dragging = false, lastPointer = null;
let multiplayer = { mesh:null, gameId:null, remote:new Map(), online:new Set(), lastSend:0, tick:0 };

const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

function authScreen(message="") {
  app.innerHTML = `
  <div class="auth-wrap"><form class="auth" id="authForm">
    <h1>Waterloo</h1>
    <p>Social game platform + 2D/3D creator.</p>
    <div class="tabs"><button type="button" id="loginTab" class="on">Log in</button><button type="button" id="signupTab">Create account</button></div>
    <div class="field"><label>USERNAME / EMAIL</label><input id="email" type="email" required placeholder="you@example.com"></div>
    <div class="field"><label>PASSWORD</label><input id="password" type="password" required minlength="6" placeholder="At least 6 characters"></div>
    <div id="confirmWrap" class="field" style="display:none"><label>USERNAME</label><input id="username" maxlength="20" placeholder="Your public username"></div>
    <div id="authError" class="error">${escapeHtml(message)}</div>
    <button class="primary" id="authButton">${configured ? "Log in" : "Set up backend first"}</button>
    <p style="font-size:10px;text-align:center">Waterloo uses Supabase Auth + Postgres for real accounts and real users.</p>
  </form></div>`;
  let signup = false;
  const setMode = s => { signup=s; $("#loginTab").classList.toggle("on",!s);$("#signupTab").classList.toggle("on",s);$("#confirmWrap").style.display=s?"block":"none";$("#authButton").textContent=configured?(s?"Create account":"Log in"):"Set up backend first"; };
  $("#loginTab").onclick=()=>setMode(false); $("#signupTab").onclick=()=>setMode(true);
  $("#authForm").onsubmit=async e=>{
    e.preventDefault();
    if(!configured){ $("#authError").textContent="Add SUPABASE_URL and SUPABASE_ANON_KEY to config.js, then reload."; return; }
    const email=$("#email").value.trim(), password=$("#password").value, username=$("#username")?.value.trim();
    let result;
    if(signup){
      if(!username || username.length<3){$("#authError").textContent="Choose a username with at least 3 characters.";return;}
      result=await supabase.auth.signUp({email,password,data:{username},options:{emailRedirectTo:`${window.location.origin}${window.location.pathname}`}});
      if(!result.error && result.data.user && result.data.session) await boot();
      else if(!result.error) $("#authError").textContent="Account created. Check your email, then return to Waterloo and log in.";
    } else {
      result=await supabase.auth.signInWithPassword({email,password});
      if(result.error) $("#authError").textContent=result.error.message; else await boot();
    }
  };
}

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

async function boot(){
  if(!supabase){authScreen();return;}
  const {data:{user:u}}=await supabase.auth.getUser(); user=u;
  if(!user){authScreen();return;}
  await ensureProfile();
  await loadData();
  renderPlatform();
}
async function ensureProfile(){
  const {data:p,error}=await supabase.from("profiles").select("*").eq("id",user.id).maybeSingle();
  if(error) throw error;
  if(p){profile=p;return;}
  const username = (user.user_metadata?.username || user.email.split("@")[0]).slice(0,20);
  const {data:created,error:e}=await supabase.from("profiles").insert({id:user.id,username}).select().single();
  if(e) throw e; profile=created;
}
async function loadData(){
  const [p,f,r,g,h]=await Promise.all([
    supabase.from("profiles").select("id,username,created_at").order("username"),
    supabase.from("friendships").select("user_id,friend_id").or(`user_id.eq.${user.id},friend_id.eq.${user.id}`),
    supabase.from("friend_requests").select("id,sender_id,receiver_id,status,profiles!friend_requests_sender_id_fkey(username)").eq("receiver_id",user.id).eq("status","pending"),
    supabase.from("games").select("*").order("created_at",{ascending:false}),
    supabase.from("hydro_accounts").select("balance").eq("user_id",user.id).maybeSingle()
  ]);
  if(p.error)throw p.error;
  players=p.data||[]; hydroBalance=h.data?.balance||0; friends=(f.data||[]).map(x=>x.user_id===user.id?x.friend_id:x.user_id); requests=r.data||[]; games=g.data||[];
}
function nav(view){
  $$(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===`v-${view}`));
  if(view==="create") resizeEditor();
}
function renderPlatform(){
  app.innerHTML=`<div class="top"><div class="logo">WATERLOO<small>GAME PLATFORM</small></div><div class="topnav"><span>Games</span><span>Catalog</span><span>Create</span><span>Players</span></div><div class="search"><input id="globalSearch" placeholder="Search games or players"><button>⌕</button></div></div>
  <div class="layout"><aside class="side"><div class="side-user">${escapeHtml(profile.username)}</div><nav class="nav">
  ${["home","profile","games","create","players","friends","inventory","forums"].map(v=>`<button data-view="${v}" class="${v==="home"?"active":""}">${{home:"⌂ Home",profile:"♙ Profile",games:"▣ Games",create:"⚙ Create",players:"♧ Players",friends:"♥ Friends",inventory:"▤ Inventory",forums:"☷ Forums"}[v]}</button>`).join("")}</nav><button class="logout" id="logout">Log out</button></aside>
  <main class="main">
  <section class="view" id="v-forums"><div class="title">Forums</div><div class="subtitle">Normal Forum + DevForum. Age is not displayed as a profile field.</div><div class="card"><div class="head">Community policy</div><div style="padding:14px;font-size:11px;line-height:1.5">Waterloo can block obvious age-sharing phrases in UI text, but that is only a communication safeguard, not a complete child-safety or legal compliance system. Mature experiences should use explicit creator metadata, access controls and review rather than relying on client-side detection alone.</div></div><div style="height:12px"></div><div class="card"><div class="head">Forum database ready</div><div class="empty">Create posts in the Normal Forum or DevForum after the moderation UI is connected.</div></div></section>
  <section class="view active" id="v-home"><div class="title">Hello, ${escapeHtml(profile.username)}!</div><div class="subtitle">Real accounts. Real users. Real playable games. <b>HYDRO: ${hydroBalance.toLocaleString()}</b></div><div class="card"><div class="head">Friends <span class="online">${friends.length} friends</span></div><div id="homeFriends">${friends.length?friends.map(friendRow).join(""):`<div class="empty">No friends yet.<br><button class="smallbtn blue" id="findPlayers">Find real players</button></div>`}</div></div><div style="height:12px"></div><div class="card"><div class="head">Games</div><div class="games" id="homeGames"></div></div></section>
  <section class="view" id="v-profile"><div class="title">Profile</div><div class="subtitle">Your public Waterloo identity.</div><div class="profile"><div><div class="avatar"></div></div><div><div class="profilebox"><h2 style="font-weight:400;margin:0">${escapeHtml(profile.username)}</h2><p style="font-size:11px;color:#71808a">Waterloo creator</p><p style="font-size:12px">Registered users can discover this profile and send friend requests.</p></div><div class="stats"><div class="stat"><b>${friends.length}</b><span>Friends</span></div><div class="stat"><b>${games.filter(g=>g.owner_id===user.id).length}</b><span>Games</span></div><div class="stat"><b>${scene.objects.length}</b><span>Editor objects</span></div></div></div></div></section>
  <section class="view" id="v-games"><div class="title">Games</div><div class="subtitle">Playable Waterloo worlds.</div><div class="card"><div class="games" id="gamesList"></div></div></section>
  <section class="view" id="v-players"><div class="title">Players</div><div class="subtitle">This list comes from the real profiles table — no bots are inserted.</div><div class="card"><div style="padding:12px"><div class="row"><input id="playerSearch" placeholder="Search username"><button class="smallbtn blue" id="playerSearchBtn">Search</button></div></div><div id="playersList"></div></div></section>
  <section class="view" id="v-friends"><div class="title">Friends</div><div class="subtitle">Only accepted real-user friendships appear here.</div><div class="card"><div class="head">Friends</div><div id="friendsList">${friends.length?friends.map(friendRow).join(""):`<div class="empty">No friends yet.</div>`}</div></div><div style="height:12px"></div><div class="card"><div class="head">Incoming requests</div><div id="requestsList">${requests.length?requests.map(requestRow).join(""):`<div class="empty">No pending requests.</div>`}</div></div></section>
  <section class="view" id="v-inventory"><div class="title">Inventory</div><div class="subtitle">Objects from your current creator scene.</div><div class="card"><div class="head">Hydro Wallet</div><div style="padding:14px"><b style="font-size:24px">${hydroBalance.toLocaleString()} HYDRO</b><p style="font-size:11px;color:#71808a">Balances are stored separately from the multiplayer mesh. Marketplace purchases and transfers will use the centralized ledger.</p><p style="font-size:11px">Launch promotion: the first 100 eligible accounts can be offered a one-time 10,000 Hydro purchase through a real payment provider. This build does not pretend a web checkout happened.</p></div></div><div style="height:12px"></div><div class="card" id="inventoryList">${scene.objects.length?scene.objects.map(objectRow).join(""):`<div class="empty">No custom objects yet.</div>`}</div></section>
  <section class="view" id="v-create"><div class="title">Create</div><div class="subtitle">A real editable scene with playable 2D and 3D modes.</div><div class="editor-tabs"><button id="mode2d">2D Game</button><button id="mode3d" class="active">3D Game</button></div><div class="engine"><div class="panel tools"><h4>Objects</h4><button data-add="block" class="active">■ Block</button><button data-add="platform">▬ Platform</button><button data-add="ball">● Ball</button><button data-add="tree">♣ Tree</button></div><div><div class="stage"><canvas id="editorCanvas"></canvas><div class="modebar" id="modeLabel">3D EDITOR</div><button class="playbtn" id="playButton">▶ PLAY</button><div class="play-overlay" id="playOverlay"><canvas id="playCanvas"></canvas><button class="closeplay" id="closePlay">✕ EXIT</button><div class="touch"><div class="dpad"><button class="up" data-key="w">▲</button><button class="left" data-key="a">◀</button><button class="down" data-key="s">▼</button><button class="right" data-key="d">▶</button></div><button class="jump" data-key="Space">JUMP</button></div><div class="playhelp">WASD / arrows • Space = jump • drag to look in 3D</div><div class="mpStatus" id="mpStatus">SINGLE PLAYER PREVIEW</div></div></div><div class="status" id="status"></div></div><div class="panel inspect"><h4>Inspector</h4><div id="noObj" style="padding:12px;color:#78858f">Select an object.</div><div id="fields" style="display:none"><label>Name</label><input id="oName"><label>X</label><input id="oX" type="number" step=".1"><label>Y</label><input id="oY" type="number" step=".1"><label>Z</label><input id="oZ" type="number" step=".1"><label>Scale</label><input id="oScale" type="number" min=".2" max="4" step=".1"><button class="delete" id="deleteObj">Delete</button></div></div></div><button class="primary" id="publish" style="margin-top:10px">Publish this game</button></section>
  </main></div>`;
  $$(".nav button").forEach(b=>b.onclick=()=>nav(b.dataset.view));
  $("#logout").onclick=async()=>{await supabase.auth.signOut();location.reload()};
  $("#findPlayers")?.addEventListener("click",()=>nav("players"));
  renderGames(); renderPlayers(); renderFriends(); wireEditor(); refreshStatus();
}
function friendRow(id){const p=players.find(x=>x.id===id);return p?`<div class="userrow"><div class="miniavatar"></div><div class="grow"><b>${escapeHtml(p.username)}</b><small>Real Waterloo user</small></div><span class="online">friend</span></div>`:""}
function requestRow(r){return `<div class="userrow"><div class="miniavatar"></div><div class="grow"><b>${escapeHtml(r.profiles?.username||"Player")}</b><small>wants to be your friend</small></div><button class="smallbtn blue" data-accept="${r.id}">Accept</button></div>`}
function objectRow(o){return `<div class="userrow"><div class="grow"><b>${escapeHtml(o.name)}</b><small>${o.type} • scale ${Number(o.scale||1).toFixed(1)}</small></div></div>`}
function renderPlayers(filter=""){const arr=players.filter(p=>p.id!==user.id&&p.username.toLowerCase().includes(filter.toLowerCase()));$("#playersList").innerHTML=arr.length?arr.map(p=>{const isFriend=friends.includes(p.id);const outgoing=p.id && false;return `<div class="userrow"><div class="miniavatar"></div><div class="grow"><b>${escapeHtml(p.username)}</b><small>Registered Waterloo user</small></div>${isFriend?'<span class="online">friends</span>':`<button class="smallbtn blue" data-add="${p.id}">Add friend</button>`}</div>`}).join(""):`<div class="empty">No other registered users.</div>`;$$("[data-add]").forEach(b=>b.onclick=()=>sendFriend(b.dataset.add));}
$("#app");
async function sendFriend(id){const {error}=await supabase.from("friend_requests").upsert({sender_id:user.id,receiver_id:id,status:"pending"},{onConflict:"sender_id,receiver_id"});if(error)alert(error.message);else{alert("Friend request sent.");await loadData();renderPlatform();nav("players")}}
async function acceptFriend(id){const {data:req}=await supabase.from("friend_requests").select("*").eq("id",id).single();if(!req)return;await supabase.from("friend_requests").update({status:"accepted"}).eq("id",id);await supabase.from("friendships").insert([{user_id:req.sender_id,friend_id:req.receiver_id}]);await loadData();renderPlatform();nav("friends")}
function renderFriends(){$("#friendsList").innerHTML=friends.length?friends.map(friendRow).join(""):`<div class="empty">No friends yet.</div>`;$("#requestsList").innerHTML=requests.length?requests.map(requestRow).join(""):`<div class="empty">No pending requests.</div>`;$$("[data-accept]").forEach(b=>b.onclick=()=>acceptFriend(b.dataset.accept))}
function renderGames(){const list=games.length?games:[{id:"starter2d",name:"Waterloo Starter 2D",game_type:"2d",scene:{objects:[]},owner_id:user.id},{id:"starter3d",name:"Waterloo Starter 3D",game_type:"3d",scene:{objects:[]},owner_id:user.id}];const html=list.map(g=>`<div class="game" data-game="${escapeHtml(g.id)}"><div class="thumb">${g.game_type==="2d"?"◆":"◇"}</div><div class="gameinfo"><b>${escapeHtml(g.name)}</b><small>${g.game_type.toUpperCase()} • Playable</small></div></div>`).join("");$("#gamesList").innerHTML=html;$("#homeGames").innerHTML=html;$$("[data-game]").forEach(el=>el.onclick=async()=>{const g=list.find(x=>String(x.id)===String(el.dataset.game));scene={mode:g.game_type,objects:(g.scene?.objects||[]).map(normalizeObject)};selected=null;nav("create");setMode(scene.mode);startPlay(g)})}
function normalizeObject(o){return{id:o.id||uid(),type:o.type||"block",name:o.name||"Object",x:Number(o.x)||0,y:Number(o.y)||0,z:Number(o.z)||0,scale:Number(o.scale||o.s||1)}}
function wireEditor(){scene.mode="3d";scene.objects=[];selected=null;$("#mode2d").onclick=()=>setMode("2d");$("#mode3d").onclick=()=>setMode("3d");$$("[data-add]").forEach(b=>b.onclick=()=>addObject(b.dataset.add));$("#deleteObj").onclick=()=>{scene.objects=scene.objects.filter(o=>o.id!==selected);selected=null;updateInspector();renderInventory();drawEditor()};$("#playButton").onclick=startPlay;$("#closePlay").onclick=stopPlay;$("#publish").onclick=publishGame;let editorDragging=false, editorDragOffset={x:0,y:0};
$("#editorCanvas").addEventListener("pointerdown",e=>{
  const c=$("#editorCanvas"),r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  let hit=null;
  for(let i=scene.objects.length-1;i>=0;i--){const q=editorPos(scene.objects[i]);if(Math.hypot(x-q.x,y-q.y)<48){hit=scene.objects[i];break}}
  selected=hit?.id||null; updateInspector(); drawEditor();
  if(hit){editorDragging=true;editorDragOffset={x:x-hit.x*35-c.clientWidth/2,y:y-(c.clientHeight/2-hit.y*35)};c.setPointerCapture?.(e.pointerId)}
});
$("#editorCanvas").addEventListener("pointermove",e=>{
  if(!editorDragging)return;
  const c=$("#editorCanvas"),r=c.getBoundingClientRect(),o=scene.objects.find(x=>x.id===selected); if(!o)return;
  const x=e.clientX-r.left,y=e.clientY-r.top;
  o.x=(x-c.clientWidth/2-editorDragOffset.x)/35;
  o.y=(c.clientHeight/2-y+editorDragOffset.y)/35;
  updateInspector(); drawEditor();
});
$("#editorCanvas").addEventListener("pointerup",()=>editorDragging=false);
[["oName","name"],["oX","x"],["oY","y"],["oZ","z"],["oScale","scale"]].forEach(([id,key])=>$("#"+id).addEventListener("input",()=>{const o=scene.objects.find(x=>x.id===selected);if(!o)return;o[key]=key==="name"?$("#"+id).value:Number($("#"+id).value);o.scale=Math.max(.2,Math.min(4,o.scale||1));drawEditor();renderInventory()}));resizeEditor()}
function setMode(m){scene.mode=m;$("#mode2d").classList.toggle("active",m==="2d");$("#mode3d").classList.toggle("active",m==="3d");$("#modeLabel").textContent=m.toUpperCase()+" EDITOR";drawEditor()}
function addObject(type){const o={id:uid(),type,name:type[0].toUpperCase()+type.slice(1),x:scene.objects.length*2-4,y:1,z:scene.objects.length*2-4,scale:1};scene.objects.push(o);selected=o.id;updateInspector();renderInventory();drawEditor()}
function resizeEditor(){const c=$("#editorCanvas");if(!c)return;const r=c.parentElement.getBoundingClientRect(),d=devicePixelRatio||1;c.width=r.width*d;c.height=450*d;c.getContext("2d").setTransform(d,0,0,d,0,0);drawEditor()}
function editorPos(o){const c=$("#editorCanvas");return{x:c.clientWidth/2+o.x*35,y:c.clientHeight/2-o.y*35}}
function drawEditor(){const c=$("#editorCanvas"),ctx=c?.getContext("2d");if(!ctx)return;const w=c.clientWidth,h=450;ctx.fillStyle="#18242b";ctx.fillRect(0,0,w,h);ctx.strokeStyle="#2f4652";for(let x=0;x<w;x+=35){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}for(let y=0;y<h;y+=35){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}scene.objects.forEach(o=>drawEditorObject(ctx,o));refreshStatus()}
function drawEditorObject(ctx,o){const p=editorPos(o),s=25*o.scale;ctx.save();ctx.fillStyle=o.type==="ball"?"#e4c35c":o.type==="tree"?"#54a36a":"#6e92a6";if(o.type==="ball"){ctx.beginPath();ctx.arc(p.x,p.y,s*.55,0,Math.PI*2);ctx.fill()}else{ctx.fillRect(p.x-s,p.y-s/2,s*2,s);if(o.type==="tree"){ctx.fillStyle="#72583f";ctx.fillRect(p.x-4,p.y-s,8,s);ctx.fillStyle="#54a36a";ctx.beginPath();ctx.arc(p.x,p.y-s,18,0,Math.PI*2);ctx.fill()}}if(o.id===selected){ctx.strokeStyle="#31b8ff";ctx.lineWidth=2;ctx.strokeRect(p.x-s-5,p.y-s-5,s*2+10,s*2+10)}ctx.fillStyle="#fff";ctx.font="10px Arial";ctx.textAlign="center";ctx.fillText(o.name,p.x,p.y+s+16);ctx.restore()}
function selectObject(e){const c=$("#editorCanvas"),r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let hit=null;for(let i=scene.objects.length-1;i>=0;i--){const p=editorPos(scene.objects[i]);if(Math.hypot(x-p.x,y-p.y)<45){hit=scene.objects[i];break}}if(hit){selected=hit.id;updateInspector();drawEditor()}}
function updateInspector(){const o=scene.objects.find(x=>x.id===selected);$("#noObj").style.display=o?"none":"block";$("#fields").style.display=o?"block":"none";if(!o)return;$("#oName").value=o.name;$("#oX").value=o.x;$("#oY").value=o.y;$("#oZ").value=o.z;$("#oScale").value=o.scale}
function renderInventory(){$("#inventoryList").innerHTML=scene.objects.length?scene.objects.map(objectRow).join(""):`<div class="empty">No custom objects yet.</div>`}
function refreshStatus(){if($("#status"))$("#status").textContent=`${scene.mode.toUpperCase()} editor • ${scene.objects.length} objects • ${selected?"Selected: "+(scene.objects.find(o=>o.id===selected)?.name||"object"):"select an object"}`}
async function publishGame(){const name=prompt("Game name","My Waterloo World");if(!name)return;const {data,error}=await supabase.from("games").insert({owner_id:user.id,name:name.slice(0,50),game_type:scene.mode,scene:{objects:scene.objects}}).select().single();if(error)alert(error.message);else{games.unshift(data);alert("Published. The game is now stored in the database.");renderGames()}}
async function startMultiplayer(game){
  if(!supabase || !game?.id) return;
  await stopMultiplayer();
  multiplayer={mesh:null,gameId:game.id,remote:new Map(),online:new Set([user.id]),lastSend:0,tick:0};
  const mesh=new WaterlooInputMesh({supabase,userId:user.id,username:profile.username,gameId:game.id,
    onInputs:(id,p)=>{
      multiplayer.remote.set(id,{...(multiplayer.remote.get(id)||{}),userId:id,username:multiplayer.remote.get(id)?.username||players.find(x=>x.id===id)?.username||'Player',mode:playState?.mode||scene.mode,input:p,lastSeen:performance.now()});
    },
    onPlayers:(list,hostId)=>{
      multiplayer.online=new Set(list.map(x=>x.userId));
      for(const p of list) if(p.userId!==user.id) multiplayer.remote.set(p.userId,{...(multiplayer.remote.get(p.userId)||{}),userId:p.userId,username:p.username||'Player',mode:scene.mode,lastSeen:performance.now(),cap:p.cap});
      for(const id of multiplayer.remote.keys()) if(!multiplayer.online.has(id)) multiplayer.remote.delete(id);
      updateMultiplayerStatus(hostId);
    },
    onStatus:msg=>{const el=$("#mpStatus");if(el)el.textContent=msg;}
  });
  multiplayer.mesh=mesh;
  try{await mesh.start(); updateMultiplayerStatus(mesh.hostId);}catch(e){console.warn(e); const el=$("#mpStatus"); if(el)el.textContent='MULTIPLAYER • signaling connected, P2P may need TURN on some networks';}
}
async function stopMultiplayer(){
  if(multiplayer.mesh){try{await multiplayer.mesh.stop();}catch{}}
  multiplayer={mesh:null,gameId:null,remote:new Map(),online:new Set(),lastSend:0,tick:0};
  updateMultiplayerStatus();
}
function broadcastPlayer(force=false){
  if(!multiplayer.mesh || !playState) return;
  const now=performance.now(); if(!force && now-multiplayer.lastSend<33)return;
  multiplayer.lastSend=now; multiplayer.tick++;
  multiplayer.mesh.sendInput(multiplayer.tick,{left:keys.a||keys.ArrowLeft,right:keys.d||keys.ArrowRight,up:keys.w||keys.ArrowUp,down:keys.s||keys.ArrowDown,jump:keys.Space});
}
function updateMultiplayerStatus(hostId=multiplayer.mesh?.hostId){
  const el=$("#mpStatus"); if(!el)return;
  if(!multiplayer.gameId){el.textContent='SINGLE PLAYER PREVIEW';return;}
  const count=Math.max(0,multiplayer.online.size-1);
  const role=hostId===user.id?'HOST':(hostId?'PEER':'ELECTING HOST');
  el.textContent=`${role} • INPUT MESH • ${count} other player${count===1?'':'s'} online`;
}
function startPlay(game=null){
  stopPlay();
  $("#playOverlay").classList.add("show");
  playState={mode:scene.mode,x:0,y:1,z:0,vy:0,yaw:0,pitch:.2};
  resizePlayCanvas();
  updateMultiplayerStatus();
  if(game?.id && !String(game.id).startsWith("starter")) startMultiplayer(game);
  raf=requestAnimationFrame(playLoop);
}
function stopPlay(){cancelAnimationFrame(raf);$("#playOverlay")?.classList.remove("show");playState=null;stopMultiplayer()}
function resizePlayCanvas(){const c=$("#playCanvas");if(!c)return;const r=c.parentElement.getBoundingClientRect(),d=devicePixelRatio||1;c.width=r.width*d;c.height=r.height*d;c.getContext("2d").setTransform(d,0,0,d,0,0)}
function project3(x,y,z,w,h,s){const dx=x-playState.x,dz=z-playState.z,dy=y-playState.y,co=Math.cos(playState.yaw),si=Math.sin(playState.yaw),xx=dx*co-dz*si,zz=dx*si+dz*co,f=260/(zz+8);return{x:w/2+xx*f,y:h/2-dy*f-playState.pitch*100,f}}
function playLoop(){if(!playState)return;simulateRemoteInputs();const c=$("#playCanvas"),ctx=c.getContext("2d"),w=c.clientWidth,h=c.clientHeight;if(playState.mode==="2d")play2d(ctx,w,h);else play3d(ctx,w,h);broadcastPlayer();for(const [id,r] of multiplayer.remote){if(performance.now()-r.lastSeen>4000)multiplayer.remote.delete(id)}raf=requestAnimationFrame(playLoop)}
function simulateRemoteInputs(){
  for(const r of multiplayer.remote.values()){
    if(!r.input)continue;
    r.x=r.x??0; r.y=r.y??(r.mode==='2d'?360:1); r.z=r.z??0; r.vy=r.vy??0;
    const b=r.input.buttons||{};
    if(r.mode==='2d'){ if(b.left)r.x-=3; if(b.right)r.x+=3; r.vy+=.55; r.y+=r.vy; if(r.y>=360){r.y=360;r.vy=0;} if(b.jump&&r.y>=359)r.vy=-10; }
    else { if(b.left)r.x-=.12; if(b.right)r.x+=.12; if(b.up)r.z-=.12; if(b.down)r.z+=.12; r.vy-=.025; r.y+=r.vy; if(r.y<1){r.y=1;r.vy=0;} if(b.jump&&r.y<=1.01)r.vy=.32; }
  }
}
function play2d(ctx,w,h){playState.vy+=.55;playState.y+=playState.vy;let onGround=playState.y>=360;if(onGround){playState.y=360;playState.vy=0}if(keys.a||keys.ArrowLeft)playState.x-=3;if(keys.d||keys.ArrowRight)playState.x+=3;if((keys.w||keys.ArrowUp||keys.Space)&&onGround)playState.vy=-10;const cam=Math.max(0,playState.x-w/2);ctx.fillStyle="#87b8d0";ctx.fillRect(0,0,w,h);ctx.fillStyle="#4f6c55";ctx.fillRect(0,380,w,h-380);for(const o of scene.objects){const x=o.x*45-cam,y=380-o.y*35,s=25*o.scale;ctx.fillStyle=o.type==="tree"?"#54a36a":"#6e92a6";if(o.type==="ball"){ctx.beginPath();ctx.arc(x,y-15,s*.5,0,Math.PI*2);ctx.fill()}else ctx.fillRect(x-s,y-s/2,s*2,s)}for(const r of multiplayer.remote.values()){if(r.mode!=="2d")continue;const rx=(r.x??0)-cam, ry=r.y??360;ctx.fillStyle="#7aa8d8";ctx.fillRect(rx-12,ry-25,24,25);ctx.fillStyle="#202a32";ctx.fillRect(rx-8,ry-40,16,15);ctx.fillStyle="#fff";ctx.font="10px Arial";ctx.textAlign="center";ctx.fillText(r.username||"Player",rx,ry-47)}ctx.fillStyle="#d9a950";ctx.fillRect(playState.x-cam-12,playState.y-25,24,25);ctx.fillStyle="#202a32";ctx.fillRect(playState.x-cam-8,playState.y-40,16,15)}
function play3d(ctx,w,h){if(keys.a||keys.ArrowLeft)playState.x-=.12;if(keys.d||keys.ArrowRight)playState.x+=.12;if(keys.w||keys.ArrowUp)playState.z-=.12;if(keys.s||keys.ArrowDown)playState.z+=.12;playState.vy-=.025;playState.y+=playState.vy;if(playState.y<1){playState.y=1;playState.vy=0}if(keys.Space&&playState.y<=1.01)playState.vy=.32;ctx.fillStyle="#17232a";ctx.fillRect(0,0,w,h);ctx.fillStyle="#536c57";ctx.fillRect(0,h/2,w,h/2);for(const o of scene.objects){const p=project3(o.x,o.y,o.z,w,h);if(p.f>0){const s=22*p.f;ctx.fillStyle=o.type==="ball"?"#e4c35c":o.type==="tree"?"#54a36a":"#6e92a6";if(o.type==="ball"){ctx.beginPath();ctx.arc(p.x,p.y,s*.55,0,Math.PI*2);ctx.fill()}else ctx.fillRect(p.x-s,p.y-s,s*2,s*2)}}for(const r of multiplayer.remote.values()){if(r.mode!=="3d")continue;const rp=project3(r.x??0,r.y??1,r.z??0,w,h);if(rp.f>0){const rs=18*rp.f;ctx.fillStyle="#7aa8d8";ctx.fillRect(rp.x-rs*.5,rp.y-rs,rs,rs);ctx.fillStyle="#202a32";ctx.fillRect(rp.x-rs*.35,rp.y-rs*1.45,rs*.7,rs*.7);ctx.fillStyle="#fff";ctx.font="10px Arial";ctx.textAlign="center";ctx.fillText(r.username||"Player",rp.x,rp.y-rs*1.6)}}const p=project3(playState.x,playState.y,playState.z,w,h);ctx.fillStyle="#d9a950";ctx.fillRect(p.x-10,p.y-25,20,25);ctx.fillStyle="#202a32";ctx.fillRect(p.x-7,p.y-40,14,14)}
window.addEventListener("keydown",e=>{keys[e.key]=true;if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key))e.preventDefault()});window.addEventListener("keyup",e=>keys[e.key]=false);
document.addEventListener("pointerdown",e=>{if(e.target.matches(".touch button")){e.target.setPointerCapture?.(e.pointerId);keys[e.target.dataset.key]=true}});
document.addEventListener("pointerup",e=>{if(e.target.matches(".touch button")){keys[e.target.dataset.key]=false}});
document.addEventListener("pointercancel",e=>{if(e.target.matches(".touch button")){keys[e.target.dataset.key]=false}});
$("#app").addEventListener("pointerdown",e=>{
  if(!e.target.closest("#playCanvas"))return;
  if(playState?.mode==="3d"){dragging=true;lastPointer={x:e.clientX,y:e.clientY};e.target.setPointerCapture?.(e.pointerId)}
});
$("#app").addEventListener("pointermove",e=>{
  if(!dragging||!playState||playState.mode!=="3d"||!lastPointer)return;
  playState.yaw+=(e.clientX-lastPointer.x)*.008;
  playState.pitch+=(e.clientY-lastPointer.y)*.003;
  playState.pitch=Math.max(-.8,Math.min(.8,playState.pitch));
  lastPointer={x:e.clientX,y:e.clientY};
});
$("#app").addEventListener("pointerup",()=>{dragging=false;lastPointer=null});
$("#app").addEventListener("pointercancel",()=>{dragging=false;lastPointer=null});
$("#app");
if(supabase)supabase.auth.onAuthStateChange((_event,_session)=>{if(_event==="SIGNED_OUT")authScreen()});
boot().catch(e=>{console.error(e);authScreen(e.message||"Unable to load Waterloo.")});
