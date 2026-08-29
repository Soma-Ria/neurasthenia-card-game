(()=>{const $=s=>document.querySelector(s);
const COLORS=[
["#ef4444","红"],["#f97316","橙"],["#eab308","黄"],["#84cc16","黄绿"],["#22c55e","绿"],["#14b8a6","青"],["#06b6d4","天蓝"],["#3b82f6","蓝"],["#6366f1","靛"],["#8b5cf6","紫"],["#a855f7","紫红"],["#ec4899","粉"],["#f43f5e","玫红"],["#78716c","灰"],["#0f172a","黑"],["#92400e","棕"]];
const RULES=`<h3>怎么玩？</h3><ol><li>房主先在准备阶段设置规则和卡牌，所有玩家选择自己的名字与颜色。</li><li>所有玩家都点击“准备”后，房主才能开始游戏。</li><li>轮到你时，依次翻开两张还没有配对的牌。</li><li>如果两张牌属于同一组，就算配对成功；保留这两张牌，你获得对应分数，并继续自己的回合。</li><li>如果两张牌不同，会按照房主设置的时间保持翻开，然后盖回，并把回合交给下一位玩家。</li></ol><h3>普通规则</h3><p>每成功配对一组牌，获得 <b>1 分</b>。所有牌都配对完成后，分数最高的玩家获胜。</p><h3>角色规则</h3><p>每一组牌可以指定所属角色。配对成功时：<b>普通牌不加分</b>；获得其他玩家所属的牌 <b>+1 分</b>；获得自己所属的牌 <b>-2 分</b>。分数按“一整对牌”计算，而不是按单张牌计算。</p><h3>鬼牌</h3><p>如果开启鬼牌，翻到鬼牌后，会按照房主选择的方向，让已经获得的角色归属和分数一起转动；同时，场上尚未配对的牌会<b>全部重新洗牌并重新盖上</b>。如果场上只剩最后一张未配对的牌，游戏立即结束。</p><h3>双人对战</h3><p>如果房间只有两名玩家，并且使用角色规则，当其中一名玩家所属的所有角色牌都已经被配对获得时，立即结束对战，由当前分数更高的一方获胜。</p><h3>联机说明</h3><p>一个房间最多 6 人。玩家颜色不能重复；刷新页面或短暂断线会尝试恢复原来的玩家身份，主动点击“返回首页/退出房间”才会离开房间。</p>`;
$("#homeRules").innerHTML=RULES;$("#setupRules").innerHTML=RULES;
let id=localStorage.getItem("ng_id")||crypto.randomUUID();localStorage.setItem("ng_id",id);
let pref=JSON.parse(localStorage.getItem("ng_pref")||"null")||{name:"玩家",color:0,rule:"normal",joker:"off",direction:"cw",cards:[{name:"猫",owner:"",count:2},{name:"狗",owner:"",count:2},{name:"鸟",owner:"",count:2},{name:"鱼",owner:"",count:2}]};
let ws,state,explicitLeave=false;
let reconnectTimer=null;
const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function save(){localStorage.setItem("ng_pref",JSON.stringify(pref))}
function send(type,data={}){if(ws?.readyState===1)ws.send(JSON.stringify({type,playerId:id,...data}))}
function connect(c,create=false){explicitLeave=false;const p=location.protocol==="https:"?"wss":"ws";ws=new WebSocket(`${p}://${location.host}/room/${c}/ws`);
ws.onopen=()=>{if(create)history.replaceState({},"",`/room/${c}`);send(create?"create":"join",create?{code:c,settings:{rule:pref.rule,joker:pref.joker,direction:pref.direction,cards:pref.cards},name:pref.name,color:pref.color}:{name:pref.name,color:pref.color});$("#status").textContent="🟢 已连接"};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="state"){state=m.state;render()}if(m.type==="error"){alert(m.message)}};
ws.onclose=()=>{$("#status").textContent=explicitLeave?"已退出":"🟡 正在重新连接…";if(!explicitLeave&&state){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>{if(state&&(!ws||ws.readyState!==1))connect(state.code,false)},1500)}}}
function render(){if(!state)return;$("#home").classList.add("hidden");$("#room").classList.remove("hidden");$("#roomCode").textContent=state.code;
const me=state.players.find(p=>p.id===id),host=state.hostId===id;
$("#players").innerHTML=state.players.map(p=>`<div class="player ${p.id===id?"me":""}"><span class="dot" style="background:${COLORS[p.color][0]}"></span><b>${esc(p.name)}</b> ${p.id===state.hostId?"👑":""}<br><small>${p.ready?"✓ 已准备":"未准备"}</small></div>`).join("");
document.querySelectorAll(".host").forEach(x=>x.classList.toggle("hidden",!host));
$("#setup").classList.toggle("hidden",state.phase==="playing"||state.phase==="finished");$("#game").classList.toggle("hidden",state.phase!=="playing");$("#finished").classList.toggle("hidden",state.phase!=="finished");
$("#rule").value=state.settings.rule;$("#joker").value=state.settings.joker;$("#direction").value=state.settings.direction;$("#failTime").value=String(state.settings.failTime||2);$("#rule").disabled=$("#joker").disabled=$("#direction").disabled=$("#failTime").disabled=!host;$("#editor").classList.toggle("hidden",!host);
$("#nameInput").value=me?.name||pref.name;
$("#colors").innerHTML=COLORS.map((c,i)=>{const used=state.players.some(p=>p.id!==id&&p.color===i);return `<button class="color ${me?.color===i?"sel":""}" data-c="${i}" ${used?"disabled":""} style="background:${c[0]}" title="${c[1]}"></button>`}).join("");
document.querySelectorAll(".color").forEach(b=>b.onclick=()=>{pref.color=+b.dataset.c;save();send("color",{color:+b.dataset.c})});
if(host){$("#cardRows").innerHTML=state.settings.cards.map((c,i)=>`<div class="cardRow"><input data-i="${i}" data-k="name" value="${esc(c.name)}"><select data-i="${i}" data-k="owner">${ownerOptions(c.owner)}</select><input type="number" min="1" data-i="${i}" data-k="count" value="${c.count}"><button data-del="${i}">×</button></div>`).join("");
$("#cardRows").querySelectorAll("[data-i]").forEach(x=>x.onchange=()=>{let cards=structuredClone(state.settings.cards),i=+x.dataset.i,k=x.dataset.k;cards[i][k]=k==="count"?Math.max(1,+x.value||1):x.value;pref.cards=cards;save();send("settings",{settings:{...state.settings,cards}})});
$("#cardRows").querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{let cards=structuredClone(state.settings.cards);cards.splice(+b.dataset.del,1);send("settings",{settings:{...state.settings,cards}})})}
if(state.phase==="playing")renderGame();if(state.phase==="finished")renderFinished()}
function ownerOptions(v){let s='<option value="">普通卡</option>';for(const p of state.players)s+=`<option value="${p.id}" ${v===p.id?"selected":""}>${esc(p.name)}</option>`;return s}
function roleStyle(c){if(!c.owner)return"";let p=state.players.find(x=>x.id===c.owner);if(!p)return"";let col=COLORS[p.color][0];return ` style="--role:${col};--role-bg:${col}22"` }
function renderGame(){const tp=state.players.find(p=>p.id===state.turnId),myTurn=state.turnId===id;$("#turn").textContent=tp?.name||"—";$("#turnHint").textContent=myTurn?"🎯 轮到你了！请选择两张牌":"请等待对方操作";$("#turnBox").classList.toggle("myTurn",myTurn);$("#scores").innerHTML=state.players.map(p=>`<div class="score"><span class="dot" style="background:${COLORS[p.color][0]}"></span>${esc(p.name)}：<b>${p.score}</b></div>`).join("");
$("#board").innerHTML=state.cards.map((c,i)=>`<button class="card ${c.revealed?"revealed":""} ${c.matched?"matched":""} ${c.owner&&c.revealed?"rolecard":""} ${c.revealed&&!c.matched?"currentPick":""}" ${roleStyle(c)} data-i="${i}" ${c.revealed||c.matched||state.turnId!==id?"disabled":""}>${c.revealed?esc(c.name||"鬼牌"):"?"}</button>`).join("");
document.querySelectorAll(".card").forEach(b=>b.onclick=()=>send("flip",{index:+b.dataset.i}))}
function renderFinished(){let arr=[...state.players].sort((a,b)=>b.score-a.score);$("#result").innerHTML=arr.map((p,i)=>`<p><b>${i+1}. ${esc(p.name)}</b>　${p.score} 分</p>`).join("")}
function goHome(closeRoom){if(closeRoom)send("leave");explicitLeave=true;try{ws?.close()}catch{}state=null;history.pushState({},'',"/");$("#room").classList.add("hidden");$("#home").classList.remove("hidden");$("#status").textContent="未连接"}
$("#createBtn").onclick=()=>connect(Math.random().toString(36).slice(2,8).toUpperCase(),true);
$("#joinBtn").onclick=()=>{let c=$("#roomInput").value.trim().toUpperCase();if(c)connect(c)};
$("#copyBtn").onclick=()=>{let u=location.origin+"/room/"+state.code;navigator.clipboard?.writeText(u).then(()=>alert("邀请链接已复制")).catch(()=>prompt("复制下面的邀请链接：",u))};
$("#leaveBtn").onclick=()=>{if(confirm("确定退出房间吗？")){explicitLeave=true;send("leave");try{ws?.close()}catch{}state=null;history.pushState({},'',"/");$("#room").classList.add("hidden");$("#home").classList.remove("hidden");}};
$("#saveName").onclick=()=>{let n=$("#nameInput").value.trim().slice(0,20)||"玩家";pref.name=n;save();send("name",{name:n})};
$("#readyBtn").onclick=()=>send("ready");$("#startBtn").onclick=()=>send("start");
$("#endBtn").onclick=()=>confirm("确定结束当前游戏并返回准备阶段吗？")&&send("end");$("#backLobby").onclick=()=>send("end");
$("#addCard").onclick=()=>send("settings",{settings:{...state.settings,cards:[...state.settings.cards,{name:"新卡牌",owner:"",count:2}]}});
$("#batchAdd").onclick=()=>$("#batchBox").classList.toggle("hidden");$("#batchCancel").onclick=()=>$("#batchBox").classList.add("hidden");
$("#batchConfirm").onclick=()=>{let n=Math.min(100,Math.max(1,+$("#batchCount").value||1));let cards=Array.from({length:n},(_,i)=>({name:`新卡牌 ${state.settings.cards.length+i+1}`,owner:"",count:2}));send("settings",{settings:{...state.settings,cards:[...state.settings.cards,...cards]}});$("#batchBox").classList.add("hidden")};
for(const [sel,key] of [["#rule","rule"],["#joker","joker"],["#direction","direction"],["#failTime","failTime"]])$(sel).onchange=e=>{pref[key]=e.target.value;save();send("settings",{settings:{...state.settings,[key]:e.target.value}})};
$("#rulesBtn").onclick=()=>{$("#modalText").innerHTML=RULES;$("#modal").classList.remove("hidden")};$("#closeModal").onclick=()=>$("#modal").classList.add("hidden");
let path=location.pathname.match(/^\/room\/([^/]+)\/?$/);if(path){connect(path[1].toUpperCase(),false)}
})();