const crypto = require("crypto");
const { evalHand } = require("poker-evaluator");

const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function createDeck() {
    const deck = [];
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push({ rank, suit });
        }
    }
    return deck;
}

function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function draw(deck) {
    return deck.pop();
}

function toEvaluatorCard(card) {
    const suitMap = { "♠": "s", "♥": "h", "♦": "d", "♣": "c" };
    const rank = card.rank === "10" ? "T" : card.rank;
    return `${rank}${suitMap[card.suit]}`;
}

function evaluateHand(cards) {
    return evalHand(cards.map(toEvaluatorCard));
}

function bestPlayer(players, communityCards) {
    // Safety check: Filter out folded players and ensure hand arrays are valid
    const results = players
        .filter(player => !player.folded && player.hand && player.hand[0])
        .map(player => {
            const cards = [...player.hand, ...communityCards];
            return {
                player: player,
                result: evaluateHand(cards)
            };
        });

    if (results.length === 0) return [];

    results.sort((a, b) => b.result.value - a.result.value);
    const winningValue = results[0].result.value;

    return results.filter(item => item.result.value === winningValue);
}

module.exports = {
    createDeck,
    shuffle,
    draw,
    evaluateHand,
    bestPlayer,
    toEvaluatorCard
};

