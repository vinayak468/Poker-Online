const socket = io();

// ========================================
// SOUND ENGINE (Web Audio API Synthesizer)
// ========================================
class SoundEngine {
    constructor() {
        this.ctx = null;
        this.muted = localStorage.getItem("pokerMuted") === "true";
    }

    init() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) this.ctx = new AudioCtx();
        }
        if (this.ctx && this.ctx.state === "suspended") {
            this.ctx.resume();
        }
    }

    setMuted(muted) {
        this.muted = muted;
        localStorage.setItem("pokerMuted", muted ? "true" : "false");
    }

    playCardDeal() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const bufferSize = this.ctx.sampleRate * 0.08;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(1400, this.ctx.currentTime);
        filter.Q.setValueAtTime(3.0, this.ctx.currentTime);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start();
    }

    playChipSound() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(1800 + Math.random() * 400, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.09);

        gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.09);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.09);
    }

    playCheckSound() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "triangle";
        osc.frequency.setValueAtTime(220, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.08);

        gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.08);
    }

    playFoldSound() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(450, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.12);

        gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.12);
    }

    playTurnAlert() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const notes = [587.33, 880]; // D5, A5
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const start = this.ctx.currentTime + idx * 0.1;

            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, start);

            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(start);
            osc.stop(start + 0.22);
        });
    }

    playWinCelebration() {
        if (this.muted) return;
        this.init();
        if (!this.ctx) return;

        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const start = this.ctx.currentTime + idx * 0.08;

            osc.type = "triangle";
            osc.frequency.setValueAtTime(freq, start);

            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.35, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(start);
            osc.stop(start + 0.45);
        });
    }
}

const sounds = new SoundEngine();

// ========================================
// GLOBAL APP STATE
// ========================================
let mySocketId = null;
let hasJoined = false;
let myRoomCode = null;
let lastGame = null;
let wasMyTurn = false;
let previousCommunityCount = 0;

const positions = ["top", "right", "bottom", "left"];

// ========================================
// DOM ELEMENTS
// ========================================
const homeScreen = document.getElementById("home-screen");
const gameScreen = document.getElementById("game-screen");
const playerNameInput = document.getElementById("player-name-input");
const roomCodeInput = document.getElementById("room-code-input");
const aiButton = document.getElementById("ai-button");
const roomButton = document.getElementById("room-button");
const joinError = document.getElementById("join-error");

// Header elements
const roomCodeDisplay = document.getElementById("room-code-display");
const copyRoomBtn = document.getElementById("copy-room-btn");
const phaseBadge = document.getElementById("phase-badge");
const handNumDisplay = document.getElementById("hand-num-display");
const rebuyTopBtn = document.getElementById("rebuy-top-btn");
const audioToggleBtn = document.getElementById("audio-toggle-btn");
const logToggleBtn = document.getElementById("log-toggle-btn");
const leaveBtn = document.getElementById("leave-btn");

// Table elements
const potValue = document.getElementById("pot-value");
const communityCardsContainer = document.getElementById("community-cards");
const myCardsContainer = document.getElementById("my-cards");
const handStrengthPill = document.getElementById("hand-strength-pill");
const dealerBtn = document.getElementById("dealer-btn");

// Controls
const btnFold = document.getElementById("btn-fold");
const btnCheckCall = document.getElementById("btn-check-call");
const checkCallText = document.getElementById("check-call-text");
const btnRaise = document.getElementById("btn-raise");
const raiseText = document.getElementById("raise-text");
const raiseSlider = document.getElementById("raise-slider");
const raiseInput = document.getElementById("raise-input");
const btnMinus = document.getElementById("btn-minus");
const btnPlus = document.getElementById("btn-plus");
const presetButtons = document.querySelectorAll(".btn-preset");
const consoleChipsDisplay = document.getElementById("console-chips-display");
const consoleActionHint = document.getElementById("console-action-hint");

// Modals & Overlays
const showdownModal = document.getElementById("showdown-modal");
const showdownHeadline = document.getElementById("showdown-headline");
const showdownHandName = document.getElementById("showdown-hand-name");
const showdownCards = document.getElementById("showdown-cards");
const rebuyModal = document.getElementById("rebuy-modal");
const rebuyActionBtn = document.getElementById("rebuy-action-btn");
const logDrawer = document.getElementById("log-drawer");
const logFeed = document.getElementById("log-feed");
const logCloseBtn = document.getElementById("log-close-btn");
const toastEl = document.getElementById("toast");

