const crypto = require("crypto");
const { evalHand } = require("poker-evaluator");

const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const rankValues = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14
};

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
    const cloned = [...deck];
    for (let i = cloned.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
    }
    return cloned;
}

function draw(deck) {
    return deck.pop();
}

function toEvaluatorCard(card) {
    if (!card || !card.rank || !card.suit) return null;
    const suitMap = { "♠": "s", "♥": "h", "♦": "d", "♣": "c" };
    const rank = card.rank === "10" ? "T" : card.rank;
    return `${rank}${suitMap[card.suit] || "s"}`;
}

function getCombinations(cards, k) {
    if (k === 0) return [[]];
    if (cards.length === 0) return [];
    const head = cards[0];
    const tail = cards.slice(1);
    const withHead = getCombinations(tail, k - 1).map(c => [head, ...c]);
    const withoutHead = getCombinations(tail, k);
    return [...withHead, ...withoutHead];
}

function getBest5Cards(cards) {
    const validCards = (cards || []).filter(c => c && c.rank && c.suit);
    if (validCards.length < 5) return validCards;
    if (validCards.length === 5) return validCards;

    const combos = getCombinations(validCards, 5);
    let bestCombo = combos[0];
    let bestVal = -1;

    for (const combo of combos) {
        const formatted = combo.map(toEvaluatorCard).filter(Boolean);
        if (formatted.length === 5) {
            const res = evalHand(formatted);
            if (res.value > bestVal) {
                bestVal = res.value;
                bestCombo = combo;
            }
        }
    }

    // Sort by rank descending
    return bestCombo.slice().sort((a, b) => (rankValues[b.rank] || 0) - (rankValues[a.rank] || 0));
}

function evaluateHand(cards) {
    const validCards = (cards || []).filter(c => c && c.rank && c.suit);
    if (validCards.length < 5) {
        return { handType: 0, handRank: 0, value: 0, handName: "High Card", bestCards: validCards };
    }

    const best5 = getBest5Cards(validCards);
    const formatted = best5.map(toEvaluatorCard).filter(Boolean);
    if (formatted.length < 5) {
        return { handType: 0, handRank: 0, value: 0, handName: "High Card", bestCards: best5 };
    }

    const res = evalHand(formatted);
    return {
        handType: res.handType,
        handRank: res.handRank,
        value: res.value,
        handName: formatHandName(res.handName),
        bestCards: best5
    };
}

function formatHandName(rawName) {
    if (!rawName) return "High Card";
    const lower = rawName.toLowerCase().trim();
    const map = {
        "high card": "High Card",
        "one pair": "One Pair",
        "two pairs": "Two Pair",
        "two pair": "Two Pair",
        "three of a kind": "Three of a Kind",
        "straight": "Straight",
        "flush": "Flush",
        "full house": "Full House",
        "four of a kind": "Four of a Kind",
        "straight flush": "Straight Flush"
    };
    return map[lower] || rawName.charAt(0).toUpperCase() + rawName.slice(1);
}

// Preflop hand strength rating (0 - 100)
function getPreflopScore(holeCards) {
    if (!holeCards || holeCards.length < 2 || !holeCards[0] || !holeCards[1]) return 30;

    const r1 = rankValues[holeCards[0].rank] || 2;
    const r2 = rankValues[holeCards[1].rank] || 2;
    const high = Math.max(r1, r2);
    const low = Math.min(r1, r2);
    const isPair = (r1 === r2);
    const isSuited = (holeCards[0].suit === holeCards[1].suit);
    const gap = high - low;

    if (isPair) {
        return 50 + high * 3.5;
    }

    let score = (high * 3.5) + (low * 1.5);

    if (isSuited) score += 6;
    if (gap === 1) score += 5;
    else if (gap === 2) score += 3;

    return Math.min(95, Math.max(15, Math.round(score)));
}

// Postflop hand score rating (0 - 100) based on evaluation and board
function getPostflopScore(holeCards, communityCards) {
    if (!holeCards || holeCards.length < 2) return 20;
    if (!communityCards || communityCards.length === 0) return getPreflopScore(holeCards);

    const allCards = [...holeCards, ...communityCards];
    const evalResult = evaluateHand(allCards);

    const type = evalResult.handType;
    let baseScore = 20;

    switch (type) {
        case 9: baseScore = 98; break;
        case 8: baseScore = 96; break;
        case 7: baseScore = 90; break;
        case 6: baseScore = 84; break;
        case 5: baseScore = 78; break;
        case 4: baseScore = 72; break;
        case 3: baseScore = 60; break;
        case 2: baseScore = 42; break;
        default: baseScore = 22; break;
    }

    const r1 = rankValues[holeCards[0].rank] || 2;
    const r2 = rankValues[holeCards[1].rank] || 2;
    const high = Math.max(r1, r2);
    baseScore += Math.round((high / 14) * 6);

    return Math.min(99, Math.max(10, baseScore));
}

// Calculate main and side pots based on each player's total contribution
function calculatePots(players) {
    const contributors = players
        .filter(p => p && p.totalBet > 0)
        .map(p => ({
            id: p.id,
            name: p.name,
            totalBet: p.totalBet,
            folded: p.folded,
            hand: p.hand,
            player: p
        }));

    if (contributors.length === 0) return [];

    const pots = [];
    while (contributors.some(c => c.totalBet > 0)) {
        const activeContributors = contributors.filter(c => c.totalBet > 0);
        const minBet = Math.min(...activeContributors.map(c => c.totalBet));

        let potAmount = 0;
        const eligiblePlayers = [];

        for (const c of contributors) {
            if (c.totalBet > 0) {
                const take = Math.min(c.totalBet, minBet);
                c.totalBet -= take;
                potAmount += take;
                if (!c.folded) {
                    eligiblePlayers.push(c.player);
                }
            }
        }

        if (potAmount > 0) {
            pots.push({
                amount: potAmount,
                eligible: eligiblePlayers
            });
        }
    }

    return pots;
}

module.exports = {
    suits,
    ranks,
    rankValues,
    createDeck,
    shuffle,
    draw,
    toEvaluatorCard,
    getCombinations,
    getBest5Cards,
    evaluateHand,
    formatHandName,
    getPreflopScore,
    getPostflopScore,
    calculatePots
};
