const {
    createDeck,
    shuffle,
    draw,
    evaluateHand,
    getPreflopScore,
    getPostflopScore,
    calculatePots
} = require("./poker");

const MAX_PLAYERS = 4;
const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const MIN_RAISE = 20;

const BOT_PROFILES = [
    { name: "Bot Alex", style: "balanced" },
    { name: "Bot Shark", style: "aggressive" },
    { name: "Bot Bluff", style: "tricky" }
];

class PokerGame {
    constructor() {
        this.humans = new Map(); // socketId -> { id, name, chips }
        this.bots = new Map();   // botId -> { id, name, chips, style }
        this.handCount = 0;
        this.actionLog = [];

        // Initialize persistent bots
        BOT_PROFILES.forEach((profile, index) => {
            const id = `bot-${index}`;
            this.bots.set(id, {
                id,
                name: profile.name,
                chips: STARTING_CHIPS,
                style: profile.style
            });
        });

        this.game = {
            phase: "waiting", // waiting | preflop | flop | turn | river | showdown
            deck: [],
            communityCards: [],
            players: [],
            pot: 0,
            dealer: -1,
            smallBlindSeat: -1,
            bigBlindSeat: -1,
            currentPlayer: -1,
            streetBet: 0,
            minRaise: MIN_RAISE,
            allInRunout: false,
            lastAction: null,
            actionLog: []
        };
    }

    log(text, type = "info") {
        const entry = { text, type, time: Date.now() };
        this.actionLog.push(entry);
        if (this.actionLog.length > 50) this.actionLog.shift();
        this.game.actionLog = this.actionLog;
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

        const safeName = (name && name.trim().slice(0, 20)) || "Player";
        this.humans.set(id, {
            id: id,
            name: safeName,
            chips: STARTING_CHIPS
        });

        this.log(`👤 ${safeName} joined the table.`);
        return true;
    }

    removeHuman(id) {
        const human = this.humans.get(id);
        if (human) {
            this.log(`👤 ${human.name} left the table.`);
        }
        this.humans.delete(id);
    }

    rebuy(id, amount = STARTING_CHIPS) {
        const human = this.humans.get(id);
        if (human) {
            human.chips += amount;
            const seat = this.game.players.find(p => p.id === id);
            if (seat) seat.chips = human.chips;
            this.log(`💰 ${human.name} reloaded ${amount} chips.`);
            return true;
        }
        return false;
    }

    buildSeats() {
        const seats = [];

        // Add human players
        for (const human of this.humans.values()) {
            // Ensure human has at least starting chips if busted
            if (human.chips <= 0) {
                human.chips = STARTING_CHIPS;
            }
            seats.push({
                id: human.id,
                name: human.name,
                chips: human.chips,
                bot: false,
                style: "human",
                folded: false,
                allIn: false,
                hand: [],
                currentBet: 0,
                totalBet: 0,
                actedThisStreet: false,
                lastAction: null
            });
        }

        // Fill remaining seats with persistent bots
        let botIndex = 0;
        while (seats.length < MAX_PLAYERS) {
            const botId = `bot-${botIndex}`;
            let botData = this.bots.get(botId);

            if (!botData) {
                botData = {
                    id: botId,
                    name: BOT_PROFILES[botIndex]?.name || `Bot ${botIndex + 1}`,
                    chips: STARTING_CHIPS,
                    style: BOT_PROFILES[botIndex]?.style || "balanced"
                };
                this.bots.set(botId, botData);
            }

            // Auto-reload bot if busted
            if (botData.chips < BIG_BLIND) {
                botData.chips = STARTING_CHIPS;
                this.log(`🤖 ${botData.name} reloaded chips.`);
            }

            seats.push({
                id: botData.id,
                name: botData.name,
                chips: botData.chips,
                bot: true,
                style: botData.style,
                folded: false,
                allIn: false,
                hand: [],
                currentBet: 0,
                totalBet: 0,
                actedThisStreet: false,
                lastAction: null
            });

            botIndex++;
        }

        return seats;
    }

