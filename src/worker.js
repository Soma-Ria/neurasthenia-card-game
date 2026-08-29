export class GameRoom {
 constructor(state){this.state=state;this.sockets=new Set();this.data=null;this.disconnectTimers=new Map()}
 async load(){if(!this.data)this.data=await this.state.storage.get("room");return this.data}
 async save(){await this.state.storage.put("room",this.data)}
 broadcast(){const m=JSON.stringify({type:"state",state:this.data});for(const w of this.sockets)if(w.readyState===1)w.send(m)}
 async fetch(req){const u=new URL(req.url);if(u.pathname.endsWith("/ws")&&req.headers.get("Upgrade")==="websocket"){const pair=new WebSocketPair(),[client,server]=Object.values(pair);server.accept();this.sockets.add(server);server.addEventListener("message",e=>this.handle(server,JSON.parse(e.data)));server.addEventListener("close",()=>this.onClose(server));server.addEventListener("error",()=>this.onClose(server));return new Response(null,{status:101,webSocket:client})}return new Response("GameRoom")}
 onClose(ws){
  this.sockets.delete(ws); const pid=ws.playerId; if(!pid||!this.data)return;
  clearTimeout(this.disconnectTimers.get(pid));
  const t=setTimeout(async()=>{this.disconnectTimers.delete(pid);if(![...this.sockets].some(s=>s.playerId===pid)){this.removePlayer(pid);await this.save();this.broadcast()}},30000);
  this.disconnectTimers.set(pid,t);
 }
 async handle(ws,m){try{ws.playerId=m.playerId;
  if(m.type==="create"){if(await this.load())throw Error("房间已存在");this.data={code:m.code,hostId:m.playerId,phase:"lobby",turnId:null,turnLocked:false,players:[],settings:{...m.settings,failTime:+m.settings.failTime||2,jokerCount:Math.min(4,Math.max(1,+m.settings.jokerCount||1))},cards:[]};this.rebuild();this.addPlayer(m,true)}
  if(!this.data)this.data=await this.load();if(!this.data)throw Error("房间不存在，请确认邀请链接或房间号");
  let me=this.data.players.find(p=>p.id===m.playerId);
  if(m.type==="join"){clearTimeout(this.disconnectTimers.get(m.playerId));this.disconnectTimers.delete(m.playerId);if(!me){if(this.data.phase!=="lobby")throw Error("游戏已经开始，暂时不能加入");if(this.data.players.length>=6)throw Error("房间已满（最多6人）");this.addPlayer(m,false)}}
  me=this.data.players.find(p=>p.id===m.playerId);
  if(m.type==="leave"){if(!me)throw Error("你不在房间内");this.removePlayer(m.playerId);clearTimeout(this.disconnectTimers.get(m.playerId));this.disconnectTimers.delete(m.playerId);if(this.data.hostId===m.playerId&&this.data.players.length)this.data.hostId=this.data.players[0].id}
  if(m.type==="name"){if(!me)throw Error("请先加入房间");me.name=(m.name||"玩家").slice(0,20)}
  if(m.type==="color"){if(!me)throw Error("请先加入房间");if(!Number.isInteger(m.color)||m.color<0||m.color>15)throw Error("无效颜色");if(this.data.players.some(p=>p.id!==me.id&&p.color===m.color))throw Error("该颜色已被其他玩家使用");me.color=m.color}
  if(m.type==="ready"){if(me)me.ready=!me.ready}
  if(m.type==="settings"){if(me?.id!==this.data.hostId||this.data.phase!=="lobby")throw Error("只有房主可修改准备阶段设置");this.data.settings={...this.data.settings,...m.settings,failTime:Math.min(10,Math.max(1,+({...this.data.settings,...m.settings}).failTime||2)),jokerCount:Math.min(4,Math.max(1,+({...this.data.settings,...m.settings}).jokerCount||1))};this.rebuild()}
  if(m.type==="start"){if(me?.id!==this.data.hostId)throw Error("只有房主可以开始");if(this.data.players.some(p=>!p.ready))throw Error("还有玩家没有准备");if(this.data.cards.length<2)throw Error("至少需要2张卡牌");this.data.phase="playing";this.data.turnLocked=false;this.data.players.forEach(p=>p.score=0);this.data.cards.forEach(c=>{c.revealed=false;c.matched=false});this.shuffle(this.data.cards);this.data.turnId=this.data.players[0].id}
  if(m.type==="end"){if(me?.id!==this.data.hostId)throw Error("只有房主可以结束");this.toLobby()}
  if(m.type==="flip"){const event=await this.flip(m.index,me?.id);if(event){const msg=JSON.stringify(event);for(const w of this.sockets)if(w.readyState===1)w.send(msg)}}
  await this.save();this.broadcast()
 }catch(e){try{ws.send(JSON.stringify({type:"error",message:e.message||String(e)}))}catch{}}}
 addPlayer(m,host){let color=this.freeColor(m.color),p={id:m.playerId,name:(m.name||"玩家").slice(0,20),color,ready:false,score:0};this.data.players.push(p);if(host)this.data.hostId=p.id}
 freeColor(w){let used=new Set(this.data.players.map(p=>p.color));if(Number.isInteger(w)&&w>=0&&w<16&&!used.has(w))return w;for(let i=0;i<16;i++)if(!used.has(i))return i;return 0}
 rebuild(){let cards=this.data.settings.cards.flatMap((c,g)=>Array.from({length:Math.max(1,+c.count||1)},()=>({id:crypto.randomUUID(),group:g,name:c.name,owner:c.owner||"",revealed:false,matched:false})));if(this.data.settings.joker==="on"){let base=this.data.settings.cards.length;for(let i=0;i<Math.min(4,Math.max(1,+this.data.settings.jokerCount||1));i++)cards.push({id:crypto.randomUUID(),group:`joker-${i}`,name:"鬼牌",owner:"",joker:true,revealed:false,matched:false})}this.data.cards=cards}
 shuffle(a){for(let i=a.length-1;i;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}}
 toLobby(){this.data.phase="lobby";this.data.turnId=null;this.data.turnLocked=false;this.data.players.forEach(p=>{p.ready=false;p.score=0});this.rebuild()}
 async flip(i,pid){if(this.data.phase!=="playing"||this.data.turnId!==pid)throw Error("还没轮到你");if(this.data.turnLocked)throw Error("请等待当前两张牌处理完成");let c=this.data.cards[i];if(!c||c.matched||c.revealed)throw Error("这张牌不能翻开");c.revealed=true;
  if(c.joker&&this.data.settings.joker==="on"){this.data.turnLocked=true;this.rotate(pid);this.shuffle(this.data.cards);this.data.cards.forEach(x=>{if(!x.matched)x.revealed=false});this.data.turnLocked=false;this.checkEnd();return {type:"joker",direction:this.data.settings.direction}}
  let open=this.data.cards.filter(x=>x.revealed&&!x.matched);if(open.length<2){this.checkEnd();return}
  let[a,b]=open.slice(-2);this.data.turnLocked=true;
  if(a.group===b.group){a.matched=b.matched=true;let p=this.data.players.find(x=>x.id===pid);if(this.data.settings.rule==="normal")p.score+=1;else if(a.owner)p.score+=a.owner===pid?-2:1;this.data.turnLocked=false;this.checkEnd();return}
  const wait=Math.min(10000,Math.max(1000,(+this.data.settings.failTime||2)*1000));
  setTimeout(async()=>{if(this.data?.phase!=="playing")return;a.revealed=b.revealed=false;this.data.turnLocked=false;let n=this.data.players.findIndex(x=>x.id===pid);if(n>=0&&this.data.players.length)this.data.turnId=this.data.players[(n+1)%this.data.players.length].id;await this.save();this.broadcast()},wait)
 }
 checkEnd(){if(this.data.settings.rule==="special"&&this.data.players.length===2){for(const p of this.data.players){const mine=this.data.cards.some(c=>c.owner===p.id);const remaining=this.data.cards.some(c=>c.owner===p.id&&!c.matched);if(mine&&!remaining){this.data.phase="finished";this.data.turnId=null;return}}}if(this.data.cards.filter(x=>!x.matched).length<=1){this.data.phase="finished";this.data.turnId=null}}
 rotate(pid){const ps=this.data.players;if(ps.length<2)return;const dir=this.data.settings.direction==="cw"?1:-1,idx=ps.findIndex(p=>p.id===pid),ids=ps.map(p=>p.id),scores=ps.map(p=>p.score);ps.forEach((p,k)=>p.score=scores[(k-dir+ps.length)%ps.length]);this.data.cards.forEach(c=>{if(c.owner){let k=ids.indexOf(c.owner);if(k>=0)c.owner=ids[(k+dir+ps.length)%ps.length]}})}
}
export default {async fetch(req,env){
 const u=new URL(req.url),parts=u.pathname.split("/"),code=parts[2];
 if(u.pathname.startsWith("/room/")&&code){
  const room=env.ROOM.get(env.ROOM.idFromName(code.toUpperCase()));
  if(parts[3]==="ws") return room.fetch(req);
  return env.ASSETS.fetch(new Request(new URL("/",req.url),req));
 }
 return env.ASSETS.fetch(req);
}}