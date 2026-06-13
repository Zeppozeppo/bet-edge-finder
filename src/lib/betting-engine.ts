// Betting Engine - Core logic for edge calculation and recommendations

export interface Game {
  id: string;
  sport: string;
  sportEmoji: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  startTime?: string;
  homeRecord?: string;
  awayRecord?: string;
  homeForm?: string;
  awayForm?: string;
}

export interface OddsData {
  gameId: string;
  overUnder?: number;
  overOdds?: number;
  underOdds?: number;
  homeML?: number;
  awayML?: number;
  spread?: number;
  favorite?: string;
}

export interface Recommendation {
  id: string;
  game: Game;
  odds: OddsData;
  pick: string;
  pickType: 'ML' | 'OVER' | 'UNDER' | 'SPREAD';
  confidence: number; // 1-5 stars
  edge: number; // percentage
  suggestedStake: number;
  potentialWin: number;
  reasoning: string;
}

// Convert American odds to decimal (European)
export function americanToDecimal(american: number): number {
  if (american > 0) {
    return (american / 100) + 1;
  } else {
    return (100 / Math.abs(american)) + 1;
  }
}

// Calculate implied probability from American odds
export function impliedProbability(american: number): number {
  if (american > 0) {
    return 100 / (american + 100);
  } else {
    return Math.abs(american) / (Math.abs(american) + 100);
  }
}

// Calculate edge: our estimated probability vs bookmaker's implied probability
export function calculateEdge(estimatedProb: number, americanOdds: number): number {
  const impliedProb = impliedProbability(americanOdds);
  return estimatedProb - impliedProb;
}

// Stake calculator based on bankroll and confidence
export function calculateStake(confidence: number, bankroll: number): number {
  const stakeMap: Record<number, { pct: number; label: string }> = {
    5: { pct: 0.10, label: '10%' },
    4: { pct: 0.07, label: '7%' },
    3: { pct: 0.05, label: '5%' },
    2: { pct: 0.03, label: '3%' },
    1: { pct: 0.02, label: '2%' },
  };
  const config = stakeMap[confidence] || stakeMap[3];
  const raw = bankroll * config.pct;
  return Math.max(1, Math.round(raw)); // Whole euros, min €1
}

// Analyze soccer game for O/U recommendations (SOCCER = ONLY O/U)
export function analyzeSoccerOU(game: Game, odds: OddsData, bankroll: number): Recommendation[] {
  const recs: Recommendation[] = [];
  
  if (!odds.overUnder || !odds.overOdds || !odds.underOdds) return recs;

  const currentGoals = game.homeScore + game.awayScore;
  const isLive = !game.status.includes('Scheduled') && !game.status.includes('0\'');
  const totalLine = odds.overUnder;
  
  // Under analysis - key factors
  let underProb = 0.5;
  let underReasons: string[] = [];
  
  // Form-based analysis
  if (game.homeForm && game.awayForm) {
    const homeDraws = (game.homeForm.match(/D/g) || []).length;
    const awayDraws = (game.awayForm.match(/D/g) || []).length;
    const homeLosses = (game.homeForm.match(/L/g) || []).length;
    const awayLosses = (game.awayForm.match(/L/g) || []).length;
    
    if (homeDraws >= 2 && awayDraws >= 2) {
      underProb += 0.12;
      underReasons.push('Entrambe tante D = difensive');
    }
    if (homeDraws + awayDraws >= 5) {
      underProb += 0.08;
      underReasons.push('5+ pareggi recenti');
    }
    if (homeLosses >= 2 && awayLosses >= 2) {
      underProb += 0.05;
      underReasons.push('Entrambe in difficoltà');
    }
  }

  // Live game under analysis
  if (isLive && currentGoals === 0) {
    underProb += 0.15;
    underReasons.push('0-0 live = Under probabile');
  }
  if (isLive && currentGoals <= 1) {
    underProb += 0.10;
    underReasons.push('Pochi gol live');
  }

  // Line-based analysis
  if (totalLine <= 2.0) {
    underProb += 0.10;
    underReasons.push('Linea bassa (≤2.0)');
  }
  if (totalLine <= 2.5) {
    underProb += 0.05;
    underReasons.push('Linea 2.5');
  }

  // Over analysis - key factors
  let overProb = 0.5;
  let overReasons: string[] = [];
  
  if (game.homeForm && game.awayForm) {
    const homeWins = (game.homeForm.match(/W/g) || []).length;
    const awayWins = (game.awayForm.match(/W/g) || []).length;
    
    if (homeWins >= 3 && awayWins >= 3) {
      overProb += 0.10;
      overReasons.push('Entrambe vincenti = gol');
    }
    if (homeWins >= 4 || awayWins >= 4) {
      overProb += 0.08;
      overReasons.push('Form attacco forte');
    }
  }

  if (isLive && currentGoals >= 2) {
    overProb += 0.15;
    overReasons.push('2+ gol già segnati');
  }
  if (totalLine >= 3.5) {
    overProb += 0.05;
    overReasons.push('Linea alta (3.5+)');
  }

  // Generate Under recommendation if edge > 3%
  const underEdge = calculateEdge(underProb, odds.underOdds);
  if (underEdge > 0.03 && underProb > 0.55) {
    const confidence = underEdge > 0.10 ? 5 : underEdge > 0.07 ? 4 : underEdge > 0.05 ? 3 : 2;
    const stake = calculateStake(confidence, bankroll);
    const decimalOdds = americanToDecimal(odds.underOdds);
    recs.push({
      id: `${game.id}-under`,
      game,
      odds,
      pick: `Under ${totalLine}`,
      pickType: 'UNDER',
      confidence,
      edge: underEdge,
      suggestedStake: stake,
      potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
      reasoning: underReasons.join('. ') || 'Analisi statistica favorevole Under',
    });
  }

  // Generate Over recommendation if edge > 3%
  const overEdge = calculateEdge(overProb, odds.overOdds);
  if (overEdge > 0.03 && overProb > 0.55) {
    const confidence = overEdge > 0.10 ? 5 : overEdge > 0.07 ? 4 : overEdge > 0.05 ? 3 : 2;
    const stake = calculateStake(confidence, bankroll);
    const decimalOdds = americanToDecimal(odds.overOdds);
    recs.push({
      id: `${game.id}-over`,
      game,
      odds,
      pick: `Over ${totalLine}`,
      pickType: 'OVER',
      confidence,
      edge: overEdge,
      suggestedStake: stake,
      potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
      reasoning: overReasons.join('. ') || 'Analisi statistica favorevole Over',
    });
  }

  return recs;
}