    startHand() {
        if (this.humans.size === 0) {
            this.game.phase = "waiting";
            return false;
        }

        this.handCount++;
        this.game.deck = shuffle(createDeck());
        this.game.communityCards = [];
        this.game.pot = 0;
        this.game.streetBet = 0;
        this.game.minRaise = BIG_BLIND;
        this.game.phase = "preflop";
        this.game.allInRunout = false;
        this.game.lastAction = null;
        this.game.players = this.buildSeats();

        // Advance dealer button
        if (this.game.dealer === -1) {
            this.game.dealer = 0;
        } else {
            this.game.dealer = (this.game.dealer + 1) % MAX_PLAYERS;
        }

        // Deal 2 hole cards to each player
        for (const player of this.game.players) {
            player.hand = [draw(this.game.deck), draw(this.game.deck)];
            player.folded = false;
            player.allIn = false;
            player.currentBet = 0;
            player.totalBet = 0;
            player.actedThisStreet = false;
            player.lastAction = null;
        }

        // Determine blinds based on player count
        const numSeats = MAX_PLAYERS;
        let sbIndex, bbIndex, firstToAct;

        if (numSeats === 2) {
            // Heads-up: Dealer is SB and acts first preflop
            sbIndex = this.game.dealer;
            bbIndex = (this.game.dealer + 1) % numSeats;
            firstToAct = sbIndex;
        } else {
            sbIndex = (this.game.dealer + 1) % numSeats;
            bbIndex = (this.game.dealer + 2) % numSeats;
            firstToAct = (this.game.dealer + 3) % numSeats;
        }

        this.game.smallBlindSeat = sbIndex;
        this.game.bigBlindSeat = bbIndex;

        this.postBlind(sbIndex, SMALL_BLIND, "Small Blind");
        this.postBlind(bbIndex, BIG_BLIND, "Big Blind");

        this.game.streetBet = BIG_BLIND;
        this.game.currentPlayer = firstToAct;

        this.log(`♠ Hand #${this.handCount} started. Dealer: ${this.game.players[this.game.dealer].name}`);
        this.skipInactive();

        return true;
    }

    postBlind(index, amount, blindName) {
        const player = this.game.players[index];
        const actual = Math.min(amount, player.chips);

        player.chips -= actual;
        player.currentBet += actual;
        player.totalBet += actual;
        this.game.pot += actual;

        if (player.chips === 0) {
            player.allIn = true;
        }

        player.lastAction = {
            type: "blind",
            amount: actual,
            text: `${blindName} ${actual}`
        };
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
            !this.game.players[index].allIn &&
            this.game.players[index].chips > 0
        );
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
        if (!this.isTurn(index)) return false;

        const player = this.game.players[index];
        player.folded = true;
        player.actedThisStreet = true;
        player.lastAction = { type: "fold", text: "Fold", amount: 0 };
        this.game.lastAction = { playerId: player.id, name: player.name, type: "fold", text: "Fold" };

        this.log(`${player.name} folded.`, "action");

        if (this.activePlayers().length === 1) {
            return this.awardFoldWinner();
        }