// ========================================
// INITIAL SETUP & PERSISTENCE
// ========================================
const savedName = localStorage.getItem("pokerPlayerName") || "";
if (savedName) playerNameInput.value = savedName;

updateAudioButton();

function updateAudioButton() {
    audioToggleBtn.textContent = sounds.muted ? "🔇" : "🔊";
    audioToggleBtn.title = sounds.muted ? "Unmute Sound" : "Mute Sound";
}

audioToggleBtn.addEventListener("click", () => {
    sounds.setMuted(!sounds.muted);
    updateAudioButton();
    showToast(sounds.muted ? "Sound Muted" : "Sound Enabled");
});

function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2500);
}

// ========================================
// JOIN & ROOM FLOW
// ========================================
function doJoin(name, roomCode) {
    sounds.init();
    const finalName = name.trim() || "Player";
    localStorage.setItem("pokerPlayerName", finalName);
    sessionStorage.setItem("pokerRoom", roomCode || "");
    joinError.style.display = "none";
    socket.emit("joinGame", { name: finalName, roomCode: roomCode || "" });
}

aiButton.addEventListener("click", () => {
    doJoin(playerNameInput.value, "");
});

roomButton.addEventListener("click", () => {
    doJoin(playerNameInput.value, roomCodeInput.value.trim());
});

[playerNameInput, roomCodeInput].forEach(input => {
    input.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            doJoin(playerNameInput.value, roomCodeInput.value.trim());
        }
    });
});

copyRoomBtn.addEventListener("click", () => {
    if (myRoomCode) {
        navigator.clipboard.writeText(myRoomCode).then(() => {
            showToast(`Room Code "${myRoomCode}" copied!`);
        }).catch(() => {
            showToast(`Room Code: ${myRoomCode}`);
        });
    }
});

rebuyTopBtn.addEventListener("click", () => {
    socket.emit("rebuy");
    sounds.playChipSound();
    showToast("Reloaded 1,000 Chips!");
});

rebuyActionBtn.addEventListener("click", () => {
    socket.emit("rebuy");
    sounds.playChipSound();
    rebuyModal.style.display = "none";
    showToast("Reloaded 1,000 Chips!");
});

leaveBtn.addEventListener("click", () => {
    if (confirm("Leave this table and return to lobby?")) {
        sessionStorage.removeItem("pokerRoom");
        location.reload();
    }
});

logToggleBtn.addEventListener("click", () => {
    logDrawer.style.display = logDrawer.style.display === "none" ? "flex" : "none";
});

logCloseBtn.addEventListener("click", () => {
    logDrawer.style.display = "none";
});

// ========================================
// SOCKET EVENTS
// ========================================
socket.on("connect", () => {
    mySocketId = socket.id;
    const prevRoom = sessionStorage.getItem("pokerRoom");
    const prevName = localStorage.getItem("pokerPlayerName");

    if (prevName && prevRoom) {
        socket.emit("joinGame", { name: prevName, roomCode: prevRoom });
    }
});

socket.on("gameFull", () => {
    joinError.textContent = "This room is full (4/4 players). Please try another code.";
    joinError.style.display = "block";
});

socket.on("joinSuccess", data => {
    hasJoined = true;
    myRoomCode = data.roomCode;
    sessionStorage.setItem("pokerRoom", myRoomCode);
    roomCodeDisplay.textContent = myRoomCode;

    homeScreen.style.display = "none";
    gameScreen.style.display = "flex";
    sounds.init();
});

socket.on("gameUpdate", game => {
    if (!hasJoined) return;
    lastGame = game;
    renderGame(game);
});

socket.on("showdown", result => {
    if (!hasJoined) return;
    renderShowdown(result);
});

// ========================================
// CARD FORMATTING UTILITIES
// ========================================
function isRedCard(card) {
    return card && (card.suit === "♥" || card.suit === "♦");
}

function createCardElement(card, isSmall = false) {
    const el = document.createElement("div");
    el.className = "card" + (isSmall ? " card-sm" : "");

    if (!card || !card.rank) {
        el.classList.add("card-back");
        return el;
    }

    if (isRedCard(card)) el.classList.add("red");

    el.innerHTML = `
        <div class="card-corner card-top">
            <span class="card-rank">${card.rank}</span>
            <span class="card-suit">${card.suit}</span>
        </div>
        <div class="card-center-suit">${card.suit}</div>
        <div class="card-corner card-bottom">
            <span class="card-rank">${card.rank}</span>
            <span class="card-suit">${card.suit}</span>
        </div>
    `;
    return el;
}

