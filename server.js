const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const PokerGame = require("./game");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const game = new PokerGame();
const PORT = 3000;
let botTimer = null;

app.use(express.static("public"));

function sendGame(reveal = false) {
    for (const [socketId] of game.humans) {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) continue;

        const myIndex = game.game.players.findIndex(player => player.id === socketId);
        const players = game.game.players.map(player => {
            const showCards = reveal || player.id === socketId;
            return {
                id: player.id, name: player.name, chips: player.chips,
                bot: player.bot, folded: player.folded, allIn: player.allIn,
                currentBet: player.currentBet, hand: showCards ? player.hand : [null, null]
            };
        });

        socket.emit("gameUpdate", {
            phase: game.game.phase, pot: game.game.pot,
            communityCards: game.game.communityCards, currentPlayer: game.game.currentPlayer,
            dealer: game.game.dealer, streetBet: game.game.streetBet,
            minRaise: game.game.minRaise, myPlayerIndex: myIndex, players
        });
    }
}

function runBot() {
    clearTimeout(botTimer);
    const player = game.current();
    if (!player || !player.bot || game.game.phase === "waiting") return;

    botTimer = setTimeout(() => {
        if (game.current() && game.current().id === player.id) {
            console.log(`${player.name} is thinking...`);
            game.botAction();
            sendGame();
            runBot();
        }
    }, 800);
}

io.on("connection", socket => {
    console.log("Connected:", socket.id);

    socket.on("joinGame", name => {
        if (game.humans.has(socket.id) || game.humans.size >= 4) {
            return socket.emit("gameFull");
        }

        let cleanName = typeof name === "string" ? name.trim().slice(0, 20) : `Player ${game.humans.size + 1}`;
        if (!game.addHuman(socket.id, cleanName)) return socket.emit("gameFull");

        console.log(`${cleanName} joined`);
        if (game.game.phase === "waiting") game.startHand();
        
        sendGame();
        runBot();
    });

    socket.on("action", payload => {
        const { action, amount } = typeof payload === "string" ? { action: payload } : payload;
        let success = false;

        switch (action) {
            case "fold": success = game.fold(socket.id); break;
            case "check": success = game.check(socket.id); break;
            case "call": success = game.call(socket.id); break;
            case "raise": success = game.raise(socket.id, amount); break;
        }

        if (success) {
            sendGame();
            runBot();
        }
    });

    socket.on("disconnect", () => {
        const player = game.humans.get(socket.id);
        if (player) {
            console.log(`${player.name} disconnected`);
            game.removeHuman(socket.id);
            if (game.current()?.bot) runBot(); 
        }
        sendGame();
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n================================\nPoker server: http://localhost:${PORT}\n================================\n`);
});
