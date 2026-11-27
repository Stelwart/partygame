const cvs = document.getElementById('game'), ctx = cvs.getContext('2d');
const uiBar = document.getElementById('ui');
const roleScreen = document.getElementById('roleScreen'), hostLobby = document.getElementById('hostLobby'), joinScreen = document.getElementById('joinScreen');
const turnScreen = document.getElementById('turnScreen'), lastPlayerScreen = document.getElementById('lastPlayerScreen'), endScreen = document.getElementById('endScreen');
const cropModal = document.getElementById('cropModal'), cropCvs = document.getElementById('cropCanvas'), cropCtx = cropCvs.getContext('2d'), zoomSlider = document.getElementById('zoomSlider');

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
let client = null, roomCode = '', isHost = false, myPlayerId = 'p_' + Math.random().toString(36).slice(2, 9);
let players = [], curIdx = 0, isRun = false, mouseMode = false, mouseDown = false;
let audioCtx, analyser, buf, score = 0, bestScore = 0, timeLeft = 30, lastT = 0, targets = [], finishX = 0, flashRed = 0, lastSyncT = 0;
let myAvatarSrc = '', imgCache = {};
const player = { x: 150, y: 200, targetY: 200, vy: 0, r: 22, active: false, waiting: false };
let cropState = { img: null, x: 0, y: 0, scale: 1, drag: false, sx: 0, sy: 0 };

const level = [
  { d: 1.0, len: 1.2, h: 0.4 }, { d: 0.6, len: 0.8, h: 0.6 }, { d: 0.6, len: 0.8, h: 0.8 },
  { d: 0.8, len: 2.5, h: 0.5 }, { d: 0.7, len: 0.7, h: 0.85 }, { d: 0.7, len: 0.7, h: 0.3 },
  { d: 0.8, len: 6.0, h: 0.65 }, { d: 0.8, len: 1.5, h: 0.8 }, { d: 0.7, len: 2.0, h: 0.5 }
];

function getCachedImg(src) {
  if (!src) return null;
  if (!imgCache[src]) { const im = new Image(); im.src = src; imgCache[src] = im; }
  return imgCache[src];
}

document.getElementById('phoneFileInp').onchange = e => {
  const file = e.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const im = new Image();
    im.onload = () => {
      cropState.img = im;
      const fit = Math.max(160 / im.width, 160 / im.height);
      cropState.scale = fit;
      zoomSlider.min = (fit * 0.5).toFixed(2);
      zoomSlider.max = (fit * 4).toFixed(2);
      zoomSlider.value = fit;
      cropState.x = (220 - im.width * fit) / 2;
      cropState.y = (220 - im.height * fit) / 2;
      cropModal.style.display = 'flex';
      drawCrop();
    };
    im.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};

function drawCrop() {
  if (!cropState.img) return;
  cropCtx.clearRect(0, 0, 220, 220);
  cropCtx.drawImage(cropState.img, cropState.x, cropState.y, cropState.img.width * cropState.scale, cropState.img.height * cropState.scale);
  cropCtx.fillStyle = 'rgba(0,0,0,0.65)';
  cropCtx.beginPath(); cropCtx.rect(0, 0, 220, 220); cropCtx.rect(30, 30, 160, 160); cropCtx.fill('evenodd');
  cropCtx.strokeStyle = '#00d26a'; cropCtx.lineWidth = 2; cropCtx.strokeRect(30, 30, 160, 160);
}

cropCvs.onpointerdown = e => { cropState.drag = true; cropState.sx = e.clientX - cropState.x; cropState.sy = e.clientY - cropState.y; };
window.addEventListener('pointermove', e => { if (!cropState.drag) return; cropState.x = e.clientX - cropState.sx; cropState.y = e.clientY - cropState.sy; drawCrop(); });
window.addEventListener('pointerup', () => { cropState.drag = false; });

zoomSlider.oninput = () => {
  const ns = parseFloat(zoomSlider.value);
  cropState.x = 110 - (110 - cropState.x) * (ns / cropState.scale);
  cropState.y = 110 - (110 - cropState.y) * (ns / cropState.scale);
  cropState.scale = ns; drawCrop();
};

document.getElementById('cancelCropBtn').onclick = () => { cropModal.style.display = 'none'; };
document.getElementById('saveCropBtn').onclick = () => {
  const out = document.createElement('canvas'); out.width = 100; out.height = 100;
  out.getContext('2d').drawImage(cropState.img, cropState.x - 30, cropState.y - 30, cropState.img.width * cropState.scale, cropState.img.height * cropState.scale);
  myAvatarSrc = out.toDataURL('image/jpeg', 0.65);
  const prev = document.getElementById('previewAva'); prev.src = myAvatarSrc; prev.style.display = 'inline-block';
  document.getElementById('photoText').textContent = 'Фото выбрано!';
  cropModal.style.display = 'none';
};