// Client-side quick hand estimator for live badge
const rankOrder = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14 };

function estimateHandStrength(holeCards, communityCards) {
    if (!holeCards || holeCards.length < 2 || !holeCards[0] || !holeCards[1]) return "";

    const all = [...holeCards, ...communityCards.filter(Boolean)];
    if (all.length < 2) return "";

    // Count ranks and suits
    const rankCounts = {};
    const suitCounts = {};
    all.forEach(c => {
        rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
        suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
    });

    const pairs = Object.keys(rankCounts).filter(r => rankCounts[r] === 2);
    const trips = Object.keys(rankCounts).filter(r => rankCounts[r] === 3);
    const quads = Object.keys(rankCounts).filter(r => rankCounts[r] === 4);
    const flushSuit = Object.keys(suitCounts).find(s => suitCounts[s] >= 5);
    const flushDrawSuit = Object.keys(suitCounts).find(s => suitCounts[s] === 4);

    if (quads.length > 0) return `✦ Four of a Kind (${quads[0]}s) ✦`;
    if (trips.length > 0 && pairs.length > 0) return `✦ Full House (${trips[0]}s full of ${pairs[0]}s) ✦`;
    if (flushSuit) return `✦ Flush (${flushSuit}) ✦`;
    if (trips.length > 0) return `✦ Three of a Kind (${trips[0]}s) ✦`;
    if (pairs.length >= 2) return `✦ Two Pair (${pairs[0]}s & ${pairs[1]}s) ✦`;
    if (pairs.length === 1) return `✦ Pair of ${pairs[0]}s ✦`;
    if (flushDrawSuit && all.length >= 5) return `✦ Flush Draw (${flushDrawSuit}) ✦`;

    const highRank = rankOrder[holeCards[0].rank] > rankOrder[holeCards[1].rank] ? holeCards[0].rank : holeCards[1].rank;
    return `High Card (${highRank})`;
}

// ========================================
// RENDER GAME STATE
// ========================================
function renderGame(game) {
    // Header & Game Info
    potValue.textContent = Number(game.pot).toLocaleString();
    phaseBadge.textContent = (game.phase || "PRE-FLOP").toUpperCase();
    handNumDisplay.textContent = `Hand #${game.handCount || 1}`;

    const myIndex = game.players.findIndex(p => p.id === mySocketId);
    const me = myIndex !== -1 ? game.players[myIndex] : null;

    // Check bust modal
    if (me && me.chips === 0 && game.phase === "showdown") {
        setTimeout(() => {
            if (me.chips === 0) rebuyModal.style.display = "flex";
        }, 1500);
    } else if (me && me.chips > 0) {
        rebuyModal.style.display = "none";
    }

    // Community Cards Deal Sounds
    if (game.communityCards && game.communityCards.length > previousCommunityCount) {
        sounds.playCardDeal();
    }
    previousCommunityCount = (game.communityCards && game.communityCards.length) || 0;

    // Render Community Cards
    renderCommunityCards(game.communityCards || []);

    // Render Seats & Players
    renderSeats(game, myIndex);

    // Render My Hole Cards
    renderMyCards(me, game.communityCards || []);

    // Update Betting Controls
    updateControls(game, me, myIndex);

    // Update Action Log Drawer
    renderActionLogs(game.actionLog || []);
}

function renderCommunityCards(cards) {
    communityCardsContainer.innerHTML = "";
    for (let i = 0; i < 5; i++) {
        const card = cards[i];
        if (card) {
            const el = createCardElement(card);
            el.classList.add("card-dealt");
            communityCardsContainer.appendChild(el);
        } else {
            const placeholder = document.createElement("div");
            placeholder.className = "card card-placeholder";
            communityCardsContainer.appendChild(placeholder);
        }
    }
}

