const socket=io();let roomCode='';let state=null;let selectedTopup=2000;let lastPhase='';let lastWinner='';
const $=id=>document.getElementById(id); const welcome=$('welcome'),game=$('game'),error=$('error');
function toast(text){const el=$('toast');el.textContent=text;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),2200)}
function enter(code){roomCode=code;welcome.classList.add('hidden');game.classList.remove('hidden');$('roomBadge').classList.remove('hidden');$('walletBtn').classList.remove('hidden');$('roomBadge').textContent=`Стол ${code}`;}
$('createBtn').onclick=()=>socket.emit('room:create',{name:$('name').value},r=>r.error?error.textContent=r.error:enter(r.code));
$('joinBtn').onclick=()=>socket.emit('room:join',{name:$('name').value,code:$('code').value},r=>r.error?error.textContent=r.error:enter(r.code));
$('copyBtn').onclick=async()=>{await navigator.clipboard.writeText(roomCode);toast('Код комнаты скопирован')};
$('startBtn').onclick=()=>socket.emit('game:start',{code:roomCode},showErr); $('nextBtn').onclick=()=>socket.emit('game:next',{code:roomCode},showErr);
function showErr(r){if(r?.error)toast(r.error)}
function cardHtml(c){if(!c)return '<div class="card back"></div>';const red=c.suit==='♥'||c.suit==='♦';return `<div class="card ${red?'red':''}">${c.rank}${c.suit}</div>`}
const phaseNames={lobby:'ЛОББИ',preflop:'ПРЕФЛОП',flop:'ФЛОП',turn:'ТЁРН',river:'РИВЕР',showdown:'ВСКРЫТИЕ'};
function render(s){state=s;$('pot').innerHTML=`<small>БАНК</small><strong>${s.pot.toLocaleString('ru-RU')}</strong>`;$('community').innerHTML=s.community.map(cardHtml).join('');
$('players').innerHTML=s.players.map((p,i)=>`<div class="player p${i} ${p.id===s.currentPlayerId?'turn':''} ${p.folded?'folded':''}"><div class="name">${p.name}${p.id===s.hostId?' 👑':''}${i===s.dealerIndex?'<span class="dealer">D</span>':''}</div><div class="stack">${p.chips.toLocaleString('ru-RU')} фишек</div><div class="bet">${p.bet?`Ставка: ${p.bet.toLocaleString('ru-RU')}`:(p.allIn?'ALL-IN':'')}</div><div class="cards">${p.cards.map(cardHtml).join('')}</div></div>`).join('');
const me=s.players.find(p=>p.id===socket.id);$('actions').classList.toggle('hidden',s.currentPlayerId!==socket.id);$('startBtn').classList.toggle('hidden',socket.id!==s.hostId||s.phase!=='lobby');$('nextBtn').classList.toggle('hidden',socket.id!==s.hostId||s.phase!=='showdown');
$('phaseLabel').textContent=phaseNames[s.phase]||s.phase;$('status').textContent=s.winnerText||({lobby:'Ожидание игроков',preflop:'Карты розданы',flop:'Три карты на столе',turn:'Четвёртая карта',river:'Последняя карта',showdown:'Карты открыты'}[s.phase]||s.phase);
if(me){$('walletBalance').textContent=me.chips.toLocaleString('ru-RU');const toCall=Math.max(0,s.currentBet-me.bet);document.querySelector('[data-action="call"]').textContent=toCall?`Колл ${toCall}`:'Колл';document.querySelector('[data-action="check"]').disabled=toCall>0;$('raiseAmount').value=Math.max(s.currentBet+50,100)}
if(lastPhase&&lastPhase!==s.phase&&s.phase!=='lobby'&&s.phase!=='showdown') toast(`${phaseNames[s.phase]} — новая карта на столе`);lastPhase=s.phase;
if(s.winnerText&&s.winnerText!==lastWinner){lastWinner=s.winnerText;const b=$('handBanner');b.textContent=s.winnerText+(s.winningHand?` · ${s.winningHand}`:'');b.classList.remove('hidden');setTimeout(()=>b.classList.add('hidden'),2700)}
}
socket.on('room:update',render);
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>socket.emit('game:action',{code:roomCode,action:b.dataset.action,amount:$('raiseAmount').value},showErr));
function sendChat(){const text=$('chatInput').value.trim();if(!text)return;socket.emit('chat:send',{code:roomCode,text});$('chatInput').value=''}$('sendChat').onclick=sendChat;$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter')sendChat()});
socket.on('chat:message',m=>{const d=document.createElement('div');d.innerHTML=`<b>${m.name}:</b> ${m.text.replace(/[<>]/g,'')}`;$('messages').appendChild(d);$('messages').scrollTop=$('messages').scrollHeight});
$('walletBtn').onclick=()=>$('walletModal').classList.remove('hidden');$('closeWallet').onclick=()=>$('walletModal').classList.add('hidden');$('walletModal').onclick=e=>{if(e.target===$('walletModal'))$('walletModal').classList.add('hidden')};
document.querySelectorAll('.package').forEach(b=>b.onclick=()=>{document.querySelectorAll('.package').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selectedTopup=Number(b.dataset.chips)});
$('demoTopup').onclick=()=>socket.emit('wallet:demo-topup',{code:roomCode,chips:selectedTopup},r=>{if(r?.error)return toast(r.error);$('walletModal').classList.add('hidden');toast(`Начислено ${selectedTopup.toLocaleString('ru-RU')} демо-фишек`) });