// --- ХОСТ (ТВ / ПК) ---
document.getElementById('createRoomBtn').onclick = () => {
  const btn = document.getElementById('createRoomBtn');
  if (typeof mqtt === 'undefined') { alert('Файл mqtt.min.js не найден!'); return; }
  btn.disabled = true; btn.textContent = 'Подключение...';
  isHost = true;
  roomCode = Math.floor(1000 + Math.random() * 9000).toString();
  client = mqtt.connect(BROKER_URL);

  client.on('connect', () => {
    client.subscribe('notegame/' + roomCode + '/to_host');
    roleScreen.style.display = 'none';
    hostLobby.style.display = 'flex';
    document.getElementById('roomCodeDisplay').textContent = roomCode;
  });

  client.on('message', (topic, message) => {
    try { handleHostData(JSON.parse(message.toString())); } catch (e) {}
  });
};

function updateHostLobby() {
  document.getElementById('playerCount').textContent = players.length;
  const grid = document.getElementById('lobbyGrid'); grid.innerHTML = '';
  players.forEach((p, idx) => {
    const card = document.createElement('div'); card.className = 'lobby-card';
    if (p.src) { const im = document.createElement('img'); im.src = p.src; card.appendChild(im); }
    else { const div = document.createElement('div'); div.className = 'no-ava'; div.textContent = idx + 1; card.appendChild(div); }
    const nm = document.createElement('div'); nm.style.fontSize = '14px'; nm.textContent = p.name; card.appendChild(nm);
    grid.appendChild(card);
  });
  document.getElementById('hostStartBtn').disabled = players.length < 2;
}

function broadcastToPhones(msg) {
  if (client && client.connected) {
    client.publish('notegame/' + roomCode + '/to_phones', JSON.stringify(msg));
  }
}

function sendToHost(msg) {
  if (client && client.connected) {
    client.publish('notegame/' + roomCode + '/to_host', JSON.stringify({ senderId: myPlayerId, ...msg }));
  }
}

document.getElementById('hostStartBtn').onclick = () => {
  curIdx = 0; hostLobby.style.display = 'none'; startTurnFlow('');
};

function startTurnFlow(prevText) {
  const cur = players[curIdx];
  showTurnUI(cur, curIdx, prevText, false);
  const lightPlayers = players.map(p => ({
    id: p.id,
    name: p.name,
    hasCustomName: p.hasCustomName,
    score: p.score
  }));
  broadcastToPhones({ type: 'TURN_WAIT', curIdx, players: lightPlayers, prevText });
}

// --- СМАРТФОН ИГРОКА ---
document.getElementById('joinScreenBtn').onclick = () => { roleScreen.style.display = 'none'; joinScreen.style.display = 'flex'; };
document.getElementById('backRoleBtn').onclick = () => { joinScreen.style.display = 'none'; roleScreen.style.display = 'flex'; };

document.getElementById('connectBtn').onclick = () => {
  const code = document.getElementById('codeInput').value.trim();
  const rawName = document.getElementById('nameInput').value.trim();
  if (code.length !== 4) { alert('Введите 4-значный код комнаты!'); return; }
  roomCode = code;
  const btn = document.getElementById('connectBtn');
  btn.disabled = true;
  document.getElementById('joinStatus').textContent = 'Подключение...';

  client = mqtt.connect(BROKER_URL, { clientId: 'phone_' + myPlayerId });

  client.on('connect', () => {
    client.subscribe('notegame/' + roomCode + '/to_phones', (err) => {
      if (!err) {
        sendToHost({ type: 'JOIN', name: rawName, hasCustomName: rawName.length > 0, src: myAvatarSrc });
        document.getElementById('joinStatus').textContent = 'Вы в комнате! Ожидайте старта игры на экране ноутбука...';
      }
    });
  });

  client.on('message', (topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      handlePhoneData(data);
    } catch (e) {}
  });
};


function formatPlayerLabel(p) {
  return p.hasCustomName ? ('Игрок ' + p.name) : p.name;
}

