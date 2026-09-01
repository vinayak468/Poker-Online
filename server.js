const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const PokerGame = require("./game");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const BOT_ACTION_DELAY_MS = 1000;
const RUNOUT_DELAY_MS = 1200;
const SHOWDOWN_DISPLAY_MS = 4500;
const TURN_TIMEOUT_MS = 25000; // Auto-action if player is inactive

// roomCode -> { game: PokerGame, turnTimer: Timeout|null, runoutRunning: boolean }
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

    const room = {
        game: new PokerGame(),
        turnTimer: null,
        runoutRunning: false,
        handEnding: false
    };
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
            totalBet: player.totalBet,
            lastAction: player.lastAction,
            hand: player.bot ? [null, null] : player.hand
        })),
        pot: game.game.pot,
        dealer: game.game.dealer,
        smallBlindSeat: game.game.smallBlindSeat,
        bigBlindSeat: game.game.bigBlindSeat,
        currentPlayer: game.game.currentPlayer,
        streetBet: game.game.streetBet,
        minRaise: game.game.minRaise,
        lastAction: game.game.lastAction,
        actionLog: game.game.actionLog || [],
        handCount: game.handCount
    };
}

function broadcastGame(code, room) {
    if (!rooms.has(code)) return;
    io.to(code).emit("gameUpdate", publicGame(room.game));
}

function clearTurnTimer(room) {
    if (room.turnTimer) {
        clearTimeout(room.turnTimer);
        room.turnTimer = null;
    }
}

function resetTurnTimer(code, room) {
    clearTurnTimer(room);

    const game = room.game;
    if (game.game.phase === "waiting" || game.game.phase === "showdown" || room.handEnding) {
        return;
    }

    const current = game.current();
    if (!current || current.bot) {
        return;
    }

    // Auto-check or auto-fold for inactive human
    room.turnTimer = setTimeout(() => {
        if (!rooms.has(code)) return;
        const cur = game.current();
        if (!cur || cur.id !== current.id) return;

        const toCall = game.game.streetBet - cur.currentBet;
        if (toCall === 0) {
            game.check(cur.id);
        } else {
            game.fold(cur.id);
        }

        handleGameProgression(code, room);
    }, TURN_TIMEOUT_MS);
}

function finishHand(code, room, showdownResult = null) {
    const game = room.game;
    if (room.handEnding) return;
    room.handEnding = true;
    clearTurnTimer(room);

    let result = showdownResult;
    if (!result && game.game.phase === "showdown") {
        result = game.showdown();
    }

    if (result) {
        io.to(code).emit("showdown", result);
    }

    broadcastGame(code, room);

    setTimeout(() => {
        if (!rooms.has(code)) return;
        room.handEnding = false;
        room.runoutRunning = false;

        if (game.humans.size > 0) {
            game.startHand();
            broadcastGame(code, room);
            handleGameProgression(code, room);
        } else {
            game.game.phase = "waiting";
            broadcastGame(code, room);
        }
    }, SHOWDOWN_DISPLAY_MS);
}

function runAllInRunout(code, room) {
    if (room.runoutRunning || room.handEnding) return;
    room.runoutRunning = true;
    clearTurnTimer(room);

    function stepRunout() {
        if (!rooms.has(code) || room.handEnding) return;
        const game = room.game;

        if (game.game.phase === "showdown") {
            const result = game.showdown();
            finishHand(code, room, result);
            return;
        }

        const showdownRes = game.nextStreet();
        broadcastGame(code, room);

        if (game.game.phase === "showdown" || showdownRes) {
            finishHand(code, room, showdownRes);
        } else {
            setTimeout(stepRunout, RUNOUT_DELAY_MS);
        }
    }

    setTimeout(stepRunout, RUNOUT_DELAY_MS);
}

function handleGameProgression(code, room) {
    if (!rooms.has(code) || room.handEnding) return;
    const game = room.game;

    if (game.game.phase === "showdown") {
        finishHand(code, room);
        return;
    }

    if (game.game.phase === "waiting") {
        broadcastGame(code, room);
        return;
    }

    if (game.game.allInRunout || game.actionablePlayers().length <= 1 && game.roundComplete()) {
        runAllInRunout(code, room);
        return;
    }

    const current = game.current();
    if (current && current.bot) {
        clearTurnTimer(room);
        setTimeout(() => {
            if (!rooms.has(code) || room.handEnding) return;
            const cur = game.current();
            if (cur && cur.bot && game.game.phase !== "showdown") {
                const actResult = game.botAction();
                if (actResult && typeof actResult === "object") {
                    // Hand concluded via fold
                    finishHand(code, room, actResult);
                    return;
                }
                broadcastGame(code, room);
                handleGameProgression(code, room);
            }
        }, BOT_ACTION_DELAY_MS);
    } else {
        broadcastGame(code, room);
        resetTurnTimer(code, room);
    }
}

io.on("connection", socket => {
    console.log("Connected:", socket.id);

    socket.on("joinGame", data => {
        const name = typeof data === "string" ? data : data?.name;
        const requestedCode = typeof data === "object" ? data?.roomCode : null;

        const playerName = typeof name === "string" && name.trim()
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

        socket.emit("joinSuccess", {
            roomCode: code,
            playerId: socket.id,
            playerName: playerName
        });

        console.log(`${playerName} joined room ${code}`);

        if (game.game.phase === "waiting") {
            game.startHand();
        }

        broadcastGame(code, room);
        handleGameProgression(code, room);
    });

    socket.on("action", data => {
        const code = socket.data.roomCode;
        const room = code && rooms.get(code);
        if (!room || room.handEnding) return;

        const game = room.game;
        const player = game.current();

        if (!player || player.id !== socket.id) {
            return;
        }

        let result = false;

        switch (data?.action) {
            case "fold":
                result = game.fold(socket.id);
                break;
            case "check":
                result = game.check(socket.id);
                break;
            case "call":
                result = game.call(socket.id);
                break;
            case "raise":
                result = game.raise(socket.id, data?.amount);
                break;
        }

        if (!result) return;

        if (typeof result === "object") {
            // Fold winner
            finishHand(code, room, result);
            return;
        }

        if (game.game.phase === "showdown") {
            finishHand(code, room);
            return;
        }

        broadcastGame(code, room);
        handleGameProgression(code, room);
    });

    socket.on("rebuy", () => {
        const code = socket.data.roomCode;
        const room = code && rooms.get(code);
        if (!room) return;

        room.game.rebuy(socket.id, 1000);
        broadcastGame(code, room);
    });

    socket.on("disconnect", () => {
        console.log("Disconnected:", socket.id);

        const code = socket.data.roomCode;
        const room = code && rooms.get(code);
        if (!room) return;

        const game = room.game;
        const isCurrentTurn = game.current()?.id === socket.id;

        if (isCurrentTurn && game.game.phase !== "showdown" && game.game.phase !== "waiting") {
            game.fold(socket.id);
        }

        game.removeHuman(socket.id);

        if (game.humans.size === 0) {
            clearTurnTimer(room);
            rooms.delete(code);
        } else {
            if (
                game.game.phase !== "showdown" &&
                game.activePlayers().filter(p => !p.bot).length === 0
            ) {
                game.game.phase = "waiting";
                game.game.players = [];
                game.game.communityCards = [];
                game.game.pot = 0;
            }
            broadcastGame(code, room);
            handleGameProgression(code, room);
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