function renderSeats(game, myIndex) {
    if (myIndex === -1) {
        positions.forEach(pos => {
            document.getElementById(`name-${pos}`).textContent = "Waiting...";
            document.getElementById(`chips-${pos}`).textContent = "--";
            document.getElementById(`action-${pos}`).style.display = "none";
            document.getElementById(`bet-${pos}`).style.display = "none";
        });
        return;
    }

    const rotated = [];
    for (let i = 0; i < 4; i++) {
        const idx = (myIndex + i) % 4;
        rotated.push({ player: game.players[idx], originalIndex: idx });
    }

    // Map rotated index to seat layout:
    // rotated[0] = bottom (me)
    // rotated[1] = left
    // rotated[2] = top
    // rotated[3] = right
    const seatMap = {
        bottom: rotated[0],
        left: rotated[1],
        top: rotated[2],
        right: rotated[3]
    };

    // Position dealer button relative to dealer's current seat
    positions.forEach(pos => {
        const item = seatMap[pos];
        if (!item || !item.player) return;

        const p = item.player;
        const origIdx = item.originalIndex;

        const seatEl = document.getElementById(`seat-${pos}`);
        const nameEl = document.getElementById(`name-${pos}`);
        const chipsEl = document.getElementById(`chips-${pos}`);
        const actionEl = document.getElementById(`action-${pos}`);
        const betEl = document.getElementById(`bet-${pos}`);
        const cardsEl = document.getElementById(`cards-${pos}`);

        // Update player info
        nameEl.textContent = p.name + (p.id === mySocketId ? " (You)" : "");
        chipsEl.textContent = `${Number(p.chips).toLocaleString()} chips`;

        // Seat active styling
        seatEl.classList.toggle("folded", !!p.folded);
        seatEl.classList.toggle("all-in", !!p.allIn);

        // Turn indicator
        const isCurrentTurn = (origIdx === game.currentPlayer && game.phase !== "waiting" && game.phase !== "showdown");
        seatEl.classList.toggle("turn-active", isCurrentTurn);

        // Dealer button placement
        if (origIdx === game.dealer) {
            dealerBtn.style.display = "flex";
            dealerBtn.className = `dealer-button dealer-at-${pos}`;
        }

        // Action badge
        if (p.lastAction && p.lastAction.text) {
            actionEl.textContent = p.lastAction.text;
            actionEl.className = `action-badge action-${p.lastAction.type}`;
            actionEl.style.display = "block";
        } else {
            actionEl.style.display = "none";
        }

        // Street bet stack
        if (p.currentBet > 0) {
            betEl.textContent = `🪙 $${p.currentBet}`;
            betEl.style.display = "flex";
        } else {
            betEl.style.display = "none";
        }

        // Opponent cards (card backs during hand)
        if (cardsEl) {
            cardsEl.innerHTML = "";
            if (!p.folded && p.id !== mySocketId && game.phase !== "waiting" && game.phase !== "showdown") {
                cardsEl.appendChild(createCardElement(null, true));
                cardsEl.appendChild(createCardElement(null, true));
            }
        }
    });
}

function renderMyCards(me, communityCards) {
    myCardsContainer.innerHTML = "";
    if (!me || !me.hand || me.hand.length < 2 || !me.hand[0] || me.folded) {
        handStrengthPill.style.display = "none";
        return;
    }

    me.hand.forEach((card, idx) => {
        const el = createCardElement(card);
        el.classList.add("hole-card", idx === 0 ? "hole-left" : "hole-right");
        myCardsContainer.appendChild(el);
    });

    const strength = estimateHandStrength(me.hand, communityCards);
    if (strength) {
        handStrengthPill.textContent = strength;
        handStrengthPill.style.display = "inline-block";
    } else {
        handStrengthPill.style.display = "none";
    }
}

