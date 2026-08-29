import { DurableObject } from 'cloudflare:workers';

const COLORS = ['#e05252','#4b83e5','#2fa66a','#e0a629','#9361d3','#df72a8'];
const MAX_PLAYERS = 6;

function rid() { return Math.random().toString(36).slice(2,8).toUpperCase(); }
function shuffle(a) { for (let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} }

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env=env;
    this.room = null;
    this.sockets = new Map();
    this.ctx.blockConcurrencyWhile(async()=>{ this.room = await this.ctx.storage.get('room') || null; });
  }
  save(){ return this.ctx.storage.put('room',this.room); }
  broadcast(msg){ const text=JSON.stringify(msg); for(const ws of this.ctx.getWebSockets()){try{ws.send(text)}catch{}} }
  send(ws,msg){try{ws.send(JSON.stringify(msg))}catch{}}
  publicState(){
    if(!this.room) return null;
    const r=this.room;
    return {roomId:r.roomId,hostId:r.hostId,phase:r.phase,mode:r.mode,settings:r.settings,players:r.players.map(p=>({id:p.id,name:p.name,color:p.color,ready:p.ready,score:p.score,cards:p.cards.length})),currentPlayer:r.currentPlayer,remaining:r.remaining,deck:r.deck.map(c=>({id:c.id,flipped:c.flipped,collected:c.collected,name:c.name,type:c.type,owner:c.owner,symbol:c.symbol,pair:c.collected?c.pair:undefined}))};
  }
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/init' && request.method==='POST'){ const b=await request.json(); if(this.room) return new Response(JSON.stringify({error:'房间已存在'}),{status:409,headers:{'content-type':'application/json'}}); this.room={roomId:b.roomId,hostId:b.hostId,phase:'lobby',mode:'normal',settings:b.settings||{},players:[b.player],deck:[],currentPlayer:0,first:null,second:null,remaining:0}; await this.save(); return new Response(JSON.stringify({roomId:b.roomId,playerId:b.hostId}),{headers:{'content-type':'application/json'}}); }
    if(url.pathname==='/join' && request.method==='POST'){ const b=await request.json(); if(!this.room) return new Response(JSON.stringify({error:'房间不存在'}),{status:404,headers:{'content-type':'application/json'}}); if(this.room.phase!=='lobby') return new Response(JSON.stringify({error:'游戏已经开始'}),{status:409,headers:{'content-type':'application/json'}}); if(this.room.players.length>=MAX_PLAYERS) return new Response(JSON.stringify({error:'房间已满'}),{status:409,headers:{'content-type':'application/json'}}); const pid=crypto.randomUUID(); const idx=this.room.players.length; const p={id:pid,name:String(b.name||`玩家${idx+1}`).slice(0,20),color:COLORS[idx],ready:false,score:0,cards:[]}; this.room.players.push(p); await this.save(); return new Response(JSON.stringify({roomId:this.room.roomId,playerId:pid}),{headers:{'content-type':'application/json'}}); }
    if(url.pathname==='/ws'){
      if(request.headers.get('Upgrade')!=='websocket') return new Response('WebSocket required',{status:426});
      const roomId=url.searchParams.get('room'); const playerId=url.searchParams.get('player');
      if(!roomId||!playerId) return new Response('room/player required',{status:400});
      const pair=new WebSocketPair(); const [client,server]=Object.values(pair);
      this.ctx.acceptWebSocket(server); server.serializeAttachment({playerId});
      this.sockets.set(playerId,server);
      if(this.room) this.send(server,{type:'state',state:this.publicState()});
      return new Response(null,{status:101,webSocket:client});
    }
    return new Response('Not found',{status:404});
  }
  async webSocketMessage(ws,message){
    let m; try{m=JSON.parse(message)}catch{return}
    const a=ws.deserializeAttachment()||{}; const pid=a.playerId;
    if(!this.room) return this.send(ws,{type:'error',message:'房间不存在'});
    const p=this.room.players.find(x=>x.id===pid); if(!p)return this.send(ws,{type:'error',message:'玩家不存在'});
    try{
      if(m.type==='set_name' && this.room.phase==='lobby'){p.name=String(m.name||'玩家').slice(0,20);await this.save();this.broadcast({type:'state',state:this.publicState()});}
      else if(m.type==='ready' && this.room.phase==='lobby'){p.ready=!!m.value;await this.save();this.broadcast({type:'state',state:this.publicState()});}
      else if(m.type==='start' && this.room.phase==='lobby') await this.start(pid,m.settings);
      else if(m.type==='flip') await this.flip(pid,m.cardId);
      else if(m.type==='leave'){this.removePlayer(pid);await this.save();this.broadcast({type:'state',state:this.publicState()});}
    }catch(e){this.send(ws,{type:'error',message:e.message||'操作失败'});}
  }
  async start(pid,settings){
    if(pid!==this.room.hostId) throw Error('只有房主可以开始游戏');
    if(this.room.players.length<1||this.room.players.length>6) throw Error('玩家人数必须为 1～6');
    if(this.room.players.some(p=>!p.ready)) throw Error('还有玩家没有准备');
    const s=settings||this.room.settings; const mode=s.mode==='special'?'special':'normal';
    const groups=Array.isArray(s.groups)?s.groups:[]; if(!groups.length) throw Error('请至少设置一组卡牌');
    let deck=[],pair=0;
    for(const g of groups){
      const count=Math.max(1,Math.min(100,Number(g.count)||1));
      const type=g.type==='player'&&mode==='special'?'player':(g.type==='ghost'?'ghost':'normal');
      if(type!=='ghost'&&count<2) throw Error(`卡牌组「${g.name}」至少需要2张`);
      if(type==='player'&&!(Number(g.owner)>=0&&Number(g.owner)<this.room.players.length)) throw Error(`卡牌组「${g.name}」没有正确指定所属玩家`);
      for(let i=0;i<count;i++) deck.push({id:crypto.randomUUID(),pair:type==='ghost'?null:pair,name:type==='ghost'?'鬼牌':String(g.name||'卡牌'),type,owner:type==='player'?Number(g.owner):-1,symbol:type==='ghost'?'👻':['◆','●','▲','★','♥','♣','☀','☾','✿','⬟','✦','♠','✚','❖'][pair%14],flipped:false,collected:false});
      if(type!=='ghost') pair++;
    }
    if(s.ghostOn){const gc=Math.max(0,Math.min(10,Number(s.ghostCount)||0));for(let i=0;i<gc;i++)deck.push({id:crypto.randomUUID(),pair:null,name:'鬼牌',type:'ghost',owner:-1,symbol:'👻',flipped:false,collected:false});}
    shuffle(deck);
    this.room={...this.room,phase:'playing',mode,settings:{...s,mode},deck,currentPlayer:0,first:null,second:null,remaining:deck.length,players:this.room.players.map(p=>({...p,score:0,cards:[]}))};
    await this.save(); this.broadcast({type:'state',state:this.publicState()});
  }
  async flip(pid,cardId){
    if(this.room.phase!=='playing') throw Error('游戏尚未开始或已经结束');
    const pi=this.room.players.findIndex(p=>p.id===pid); if(pi!==this.room.currentPlayer) throw Error('还没轮到你');
    const c=this.room.deck.find(x=>x.id===cardId); if(!c||c.collected||c.flipped) throw Error('这张牌不能翻开');
    if(this.room.first===null){c.flipped=true;this.room.first=c.id;await this.save();this.broadcast({type:'state',state:this.publicState()});return;}
    if(this.room.second!==null) throw Error('正在处理上一轮');
    c.flipped=true;this.room.second=c.id;this.broadcast({type:'state',state:this.publicState()});
    const a=this.room.deck.find(x=>x.id===this.room.first), b=c;
    await new Promise(r=>setTimeout(r,850));
    if(a.type==='ghost'||b.type==='ghost'){
      const ghost=a.type==='ghost'?a:b; ghost.collected=true; if(a!==ghost)a.flipped=false;if(b!==ghost)b.flipped=false;
      this.room.remaining--; this.rotate(); this.room.first=this.room.second=null;
      if(this.room.remaining<=1){this.finish('鬼牌规则：场上只剩最后一张牌');return;}
    }else if(a.pair===b.pair){a.collected=b.collected=true;this.room.remaining-=2;this.award(a,pi);this.award(b,pi);this.room.first=this.room.second=null;if(this.room.remaining===0){this.finish('所有卡牌均已配对');return;}}
    else{a.flipped=b.flipped=false;this.room.first=this.room.second=null;this.room.currentPlayer=(pi+1)%this.room.players.length;}
    await this.save();this.broadcast({type:'state',state:this.publicState()});
  }
  award(c,pi){const p=this.room.players[pi];p.cards.push(c.id);if(this.room.mode==='normal')p.score++;else if(c.type==='player')p.score+=c.owner===pi?-2:1;}
  rotate(){const n=this.room.players.length,old=this.room.players.map(p=>({score:p.score,cards:[...p.cards]})),d=this.room.settings.direction==='ccw'?-1:1;for(let i=0;i<n;i++){const src=(i-d+n)%n;this.room.players[i].score=old[src].score;this.room.players[i].cards=old[src].cards;}}
  finish(reason){this.room.phase='finished';this.room.finishReason=reason;this.ctx.storage.put('room',this.room);this.broadcast({type:'state',state:this.publicState()});}
  removePlayer(pid){this.room.players=this.room.players.filter(p=>p.id!==pid);if(!this.room.players.length){this.room=null;this.ctx.storage.delete('room');return;}if(this.room.hostId===pid)this.room.hostId=this.room.players[0].id;this.room.currentPlayer=Math.min(this.room.currentPlayer,this.room.players.length-1);}
  async webSocketClose(ws){const a=ws.deserializeAttachment()||{};this.sockets.delete(a.playerId);}
}