function showTurnUI(cur, idx, prevText, isMyPhone) {
  const prefix = idx === 0 ? 'Сейчас очередь ' : 'Теперь очередь ';
  document.getElementById('prevResult').textContent = prevText;
  document.getElementById('nextPlayerTitle').textContent = cur.hasCustomName ? (prefix + 'игрока ' + cur.name + '!') : (prefix + cur.name + '!');
  document.getElementById('curPlayerName').textContent = cur.name;
  document.getElementById('timer').textContent = '30.0';
  document.getElementById('score').textContent = '0';

  const ava = document.getElementById('turnAvatar');
  if (cur.src) { ava.src = cur.src; ava.style.display = 'block'; } else { ava.style.display = 'none'; }

  joinScreen.style.display = 'none';
  endScreen.style.display = 'none';
  lastPlayerScreen.style.display = 'none';
  turnScreen.style.display = 'flex';

  if (isMyPhone) {
    document.getElementById('turnSubText').textContent = 'Ваша очередь! Выберите управление и пойте в телефон:';
    document.getElementById('turnControls').style.display = 'flex';
  } else {
    document.getElementById('turnSubText').textContent = isHost ? 'Игрок готовится на своём смартфоне...' : 'Смотрите на большой экран!';
    document.getElementById('turnControls').style.display = 'none';
  }
}

function handleHostData(data) {
  if (data.type === 'JOIN') {
    if (players.some(p => p.id === data.senderId)) return;
    if (players.length >= 8) {
      broadcastToPhones({ type: 'FULL', targetId: data.senderId });
      return;
    }
    players.push({
      id: data.senderId,
      name: data.name || ('Игрок ' + (players.length + 1)),
      hasCustomName: data.hasCustomName,
      src: data.src || '',
      score: 0
    });
    updateHostLobby();
  } else if (data.type === 'ROUND_START') {
    turnScreen.style.display = 'none';
    uiBar.style.display = 'block';
  } else if (data.type === 'STATE') {
    document.getElementById('timer').textContent = data.timeLeft.toFixed(1);
    document.getElementById('score').textContent = Math.round(data.score);
    renderScene(data.player, data.targets, data.finishX, data.flashRed, players[curIdx]?.src);
  } else if (data.type === 'TURN_END') {
    uiBar.style.display = 'none';
    ctx.clearRect(0, 0, 800, 450);
    players[curIdx].score = data.finalPts;
    const label = formatPlayerLabel(players[curIdx]);
    const statusMsg = data.statusType === 'finish'
      ? (label + ' финишировал! (' + data.finalPts + ' очков)')
      : (label + ': время вышло (' + data.finalPts + ' очков)');

    if (curIdx + 1 < players.length) {
      curIdx++;
      startTurnFlow(statusMsg);
    } else {
      showLastPlayerUI(players[curIdx], statusMsg);
      broadcastToPhones({ type: 'LAST_PLAYER', finished: players[curIdx], statusMsg, players });
    }
  } else if (data.type === 'SHOW_BOARD') {
    lastPlayerScreen.style.display = 'none';
    showLeaderboard(players);
    broadcastToPhones({ type: 'BOARD', players });
  } else if (data.type === 'BACK_MENU') {
    endScreen.style.display = 'none';
    hostLobby.style.display = 'flex';
    players.forEach(p => p.score = 0);
    broadcastToPhones({ type: 'RESET_LOBBY' });
  }
}

function handlePhoneData(data) {
  if (data.type === 'FULL' && data.targetId === myPlayerId) {
    document.getElementById('joinStatus').textContent = 'Комната заполнена (максимум 8 игроков)!';
  } else if (data.type === 'TURN_WAIT') {
    players = data.players;
    curIdx = data.curIdx;
    showTurnUI(players[curIdx], curIdx, data.prevText, players[curIdx].id === myPlayerId);
  } else if (data.type === 'LAST_PLAYER') {
    players = data.players;
    showLastPlayerUI(data.finished, data.statusMsg);
  } else if (data.type === 'BOARD') {
    lastPlayerScreen.style.display = 'none';
    showLeaderboard(data.players);
  } else if (data.type === 'RESET_LOBBY') {
    endScreen.style.display = 'none';
    joinScreen.style.display = 'flex';
    document.getElementById('joinStatus').textContent = 'Ожидайте старта нового раунда...';
  }
}

function showLastPlayerUI(finishedPlayer, statusMsg) {
  document.getElementById('lastPlayerResult').textContent = statusMsg;
  const ava = document.getElementById('lastPlayerAvatar');
  if (finishedPlayer.src) { ava.src = finishedPlayer.src; ava.style.display = 'block'; } else { ava.style.display = 'none'; }
  lastPlayerScreen.style.display = 'flex';
}

