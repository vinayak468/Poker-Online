const {
    createDeck,
    shuffle,
    draw,
    evaluateHand
} = require("./poker");

const MAX_PLAYERS = 4;
const STARTING_CHIPS = 1000;

const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const MIN_RAISE = 20;

const BOT_NAMES = [
    "Bot Alex",
    "Bot Shark",
    "Bot Bluff"
];

class PokerGame {

    constructor() {
        this.humans = new Map();

        this.game = {
            phase: "waiting",
            deck: [],
            communityCards: [],
            players: [],
            pot: 0,
            dealer: -1,
            currentPlayer: -1,
            streetBet: 0,
            minRaise: MIN_RAISE
        };
    }

    reclaimSeat(name, newId) {
        const trimmed = name.trim().toLowerCase();

        for (const [oldId, human] of this.humans.entries()) {
            if (human.name.trim().toLowerCase() === trimmed) {
                this.humans.delete(oldId);
                human.id = newId;
                this.humans.set(newId, human);

                const seat = this.game.players.find(p => p.id === oldId);
                if (seat) {
                    seat.id = newId;
                }

                return true;
            }
        }

        return false;
    }

    addHuman(id, name) {
        if (this.humans.size >= MAX_PLAYERS) {
            return false;
        }

        this.humans.set(id, {
            id: id,
            name: name,
            chips: STARTING_CHIPS
        });

        return true;
    }

    removeHuman(id) {
        this.humans.delete(id);
    }

    buildSeats() {
        const seats = Array.from(this.humans.values()).map(player => ({
            id: player.id,
            name: player.name,
            chips: player.chips,
            bot: false,
            folded: false,
            allIn: false,
            hand: [],
            currentBet: 0,
            totalBet: 0
        }));

        let bot = 0;

        while (seats.length < MAX_PLAYERS) {
            seats.push({
                id: `bot-${bot}`,
                name: BOT_NAMES[bot],
                chips: STARTING_CHIPS,
                bot: true,
                folded: false,
                allIn: false,
                hand: [],
                currentBet: 0,
                totalBet: 0
            });

            bot++;
        }

        return seats;
    }

    startHand() {
        if (this.humans.size === 0) {
            this.game.phase = "waiting";
            return;
        }

        this.game.deck = shuffle(createDeck());
        this.game.communityCards = [];
        this.game.pot = 0;
        this.game.streetBet = 0;
        this.game.minRaise = MIN_RAISE;
        this.game.phase = "preflop";
        this.game.players = this.buildSeats();
        this.game.dealer = (this.game.dealer + 1) % MAX_PLAYERS;

        for (const player of this.game.players) {
            player.hand = [draw(this.game.deck), draw(this.game.deck)];
            player.folded = false;
            player.allIn = false;
            player.currentBet = 0;
            player.totalBet = 0;
        }

        const smallBlind = (this.game.dealer + 1) % MAX_PLAYERS;
        const bigBlind = (this.game.dealer + 2) % MAX_PLAYERS;

        this.postBlind(smallBlind, SMALL_BLIND);
        this.postBlind(bigBlind, BIG_BLIND);

        this.game.streetBet = BIG_BLIND;
        this.game.currentPlayer = (bigBlind + 1) % MAX_PLAYERS;

        this.skipInactive();

        return true;
    }

    postBlind(index, amount) {
        const player = this.game.players[index];
        const actual = Math.min(amount, player.chips);

        player.chips -= actual;
        player.currentBet += actual;
        player.totalBet += actual;
        this.game.pot += actual;

        if (player.chips === 0) {
            player.allIn = true;
        }
    }

    activePlayers() {
        return this.game.players.filter(player => !player.folded);
    }

    actionablePlayers() {
        return this.game.players.filter(
            player => !player.folded && !player.allIn && player.chips > 0
        );
    }

    current() {
        return this.game.players[this.game.currentPlayer];
    }

    skipInactive() {
        for (let i = 0; i < MAX_PLAYERS; i++) {
            const player = this.current();

            if (player && !player.folded && !player.allIn && player.chips > 0) {
                return;
            }

            this.game.currentPlayer = (this.game.currentPlayer + 1) % MAX_PLAYERS;
        }
    }

    fold(id) {
        const index = this.findPlayer(id);

        if (!this.isTurn(index)) {
            return false;
        }

        this.game.players[index].folded = true;

        if (this.activePlayers().length === 1) {
            this.awardFoldWinner();
            return true;
        }

        this.nextAction();
        return true;
    }

    check(id) {
        const index = this.findPlayer(id);

        if (!this.isTurn(index)) {
            return false;
        }

        const player = this.game.players[index];

        if (player.currentBet !== this.game.streetBet) {
            return false;
        }

        this.nextAction();
        return true;
    }

    call(id) {
        const index = this.findPlayer(id);

        if (!this.isTurn(index)) {
            return false;
        }

        const player = this.game.players[index];
        const needed = Math.max(0, this.game.streetBet - player.currentBet);
        const amount = Math.min(needed, player.chips);

        player.chips -= amount;
        player.currentBet += amount;
        player.totalBet += amount;
        this.game.pot += amount;

        if (player.chips === 0) {
            player.allIn = true;
        }

        this.nextAction();
        return true;
    }

