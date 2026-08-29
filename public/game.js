(()=>{const $=s=>document.querySelector(s);
const COLORS=[["#ef4444","红"],["#3b82f6","蓝"],["#22c55e","绿"],["#eab308","黄"],["#a855f7","紫"],["#ec4899","粉"]];
const RULES=`<h3>普通规则</h3><p>轮到玩家时翻开两张牌。相同组成一对，<b>+1 分</b>并继续；不同则不加分并换下一位。全部配对完成后，分数最高者获胜。</p><h3>角色规则</h3><p>普通牌的一对：0 分；其他玩家所属的一对：<b>+1 分</b>；自己所属的一对：<b>-2 分</b>。所有分数变化都按“一对牌”计算。</p><h3>鬼牌</h3><p>翻开鬼牌后，已获得的卡牌归属和分数按设置的顺时针或逆时针方向转动。场上只剩最后一张牌时立即结束。</p><h3>联机</h3><p>房间最多 6 人。房主设置卡牌并开始/结束游戏；每位玩家可以选择自己的颜色，颜色不能重复。</p>`;
$("#homeRules").innerHTML=RULES;$("#setupRules").innerHTML=RULES;
let id=localStorage.getItem("ng_id")||crypto.randomUUID();localStorage.setItem("ng_id",id);
let pref=JSON.parse(localStorage.getItem("ng_pref")||"null")||{name:"玩家",color:0,rule:"normal",joker:"off",direction:"cw",cards:[{name:"猫",owner:"",count:2},{name:"狗",owner:"",count:2},{name:"鸟",owner:"",count:2},{name:"鱼",owner:"",count:2}]};
let ws,state;
const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function save(){localStorage.setItem("ng_pref",JSON.stringify(pref))}
function send(type,data={}){if(ws?.readyState===1)ws.send(JSON.stringify({type,playerId:id,...data}))}
function connect(code,create=false){const p=location.protocol==="https:"?"wss":"ws";ws=new WebSocket(`${p}://${location.host}/room/${code}/ws`);ws.onopen=()=>{send("join",{name:pref.name,color:pref.color});if(create)send("create",{code,settings:{rule:pref.rule,joker:pref.joker,direction:pref.direction,cards:pref.cards}});$("#status").textContent="已连接"};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="state"){state=m.state;render()}if(m.type==="error")alert(m.message)};ws.onclose=()=>$("#status").textContent="连接断开"}
function render(){if(!state)return;$("#home").classList.add("hidden");$("#room").classList.remove("hidden");$("#roomCode").textContent=state.code;const me=state.players.find(p=>p.id===id),host=state.hostId===id;
$("#players").innerHTML=state.players.map(p=>`<div class="player ${p.id===id?"me":""}"><span class="dot" style="background:${COLORS[p.color][0]}"></span><b>${esc(p.name)}</b> ${p.host?"👑":""}<br><small>${p.ready?"✓ 已准备":"未准备"}</small></div>`).join("");
document.querySelectorAll(".host").forEach(x=>x.classList.toggle("hidden",!host));$("#setup").classList.toggle("hidden",state.phase==="playing");$("#game").classList.toggle("hidden",state.phase!=="playing");
$("#rule").value=state.settings.rule;$("#joker").value=state.settings.joker;$("#direction").value=state.settings.direction;
$("#rule").disabled=$("#joker").disabled=$("#direction").disabled=!host;
$("#editor").classList.toggle("hidden",!host);
$("#colors").innerHTML=COLORS.map((c,i)=>{const used=state.players.some(p=>p.id!==id&&p.color===i);return `<button class="color ${me?.color===i?"sel":""}" data-c="${i}" ${used?"disabled":""} style="background:${c[0]}" title="${c[1]}"></button>`}).join("");
document.querySelectorAll(".color").forEach(b=>b.onclick=()=>send("color",{color:+b.dataset.c}));
if(host){$("#cardRows").innerHTML=state.settings.cards.map((c,i)=>`<div class="cardRow"><input data-i="${i}" data-k="name" value="${esc(c.name)}"><select data-i="${i}" data-k="owner">${ownerOptions(c.owner)}</select><input type="number" min="1" data-i="${i}" data-k="count" value="${c.count}"><button data-del="${i}">×</button></div>`).join("");
$("#cardRows").querySelectorAll("[data-i]").forEach(x=>x.onchange=()=>{let cards=structuredClone(state.settings.cards),i=+x.dataset.i,k=x.dataset.k;cards[i][k]=k==="count"?Math.max(1,+x.value||1):x.value;pref.cards=cards;save();send("settings",{settings:{...state.settings,cards}})});$("#cardRows").querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{let cards=structuredClone(state.settings.cards);cards.splice(+b.dataset.del,1);send("settings",{settings:{...state.settings,cards}})})}
if(state.phase==="playing")renderGame()}
function ownerOptions(v){let s='<option value="">普通卡</option>';for(const p of state.players)s+=`<option value="${p.id}" ${v===p.id?"selected":""}>${esc(p.name)}</option>`;return s}
function renderGame(){$("#turn").textContent=state.players.find(p=>p.id===state.turnId)?.name||"—";$("#scores").innerHTML=state.players.map(p=>`<div class="score"><span class="dot" style="background:${COLORS[p.color][0]}"></span>${esc(p.name)}：<b>${p.score}</b></div>`).join("");$("#board").innerHTML=state.cards.map((c,i)=>`<button class="card ${c.revealed?"revealed":""} ${c.matched?"matched":""}" data-i="${i}" ${c.revealed||c.matched||state.turnId!==id?"disabled":""}>${c.revealed?esc(c.name||"鬼牌"):"?"}</button>`).join("");document.querySelectorAll(".card").forEach(b=>b.onclick=()=>send("flip",{index:+b.dataset.i}))}
$("#createBtn").onclick=()=>connect(Math.random().toString(36).slice(2,8).toUpperCase(),true);
$("#joinBtn").onclick=()=>{let c=$("#roomInput").value.trim().toUpperCase();if(c)connect(c)};
$("#copyBtn").onclick=()=>navigator.clipboard?.writeText(location.origin+"/room/"+state.code).then(()=>alert("邀请链接已复制"));
$("#readyBtn").onclick=()=>send("ready");$("#startBtn").onclick=()=>send("start");
$("#endBtn").onclick=()=>confirm("确定结束当前游戏并返回准备阶段吗？")&&send("end");
$("#addCard").onclick=()=>send("settings",{settings:{...state.settings,cards:[...state.settings.cards,{name:"新卡牌",owner:"",count:2}]}});
for(const [sel,key] of [["#rule","rule"],["#joker","joker"],["#direction","direction"]])$(sel).onchange=e=>{pref[key]=e.target.value;save();send("settings",{settings:{...state.settings,[key]:e.target.value}})};
$("#rulesBtn").onclick=()=>{$("#modalText").innerHTML=RULES;$("#modal").classList.remove("hidden")};$("#closeModal").onclick=()=>$("#modal").classList.add("hidden");
if(location.pathname.startsWith("/room/"))connect(location.pathname.split("/")[2]);
})();