function updateControls(game, me, myIndex) {
    const isMyTurn = (myIndex === game.currentPlayer && game.phase !== "waiting" && game.phase !== "showdown" && me && !me.folded && !me.allIn);

    // Audio cue when turn arrives
    if (isMyTurn && !wasMyTurn) {
        sounds.playTurnAlert();
    }
    wasMyTurn = isMyTurn;

    if (consoleChipsDisplay && me) {
        consoleChipsDisplay.textContent = "🪙 " + Number(me.chips).toLocaleString();
    }

    if (consoleActionHint) {
        if (isMyTurn) {
            consoleActionHint.textContent = "⚡ YOUR TURN TO ACT";
            consoleActionHint.classList.add("my-turn");
        } else {
            const curPlayer = game.players[game.currentPlayer];
            consoleActionHint.textContent = curPlayer ? `Waiting for ${curPlayer.name}...` : "Waiting...";
            consoleActionHint.classList.remove("my-turn");
        }
    }

    btnFold.disabled = !isMyTurn;
    btnCheckCall.disabled = !isMyTurn;
    btnRaise.disabled = !isMyTurn;
    raiseSlider.disabled = !isMyTurn;
    raiseInput.disabled = !isMyTurn;
    btnMinus.disabled = !isMyTurn;
    btnPlus.disabled = !isMyTurn;
    presetButtons.forEach(btn => btn.disabled = !isMyTurn);

    if (!isMyTurn || !me) return;

    const streetBet = game.streetBet || 0;
    const myBet = me.currentBet || 0;
    const toCall = Math.max(0, streetBet - myBet);

    // CHECK vs CALL Button
    if (toCall === 0) {
        checkCallText.textContent = "CHECK";
        btnCheckCall.dataset.action = "check";
        btnCheckCall.classList.remove("is-call");
    } else {
        const callAmount = Math.min(toCall, me.chips);
        checkCallText.textContent = `CALL $${callAmount}`;
        btnCheckCall.dataset.action = "call";
        btnCheckCall.classList.add("is-call");
    }

    // RAISE / BET Range & Presets
    const minRaiseInc = Math.max(20, game.minRaise || 20);
    const minRaiseTarget = streetBet + minRaiseInc;
    const maxRaiseTarget = myBet + me.chips;

    if (me.chips <= toCall) {
        // Can only go all-in or call
        btnRaise.disabled = true;
        raiseSlider.disabled = true;
        raiseInput.disabled = true;
        btnMinus.disabled = true;
        btnPlus.disabled = true;
        presetButtons.forEach(btn => btn.disabled = true);
        return;
    }

    const clampedMin = Math.min(minRaiseTarget, maxRaiseTarget);

    raiseSlider.min = clampedMin;
    raiseSlider.max = maxRaiseTarget;
    raiseSlider.step = 10;

    raiseInput.min = clampedMin;
    raiseInput.max = maxRaiseTarget;

    // Sync raise value if out of bounds
    let currentVal = parseInt(raiseSlider.value, 10);
    if (isNaN(currentVal) || currentVal < clampedMin || currentVal > maxRaiseTarget) {
        currentVal = clampedMin;
        raiseSlider.value = currentVal;
        raiseInput.value = currentVal;
    }

    updateRaiseButtonText(currentVal, streetBet, maxRaiseTarget);
}

function updateRaiseButtonText(val, streetBet, maxTarget) {
    const isBet = (streetBet === 0);
    if (val >= maxTarget) {
        raiseText.textContent = `ALL-IN ($${val})`;
    } else if (isBet) {
        raiseText.textContent = `BET $${val}`;
    } else {
        raiseText.textContent = `RAISE TO $${val}`;
    }
}

// ========================================
// CONTROLS INTERACTIVITY
// ========================================
raiseSlider.addEventListener("input", e => {
    const val = parseInt(e.target.value, 10);
    raiseInput.value = val;
    if (lastGame) {
        const me = lastGame.players.find(p => p.id === mySocketId);
        const max = me ? (me.currentBet + me.chips) : 1000;
        updateRaiseButtonText(val, lastGame.streetBet || 0, max);
    }
});

raiseInput.addEventListener("change", e => {
    let val = parseInt(e.target.value, 10);
    const min = parseInt(raiseSlider.min, 10);
    const max = parseInt(raiseSlider.max, 10);

    if (isNaN(val)) val = min;
    val = Math.max(min, Math.min(max, val));

    raiseInput.value = val;
    raiseSlider.value = val;
    if (lastGame) {
        updateRaiseButtonText(val, lastGame.streetBet || 0, max);
    }
});

btnMinus.addEventListener("click", () => {
    let val = parseInt(raiseSlider.value, 10) - 20;
    const min = parseInt(raiseSlider.min, 10);
    val = Math.max(min, val);
    raiseSlider.value = val;
    raiseInput.value = val;
    if (lastGame) {
        const me = lastGame.players.find(p => p.id === mySocketId);
        updateRaiseButtonText(val, lastGame.streetBet || 0, me ? (me.currentBet + me.chips) : 1000);
    }
    sounds.playChipSound();
});

btnPlus.addEventListener("click", () => {
    let val = parseInt(raiseSlider.value, 10) + 20;
    const max = parseInt(raiseSlider.max, 10);
    val = Math.min(max, val);
    raiseSlider.value = val;
    raiseInput.value = val;
    if (lastGame) {
        const me = lastGame.players.find(p => p.id === mySocketId);
        updateRaiseButtonText(val, lastGame.streetBet || 0, me ? (me.currentBet + me.chips) : 1000);
    }
    sounds.playChipSound();
});

presetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        if (!lastGame) return;
        const me = lastGame.players.find(p => p.id === mySocketId);
        if (!me) return;

        const preset = btn.dataset.preset;
        const pot = lastGame.pot || 0;
        const streetBet = lastGame.streetBet || 0;
        const minTarget = parseInt(raiseSlider.min, 10);
        const maxTarget = parseInt(raiseSlider.max, 10);

        let target = minTarget;

        switch (preset) {
            case "min":
                target = minTarget;
                break;
            case "2.5bb":
                target = Math.max(minTarget, 50);
                break;
            case "half-pot":
                target = Math.max(minTarget, streetBet + Math.round(pot * 0.5));
                break;
            case "pot":
                target = Math.max(minTarget, streetBet + pot);
                break;
            case "all-in":
                target = maxTarget;
                break;
        }

        target = Math.max(minTarget, Math.min(maxTarget, target));
        raiseSlider.value = target;
        raiseInput.value = target;
        updateRaiseButtonText(target, streetBet, maxTarget);
        sounds.playChipSound();
    });
});

// ========================================
// ACTION DISPATCHERS
// ========================================
btnFold.addEventListener("click", () => {
    sounds.playFoldSound();
    socket.emit("action", { action: "fold" });
});

btnCheckCall.addEventListener("click", () => {
    const action = btnCheckCall.dataset.action || "check";
    if (action === "check") sounds.playCheckSound();
    else sounds.playChipSound();

    socket.emit("action", { action });
});

btnRaise.addEventListener("click", () => {
    const amount = parseInt(raiseSlider.value, 10);
    sounds.playChipSound();
    socket.emit("action", { action: "raise", amount });
});

// Keyboard Shortcuts
window.addEventListener("keydown", e => {
    if (!lastGame || !hasJoined) return;
    if (document.activeElement === raiseInput || document.activeElement === roomCodeInput || document.activeElement === playerNameInput) {
        return;
    }

    const key = e.key.toUpperCase();
    if (key === "F" && !btnFold.disabled) {
        btnFold.click();
    } else if ((key === "C" || e.code === "Space") && !btnCheckCall.disabled) {
        e.preventDefault();
        btnCheckCall.click();
    } else if (key === "R" && !btnRaise.disabled) {
        btnRaise.click();
    }
});

// ========================================
// SHOWDOWN REVEAL & CELEBRATION
// ========================================
function renderShowdown(result) {
    sounds.playWinCelebration();

    const winnerNames = result.winners.map(w => w.name).join(" & ");
    const winningHand = result.winners[0]?.hand || "Winning Hand";

    showdownHeadline.textContent = `🏆 ${winnerNames} wins ${Number(result.pot).toLocaleString()} chips!`;
    showdownHandName.textContent = winningHand;

    showdownCards.innerHTML = "";
    const winningCards = result.winners[0]?.bestCards || result.winners[0]?.cards || [];
    if (winningCards && winningCards.length > 0) {
        winningCards.forEach(card => {
            if (card) {
                const el = createCardElement(card);
                el.classList.add("card-winning");
                showdownCards.appendChild(el);
            }
        });
    }

    showdownModal.style.display = "flex";

    // Reveal opponent cards at their seat positions
    if (result.reveals && lastGame) {
        const myIndex = lastGame.players.findIndex(p => p.id === mySocketId);
        if (myIndex !== -1) {
            const seatPositions = ["top", "left", "right"];
            const rotated = [];
            for (let i = 0; i < 4; i++) {
                rotated.push(lastGame.players[(myIndex + i) % 4]);
            }
            const seatMap = { top: rotated[2], left: rotated[1], right: rotated[3] };

            seatPositions.forEach(pos => {
                const seatPlayer = seatMap[pos];
                const cardsContainer = document.getElementById(`cards-${pos}`);
                if (!cardsContainer || !seatPlayer) return;

                const reveal = result.reveals.find(r => r.id === seatPlayer.id);
                if (reveal && reveal.cards && reveal.cards[0]) {
                    cardsContainer.innerHTML = "";
                    reveal.cards.forEach(card => {
                        cardsContainer.appendChild(createCardElement(card, true));
                    });
                }
            });
        }
    }

    setTimeout(() => {
        showdownModal.style.display = "none";
    }, 4000);
}

function renderActionLogs(logs) {
    if (!logs || logs.length === 0) return;
    logFeed.innerHTML = "";
    logs.slice(-25).forEach(entry => {
        const item = document.createElement("div");
        item.className = `log-item log-${entry.type || "info"}`;
        item.textContent = entry.text;
        logFeed.appendChild(item);
    });
    logFeed.scrollTop = logFeed.scrollHeight;
}
