export class GameRoom {
  constructor(state){this.state=state;this.sockets=new Set();this.data=null}
  async load(){if(!this.data)this.data=await this.state.storage.get("room");return this.data}
  async save(){await this.state.storage.put("room",this.data)}
  broadcast(){const m=JSON.stringify({type:"state",state:this.data});for(const w of this.sockets)if(w.readyState===1)w.send(m)}
  async fetch(req){
    if(new URL(req.url).pathname.endsWith("/ws")&&req.headers.get("Upgrade")==="websocket"){
      const pair=new WebSocketPair(),[client,server]=Object.values(pair);server.accept();this.sockets.add(server);
      server.addEventListener("message",e=>this.handle(server,JSON.parse(e.data)));
      server.addEventListener("close",()=>this.sockets.delete(server));server.addEventListener("error",()=>this.sockets.delete(server));
      return new Response(null,{status:101,webSocket:client})
    } return new Response("GameRoom")
  }
  async handle(ws,m){try{
    if(m.type==="create"){
      if(await this.load())throw Error("房间已存在");
      this.data={code:m.code,hostId:m.playerId,phase:"lobby",turnId:null,players:[],
        settings:m.settings,cards:[]};this.rebuild();this.addPlayer(m)
    }
    if(!this.data)this.data=await this.load();if(!this.data)throw Error("房间不存在");
    let me=this.data.players.find(p=>p.id===m.playerId);
    if(m.type==="join"&&!me){if(this.data.players.length>=6)throw Error("房间已满（最多6人）");this.addPlayer(m)}
    me=this.data.players.find(p=>p.id===m.playerId);
    if(m.type==="name"){if(!me)throw Error("请先加入房间");me.name=(m.name||"玩家").slice(0,20)}
    if(m.type==="color"){if(!me)throw Error("请先加入房间");if(this.data.players.some(p=>p.id!==me.id&&p.color===m.color))throw Error("该颜色已被其他玩家使用");me.color=m.color}
    if(m.type==="ready"){if(me)me.ready=!me.ready}
    if(m.type==="settings"){if(me?.id!==this.data.hostId||this.data.phase!=="lobby")throw Error("只有房主可修改准备阶段设置");this.data.settings={...this.data.settings,...m.settings};this.rebuild()}
    if(m.type==="start"){
      if(me?.id!==this.data.hostId)throw Error("只有房主可以开始");
      if(this.data.players.length<1)throw Error("没有玩家");
      if(this.data.players.some(p=>!p.ready))throw Error("还有玩家没有准备");
      this.data.phase="playing";this.data.players.forEach(p=>p.score=0);this.data.cards.forEach(c=>{c.revealed=false;c.matched=false});this.shuffle(this.data.cards);this.data.turnId=this.data.players[0].id
    }
    if(m.type==="end"){if(me?.id!==this.data.hostId)throw Error("只有房主可以结束");this.toLobby()}
    if(m.type==="flip")await this.flip(m.index,me?.id)
    await this.save();this.broadcast()
  }catch(e){ws.send(JSON.stringify({type:"error",message:e.message||String(e)}))}}
  addPlayer(m){let color=this.freeColor(m.color),p={id:m.playerId,name:(m.name||"玩家").slice(0,20),color,ready:false,score:0,host:false};this.data.players.push(p);if(!this.data.hostId){this.data.hostId=p.id;p.host=true}}
  freeColor(w){let used=new Set(this.data.players.map(p=>p.color));if(Number.isInteger(w)&&w>=0&&w<6&&!used.has(w))return w;for(let i=0;i<6;i++)if(!used.has(i))return i;return 0}
  rebuild(){this.data.cards=this.data.settings.cards.flatMap((c,g)=>Array.from({length:Math.max(1,+c.count||1)},()=>({id:crypto.randomUUID(),group:g,name:c.name,owner:c.owner||"",revealed:false,matched:false})))}
  shuffle(a){for(let i=a.length-1;i;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}}
  toLobby(){this.data.phase="lobby";this.data.turnId=null;this.data.players.forEach(p=>{p.ready=false;p.score=0});this.rebuild()}
  async flip(i,pid){
    if(this.data.phase!=="playing"||this.data.turnId!==pid)throw Error("还没轮到你");
    let c=this.data.cards[i];if(!c||c.matched||c.revealed)throw Error("这张牌不能翻开");
    c.revealed=true;
    if(c.name==="鬼牌"&&this.data.settings.joker==="on"){this.rotate(pid);this.checkEnd();return}
    let open=this.data.cards.filter(x=>x.revealed&&!x.matched);if(open.length<2){this.checkEnd();return}
    let[a,b]=open.slice(-2);
    if(a.group===b.group){
      a.matched=b.matched=true;let p=this.data.players.find(x=>x.id===pid);
      if(this.data.settings.rule==="normal")p.score+=1;else if(a.owner)p.score+=a.owner===pid?-2:1;
      this.checkEnd()
    }else{
      setTimeout(async()=>{if(this.data?.phase!=="playing")return;a.revealed=b.revealed=false;let n=this.data.players.findIndex(x=>x.id===pid);this.data.turnId=this.data.players[(n+1)%this.data.players.length].id;await this.save();this.broadcast()},650)
    }
  }
  checkEnd(){if(this.data.cards.filter(x=>!x.matched).length<=1){this.data.phase="finished";this.data.turnId=null}}
  rotate(pid){
    const ps=this.data.players;if(ps.length<2)return;const dir=this.data.settings.direction==="cw"?1:-1,idx=ps.findIndex(p=>p.id===pid);
    const ids=ps.map(p=>p.id),scores=ps.map(p=>p.score);
    ps.forEach((p,k)=>{p.score=scores[(k-dir+ps.length)%ps.length]});
    this.data.cards.forEach(c=>{if(c.owner){let k=ids.indexOf(c.owner);if(k>=0)c.owner=ids[(k+dir+ps.length)%ps.length]}})
  }
}
export default {async fetch(req,env){let u=new URL(req.url);if(u.pathname.startsWith("/room/")){let code=u.pathname.split("/")[2];if(!code)return new Response("Missing room code",{status:400});return env.ROOM.get(env.ROOM.idFromName(code)).fetch(req)}return env.ASSETS.fetch(req)}}