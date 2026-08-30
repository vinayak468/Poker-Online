const socket = io();

let mySocketId = null;
let hasJoined = false;
let myRoomCode = null;

const positions = ["top", "right", "bottom", "left"];

// ========================================
// JOIN SCREEN
// ========================================

const joinScreen = document.getElementById("home-screen");
const gameScreen = document.getElementById("game-screen");
const roomNameInput = document.getElementById("room-name-input");
const roomCodeInput = document.getElementById("room-code-input");
const roomButton = document.getElementById("room-button");
const aiButton = document.getElementById("ai-button");
const joinError = document.getElementById("join-error");
const roomLabel = document.getElementById("room");

function doJoin(name, roomCode) {
    const finalName = name.trim() || "Player";
    joinError.style.display = "none";
    sessionStorage.setItem("pokerName", finalName);
    sessionStorage.setItem("pokerRoom", roomCode || "");
    socket.emit("joinGame", { name: finalName, roomCode: roomCode || "" });
}

aiButton.addEventListener("click", () => {
    const name = prompt("Enter your name:") || "Player";
    // Blank room code = private table just for this player + bots
    doJoin(name, "");
});

roomButton.addEventListener("click", () => {
    doJoin(roomNameInput.value, roomCodeInput.value.trim());
});

[roomNameInput, roomCodeInput].forEach(input => {
    input.addEventListener("keydown", e => {
        if (e.key === "Enter") doJoin(roomNameInput.value, roomCodeInput.value.trim());
    });
});

// ========================================
// CONNECT
// ========================================

socket.on("connect", () => {
    mySocketId = socket.id;

    const savedName = sessionStorage.getItem("pokerName");
    const savedRoom = sessionStorage.getItem("pokerRoom");

    if (savedName) {
        socket.emit("joinGame", { name: savedName, roomCode: savedRoom || "" });
    }
});

socket.on("gameFull", () => {
    joinError.textContent = "This room is full.";
    joinError.style.display = "block";
});

socket.on("joinSuccess", data => {
    hasJoined = true;
    myRoomCode = data.roomCode;
    sessionStorage.setItem("pokerRoom", myRoomCode);
    joinScreen.style.display = "none";
    gameScreen.style.display = "block";
    roomLabel.textContent = `Room: ${myRoomCode} (share this code)`;
});

// ========================================
// SHOWDOWN REVEAL
// ========================================

function cardText(card) {
    if (!card) return "?";
    return `${card.rank}${card.suit}`;
}

function isRed(card) {
    return card && (card.suit === "\u2665" || card.suit === "\u2666");
}

socket.on("showdown", result => {
    const banner = document.getElementById("showdown-banner");

    const names = result.winners.map(w => w.name).join(" & ");
    const handName = result.winners[0]?.hand || "";

    banner.innerHTML = `
        <div class="showdown-content">
            <div class="showdown-title">🏆 ${names} wins ${result.pot} chips</div>
            <div class="showdown-hand">${handName}</div>
        </div>
    `;
    banner.style.display = "flex";

    // Reveal all active players' hole cards at their seats
    const seatPositions = ["top", "left", "right"];
    const lastGame = window.__lastGame;

    if (lastGame && result.reveals) {
        const myIndex = lastGame.players.findIndex(p => p.id === mySocketId);

        if (myIndex !== -1) {
            const rotated = [];
            for (let i = 0; i < 4; i++) {
                rotated.push(lastGame.players[(myIndex + i) % 4]);
            }

            const seatMap = {
                top: rotated[2],
                left: rotated[1],
                right: rotated[3]
            };

            seatPositions.forEach(pos => {
                const seatPlayer = seatMap[pos];
                const container = document.getElementById(`cards-${pos}`);
                if (!container || !seatPlayer) return;

                const reveal = result.reveals.find(r => r.id === seatPlayer.id);
                container.innerHTML = "";

                if (reveal && reveal.cards) {
                    reveal.cards.forEach(card => {
                        const el = document.createElement("div");
                        el.className = "hole-card small" + (isRed(card) ? " red" : "");
                        el.textContent = cardText(card);
                        container.appendChild(el);
                    });
                }
            });
        }
    }

    setTimeout(() => {
        banner.style.display = "none";
        document.querySelectorAll(".seat-cards").forEach(el => el.innerHTML = "");
    }, 4500);
});

// ========================================
// GAME UPDATE
// ========================================

socket.on("gameUpdate", game => {
    if (!hasJoined) return;
    window.__lastGame = game;
    updateTable(game);
    updateMyCards(game);
    updateControls(game);
});

// ========================================
// UPDATE TABLE
// ========================================

