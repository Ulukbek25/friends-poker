import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const STARTING_CHIPS = 2000;
const SMALL_BLIND = 25;
const BIG_BLIND = 50;

const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function publicRoom(room, viewerId) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    pot: room.pot,
    currentBet: room.currentBet,
    community: room.community,
    currentPlayerId: room.currentPlayerId,
    dealerIndex: room.dealerIndex,
    minRaise: BIG_BLIND,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      bet: p.bet,
      folded: p.folded,
      allIn: p.allIn,
      connected: p.connected,
      cards: p.id === viewerId || room.phase === 'showdown' ? p.cards : p.cards.map(() => null)
    })),
    winnerText: room.winnerText || '',
    winningHand: room.winningHand || ''
  };
}

function emitRoom(room) {
  for (const p of room.players) io.to(p.id).emit('room:update', publicRoom(room, p.id));
}

function activePlayers(room) {
  return room.players.filter(p => !p.folded && p.connected && p.chips + p.bet > 0);
}

function nextActiveIndex(room, from) {
  if (!room.players.length) return -1;
  for (let step = 1; step <= room.players.length; step++) {
    const idx = (from + step) % room.players.length;
    const p = room.players[idx];
    if (!p.folded && !p.allIn && p.connected && p.chips > 0) return idx;
  }
  return -1;
}

function allMatched(room) {
  return room.players.every(p => p.folded || p.allIn || !p.connected || p.bet === room.currentBet);
}

function resetBets(room) {
  room.players.forEach(p => { p.bet = 0; p.acted = false; });
  room.currentBet = 0;
}

function postBlind(player, amount) {
  const paid = Math.min(player.chips, amount);
  player.chips -= paid;
  player.bet += paid;
  if (player.chips === 0) player.allIn = true;
  return paid;
}

function startHand(room) {
  const eligible = room.players.filter(p => p.connected && p.chips > 0);
  if (eligible.length < 2) return;
  room.deck = makeDeck();
  room.community = [];
  room.pot = 0;
  room.currentBet = 0;
  room.phase = 'preflop';
  room.winnerText = '';
  room.winningHand = '';
  room.players.forEach(p => {
    p.cards = p.connected && p.chips > 0 ? [room.deck.pop(), room.deck.pop()] : [];
    p.folded = !p.connected || p.chips <= 0;
    p.allIn = false;
    p.bet = 0;
    p.acted = false;
  });

  room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
  const sbIndex = nextActiveIndex(room, room.dealerIndex);
  const bbIndex = nextActiveIndex(room, sbIndex);
  room.pot += postBlind(room.players[sbIndex], SMALL_BLIND);
  room.pot += postBlind(room.players[bbIndex], BIG_BLIND);
  room.currentBet = Math.max(room.players[sbIndex].bet, room.players[bbIndex].bet);
  const firstIndex = nextActiveIndex(room, bbIndex);
  room.currentPlayerId = firstIndex >= 0 ? room.players[firstIndex].id : null;
  emitRoom(room);
}

function advanceStreet(room) {
  const contenders = room.players.filter(p => !p.folded && p.connected);
  if (contenders.length <= 1) return finishHand(room, contenders[0]);

  if (room.phase === 'river' || contenders.every(p => p.allIn)) return showdown(room);

  resetBets(room);
  if (room.phase === 'preflop') {
    room.deck.pop();
    room.community.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    room.phase = 'flop';
  } else if (room.phase === 'flop') {
    room.deck.pop(); room.community.push(room.deck.pop()); room.phase = 'turn';
  } else if (room.phase === 'turn') {
    room.deck.pop(); room.community.push(room.deck.pop()); room.phase = 'river';
  }
  const idx = nextActiveIndex(room, room.dealerIndex);
  room.currentPlayerId = idx >= 0 ? room.players[idx].id : null;
  if (!room.currentPlayerId) showdown(room);
}

function rankValue(rank) { return RANKS.indexOf(rank) + 2; }