export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/create'){if(request.method!=='POST')return new Response('Method not allowed',{status:405});let body=await request.json().catch(()=>({}));const roomId=rid();const hostId=crypto.randomUUID();const id=env.ROOM.idFromName(roomId);const room=env.ROOM.get(id);const p={id:hostId,name:String(body.name||'玩家1').slice(0,20),color:COLORS[0],ready:true,score:0,cards:[]};const res=await room.fetch(new Request(url.origin+'/init',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId,hostId,player:p,settings:body.settings})}));return res;}
  if(url.pathname==='/api/join'){if(request.method!=='POST')return new Response('Method not allowed',{status:405});let body=await request.json().catch(()=>({}));const roomId=String(body.roomId||'').toUpperCase();const id=env.ROOM.idFromName(roomId);const room=env.ROOM.get(id);return room.fetch(new Request(url.origin+'/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));}
  if(url.pathname.startsWith('/room/')){const parts=url.pathname.split('/').filter(Boolean);const roomId=(parts[1]||'').toUpperCase(); if(parts[2]==='ws'){const stub=env.ROOM.get(env.ROOM.idFromName(roomId));const u=new URL(request.url);u.pathname='/ws';u.searchParams.set('room',roomId);u.searchParams.set('player',url.searchParams.get('player')||'');return stub.fetch(new Request(u,request));} return env.ASSETS.fetch(new Request(url.origin+'/index.html',request));}
  if(url.pathname==='/init'||url.pathname==='/join'){const stub=env.ROOM.get(env.ROOM.idFromName('dummy'));return new Response('direct room endpoint',{status:404});}
  return env.ASSETS.fetch(request);
}};
