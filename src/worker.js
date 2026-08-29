export class GameRoom {
  constructor(state) {
    this.state = state; this.sockets = new Set(); this.data = null;
    this.disconnectTimers = new Map(); this.finishTimer = null;
  }
  async load(){ if(!this.data) this.data=await this.state.storage.get('room'); return this.data; }
  async save(){ if(this.data) await this.state.storage.put('room',this.data); }
  async broadcast(){ for(const ws of this.sockets) this.sendState(ws); }
  sendState(ws){
    if(ws.readyState!==1||!this.data)return;
    const d=structuredClone(this.data), pid=ws.playerId;
    // Preparation card visibility is per-player. During play all players need the live board.
    if(d.phase==='lobby'){
      const p=d.players.find(x=>x.id===pid), canView=p?.id===d.hostId||p?.cardView;
      if(!canView) d.settings.cards=(d.settings.cards||[]).map(c=>({name:'隐藏卡牌',owner:'',count:c.count||2,hidden:true}));
      if(d.penalties?.cards){
        d.penalties.cards=d.penalties.cards.map(c=>this.canSeePenalty(c,pid)?c:{id:c.id,name:'隐藏惩罚牌',owner:c.owner||'',count:c.count||2,hidden:true,colorOwner:c.colorOwner||'',editorIds:[]});
      }
    }
    ws.send(JSON.stringify({type:'state',state:d}));
  }
  canSeePenalty(card,pid){
    if(!card.hidden)return true;
    if(!pid)return false;
    if(pid===this.data.hostId)return true;
    if(this.data.players.find(x=>x.id===pid)?.penaltyView===false)return false;
    const p=this.data.players.find(x=>x.id===pid); if(!p)return false;
    if(this.data.penalties.mode==='shared')return !!p.penaltyEdit;
    if(this.data.penalties.mode==='personal')return card.owner===pid||card.editorIds?.includes(pid);
    return false;
  }
  async fetch(req){
    const u=new URL(req.url);
    if(u.pathname.endsWith('/ws')&&req.headers.get('Upgrade')==='websocket'){
      const pair=new WebSocketPair(),[client,server]=Object.values(pair); server.accept();
      this.sockets.add(server);
      server.addEventListener('message',e=>{try{this.handle(server,JSON.parse(e.data))}catch{}});
      server.addEventListener('close',()=>this.onClose(server));
      server.addEventListener('error',()=>this.onClose(server));
      return new Response(null,{status:101,webSocket:client});
    }
    return new Response('GameRoom');
  }
  onClose(ws){
    this.sockets.delete(ws); const pid=ws.playerId; if(!pid||!this.data)return;
    clearTimeout(this.disconnectTimers.get(pid));
    const t=setTimeout(async()=>{
      this.disconnectTimers.delete(pid);
      if(![...this.sockets].some(s=>s.playerId===pid)){
        this.removePlayer(pid); await this.save(); this.broadcast();
      }
    },30000);
    this.disconnectTimers.set(pid,t);
  }
  async handle(ws,m){
    try{
      if(m.type==='ping'){ws.send(JSON.stringify({type:'pong',at:Date.now()}));return;}
      ws.playerId=m.playerId;
      if(m.type==='create'){
        if(await this.load()) throw Error('房间已存在');
        this.data={code:m.code,hostId:m.playerId,phase:'lobby',turnId:null,turnLocked:false,players:[],
          settings:{rule:'normal',joker:'off',jokerCount:1,direction:'cw',failTime:2,cards:[]},cards:[],
          penalties:{enabled:false,mode:'host',cards:[]},events:[]};
        this.data.settings={...this.data.settings,...m.settings}; this.data.nextSettings=null; this.normalize(); this.rebuild(); this.addPlayer(m,true,false);
      }
      if(!this.data)this.data=await this.load();
      if(!this.data)throw Error('房间不存在，请确认邀请链接或房间号');
      let me=this.data.players.find(p=>p.id===m.playerId);
      if(m.type==='join'){
        clearTimeout(this.disconnectTimers.get(m.playerId)); this.disconnectTimers.delete(m.playerId);
        if(!me){
          if(this.data.players.length>=6)throw Error('房间已满（最多6人）');
          this.addPlayer(m,false,this.data.phase!=='lobby');
        }
      }
      me=this.data.players.find(p=>p.id===m.playerId);
      if(m.type==='leave'){
        if(!me)throw Error('你不在房间内');
        this.removePlayer(m.playerId); clearTimeout(this.disconnectTimers.get(m.playerId)); this.disconnectTimers.delete(m.playerId);
        if(this.data.hostId===m.playerId&&this.data.players.length)this.data.hostId=this.data.players[0].id;
      }
      if(m.type==='name'){if(!me)throw Error('请先加入房间');me.name=(m.name||'玩家').slice(0,20)}
      if(m.type==='color'){if(!me)throw Error('请先加入房间');if(!Number.isInteger(m.color)||m.color<0||m.color>=16)throw Error('无效颜色');if(this.data.players.some(p=>p.id!==me.id&&p.color===m.color))throw Error('该颜色已被其他玩家使用');me.color=m.color}
      if(m.type==='ready'){if(me&&!me.spectator)this.toggleReady(me)}
      if(m.type==='settings')this.updateSettings(me,m.settings||{});
      if(m.type==='permissions')this.updatePermissions(me,m.permissions||{});
      if(m.type==='spectator')this.setSpectator(me,m.playerId,!!m.spectator);
      if(m.type==='penalties')this.updatePenalties(me,m);
      if(m.type==='start')this.startGame(me);
      if(m.type==='end'){if(me?.id!==this.data.hostId)throw Error('只有房主可以结束');this.toLobby()}
      if(m.type==='flip')await this.flip(m.index,me?.id,m.area||'main');
      await this.save(); this.broadcast();
    }catch(e){try{ws.send(JSON.stringify({type:'error',message:e.message||String(e)}))}catch{}}
  }
  normalize(){
    const s=this.data.settings||{}; s.failTime=Math.min(10,Math.max(1,+s.failTime||2)); s.jokerCount=Math.min(4,Math.max(1,+s.jokerCount||1)); s.cards=Array.isArray(s.cards)?s.cards:[]; this.data.settings=s;
    this.data.nextSettings=this.data.nextSettings&&typeof this.data.nextSettings==='object'?this.data.nextSettings:null;
    this.data.permissions=this.data.permissions||{players:{}};
    this.data.penalties=this.data.penalties||{enabled:false,mode:'host',cards:[]}; this.data.penalties.cards=this.data.penalties.cards||[]; this.data.penaltyCards=Array.isArray(this.data.penaltyCards)?this.data.penaltyCards:[];
    for(const p of this.data.players||[])this.normalizePlayer(p);
  }
  normalizePlayer(p){p.ready=!!p.ready;p.spectator=!!p.spectator;p.score=Number.isFinite(p.score)?p.score:0;p.acquired=Array.isArray(p.acquired)?p.acquired:[];p.debuffs=Array.isArray(p.debuffs)?p.debuffs:[];p.cardView=p.cardView!==false;p.cardEdit=!!p.cardEdit;p.penaltyView=p.penaltyView!==false;p.penaltyEdit=!!p.penaltyEdit}
  addPlayer(m,host,spectator=false){const p={id:m.playerId,name:(m.name||'玩家').slice(0,20),color:this.freeColor(m.color),ready:false,score:0,acquired:[],debuffs:[],cardView:true,cardEdit:false,penaltyView:true,penaltyEdit:false,spectator:!!spectator};this.data.players.push(p);if(host)this.data.hostId=p.id;this.data.permissions=this.data.permissions||{players:{}}}
  removePlayer(pid){const i=this.data.players.findIndex(p=>p.id===pid);if(i>=0)this.data.players.splice(i,1);if(this.data.hostId===pid&&this.data.players.length)this.data.hostId=this.data.players[0].id}
  freeColor(w){const used=new Set(this.data.players.map(p=>p.color));if(Number.isInteger(w)&&w>=0&&w<16&&!used.has(w))return w;for(let i=0;i<16;i++)if(!used.has(i))return i;return 0}
  canEditMain(p){return !!p&&(p.id===this.data.hostId||p.cardEdit)}
  toggleReady(me){me.ready=!me.ready}
  updateSettings(me,s){
    const keys=['rule','joker','jokerCount','direction','failTime'];
    if(this.data.phase!=='lobby'){
      if(me?.id!==this.data.hostId)throw Error('只有房主可以修改游戏设置');
      this.data.nextSettings={...(this.data.nextSettings||{}),...s};
      return;
    }
    if(Object.keys(s).some(k=>keys.includes(k))&&me?.id!==this.data.hostId)throw Error('只有房主可以修改游戏规则');
    if('cards' in s&&!this.canEditMain(me))throw Error('你没有修改公共区卡牌的权限');
    if('cards' in s)this.data.settings.cards=Array.isArray(s.cards)?s.cards:[];
    for(const k of keys)if(k in s)this.data.settings[k]=s[k];
    this.normalize(); this.rebuild();
  }
  setSpectator(me,targetId,spectator){
    if(me?.id!==this.data.hostId)throw Error('只有房主可以调整观战状态');
    const p=this.data.players.find(x=>x.id===targetId); if(!p)throw Error('玩家不存在');
    p.spectator=!!spectator;
    if(p.spectator&&this.data.turnId===p.id)this.nextTurn(p.id);
    if(this.data.phase==='lobby'&&!p.spectator)p.ready=false;
    if(!p.spectator&&this.data.phase==='playing'&&!this.data.turnId)this.data.turnId=p.id;
  }
  updatePermissions(me,perm){
    if(me?.id!==this.data.hostId||this.data.phase!=='lobby')throw Error('只有房主可设置权限');
    this.data.permissions={...this.data.permissions,...perm};
    const q=perm.players||{};
    for(const p of this.data.players){if(q[p.id]){p.cardView=!!q[p.id].cardView;p.cardEdit=!!q[p.id].cardEdit;p.penaltyView=q[p.id].penaltyView!==false;p.penaltyEdit=!!q[p.id].penaltyEdit}}
  }
  updatePenalties(me,m){
    if(this.data.phase!=='lobby')throw Error('游戏开始后不能修改惩罚牌');
    if(m.penalties?.enabled!==undefined&&me?.id!==this.data.hostId)throw Error('只有房主可开启或关闭惩罚牌');
    const next={...this.data.penalties,...(m.penalties||{})}; const mode=next.mode;
    if(me?.id!==this.data.hostId){
      if(mode==='shared'&&!me?.penaltyEdit)throw Error('你没有惩罚牌编辑权限');
      if(mode==='personal'&&m.card&&m.card.owner!==me.id)throw Error('只能修改自己的惩罚牌');
    }
    this.data.penalties=next;
    if(Array.isArray(m.cards)){
      if(me?.id!==this.data.hostId && !(mode==='shared'&&me?.penaltyEdit))throw Error('没有权限修改惩罚牌');
      this.data.penalties.cards=m.cards;
    }
    if(m.card){
      const i=this.data.penalties.cards.findIndex(c=>c.id===m.card.id);
      if(i<0)this.data.penalties.cards.push(m.card);else this.data.penalties.cards[i]={...this.data.penalties.cards[i],...m.card};
    }
    this.data.penalties.cards=this.data.penalties.cards.map(c=>({...c,editorIds:Array.isArray(c.editorIds)?c.editorIds:[]}));
  }
  rebuild(){
    const s=this.data.settings;
    this.data.cards=(s.cards||[]).flatMap((c,g)=>Array.from({length:Math.max(1,+c.count||1)},()=>({id:crypto.randomUUID(),group:`m-${g}`,name:c.name||'未命名',owner:c.owner||'',revealed:false,matched:false})));
    if(s.joker==='on')for(let i=0;i<Math.min(4,Math.max(1,+s.jokerCount||1));i++)this.data.cards.push({id:crypto.randomUUID(),group:`joker-${i}`,name:'鬼牌',owner:'',joker:true,revealed:false,matched:false});
  }
  buildPenaltyBoard(){
    return (this.data.penalties.cards||[]).flatMap((c,g)=>Array.from({length:Math.max(1,+c.count||1)},()=>({...c,id:crypto.randomUUID(),group:`p-${g}`,revealed:false,matched:false,joker:false})));
  }
  shuffle(a){for(let i=a.length-1;i;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}}
  startGame(me){
    if(me?.id!==this.data.hostId)throw Error('只有房主可以开始');
    const active=this.data.players.filter(p=>!p.spectator);
    if(active.length<1||active.some(p=>!p.ready))throw Error('还有游戏玩家没有准备');
    if(this.data.cards.length<2)throw Error('至少需要2张公共牌');
    this.data.phase='playing'; this.data.turnLocked=false; this.data.turnId=active[0].id; this.data.events=[];
    for(const p of this.data.players){p.score=0;p.acquired=[];p.debuffs=[];if(!p.spectator)p.ready=true}
    for(const c of this.data.cards){c.revealed=false;c.matched=false}
    this.data.penaltyCards=this.data.penalties.enabled?this.buildPenaltyBoard():[];
    this.shuffle(this.data.cards); this.shuffle(this.data.penaltyCards);
  }
  toLobby(){
    if(this.finishTimer){clearTimeout(this.finishTimer);this.finishTimer=null}
    this.data.phase='lobby';this.data.turnId=null;this.data.turnLocked=false;this.data.events=[];
    if(this.data.nextSettings){ this.data.settings={...this.data.settings,...this.data.nextSettings}; this.data.nextSettings=null; this.normalize(); }
    for(const p of this.data.players){p.ready=false;p.score=0;p.acquired=[];p.debuffs=[]}
    this.data.cards=[];this.data.penaltyCards=[];this.rebuild();
  }
  addEvent(text,type='info'){this.data.events=[...(this.data.events||[]).slice(-2),{id:crypto.randomUUID(),text,type,at:Date.now()}]}
  addEventPersistent(text,type='info'){this.data.events=[...(this.data.events||[]).slice(-2),{id:crypto.randomUUID(),text,type,at:Date.now()}]}
  async flip(i,pid,area){
    const player=this.data.players.find(x=>x.id===pid); if(player?.spectator)throw Error('观战玩家不能操作牌');
    if(this.data.phase!=='playing'||this.data.turnId!==pid)throw Error('还没轮到你');
    if(this.data.turnLocked)throw Error('请等待当前牌处理完成');
    const arr=area==='penalty'?this.data.penaltyCards:this.data.cards;
    const c=arr?.[i]; if(!c||c.matched||c.revealed)throw Error('这张牌不能翻开');
    c.revealed=true;
    if(c.joker){
      this.data.turnLocked=true;this.addEvent(`👻 ${this.data.players.find(p=>p.id===pid)?.name||'玩家'} 触发了鬼牌！`,'joker');
      await this.save();this.broadcast();
      await new Promise(r=>setTimeout(r,2200));
      this.jokerMove();
      for(const x of this.data.cards)if(!x.matched)x.revealed=false;
      for(const x of this.data.penaltyCards)if(!x.matched)x.revealed=false;
      this.data.turnLocked=false;this.nextTurn(pid);this.checkEnd();return;
    }
    const open=arr.filter(x=>x.revealed&&!x.matched);if(open.length<2)return;
    const [a,b]=open.slice(-2);this.data.turnLocked=true;
    if(a.group===b.group){
      a.matched=b.matched=true;this.acquirePair(pid,a,b);
      if(area==='penalty')this.applyPenalty(pid,a);else this.scorePair(pid,a);
      this.data.turnLocked=false;this.checkEnd();return;
    }
    const wait=Math.min(10000,Math.max(1000,(+this.data.settings.failTime||2)*1000));
    setTimeout(async()=>{if(this.data?.phase!=='playing')return;a.revealed=b.revealed=false;this.data.turnLocked=false;this.nextTurn(pid);await this.save();this.broadcast()},wait);
  }
  acquirePair(pid,a,b){const p=this.data.players.find(x=>x.id===pid);if(!p)return;p.acquired.push(a.id,b.id)}
  scorePair(pid,a){
    const p=this.data.players.find(x=>x.id===pid);if(!p)return;
    if(this.data.settings.rule==='normal'){p.score+=1;return}
    if(a.owner){if(a.owner===pid)p.score-=2;else{p.score+=1;const from=this.data.players.find(x=>x.id===a.owner);this.addEvent(`🎴 ${p.name} 夺走了 ${from?.name||'玩家'} 的 ${a.name||'角色牌'}`,'role');}}
  }
  applyPenalty(pid,c){const p=this.data.players.find(x=>x.id===pid);if(!p)return;p.debuffs.push({id:c.id,name:c.name||'惩罚',owner:c.owner||''});this.addEvent(`⚠️ ${p.name} 触发了 ${c.name||'惩罚'}`,'penalty')}
  nextTurn(pid){const active=this.data.players.filter(p=>!p.spectator);if(!active.length){this.data.turnId=null;return}const n=active.findIndex(x=>x.id===pid);this.data.turnId=active[(n+1+active.length)%active.length].id}
  jokerMove(){
    const ps=this.data.players;if(ps.length<2)return;const dir=this.data.settings.direction,ids=ps.map(p=>p.id),packs=ps.map(p=>p.acquired||[]),debuffs=ps.map(p=>p.debuffs||[]),scores=ps.map(p=>p.score);let map=[];
    if(dir==='random'){const perm=[...Array(ps.length).keys()];this.shuffle(perm);map=perm}
    else{const d=dir==='cw'?1:-1;map=ps.map((_,k)=>(k-d+ps.length)%ps.length)}
    ps.forEach((p,k)=>{p.acquired=[...packs[map[k]]];p.debuffs=[...debuffs[map[k]]];p.score=scores[map[k]]});
    if(this.data.settings.rule==='special')this.recalcSpecialScores();
  }
  recalcSpecialScores(){
    for(const p of this.data.players)p.score=0;
    for(const p of this.data.players){const groups=new Set();for(const id of p.acquired||[]){const c=this.data.cards.find(x=>x.id===id);if(c?.group&&!c.joker)groups.add(c.group)}for(const g of groups){const c=this.data.cards.find(x=>x.group===g);if(c?.owner)p.score+=c.owner===p.id?-2:1}}
  }
  checkEnd(){
    if(this.data.phase!=='playing')return;
    const activePlayers=this.data.players.filter(p=>!p.spectator);
    if(this.data.settings.rule==='special'&&activePlayers.length===2){
      for(const p of this.data.players){
        const groups=new Set(this.data.cards.filter(c=>c.owner===p.id&&!c.joker).map(c=>c.group));
        if(groups.size&&[...groups].every(g=>this.data.cards.filter(c=>c.group===g).every(c=>c.matched)))return this.finishAfterDelay();
      }
    }
    const mainLeft=this.data.cards.filter(x=>!x.matched).length;
    const penaltyLeft=this.data.penalties.enabled?this.data.penaltyCards.filter(x=>!x.matched).length:0;
    if(mainLeft<=1&&penaltyLeft<=1)return this.finishAfterDelay();
  }

  finishAfterDelay(){
    if(this.data.phase!=='playing')return;this.data.phase='ending';this.data.turnId=null;this.data.turnLocked=true;this.data.events=[];this.broadcast();
    this.finishTimer=setTimeout(async()=>{if(!this.data)return;this.data.phase='finished';this.data.turnLocked=false;this.finishTimer=null;await this.save();this.broadcast()},5000);
  }
}
export default {async fetch(req,env){const u=new URL(req.url),parts=u.pathname.split('/'),code=parts[2];if(u.pathname.startsWith('/room/')&&code){const room=env.ROOM.get(env.ROOM.idFromName(code.toUpperCase()));if(parts[3]==='ws')return room.fetch(req);return env.ASSETS.fetch(new Request(new URL('/',req.url),req))}return env.ASSETS.fetch(req)}};