function scoreFive(cards) {
  const vals = cards.map(c => rankValue(c.rank)).sort((a,b)=>b-a);
  const counts = new Map(); vals.forEach(v => counts.set(v,(counts.get(v)||0)+1));
  const groups = [...counts.entries()].sort((a,b)=> b[1]-a[1] || b[0]-a[0]);
  const flush = cards.every(c => c.suit === cards[0].suit);
  const unique = [...new Set(vals)];
  if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let i=0;i<=unique.length-5;i++) if (unique[i]-unique[i+4]===4) { straightHigh=unique[i]; break; }
  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0][1]===4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1]===3 && groups[1]?.[1]>=2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1]===3) return [3, groups[0][0], ...groups.filter(g=>g[1]===1).map(g=>g[0]).sort((a,b)=>b-a)];
  if (groups[0][1]===2 && groups[1]?.[1]===2) {
    const pairs=[groups[0][0],groups[1][0]].sort((a,b)=>b-a);
    const kicker=groups.find(g=>g[1]===1)?.[0]||0;
    return [2,...pairs,kicker];
  }
  if (groups[0][1]===2) return [1,groups[0][0],...groups.filter(g=>g[1]===1).map(g=>g[0]).sort((a,b)=>b-a)];
  return [0,...vals];
}

function handName(score) {
  return ['Старшая карта','Пара','Две пары','Сет','Стрит','Флеш','Фул-хаус','Каре','Стрит-флеш'][score?.[0] || 0];
}

function compareScore(a,b) { for(let i=0;i<Math.max(a.length,b.length);i++){ const d=(a[i]||0)-(b[i]||0); if(d) return d;} return 0; }
function combinations(arr,k){ const out=[]; const rec=(start,p)=>{ if(p.length===k){out.push(p.slice());return;} for(let i=start;i<arr.length;i++){p.push(arr[i]);rec(i+1,p);p.pop();}}; rec(0,[]); return out; }
function bestScore(cards){ let best=null; for(const hand of combinations(cards,5)){ const s=scoreFive(hand); if(!best||compareScore(s,best)>0) best=s;} return best; }

function showdown(room) {
  while (room.community.length < 5) { room.deck.pop(); room.community.push(room.deck.pop()); }
  const contenders = room.players.filter(p => !p.folded && p.connected);
  let best = null; let winners = [];
  for (const p of contenders) {
    const s = bestScore([...p.cards, ...room.community]);
    if (!best || compareScore(s,best)>0) { best=s; winners=[p]; }
    else if (compareScore(s,best)===0) winners.push(p);
  }
  const share = Math.floor(room.pot / winners.length);
  winners.forEach(w => w.chips += share);
  const remainder = room.pot - share * winners.length;
  if (winners[0]) winners[0].chips += remainder;
  room.winnerText = winners.length === 1 ? `${winners[0].name} выиграл банк ${room.pot}` : `Ничья: ${winners.map(w=>w.name).join(', ')} делят банк ${room.pot}`;
  room.winningHand = handName(best);
  room.pot = 0;
  room.phase = 'showdown';
  room.currentPlayerId = null;
  emitRoom(room);
}

function finishHand(room, winner) {
  if (winner) { winner.chips += room.pot; room.winnerText = `${winner.name} выиграл банк ${room.pot}`; room.winningHand = 'Победа без вскрытия'; }
  room.pot = 0; room.phase = 'showdown'; room.currentPlayerId = null; emitRoom(room);
}

function afterAction(room, playerIndex) {
  const contenders = room.players.filter(p => !p.folded && p.connected);
  if (contenders.length <= 1) return finishHand(room, contenders[0]);
  const everyoneActed = room.players.every(p => p.folded || p.allIn || !p.connected || p.acted);
  if (everyoneActed && allMatched(room)) {
    advanceStreet(room);
    emitRoom(room);
    return;
  }
  const next = nextActiveIndex(room, playerIndex);
  room.currentPlayerId = next >= 0 ? room.players[next].id : null;
  if (!room.currentPlayerId) advanceStreet(room);
  emitRoom(room);
}

function sanitizeName(name) { return String(name || '').trim().slice(0,20); }
function newCode() { return Math.random().toString(36).slice(2,8).toUpperCase(); }

