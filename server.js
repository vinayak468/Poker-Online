const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const PokerGame = require("./game");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// roomCode -> { game: PokerGame }
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

function makeRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).slice(2, 6).toUpperCase();
    } while (rooms.has(code));
    return code;
}

function getOrCreateRoom(roomCode) {
    let code = roomCode && roomCode.trim().toUpperCase();

    if (code && rooms.has(code)) {
        return { code, room: rooms.get(code) };
    }

    if (!code) {
        code = makeRoomCode();
    }

    const room = { game: new PokerGame() };
    rooms.set(code, room);
    return { code, room };
}

function publicGame(game) {
    return {
        phase: game.game.phase,
        communityCards: game.game.communityCards,
        players: game.game.players.map(player => ({
            id: player.id,
            name: player.name,
            chips: player.chips,
            bot: player.bot,
            folded: player.folded,
            allIn: player.allIn,
            currentBet: player.currentBet,
            hand: player.bot ? [null, null] : player.hand
        })),
        pot: game.game.pot,
        dealer: game.game.dealer,
        currentPlayer: game.game.currentPlayer,
        streetBet: game.game.streetBet,
        minRaise: game.game.minRaise
    };
}

function broadcastGame(code, room) {
    io.to(code).emit("gameUpdate", publicGame(room.game));
}

function finishHand(code, room) {
    const game = room.game;

    if (game.game.phase !== "showdown") {
        return;
    }

    if (game.game.pot > 0) {
        const result = game.showdown();

        if (result) {
            io.to(code).emit("showdown", result);
        }
    }

    broadcastGame(code, room);

    setTimeout(() => {
        if (!rooms.has(code)) return;

        if (game.humans.size > 0) {
            game.startHand();
            broadcastGame(code, room);
            runBots(code, room);
        } else {
            game.game.phase = "waiting";
            broadcastGame(code, room);
        }
    }, 5000);
}

const BOT_ACTION_DELAY_MS = 1200;

// Runs ONE bot action at a time, broadcasting after each, with a short
// delay in between so players can actually see each street/action land
// instead of the whole hand resolving instantly.
function runBots(code, room, safety = 20) {
    const game = room.game;

    if (!rooms.has(code)) {
        return;
    }

    if (
        game.game.phase === "waiting" ||
        game.game.phase === "showdown" ||
        !game.current()?.bot ||
        safety <= 0
    ) {
        broadcastGame(code, room);

        if (game.game.phase === "showdown") {
            finishHand(code, room);
        }

        return;
    }

    game.botAction();
    broadcastGame(code, room);

    setTimeout(() => {
        runBots(code, room, safety - 1);
    }, BOT_ACTION_DELAY_MS);
}

io.on("connection", socket => {
    console.log("Connected:", socket.id);

    socket.on("joinGame", data => {
        const name = typeof data === "string" ? data : data?.name;
        const requestedCode = typeof data === "object" ? data?.roomCode : null;

        const playerName =
            typeof name === "string" && name.trim()
                ? name.trim().slice(0, 20)
                : "Player";

        const { code, room } = getOrCreateRoom(requestedCode);
        const game = room.game;

        const reclaimed = game.reclaimSeat(playerName, socket.id);

        if (!reclaimed && !game.addHuman(socket.id, playerName)) {
            socket.emit("gameFull");
            return;
        }

        socket.join(code);
        socket.data.roomCode = code;

        socket.emit("joinSuccess", { roomCode: code });

        console.log(`${playerName} joined room ${code}`);

        if (game.game.phase === "waiting") {
            game.startHand();
        }

        broadcastGame(code, room);
        runBots(code, room);
    });

    socket.on("action", data => {
        const code = socket.data.roomCode;
        const room = code && rooms.get(code);

        if (!room) return;

        const game = room.game;
        const player = game.current();

        if (!player || player.id !== socket.id) {
            return;
        }

        let success = false;

        switch (data?.action) {
            case "fold":
                success = game.fold(socket.id);
                break;

            case "check":
                success = game.check(socket.id);
                break;

            case "call":
                success = game.call(socket.id);
                break;

            case "raise":
                success = game.raise(socket.id);
                break;
        }

        if (!success) {
            return;
        }

        if (game.game.phase === "showdown") {
            finishHand(code, room);
            return;
        }

        broadcastGame(code, room);
        runBots(code, room);
    });

    socket.on("disconnect", () => {
        console.log("Disconnected:", socket.id);

        const code = socket.data.roomCode;
        const room = code && rooms.get(code);

        if (!room) return;

        const game = room.game;
        game.removeHuman(socket.id);

        if (
            game.game.phase !== "showdown" &&
            game.activePlayers().filter(p => !p.bot).length === 0
        ) {
            game.game.phase = "waiting";
            game.game.players = [];
            game.game.communityCards = [];
            game.game.pot = 0;
        }

        if (game.humans.size === 0) {
            rooms.delete(code);
        } else {
            broadcastGame(code, room);
        }
    });
});

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        rooms: rooms.size
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Poker server running on port ${PORT}`);
});
