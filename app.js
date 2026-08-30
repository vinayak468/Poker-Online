const socket = io();

let mySocketId = null;
let playerName = null;

const positions = ["top", "right", "bottom", "left"];

socket.on("connect", () => {
    mySocketId = socket.id;
    if (!playerName) {
        playerName = prompt("Enter your player name:") || "Player";
    }
    socket.emit("joinGame", playerName);
});

socket.on("gameUpdate", game => {
    console.log("GAME UPDATE:", game);
    updateTable(game);
    updateMyCards(game);
    updateControls(game);
});

function updateTable(game) {
    document.getElementById("pot").textContent = game.pot;

    const myIndex = game.players.findIndex(player => player.id === mySocketId);
    if (myIndex === -1) return;

    const rotatedPlayers = [];
    for (let i = 0; i < 4; i++) {
        const index = (myIndex + i) % 4;
        rotatedPlayers.push(game.players[index]);
    }

    const displayOrder = [
        rotatedPlayers[2], 
        rotatedPlayers[3], 
        rotatedPlayers[0], 
        rotatedPlayers[1]  
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

socket.on("gameFull", () => {
    alert("This table is full.");
});