// Analyze non-soccer games (ML, Spread, O/U all allowed)
export function analyzeOtherSport(game: Game, odds: OddsData, bankroll: number): Recommendation[] {
  const recs: Recommendation[] = [];
  
  // First add O/U analysis if available
  if (odds.overUnder) {
    recs.push(...analyzeSoccerOU(game, odds, bankroll));
  }
  
  // ML analysis
  if (odds.homeML && odds.awayML) {
    const homeProb = impliedProbability(odds.homeML);
    const awayProb = impliedProbability(odds.awayML);
    
    // Check for record-based edge
    if (game.homeRecord && game.awayRecord) {
      const homeWinPct = parseRecordWinPct(game.homeRecord);
      const awayWinPct = parseRecordWinPct(game.awayRecord);
      
      // Strong team vs weak team
      if (homeWinPct > 0.6 && awayWinPct < 0.45 && odds.homeML < -120) {
        const edge = homeWinPct - homeProb;
        if (edge > 0.03) {
          const confidence = edge > 0.10 ? 5 : edge > 0.07 ? 4 : edge > 0.05 ? 3 : 2;
          const stake = calculateStake(confidence, bankroll);
          const decimalOdds = americanToDecimal(odds.homeML);
          recs.push({
            id: `${game.id}-home-ml`,
            game,
            odds,
            pick: `${game.homeTeam} ML`,
            pickType: 'ML',
            confidence,
            edge,
            suggestedStake: stake,
            potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
            reasoning: `${game.homeRecord} vs ${game.awayRecord}, squadra forte in casa`,
          });
        }
      }
      
      if (awayWinPct > 0.6 && homeWinPct < 0.45 && odds.awayML < -120) {
        const edge = awayWinPct - awayProb;
        if (edge > 0.03) {
          const confidence = edge > 0.10 ? 5 : edge > 0.07 ? 4 : edge > 0.05 ? 3 : 2;
          const stake = calculateStake(confidence, bankroll);
          const decimalOdds = americanToDecimal(odds.awayML);
          recs.push({
            id: `${game.id}-away-ml`,
            game,
            odds,
            pick: `${game.awayTeam} ML`,
            pickType: 'ML',
            confidence,
            edge,
            suggestedStake: stake,
            potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
            reasoning: `${game.awayRecord} vs ${game.homeRecord}, squadra forte fuori`,
          });
        }
      }
    }
  }
  
  return recs;
}

function parseRecordWinPct(record: string): number {
  // Parse "33-20" or "53-22-7" format
  const parts = record.split('-').map(Number);
  if (parts.length >= 2) {
    const wins = parts[0];
    const total = parts.reduce((a, b) => a + b, 0);
    return wins / total;
  }
  return 0.5;
}

// Main analyzer: route to correct sport analysis
export function analyzeGame(game: Game, odds: OddsData, bankroll: number): Recommendation[] {
  if (game.sport === 'soccer') {
    return analyzeSoccerOU(game, odds, bankroll);
  }
  return analyzeOtherSport(game, odds, bankroll);
}