document.getElementById('toLeaderboardBtn').onclick = () => {
  if (isHost) {
    lastPlayerScreen.style.display = 'none';
    showLeaderboard(players);
    broadcastToPhones({ type: 'BOARD', players });
  } else {
    sendToHost({ type: 'SHOW_BOARD' });
  }
};

function showLeaderboard(list) {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  const board = document.getElementById('leaderboard');
  board.innerHTML = '';
  sorted.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'board-item' + (idx === 0 ? ' first' : '');
    const left = document.createElement('span');
    if (p.src) {
      const img = document.createElement('img');
      img.src = p.src;
      img.className = 'mini-ava';
      left.appendChild(img);
    }
    left.appendChild(document.createTextNode((idx + 1) + '. ' + p.name));
    const right = document.createElement('strong');
    right.textContent = p.score + ' очков';
    div.appendChild(left);
    div.appendChild(right);
    board.appendChild(div);
  });
  endScreen.style.display = 'flex';
}

document.getElementById('menuBtn').onclick = () => {
  if (isHost) {
    endScreen.style.display = 'none';
    hostLobby.style.display = 'flex';
    players.forEach(p => p.score = 0);
    broadcastToPhones({ type: 'RESET_LOBBY' });
  } else {
    sendToHost({ type: 'BACK_MENU' });
  }
};
function resetAttempt() {
  targets = []; let cx = 500;
  level.forEach(n => {
    cx += n.d * 180; let w = n.len * 180;
    targets.push({ x: cx, y: 450 - (n.h * 350 + 50) - 23, w, h: 46, len: n.len, hit: false });
    cx += w;
  });
  finishX = cx + 150; score = 0;
  player.y = 180; player.targetY = 180; player.vy = 0; player.active = false; player.waiting = false;
  document.getElementById('score').textContent = '0';
}

function respawnAtNextNote() {
  const curIdxNote = targets.findIndex(t => t.x + t.w > player.x);
  if (curIdxNote !== -1) {
    const note = targets[curIdxNote];
    const targetObj = (note.x <= player.x && curIdxNote + 1 < targets.length)
      ? targets[curIdxNote + 1]
      : (note.x > player.x ? note : null);
    if (targetObj) {
      const shiftX = (player.x + 120) - targetObj.x;
      targets.forEach(t => { t.x += shiftX; t.hit = false; });
      finishX += shiftX; player.y = targetObj.y + targetObj.h / 2;
    } else {
      const shiftX = (player.x + 120) - finishX;
      targets.forEach(t => { t.x += shiftX; t.hit = false; });
      finishX += shiftX; player.y = 225;
    }
  } else {
    const shiftX = (player.x + 120) - finishX;
    targets.forEach(t => { t.x += shiftX; t.hit = false; });
    finishX += shiftX; player.y = 225;
  }
  player.targetY = player.y; player.vy = 0; player.active = false; player.waiting = true;
}

function beginPhoneRound() {
  timeLeft = 30; bestScore = 0; resetAttempt();
  uiBar.style.display = 'block'; turnScreen.style.display = 'none';
  sendToHost({ type: 'ROUND_START' });
  lastT = performance.now(); isRun = true; requestAnimationFrame(loop);
}

document.getElementById('startTurnMicBtn').onclick = async () => {
  try {
    if (!audioCtx) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048;
      src.connect(analyser); buf = new Float32Array(2048);
    }
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    mouseMode = false; beginPhoneRound();
  } catch (e) { alert('Ошибка микрофона: ' + e.message); }
};

document.getElementById('startTurnMouseBtn').onclick = () => { mouseMode = true; beginPhoneRound(); };

function setPointerY(clientY) {
  const rect = cvs.getBoundingClientRect();
  player.targetY = Math.max(player.r, Math.min(450 - player.r, ((clientY - rect.top) / rect.height) * 450));
}
cvs.onpointerdown = e => { mouseDown = true; if (mouseMode) setPointerY(e.clientY); };
window.addEventListener('pointerup', () => { mouseDown = false; });
cvs.onpointermove = e => { if (mouseMode && mouseDown) setPointerY(e.clientY); };

