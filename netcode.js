// Waterloo experimental input-sharing mesh.
// Signaling uses Supabase Realtime; gameplay packets use WebRTC DataChannels.
// The demo simulation is fixed-step. Production games should use a deterministic
// fixed-point/authoritative simulation plus TURN and server-side validation.

export class WaterlooInputMesh {
  constructor({supabase, userId, username, gameId, onInputs, onPlayers, onStatus}) {
    this.supabase = supabase; this.userId = userId; this.username = username; this.gameId = gameId;
    this.onInputs = onInputs || (()=>{}); this.onPlayers = onPlayers || (()=>{}); this.onStatus = onStatus || (()=>{});
    this.channel = null; this.peers = new Map(); this.inputs = new Map(); this.presence = new Map();
    this.hostId = null; this.startedAt = performance.now(); this.seq = 0; this.lastElection = 0;
    this.localCapabilities = this.capabilities();
  }
  capabilities() {
    const cores = navigator.hardwareConcurrency || 2;
    const memory = navigator.deviceMemory || 2;
    const connection = navigator.connection;
    return { cores, memory, downlink: connection?.downlink || 0, rtt: connection?.rtt || 9999,
      score: cores * 10 + memory * 5 + Math.max(0, 50 - Math.min(connection?.rtt || 9999, 50)) };
  }
  async start() {
    if (!this.supabase) return;
    const topic = `waterloo-mesh:${this.gameId}`;
    this.channel = this.supabase.channel(topic, {config:{presence:{key:this.userId}}});
    this.channel
      .on('presence',{event:'sync'},()=>this.syncPresence())
      .on('presence',{event:'join'},({newPresences})=>this.handlePresence(newPresences))
      .on('presence',{event:'leave'},({leftPresences})=>this.handleLeave(leftPresences))
      .on('broadcast',{event:'signal'},({payload})=>this.handleSignal(payload));
    await new Promise((resolve,reject)=>this.channel.subscribe(async status=>{
      if(status==='SUBSCRIBED'){await this.channel.track({userId:this.userId,username:this.username,cap:this.localCapabilities,startedAt:this.startedAt}); resolve();}
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT') reject(new Error(`Mesh signaling ${status}`));
    }));
    this.syncPresence();
    this.electHost();
  }
  syncPresence(){
    const state=this.channel?.presenceState()||{}; const next=new Map();
    for(const entries of Object.values(state)) for(const p of entries) if(p.userId) next.set(p.userId,p);
    this.presence=next;
    for(const [id] of this.peers) if(!next.has(id)) this.closePeer(id);
    for(const [id,p] of next) if(id!==this.userId && !this.peers.has(id) && this.shouldInitiate(id)) this.connect(id);
    this.electHost(); this.onPlayers([...next.values()],this.hostId);
  }
  shouldInitiate(id){ return String(this.userId) < String(id); }
  async signal(to,payload){ return this.channel?.send({type:'broadcast',event:'signal',payload:{from:this.userId,to,...payload}}); }
  async connect(id){
    if(this.peers.has(id)) return this.peers.get(id);
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
    const peer={pc,dc:null,remoteInputs:new Map()}; this.peers.set(id,peer);
    const dc=pc.createDataChannel('inputs',{ordered:true}); this.bindDataChannel(id,dc);
    pc.onicecandidate=e=>{if(e.candidate)this.signal(id,{kind:'ice',candidate:e.candidate});};
    const offer=await pc.createOffer(); await pc.setLocalDescription(offer); await this.signal(id,{kind:'offer',sdp:pc.localDescription});
    return peer;
  }
  bindDataChannel(id,dc){
    const peer=this.peers.get(id); if(!peer)return; peer.dc=dc;
    dc.onopen=()=>this.onStatus(`P2P input link connected • ${this.peers.size} peer${this.peers.size===1?'':'s'}`);
    dc.onclose=()=>this.onStatus(`P2P input link closed • ${this.peers.size} peer${this.peers.size===1?'':'s'}`);
    dc.onmessage=e=>{try{const p=JSON.parse(e.data); if(p.type==='input')this.receiveInput(id,p);}catch{}};
  }
  async handleSignal(m){
    if(!m || m.to!==this.userId || !m.from)return;
    let peer=this.peers.get(m.from);
    if(m.kind==='offer'){
      if(!peer){const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]}); peer={pc,dc:null,remoteInputs:new Map()}; this.peers.set(m.from,peer);
        pc.ondatachannel=e=>this.bindDataChannel(m.from,e.channel);
        pc.onicecandidate=e=>{if(e.candidate)this.signal(m.from,{kind:'ice',candidate:e.candidate});};
      }
      await peer.pc.setRemoteDescription(m.sdp); const answer=await peer.pc.createAnswer(); await peer.pc.setLocalDescription(answer); await this.signal(m.from,{kind:'answer',sdp:peer.pc.localDescription});
    } else if(m.kind==='answer' && peer){ await peer.pc.setRemoteDescription(m.sdp); }
    else if(m.kind==='ice' && peer){ try{await peer.pc.addIceCandidate(m.candidate);}catch{} }
  }
  handlePresence(list){ this.syncPresence(); }
  handleLeave(list){ for(const p of list||[]) this.closePeer(p.userId); this.syncPresence(); }
  closePeer(id){const p=this.peers.get(id); if(p?.pc) p.pc.close(); this.peers.delete(id); this.inputs.delete(id);}
  sendInput(tick,buttons){
    const packet={type:'input',tick,seq:++this.seq,buttons:{left:!!buttons.left,right:!!buttons.right,up:!!buttons.up,down:!!buttons.down,jump:!!buttons.jump}};
    this.inputs.set(this.userId,packet);
    const raw=JSON.stringify(packet);
    for(const p of this.peers.values()) if(p.dc?.readyState==='open') p.dc.send(raw);
    return packet;
  }
  receiveInput(id,p){ this.inputs.set(id,{...p,userId:id}); this.onInputs(id,p); }
  electHost(){
    const now=performance.now(); if(now-this.lastElection<100)return; this.lastElection=now;
    const candidates=[...this.presence.values()]; if(!candidates.length)return;
    candidates.sort((a,b)=>{
      const ar=a.cap?.rtt||9999, br=b.cap?.rtt||9999;
      if(ar!==br)return ar-br;
      const sa=a.cap?.score||0,sb=b.cap?.score||0;
      if(sb!==sa)return sb-sa;
      return String(a.userId).localeCompare(String(b.userId));
    });
    const next=candidates[0]?.userId||null;
    if(next!==this.hostId){this.hostId=next; this.onStatus(next===this.userId?'HOST • input mesh owner':'PEER • host '+(this.presence.get(next)?.username||next));}
  }
  async stop(){
    for(const [id] of this.peers)this.closePeer(id);
    if(this.channel){try{await this.channel.untrack();}catch{} try{await this.supabase.removeChannel(this.channel);}catch{}}
    this.channel=null; this.hostId=null; this.presence.clear(); this.inputs.clear();
  }
}