    raise(id) {
        const index = this.findPlayer(id);

        if (!this.isTurn(index)) {
            return false;
        }

        const player = this.game.players[index];
        const target = this.game.streetBet + this.game.minRaise;
        const needed = target - player.currentBet;

        if (needed <= 0) {
            return false;
        }

        if (player.chips <= needed) {
            const amount = player.chips;

            player.chips = 0;
            player.currentBet += amount;
            player.totalBet += amount;
            this.game.pot += amount;
            player.allIn = true;

            if (player.currentBet > this.game.streetBet) {
                this.game.minRaise = player.currentBet - this.game.streetBet;
                this.game.streetBet = player.currentBet;
            }

            this.nextAction();
            return true;
        }

        const previous = this.game.streetBet;

        player.chips -= needed;
        player.currentBet += needed;
        player.totalBet += needed;
        this.game.pot += needed;

        this.game.streetBet = player.currentBet;
        this.game.minRaise = Math.max(MIN_RAISE, this.game.streetBet - previous);

        this.nextAction();
        return true;
    }

    findPlayer(id) {
        return this.game.players.findIndex(player => player.id === id);
    }

    isTurn(index) {
        return (
            index >= 0 &&
            index === this.game.currentPlayer &&
            this.game.phase !== "waiting" &&
            this.game.phase !== "showdown" &&
            !this.game.players[index].folded &&
            !this.game.players[index].allIn
        );
    }

    nextAction() {
        if (this.activePlayers().length <= 1) {
            this.awardFoldWinner();
            return;
        }

        if (this.roundComplete()) {
            this.nextStreet();
            return;
        }

        for (let i = 1; i <= MAX_PLAYERS; i++) {
            const next = (this.game.currentPlayer + i) % MAX_PLAYERS;
            const player = this.game.players[next];

            if (!player.folded && !player.allIn && player.chips > 0) {
                this.game.currentPlayer = next;
                return;
            }
        }

        this.nextStreet();
    }

    roundComplete() {
        const active = this.activePlayers();
        const actionable = this.actionablePlayers();

        if (active.length <= 1) {
            return true;
        }

        if (actionable.length === 0) {
            return true;
        }

        return actionable.every(
            player => player.currentBet === this.game.streetBet
        );
    }

    nextStreet() {
        if (this.game.phase === "preflop") {
            draw(this.game.deck);
            this.game.communityCards.push(
                draw(this.game.deck),
                draw(this.game.deck),
                draw(this.game.deck)
            );
            this.game.phase = "flop";
        } else if (this.game.phase === "flop") {
            draw(this.game.deck);
            this.game.communityCards.push(draw(this.game.deck));
            this.game.phase = "turn";
        } else if (this.game.phase === "turn") {
            draw(this.game.deck);
            this.game.communityCards.push(draw(this.game.deck));
            this.game.phase = "river";
        } else {
            this.game.phase = "showdown";
            return;
        }

        for (const player of this.game.players) {
            player.currentBet = 0;
        }

        this.game.streetBet = 0;
        this.game.minRaise = MIN_RAISE;
        this.game.currentPlayer = this.game.dealer;

        this.skipInactive();
    }

    // ========================================
    // SHOWDOWN
    // ========================================

    showdown() {
        const active = this.activePlayers();

        if (active.length === 0) {
            return null;
        }

        const evaluated = active
            .filter(player => player.hand && player.hand[0])
            .map(player => ({
                player: player,
                result: evaluateHand(
                    [...player.hand, ...this.game.communityCards]
                )
            }));

        if (evaluated.length === 0) {
            return null;
        }

        evaluated.sort((a, b) => b.result.value - a.result.value);

        const winningValue = evaluated[0].result.value;
        const winners = evaluated.filter(
            entry => entry.result.value === winningValue
        );

        const share = Math.floor(this.game.pot / winners.length);

        for (const winner of winners) {
            winner.player.chips += share;
        }

        const remainder = this.game.pot - share * winners.length;

        if (remainder > 0) {
            winners[0].player.chips += remainder;
        }

        const result = {
            pot: this.game.pot,

            winners: winners.map(winner => ({
                id: winner.player.id,
                name: winner.player.name,
                hand: winner.result.handName,
                cards: winner.player.hand
            })),

            reveals: evaluated.map(entry => ({
                id: entry.player.id,
                name: entry.player.name,
                hand: entry.result.handName,
                cards: entry.player.hand,
                isWinner: winningValue === entry.result.value
            }))
        };

        this.game.pot = 0;
        this.game.phase = "showdown";

        this.syncStacks();

        return result;
    }

    // ========================================
    // FOLD WINNER
    // ========================================

    awardFoldWinner() {
        const winner = this.activePlayers()[0];

        if (!winner) {
            return null;
        }

        const amount = this.game.pot;

        winner.chips += amount;

        this.game.pot = 0;
        this.game.phase = "showdown";

        this.syncStacks();

        return {
            pot: amount,

            winners: [{
                id: winner.id,
                name: winner.name,
                hand: "Everyone else folded",
                cards: winner.hand
            }],

            reveals: [{
                id: winner.id,
                name: winner.name,
                hand: "Everyone else folded",
                cards: winner.hand,
                isWinner: true
            }]
        };
    }

    syncStacks() {
        for (const player of this.game.players) {
            if (!player.bot) {
                const human = this.humans.get(player.id);

                if (human) {
                    human.chips = player.chips;
                }
            }
        }
    }

    botAction() {
        const player = this.current();

        if (!player || !player.bot) {
            return null;
        }

        const callAmount = Math.max(0, this.game.streetBet - player.currentBet);
        const random = Math.random();

        if (callAmount === 0 && random < 0.45) {
            this.check(player.id);
            return "check";
        }

        if (random < 0.15) {
            this.fold(player.id);
            return "fold";
        }

        if (random > 0.80) {
            this.raise(player.id);
            return "raise";
        }

        this.call(player.id);
        return "call";
    }
}

module.exports = PokerGame;
