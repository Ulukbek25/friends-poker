const socket=io();let roomCode='';let state=null;
const $=id=>document.getElementById(id); const welcome=$('welcome'),game=$('game'),error=$('error');
function enter(code){roomCode=code;welcome.classList.add('hidden');game.classList.remove('hidden');$('roomBadge').classList.remove('hidden');$('roomBadge').textContent=`Комната ${code}`;}
$('createBtn').onclick=()=>socket.emit('room:create',{name:$('name').value},r=>r.error?error.textContent=r.error:enter(r.code));
$('joinBtn').onclick=()=>socket.emit('room:join',{name:$('name').value,code:$('code').value},r=>r.error?error.textContent=r.error:enter(r.code));
$('copyBtn').onclick=async()=>{await navigator.clipboard.writeText(roomCode);$('copyBtn').textContent='Код скопирован';setTimeout(()=>$('copyBtn').textContent='Скопировать код',1200)};
$('startBtn').onclick=()=>socket.emit('game:start',{code:roomCode},showErr); $('nextBtn').onclick=()=>socket.emit('game:next',{code:roomCode},showErr);
function showErr(r){if(r?.error)alert(r.error)}
function cardHtml(c){if(!c)return '<div class="card back"></div>';const red=c.suit==='♥'||c.suit==='♦';return `<div class="card ${red?'red':''}">${c.rank}${c.suit}</div>`}
function render(s){state=s;$('pot').textContent=`Банк: ${s.pot}`;$('community').innerHTML=s.community.map(cardHtml).join('');
$('players').innerHTML=s.players.map((p,i)=>`<div class="player p${i} ${p.id===s.currentPlayerId?'turn':''} ${p.folded?'folded':''}"><strong>${p.name}${p.id===s.hostId?' 👑':''}</strong><div>${p.chips} фишек · ставка ${p.bet}</div><div class="cards">${p.cards.map(cardHtml).join('')}</div></div>`).join('');
const me=s.players.find(p=>p.id===socket.id);$('actions').classList.toggle('hidden',s.currentPlayerId!==socket.id);$('startBtn').classList.toggle('hidden',socket.id!==s.hostId||s.phase!=='lobby');$('nextBtn').classList.toggle('hidden',socket.id!==s.hostId||s.phase!=='showdown');
$('status').textContent=s.winnerText||({lobby:'Ожидание игроков',preflop:'Префлоп',flop:'Флоп',turn:'Терн',river:'Ривер',showdown:'Вскрытие'}[s.phase]||s.phase);if(me){const toCall=Math.max(0,s.currentBet-me.bet);document.querySelector('[data-action="call"]').textContent=toCall?`Call ${toCall}`:'Call';document.querySelector('[data-action="check"]').disabled=toCall>0;$('raiseAmount').value=Math.max(s.currentBet+50,100)}}
socket.on('room:update',render);
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>socket.emit('game:action',{code:roomCode,action:b.dataset.action,amount:$('raiseAmount').value},showErr));
function sendChat(){const text=$('chatInput').value.trim();if(!text)return;socket.emit('chat:send',{code:roomCode,text});$('chatInput').value=''}$('sendChat').onclick=sendChat;$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter')sendChat()});
socket.on('chat:message',m=>{const d=document.createElement('div');d.innerHTML=`<b>${m.name}:</b> ${m.text.replace(/[<>]/g,'')}`;$('messages').appendChild(d);$('messages').scrollTop=$('messages').scrollHeight});