io.on('connection', socket => {
  socket.on('room:create', ({ name }, cb) => {
    name = sanitizeName(name); if (!name) return cb?.({ error:'Введите имя' });
    let code; do { code = newCode(); } while (rooms.has(code));
    const room = { code, hostId:socket.id, players:[], phase:'lobby', pot:0, currentBet:0, community:[], deck:[], dealerIndex:-1, currentPlayerId:null, winnerText:'', winningHand:'' };
    room.players.push({ id:socket.id, name, chips:STARTING_CHIPS, bet:0, cards:[], folded:false, allIn:false, connected:true, acted:false });
    rooms.set(code, room); socket.join(code); cb?.({ ok:true, code }); emitRoom(room);
  });

  socket.on('room:join', ({ code, name }, cb) => {
    code=String(code||'').toUpperCase().trim(); name=sanitizeName(name);
    const room=rooms.get(code); if(!room) return cb?.({error:'Комната не найдена'});
    if(room.phase!=='lobby' && room.phase!=='showdown') return cb?.({error:'Дождитесь окончания раздачи'});
    if(room.players.length>=8) return cb?.({error:'Комната заполнена'});
    room.players.push({ id:socket.id, name, chips:STARTING_CHIPS, bet:0, cards:[], folded:false, allIn:false, connected:true, acted:false });
    socket.join(code); cb?.({ok:true,code}); emitRoom(room);
  });

  socket.on('game:start', ({ code }, cb) => {
    const room=rooms.get(code); if(!room || room.hostId!==socket.id) return cb?.({error:'Только создатель может начать'});
    if(room.players.filter(p=>p.connected).length<2) return cb?.({error:'Нужно минимум 2 игрока'});
    startHand(room); cb?.({ok:true});
  });

  socket.on('game:next', ({ code }, cb) => {
    const room=rooms.get(code); if(!room || room.hostId!==socket.id) return cb?.({error:'Только создатель может продолжить'});
    if(room.phase!=='showdown') return cb?.({error:'Раздача еще не завершена'});
    startHand(room); cb?.({ok:true});
  });

  socket.on('game:action', ({ code, action, amount }, cb) => {
    const room=rooms.get(code); if(!room || room.currentPlayerId!==socket.id) return cb?.({error:'Сейчас не ваш ход'});
    const idx=room.players.findIndex(p=>p.id===socket.id); const p=room.players[idx];
    const toCall = room.currentBet - p.bet;
    if(action==='fold') { p.folded=true; p.acted=true; }
    else if(action==='check') { if(toCall!==0) return cb?.({error:'Нельзя сделать check'}); p.acted=true; }
    else if(action==='call') {
      const paid=Math.min(p.chips,toCall); p.chips-=paid; p.bet+=paid; room.pot+=paid; p.acted=true; if(p.chips===0)p.allIn=true;
    } else if(action==='raise') {
      const target=Math.max(Number(amount)||0, room.currentBet+BIG_BLIND);
      const need=target-p.bet; if(need<=toCall) return cb?.({error:'Слишком маленькое повышение'});
      const paid=Math.min(p.chips,need); p.chips-=paid; p.bet+=paid; room.pot+=paid; room.currentBet=Math.max(room.currentBet,p.bet); p.acted=true; if(p.chips===0)p.allIn=true;
      room.players.forEach(o=>{ if(o.id!==p.id && !o.folded && !o.allIn) o.acted=false; });
    } else if(action==='allin') {
      const paid=p.chips; p.chips=0; p.bet+=paid; room.pot+=paid; p.allIn=true; p.acted=true;
      if(p.bet>room.currentBet){ room.currentBet=p.bet; room.players.forEach(o=>{if(o.id!==p.id&&!o.folded&&!o.allIn)o.acted=false;}); }
    } else return cb?.({error:'Неизвестное действие'});
    cb?.({ok:true}); afterAction(room,idx);
  });


  socket.on('wallet:demo-topup', ({ code, chips }, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const player = room?.players.find(p => p.id === socket.id);
    const allowed = [2000, 5000, 10000, 25000];
    chips = Number(chips);
    if (!room || !player) return cb?.({ error:'Комната не найдена' });
    if (!allowed.includes(chips)) return cb?.({ error:'Недоступный пакет фишек' });
    if (!['lobby','showdown'].includes(room.phase)) return cb?.({ error:'Пополнять фишки можно только между раздачами' });
    player.chips += chips;
    cb?.({ ok:true, chips:player.chips });
    emitRoom(room);
  });

  socket.on('chat:send', ({ code, text }) => {
    const room=rooms.get(code); const p=room?.players.find(x=>x.id===socket.id); text=String(text||'').trim().slice(0,250);
    if(room&&p&&text) io.to(code).emit('chat:message',{name:p.name,text,at:Date.now()});
  });

  socket.on('disconnect', () => {
    for(const [code,room] of rooms){ const p=room.players.find(x=>x.id===socket.id); if(!p)continue; p.connected=false; p.folded=true;
      if(room.hostId===socket.id){ const next=room.players.find(x=>x.connected); if(next)room.hostId=next.id; }
      if(room.currentPlayerId===socket.id){ const idx=room.players.indexOf(p); afterAction(room,idx); }
      else emitRoom(room);
      if(!room.players.some(x=>x.connected)) rooms.delete(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Poker running on http://localhost:${PORT}`));