function updateTable(game) {
    document.getElementById("pot").textContent = game.pot;

    const myIndex = game.players.findIndex(player => player.id === mySocketId);

    if (myIndex === -1) {
        document.querySelectorAll("[id^='player-']").forEach(el => {
            el.textContent = "Waiting for next hand...";
        });
        document.querySelectorAll("[id^='chips-']").forEach(el => {
            el.textContent = "--";
        });
        return;
    }

    const rotatedPlayers = [];
    for (let i = 0; i < 4; i++) {
        const index = (myIndex + i) % 4;
        rotatedPlayers.push(game.players[index]);
    }

    const displayOrder = [
        rotatedPlayers[2], // top
        rotatedPlayers[3], // right
        rotatedPlayers[0], // bottom (you)
        rotatedPlayers[1]  // left
    ];

    positions.forEach((position, index) => {
        const player = displayOrder[index];
        const nameElement = document.getElementById(`player-${position}`);
        const chipsElement = document.getElementById(`chips-${position}`);

        if (!player) {
            nameElement.textContent = "Waiting...";
            chipsElement.textContent = "--";
            return;
        }

        let displayName;
        if (player.id === mySocketId) {
            displayName = "👤 You";
        } else if (player.bot) {
            displayName = `🤖 ${player.name}`;
        } else {
            displayName = `👤 ${player.name}`;
        }

        if (player.folded) displayName += " (Folded)";
        if (game.players[game.currentPlayer]?.id === player.id) displayName += " ◀";
        if (player.allIn) displayName += " ALL-IN";

        nameElement.textContent = displayName;
        chipsElement.textContent = `${player.chips} chips`;
    });

    updateCommunityCards(game);
}

// ========================================
// COMMUNITY CARDS
// ========================================

function updateCommunityCards(game) {
    const cards = document.querySelectorAll(".community-cards .card");

    cards.forEach((element, index) => {
        const card = game.communityCards[index];

        if (!card) {
            element.textContent = "?";
            element.className = "card hidden-card";
            return;
        }

        element.textContent = `${card.rank}${card.suit}`;
        element.className = "card";

        if (card.suit === "♥" || card.suit === "♦") {
            element.classList.add("red");
        }
    });
}

// ========================================
// MY CARDS
// ========================================

function updateMyCards(game) {
    const me = game.players.find(player => player.id === mySocketId);
    const container = document.getElementById("my-cards");

    if (!container) return;

    container.innerHTML = "";

    if (!me || !me.hand || me.hand.length === 0) return;

    me.hand.forEach(card => {
        const element = document.createElement("div");
        element.className = "hole-card";

        if (card) {
            element.textContent = `${card.rank}${card.suit}`;
            if (card.suit === "♥" || card.suit === "♦") {
                element.classList.add("red");
            }
        } else {
            element.classList.add("hidden-card");
        }

        container.appendChild(element);
    });
}

// ========================================
// CONTROLS
// ========================================

function updateControls(game) {
    const myIndex = game.players.findIndex(player => player.id === mySocketId);
    const myTurn = myIndex === game.currentPlayer;
    const active = game.phase !== "waiting" && game.phase !== "showdown";

    document.querySelector(".fold").disabled = !(myTurn && active);
    document.querySelector(".check").disabled = !(myTurn && active);
    document.querySelector(".raise").disabled = !(myTurn && active);

    updateCheckButton(game);
}

function updateCheckButton(game) {
    const button = document.querySelector(".check");
    const myIndex = game.players.findIndex(player => player.id === mySocketId);

    if (myIndex === -1) return;

    const me = game.players[myIndex];
    const highestBet = Math.max(
        ...game.players
            .filter(player => !player.folded)
            .map(player => player.currentBet || 0)
    );

    if (highestBet > (me.currentBet || 0)) {
        button.textContent = "CALL";
        button.dataset.action = "call";
    } else {
        button.textContent = "CHECK";
        button.dataset.action = "check";
    }
}

// ========================================
// ACTIONS
// ========================================

document.querySelector(".fold").addEventListener("click", () => {
    socket.emit("action", { action: "fold" });
});

document.querySelector(".check").addEventListener("click", () => {
    const action = document.querySelector(".check").dataset.action || "check";
    socket.emit("action", { action });
});

document.querySelector(".raise").addEventListener("click", () => {
    const amountStr = prompt("Enter raise amount:");
    if (amountStr === null) return;

    const amount = parseInt(amountStr, 10);
    if (isNaN(amount) || amount <= 0) {
        alert("Please enter a valid numeric amount.");
        return;
    }

    socket.emit("action", { action: "raise", amount });
});