        this.nextAction();
        return true;
    }

    check(id) {
        const index = this.findPlayer(id);
        if (!this.isTurn(index)) return false;

        const player = this.game.players[index];
        if (player.currentBet !== this.game.streetBet) {
            return false;
        }

        player.actedThisStreet = true;
        player.lastAction = { type: "check", text: "Check", amount: 0 };
        this.game.lastAction = { playerId: player.id, name: player.name, type: "check", text: "Check" };

        this.log(`${player.name} checked.`, "action");

        this.nextAction();
        return true;
    }

    call(id) {
        const index = this.findPlayer(id);
        if (!this.isTurn(index)) return false;

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

        player.actedThisStreet = true;
        const actionType = player.allIn ? "allIn" : "call";
        const actionText = player.allIn ? `All-In (${amount})` : `Call ${amount}`;

        player.lastAction = { type: actionType, text: actionText, amount };
        this.game.lastAction = { playerId: player.id, name: player.name, type: actionType, text: actionText, amount };

        this.log(`${player.name} ${player.allIn ? "went all-in for" : "called"} ${amount}.`, "action");

        this.nextAction();
        return true;
    }

    raise(id, targetTotalBet) {
        const index = this.findPlayer(id);
        if (!this.isTurn(index)) return false;

        const player = this.game.players[index];
        const previousStreetBet = this.game.streetBet;
        const minRaiseIncrement = Math.max(BIG_BLIND, this.game.minRaise);
        const minValidTotal = previousStreetBet + minRaiseIncrement;
        const maxPossibleTotal = player.currentBet + player.chips;

        let target = Number(targetTotalBet);
        if (isNaN(target) || target < minValidTotal) {
            target = minValidTotal;
        }

        // Clamp to player's chip capacity
        if (target > maxPossibleTotal) {
            target = maxPossibleTotal;
        }

        const needed = target - player.currentBet;
        if (needed <= 0) {
            // Player already matches bet, treat as check/call
            return this.call(id);
        }

        player.chips -= needed;
        player.currentBet += needed;
        player.totalBet += needed;
        this.game.pot += needed;

        if (player.chips === 0) {
            player.allIn = true;
        }

        const raiseDiff = player.currentBet - previousStreetBet;

        if (player.currentBet > previousStreetBet) {
            this.game.streetBet = player.currentBet;
            if (raiseDiff >= minRaiseIncrement) {
                this.game.minRaise = raiseDiff;
            }

            // Reopen betting for all other non-folded, non-all-in players
            for (const other of this.game.players) {
                if (other.id !== player.id && !other.folded && !other.allIn) {
                    other.actedThisStreet = false;
                }
            }
        }

        player.actedThisStreet = true;
        const actionType = player.allIn ? "allIn" : "raise";
        const isBet = previousStreetBet === 0;
        const actionText = player.allIn
            ? `All-In (${player.currentBet})`
            : (isBet ? `Bet ${player.currentBet}` : `Raise to ${player.currentBet}`);

        player.lastAction = { type: actionType, text: actionText, amount: player.currentBet };
        this.game.lastAction = { playerId: player.id, name: player.name, type: actionType, text: actionText, amount: player.currentBet };

        this.log(`${player.name} ${isBet ? "bet" : "raised to"} ${player.currentBet}.`, "action");

        this.nextAction();
        return true;
    }

    roundComplete() {
        const active = this.activePlayers();
        if (active.length <= 1) return true;

        const actionable = this.actionablePlayers();
        if (actionable.length === 0) return true;

        // Round complete if all actionable players acted and all active bets match streetBet (or all-in)
        const allActionableActed = actionable.every(p => p.actedThisStreet);
        const allBetsMatched = actionable.every(p => p.currentBet === this.game.streetBet);

        return allActionableActed && allBetsMatched;
    }

    nextAction() {
        if (this.activePlayers().length <= 1) {
            return this.awardFoldWinner();
        }

        if (this.roundComplete()) {
            this.nextStreet();
            return;
        }

        // Find next actionable player clockwise
        for (let i = 1; i <= MAX_PLAYERS; i++) {
            const next = (this.game.currentPlayer + i) % MAX_PLAYERS;
            const player = this.game.players[next];

            if (player && !player.folded && !player.allIn && player.chips > 0) {
                this.game.currentPlayer = next;
                return;
            }
        }

        this.nextStreet();
    }

    nextStreet() {
        // Reset per-street betting counters
        for (const player of this.game.players) {
            player.currentBet = 0;
            player.actedThisStreet = false;
            player.lastAction = null;
        }

        this.game.streetBet = 0;
        this.game.minRaise = BIG_BLIND;

        if (this.game.phase === "preflop") {
            draw(this.game.deck); // Burn card
            this.game.communityCards.push(
                draw(this.game.deck),
                draw(this.game.deck),
                draw(this.game.deck)
            );
            this.game.phase = "flop";
            const c = this.game.communityCards.map(c => `${c.rank}${c.suit}`).join(" ");
            this.log(`🃏 Flop dealt: [ ${c} ]`, "deal");
        } else if (this.game.phase === "flop") {
            draw(this.game.deck); // Burn card
            const turnCard = draw(this.game.deck);
            this.game.communityCards.push(turnCard);
            this.game.phase = "turn";
            this.log(`🃏 Turn dealt: [ ${turnCard.rank}${turnCard.suit} ]`, "deal");
        } else if (this.game.phase === "turn") {
            draw(this.game.deck); // Burn card
            const riverCard = draw(this.game.deck);
            this.game.communityCards.push(riverCard);
            this.game.phase = "river";
            this.log(`🃏 River dealt: [ ${riverCard.rank}${riverCard.suit} ]`, "deal");
        } else {
            this.game.phase = "showdown";
            return this.showdown();
        }

        // Check if hand is in all-in runout mode
        if (this.actionablePlayers().length <= 1) {
            this.game.allInRunout = true;
            return;
        }

        // Set action starting from player left of dealer
        this.game.currentPlayer = (this.game.dealer + 1) % MAX_PLAYERS;
        this.skipInactive();
    }

    showdown() {
        const active = this.activePlayers();
        if (active.length === 0) return null;

        const pots = calculatePots(this.game.players);
        const overallWinners = new Map();
        const reveals = [];

        // Evaluate all active players' hands
        const evaluatedPlayers = active
            .filter(p => p.hand && p.hand[0] && p.hand[1])
            .map(p => {
                const evalResult = evaluateHand([...p.hand, ...this.game.communityCards]);
                return {
                    player: p,
                    eval: evalResult
                };
            });

        // Award each pot tier (Main Pot + Side Pots)
        for (const pot of pots) {
            const eligibleEvaluated = evaluatedPlayers.filter(ep =>
                pot.eligible.some(elig => elig.id === ep.player.id)
            );

            if (eligibleEvaluated.length === 0) continue;

            eligibleEvaluated.sort((a, b) => b.eval.value - a.eval.value);
            const bestValue = eligibleEvaluated[0].eval.value;
            const winners = eligibleEvaluated.filter(ep => ep.eval.value === bestValue);

            const share = Math.floor(pot.amount / winners.length);
            const remainder = pot.amount - (share * winners.length);

            winners.forEach((w, idx) => {
                const wonAmount = share + (idx === 0 ? remainder : 0);
                w.player.chips += wonAmount;

                const prev = overallWinners.get(w.player.id) || {
                    id: w.player.id,
                    name: w.player.name,
                    hand: w.eval.handName,
                    cards: w.eval.bestCards || w.player.hand,
                    holeCards: w.player.hand,
                    bestCards: w.eval.bestCards,
                    amount: 0
                };
                prev.amount += wonAmount;
                overallWinners.set(w.player.id, prev);
            });
        }

        const winnersList = Array.from(overallWinners.values());

        // Prepare reveals for showdown presentation
        for (const ep of evaluatedPlayers) {
            const isWinner = overallWinners.has(ep.player.id);
            reveals.push({
                id: ep.player.id,
                name: ep.player.name,
                hand: ep.eval.handName,
                cards: ep.player.hand,
                bestCards: ep.eval.bestCards,
                isWinner
            });
        }

        const totalPotWon = winnersList.reduce((sum, w) => sum + w.amount, 0);

        if (winnersList.length > 0) {
            const winNames = winnersList.map(w => w.name).join(" & ");
            const handDesc = winnersList[0].hand;
            this.log(`🏆 ${winNames} won ${totalPotWon} chips with ${handDesc}!`, "win");
        }

        const result = {
            pot: totalPotWon,
            winners: winnersList,
            reveals: reveals,
            isFoldWin: false
        };

        this.game.pot = 0;
        this.game.phase = "showdown";
        this.syncStacks();

        return result;
    }

    awardFoldWinner() {
        const winner = this.activePlayers()[0];
        if (!winner) return null;

        const amount = this.game.pot;
        winner.chips += amount;

        this.log(`🏆 ${winner.name} won ${amount} chips (all opponents folded).`, "win");

        const result = {
            pot: amount,
            winners: [{
                id: winner.id,
                name: winner.name,
                hand: "Opponents Folded",
                cards: winner.hand,
                amount: amount
            }],
            reveals: [{
                id: winner.id,
                name: winner.name,
                hand: "Opponents Folded",
                cards: winner.hand,
                isWinner: true
            }],
            isFoldWin: true
        };

        this.game.pot = 0;
        this.game.phase = "showdown";
        this.syncStacks();

        return result;
    }

    syncStacks() {
        for (const player of this.game.players) {
            if (player.bot) {
                const bot = this.bots.get(player.id);
                if (bot) bot.chips = player.chips;
            } else {
                const human = this.humans.get(player.id);
                if (human) human.chips = player.chips;
            }
        }
    }

    // ========================================
    // INTELLIGENT BOT DECISION ENGINE
    // ========================================
    botAction() {
        const player = this.current();
        if (!player || !player.bot) return null;

        const toCall = Math.max(0, this.game.streetBet - player.currentBet);
        const canCheck = (toCall === 0);
        const isPreflop = (this.game.phase === "preflop");
        const pot = this.game.pot;

        // Calculate hand strength score (0 to 100)
        let score = isPreflop
            ? getPreflopScore(player.hand)
            : getPostflopScore(player.hand, this.game.communityCards);

        // Profile adjustments
        let bluffChance = 0.10;
        let aggressionBonus = 0;

        if (player.style === "aggressive") {
            aggressionBonus = 10;
            bluffChance = 0.18;
        } else if (player.style === "tricky") {
            aggressionBonus = 5;
            bluffChance = 0.25;
        }

        score = Math.min(100, Math.max(0, score + aggressionBonus));
        const roll = Math.random();
        const minRaiseAmount = Math.max(BIG_BLIND, this.game.minRaise);

        // Case 1: Can Check for Free
        if (canCheck) {
            // Strong hand (score >= 75): 75% bet/raise, 25% check (trap)
            if (score >= 75) {
                if (roll < 0.75) {
                    const betSize = this.calcBotBet(player, pot);
                    this.raise(player.id, betSize);
                    return "raise";
                }
                this.check(player.id);
                return "check";
            }

            // Medium hand (score 50-74): 35% bet, 65% check
            if (score >= 50) {
                if (roll < 0.35) {
                    const betSize = this.calcBotBet(player, pot);
                    this.raise(player.id, betSize);
                    return "raise";
                }
                this.check(player.id);
                return "check";
            }

            // Weak hand: bluff roll can bet, otherwise ALWAYS CHECK (never fold on free check)
            if (roll < bluffChance) {
                const betSize = this.calcBotBet(player, pot);
                this.raise(player.id, betSize);
                return "raise";
            }

            this.check(player.id);
            return "check";
        }

        // Case 2: Facing a Bet/Raise (toCall > 0)
        const potOdds = toCall / (pot + toCall);

        // Monster hand (score >= 85): 60% re-raise, 40% call
        if (score >= 85) {
            if (roll < 0.60) {
                const raiseTarget = this.game.streetBet + this.calcBotBet(player, pot);
                this.raise(player.id, raiseTarget);
                return "raise";
            }
            this.call(player.id);
            return "call";
        }

        // Strong hand (score 68-84): 25% raise, 75% call
        if (score >= 68) {
            if (roll < 0.25) {
                const raiseTarget = this.game.streetBet + this.calcBotBet(player, pot);
                this.raise(player.id, raiseTarget);
                return "raise";
            }
            this.call(player.id);
            return "call";
        }

        // Medium hand (score 48-67): Call if reasonable price / good pot odds
        if (score >= 48) {
            const maxCallWilling = isPreflop ? BIG_BLIND * 3 : pot * 0.45;
            if (toCall <= maxCallWilling || potOdds < 0.30) {
                this.call(player.id);
                return "call";
            }
            this.fold(player.id);
            return "fold";
        }

        // Weak hand (score < 48): Bluff re-raise occasionally if small bet, else fold
        if (roll < (bluffChance * 0.5) && toCall <= BIG_BLIND * 2) {
            const raiseTarget = this.game.streetBet + minRaiseAmount * 2;
            this.raise(player.id, raiseTarget);
            return "raise";
        }

        this.fold(player.id);
        return "fold";
    }

    calcBotBet(player, pot) {
        const minRaise = Math.max(BIG_BLIND, this.game.minRaise);
        if (pot <= 0) return minRaise;

        // Bet between 40% and 75% of pot
        const fraction = 0.45 + (Math.random() * 0.30);
        let bet = Math.round(pot * fraction);
        bet = Math.max(minRaise, bet);

        return this.game.streetBet + bet;
    }
}

module.exports = PokerGame;