function getPitch() {
  analyser.getFloatTimeDomainData(buf);
  let rms = 0; for (let i = 0; i < 2048; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / 2048); if (rms < 0.008) return -1;
  let r1 = 0, r2 = 2047;
  for (let i = 0; i < 1024; i++) if (Math.abs(buf[i]) < 0.2) { r1 = i; break; }
  for (let i = 1; i < 1024; i++) if (Math.abs(buf[2048 - i]) < 0.2) { r2 = 2048 - i; break; }
  let s = buf.slice(r1, r2), len = s.length; if (len < 2) return -1;
  let c = new Array(len).fill(0);
  for (let i = 0; i < len; i++) for (let j = 0; j < len - i; j++) c[i] += s[j] * s[j + i];
  let d = 0; while (d < len - 1 && c[d] > c[d + 1]) d++;
  let maxV = -1, maxP = -1;
  for (let i = d; i < len; i++) if (c[i] > maxV) { maxV = c[i]; maxP = i; }
  return maxP > 0 ? audioCtx.sampleRate / maxP : -1;
}

function renderScene(pObj, tList, fX, fRed, avaSrc) {
  ctx.clearRect(0, 0, 800, 450);
  if (fRed > 0) { ctx.fillStyle = 'rgba(255, 71, 87, ' + fRed + ')'; ctx.fillRect(0, 0, 800, 450); }
  tList.forEach(t => {
    ctx.fillStyle = t.hit ? '#00ff88' : 'rgba(255,255,255,0.2)';
    ctx.fillRect(t.x, t.y, t.w, t.h);
    if (t.len >= 2.5) {
      ctx.fillStyle = t.hit ? '#121212' : '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('Тяни ' + t.len + ' сек!', t.x + 15, t.y + 28);
    }
  });
  ctx.fillStyle = '#ffa502'; ctx.fillRect(fX, 0, 12, 450);
  ctx.font = 'bold 16px sans-serif'; ctx.fillText('ФИНИШ', fX - 25, 30);

  const curImg = getCachedImg(avaSrc);
  ctx.save(); ctx.beginPath(); ctx.arc(pObj.x, pObj.y, pObj.r, 0, Math.PI * 2); ctx.clip();
  if (curImg && curImg.complete && curImg.naturalWidth > 0) {
    ctx.drawImage(curImg, pObj.x - pObj.r, pObj.y - pObj.r, pObj.r * 2, pObj.r * 2);
  } else {
    ctx.fillStyle = pObj.active ? '#ff4757' : '#747d8c';
    ctx.fillRect(pObj.x - pObj.r, pObj.y - pObj.r, pObj.r * 2, pObj.r * 2);
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(pObj.x, pObj.y, pObj.r, 0, Math.PI * 2); ctx.lineWidth = 3;
  ctx.strokeStyle = pObj.active ? '#00ff88' : '#747d8c'; ctx.stroke();
}

function endPhoneTurn(statusType) {
  isRun = false; uiBar.style.display = 'none';
  if (score > bestScore) bestScore = score;
  const finalPts = Math.round(bestScore);
  ctx.clearRect(0, 0, 800, 450);
  sendToHost({ type: 'TURN_END', statusType, finalPts });
}

function loop(now) {
  if (!isRun) return;
  let dt = Math.min((now - lastT) / 1000, 0.1); lastT = now;
  timeLeft -= dt;
  if (timeLeft <= 0) { document.getElementById('timer').textContent = '0.0'; endPhoneTurn('timeout'); return; }
  document.getElementById('timer').textContent = timeLeft.toFixed(1);

  if (mouseMode) { player.active = mouseDown; }
  else {
    let p = getPitch();
    if (p >= 100 && p <= 450) { player.active = true; player.targetY = 450 - (((p - 100) / 350) * 350 + 50); }
    else { player.active = false; }
  }

  if (player.active) { player.waiting = false; player.vy = 0; player.y += (player.targetY - player.y) * 0.2; finishX -= 180 * dt; }
  else if (!player.waiting) { player.vy += 650 * dt; player.y += player.vy * dt; }

  if (!player.waiting && player.y + player.r >= 450) { flashRed = 0.3; respawnAtNextNote(); }
  if (flashRed > 0) flashRed -= dt;

  targets.forEach(t => {
    if (player.active) t.x -= 180 * dt;
    t.hit = player.active && player.x > t.x && player.x < t.x + t.w && player.y > t.y && player.y < t.y + t.h;
    if (t.hit) { score += 100 * dt; document.getElementById('score').textContent = Math.round(score); if (score > bestScore) bestScore = score; }
  });

  if (player.x >= finishX) { score += 500; endPhoneTurn('finish'); return; }

  renderScene(player, targets, finishX, flashRed, myAvatarSrc);
  if (now - lastSyncT > 40) {
    lastSyncT = now;
    sendToHost({ type: 'STATE', player, targets, finishX, flashRed, timeLeft, score });
  }
  requestAnimationFrame(loop);
}
