// Betting Engine - Core logic for edge calculation and recommendations
// This is the same engine but used client-side

export interface Game {
  id: string;
  sport: string;
  sportEmoji: string;
  league: string;
  leagueName: string;
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
  isLive: boolean;
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
  confidence: number;
  edge: number;
  suggestedStake: number;
  potentialWin: number;
  reasoning: string;
}

export function americanToDecimal(american: number): number {
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

export function impliedProbability(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

export function calculateEdge(estimatedProb: number, americanOdds: number): number {
  const impliedProb = impliedProbability(americanOdds);
  return estimatedProb - impliedProb;
}

export function calculateStake(confidence: number, bankroll: number): number {
  const stakeMap: Record<number, number> = { 5: 0.10, 4: 0.07, 3: 0.05, 2: 0.03, 1: 0.02 };
  const pct = stakeMap[confidence] || 0.05;
  return Math.max(1, Math.round(bankroll * pct));
}

function parseRecordWinPct(record: string): number {
  const parts = record.split('-').map(Number);
  if (parts.length >= 2) {
    return parts[0] / parts.reduce((a, b) => a + b, 0);
  }
  return 0.5;
}

export function analyzeGame(game: Game, odds: OddsData, bankroll: number): Recommendation[] {
  const recs: Recommendation[] = [];
  const currentGoals = game.homeScore + game.awayScore;
  const isLive = game.isLive;

  // ===== OVER/UNDER ANALYSIS =====
  if (odds.overUnder && odds.overOdds && odds.underOdds) {
    const totalLine = odds.overUnder;

    // Under analysis - punto base più basso per catturare più edge
    let underProb = 0.48;
    let underReasons: string[] = [];

    if (game.homeForm && game.awayForm) {
      const homeDraws = (game.homeForm.match(/D/g) || []).length;
      const awayDraws = (game.awayForm.match(/D/g) || []).length;
      const homeLosses = (game.homeForm.match(/L/g) || []).length;
      const awayLosses = (game.awayForm.match(/L/g) || []).length;
      // Squadre difensive (pareggi = partite chiuse)
      if (homeDraws >= 2 && awayDraws >= 2) { underProb += 0.12; underReasons.push('Entrambe difensive'); }
      if (homeDraws + awayDraws >= 5) { underProb += 0.08; underReasons.push('5+ pareggi recenti'); }
      // Squadre che perdono molto = partite sbilanciate con pochi gol
      if (homeLosses >= 3 && awayLosses >= 3) { underProb += 0.06; underReasons.push('Entrambe in crisi = partita bloccata'); }
    }

    if (isLive && currentGoals === 0) { underProb += 0.15; underReasons.push('0-0 live'); }
    if (isLive && currentGoals <= 1) { underProb += 0.10; underReasons.push('Pochi gol live'); }
    if (totalLine <= 2.0) { underProb += 0.10; underReasons.push('Linea bassa'); }
    if (totalLine <= 2.5) { underProb += 0.05; underReasons.push('Linea 2.5'); }

    // Record-based under edge
    if (game.homeRecord && game.awayRecord) {
      const homePct = parseRecordWinPct(game.homeRecord);
      const awayPct = parseRecordWinPct(game.awayRecord);
      if (homePct > 0.65 && awayPct < 0.35) {
        underProb += 0.08; underReasons.push(`${game.homeTeam} domina, partita controllata`);
      }
      // Squadre con record simile = partita equilibrata = meno gol
      if (Math.abs(homePct - awayPct) < 0.10 && homePct > 0.45 && homePct < 0.60) {
        underProb += 0.05; underReasons.push('Squadre equilibrate = partita tattica');
      }
    }

    // Campionato difensivo (Serie A, Ligue 1 tendono ad avere meno gol)
    const defensiveLeagues = ['ita.1', 'fra.1', 'por.1'];
    if (defensiveLeagues.includes(game.league)) {
      underProb += 0.04; underReasons.push('Campionato tendenzialmente Under');
    }

    // Over analysis - punto base più basso
    let overProb = 0.48;
    let overReasons: string[] = [];

    if (game.homeForm && game.awayForm) {
      const homeWins = (game.homeForm.match(/W/g) || []).length;
      const awayWins = (game.awayForm.match(/W/g) || []).length;
      if (homeWins >= 3 && awayWins >= 3) { overProb += 0.10; overReasons.push('Entrambe vincenti = gol'); }
      // Perdite = partite aperte con gol da entrambe le parti
      const homeLosses = (game.homeForm.match(/L/g) || []).length;
      const awayLosses = (game.awayForm.match(/L/g) || []).length;
      if (homeLosses >= 2 && awayLosses >= 2) { overProb += 0.06; overReasons.push('Entrambe subiscono gol'); }
    }

    if (isLive && currentGoals >= 2) { overProb += 0.15; overReasons.push('2+ gol già segnati'); }
    if (isLive && currentGoals >= 3) { overProb += 0.10; overReasons.push('3+ gol'); }
    if (totalLine >= 3.5) { overProb += 0.05; overReasons.push('Linea alta'); }
    if (totalLine >= 2.5) { overProb += 0.03; overReasons.push('Linea 2.5+'); }

    // Campionato offensivo (Bundesliga, Eredivisie)
    const offensiveLeagues = ['ger.1', 'ned.1', 'eng.1'];
    if (offensiveLeagues.includes(game.league)) {
      overProb += 0.04; overReasons.push('Campionato tendenzialmente Over');
    }

    // Under recommendation - soglia abbassata da 0.03 a 0.01, prob da 0.55 a 0.50
    const underEdge = calculateEdge(underProb, odds.underOdds);
    if (underEdge > 0.01 && underProb > 0.50) {
      const confidence = underEdge > 0.10 ? 5 : underEdge > 0.07 ? 4 : underEdge > 0.05 ? 3 : underEdge > 0.03 ? 2 : 1;
      const stake = calculateStake(confidence, bankroll);
      const decimalOdds = americanToDecimal(odds.underOdds);
      recs.push({
        id: `${game.id}-under`, game, odds,
        pick: `Under ${totalLine}`, pickType: 'UNDER',
        confidence, edge: underEdge,
        suggestedStake: stake,
        potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
        reasoning: underReasons.join('. ') || 'Analisi statistica Under',
      });
    }

    // Over recommendation - soglia abbassata
    const overEdge = calculateEdge(overProb, odds.overOdds);
    if (overEdge > 0.01 && overProb > 0.50) {
      const confidence = overEdge > 0.10 ? 5 : overEdge > 0.07 ? 4 : overEdge > 0.05 ? 3 : overEdge > 0.03 ? 2 : 1;
      const stake = calculateStake(confidence, bankroll);
      const decimalOdds = americanToDecimal(odds.overOdds);
      recs.push({
        id: `${game.id}-over`, game, odds,
        pick: `Over ${totalLine}`, pickType: 'OVER',
        confidence, edge: overEdge,
        suggestedStake: stake,
        potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
        reasoning: overReasons.join('. ') || 'Analisi statistica Over',
      });
    }
  }

  // ===== ML ANALYSIS - ORA ANCHE PER IL CALCIO =====
  if (odds.homeML && odds.awayML) {
    recs.push(...analyzeML(game, odds, bankroll));
  }

  // ===== SPREAD ANALYSIS =====
  if (odds.spread && odds.favorite) {
    recs.push(...analyzeSpread(game, odds, bankroll));
  }

  return recs;
}

function analyzeML(game: Game, odds: OddsData, bankroll: number): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!odds.homeML || !odds.awayML) return recs;

  // Analisi basata su record
  if (game.homeRecord && game.awayRecord) {
    const homeWinPct = parseRecordWinPct(game.homeRecord);
    const awayWinPct = parseRecordWinPct(game.awayRecord);

    // Casa: abbassata soglia da 0.6 a 0.55 e away da 0.45 a 0.50
    if (homeWinPct > 0.55 && awayWinPct < 0.50) {
      const edge = homeWinPct - impliedProbability(odds.homeML);
      // Bonus vantaggio casa per il calcio
      const homeBonus = game.sport === 'soccer' ? 0.05 : 0.02;
      const adjustedEdge = edge + homeBonus;
      if (adjustedEdge > 0.01) {
        const confidence = adjustedEdge > 0.10 ? 5 : adjustedEdge > 0.07 ? 4 : adjustedEdge > 0.05 ? 3 : adjustedEdge > 0.03 ? 2 : 1;
        const stake = calculateStake(confidence, bankroll);
        const decimalOdds = americanToDecimal(odds.homeML);
        recs.push({
          id: `${game.id}-home-ml`, game, odds,
          pick: `${game.homeTeam} ML`, pickType: 'ML',
          confidence, edge: adjustedEdge,
          suggestedStake: stake,
          potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
          reasoning: `${game.homeRecord} vs ${game.awayRecord}, forte in casa${game.sport === 'soccer' ? ' + bonus casa' : ''}`,
        });
      }
    }

    // Trasferta: soglie abbassate
    if (awayWinPct > 0.55 && homeWinPct < 0.50) {
      const edge = awayWinPct - impliedProbability(odds.awayML);
      if (edge > 0.01) {
        const confidence = edge > 0.10 ? 5 : edge > 0.07 ? 4 : edge > 0.05 ? 3 : edge > 0.03 ? 2 : 1;
        const stake = calculateStake(confidence, bankroll);
        const decimalOdds = americanToDecimal(odds.awayML);
        recs.push({
          id: `${game.id}-away-ml`, game, odds,
          pick: `${game.awayTeam} ML`, pickType: 'ML',
          confidence, edge,
          suggestedStake: stake,
          potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
          reasoning: `${game.awayRecord} vs ${game.homeRecord}, forte fuori`,
        });
      }
    }
  }

  // Analisi basata su form (anche senza record)
  if (game.homeForm && game.awayForm) {
    const homeWins = (game.homeForm.match(/W/g) || []).length;
    const homeTotal = game.homeForm.length;
    const awayWins = (game.awayForm.match(/W/g) || []).length;
    const awayTotal = game.awayForm.length;

    if (homeTotal >= 4 && awayTotal >= 4) {
      const homeFormPct = homeWins / homeTotal;
      const awayFormPct = awayWins / awayTotal;

      // Forma casa eccellente vs forma trasferta pessima
      if (homeFormPct > 0.6 && awayFormPct < 0.3 && odds.homeML) {
        const edge = homeFormPct - impliedProbability(odds.homeML) + (game.sport === 'soccer' ? 0.05 : 0.02);
        if (edge > 0.01) {
          const confidence = edge > 0.10 ? 5 : edge > 0.07 ? 4 : edge > 0.05 ? 3 : edge > 0.03 ? 2 : 1;
          const stake = calculateStake(confidence, bankroll);
          const decimalOdds = americanToDecimal(odds.homeML);
          recs.push({
            id: `${game.id}-home-ml-form`, game, odds,
            pick: `${game.homeTeam} ML`, pickType: 'ML',
            confidence, edge,
            suggestedStake: stake,
            potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
            reasoning: `Form ${game.homeForm} vs ${game.awayForm}, casa in grande stato`,
          });
        }
      }

      // Forma trasferta eccellente
      if (awayFormPct > 0.6 && homeFormPct < 0.3 && odds.awayML) {
        const edge = awayFormPct - impliedProbability(odds.awayML);
        if (edge > 0.01) {
          const confidence = edge > 0.10 ? 5 : edge > 0.07 ? 4 : edge > 0.05 ? 3 : edge > 0.03 ? 2 : 1;
          const stake = calculateStake(confidence, bankroll);
          const decimalOdds = americanToDecimal(odds.awayML);
          recs.push({
            id: `${game.id}-away-ml-form`, game, odds,
            pick: `${game.awayTeam} ML`, pickType: 'ML',
            confidence, edge,
            suggestedStake: stake,
            potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
            reasoning: `Form ${game.awayForm} vs ${game.homeForm}, ospite in grande stato`,
          });
        }
      }
    }
  }

  // Live ML: squadra in vantaggio con quota alta
  if (game.isLive && game.homeScore !== game.awayScore) {
    const homeLeading = game.homeScore > game.awayScore;
    const mlOdds = homeLeading ? odds.homeML : odds.awayML;
    const leadingTeam = homeLeading ? game.homeTeam : game.awayTeam;
    if (mlOdds && mlOdds > 0) { // underdog che sta vincendo
      const liveProb = 0.60 + Math.abs(game.homeScore - game.awayScore) * 0.10;
      const edge = liveProb - impliedProbability(mlOdds);
      if (edge > 0.01) {
        const confidence = edge > 0.10 ? 5 : edge > 0.07 ? 4 : edge > 0.05 ? 3 : 2;
        const stake = calculateStake(confidence, bankroll);
        const decimalOdds = americanToDecimal(mlOdds);
        recs.push({
          id: `${game.id}-live-ml`, game, odds,
          pick: `${leadingTeam} ML`, pickType: 'ML',
          confidence, edge,
          suggestedStake: stake,
          potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
          reasoning: `LIVE ${game.homeScore}-${game.awayScore}, ${leadingTeam} in vantaggio`,
        });
      }
    }
  }

  return recs;
}

function analyzeSpread(game: Game, odds: OddsData, bankroll: number): Recommendation[] {
  const recs: Recommendation[] = [];
  if (!odds.spread || !odds.favorite) return recs;

  // Parse spread (e.g. "-3.5" means favorite gives 3.5 points)
  const spreadNum = parseFloat(odds.spread);
  if (isNaN(spreadNum) || spreadNum === 0) return recs;

  const isHomeFav = odds.favorite?.includes(game.homeTeam);
  const favTeam = isHomeFav ? game.homeTeam : game.awayTeam;
  const underdogTeam = isHomeFav ? game.awayTeam : game.homeTeam;

  // Record-based spread analysis
  if (game.homeRecord && game.awayRecord) {
    const homePct = parseRecordWinPct(game.homeRecord);
    const awayPct = parseRecordWinPct(game.awayRecord);

    // Favorite should cover spread
    if (isHomeFav && homePct > 0.65 && Math.abs(spreadNum) <= 7) {
      const favProb = homePct * 0.85; // Cover rate is lower than win rate
      const edge = favProb - 0.52; // Spread is roughly 50/50 by design
      if (edge > 0.01) {
        const confidence = edge > 0.08 ? 4 : edge > 0.05 ? 3 : 2;
        const stake = calculateStake(confidence, bankroll);
        const spreadOdds = odds.homeML || -110; // fallback
        const decimalOdds = americanToDecimal(spreadOdds);
        recs.push({
          id: `${game.id}-spread-fav`, game, odds,
          pick: `${favTeam} ${odds.spread}`, pickType: 'SPREAD',
          confidence, edge,
          suggestedStake: stake,
          potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
          reasoning: `${game.homeRecord} vs ${game.awayRecord}, ${favTeam} copre lo spread`,
        });
      }
    }

    // Underdog with spread (getting points)
    if (!isHomeFav && awayPct > 0.45 && Math.abs(spreadNum) >= 3) {
      const dogProb = 0.50 + (Math.abs(spreadNum) * 0.03); // Bigger spread = more value for dog
      const edge = dogProb - 0.50;
      if (edge > 0.01) {
        const confidence = edge > 0.08 ? 4 : edge > 0.05 ? 3 : 2;
        const stake = calculateStake(confidence, bankroll);
        const spreadOdds = odds.awayML || -110;
        const decimalOdds = americanToDecimal(spreadOdds);
        recs.push({
          id: `${game.id}-spread-dog`, game, odds,
          pick: `${underdogTeam} +${Math.abs(spreadNum)}`, pickType: 'SPREAD',
          confidence, edge,
          suggestedStake: stake,
          potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
          reasoning: `${underdogTeam} prende ${Math.abs(spreadNum)} punti, valore sottovalutato`,
        });
      }
    }
  }

  // Live spread: if favorite is trailing, spread value increases
  if (game.isLive && isHomeFav && game.homeScore < game.awayScore) {
    const deficit = game.awayScore - game.homeScore;
    if (deficit <= Math.abs(spreadNum)) {
      const liveProb = 0.55 + (Math.abs(spreadNum) - deficit) * 0.05;
      const edge = liveProb - 0.50;
      if (edge > 0.01) {
        const confidence = edge > 0.08 ? 4 : edge > 0.05 ? 3 : 2;
        const stake = calculateStake(confidence, bankroll);
        const spreadOdds = odds.homeML || -110;
        const decimalOdds = americanToDecimal(spreadOdds);
        recs.push({
          id: `${game.id}-live-spread`, game, odds,
          pick: `${favTeam} ${odds.spread}`, pickType: 'SPREAD',
          confidence, edge,
          suggestedStake: stake,
          potentialWin: Math.round((stake * decimalOdds - stake) * 100) / 100,
          reasoning: `LIVE ${game.homeScore}-${game.awayScore}, ${favTeam} sotto ma copre spread`,
        });
      }
    }
  }

  return recs;
}

// ===== FAST LIVE SCORE SOURCES =====
// These sources update faster than ESPN because they're connected to bookmakers/exchanges

export interface FastLiveScore {
  id: string
  source: 'api-football' | 'football-data' | 'scorebat' | 'espn'
  sport: string
  leagueName: string
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  status: string
  minute?: number
  isLive: boolean
  isFinished: boolean
  espnId?: string
}

// ScoreBat — 100% FREE, NO API KEY NEEDED, NO REGISTRATION
// Provides live soccer scores with video highlights
// Updates faster than ESPN (connected to multiple bookmaker feeds)
export async function fetchFastLiveScores_ScoreBat(): Promise<FastLiveScore[]> {
  const scores: FastLiveScore[] = []

  try {
    // ScoreBat free API - returns live match data with scores
    const res = await fetch('https://www.scorebat.com/api/v3/feed/')
    if (!res.ok) return scores
    const data = await res.json()

    for (const match of data.response || []) {
      if (!match) continue

      const homeTeam = match.team1 || match.homeTeam || ''
      const awayTeam = match.team2 || match.awayTeam || ''
      if (!homeTeam || !awayTeam) continue

      // Parse score from "1 - 0" format
      const scoreStr = match.score || match.result || ''
      const scoreParts = scoreStr.split(/\s*[-:]\s*/)
      const homeScore = parseInt(scoreParts[0]) || 0
      const awayScore = parseInt(scoreParts[1]) || 0

      const status = match.status || match.matchStatus || ''
      const minute = match.minute || match.matchTime
      const isLive = match.live || match.isLive || 
                     (typeof minute === 'string' && minute.includes("'")) ||
                     status.toLowerCase().includes('live') ||
                     status.toLowerCase().includes('in play')

      scores.push({
        id: `sb-${match.id || Math.random().toString(36).slice(2)}`,
        source: 'scorebat',
        sport: 'soccer',
        leagueName: match.competition || match.league || match.tournament || '',
        homeTeam,
        awayTeam,
        homeScore,
        awayScore,
        status: typeof minute === 'string' && minute.includes("'") ? minute : status,
        minute: typeof minute === 'number' ? minute : undefined,
        isLive: !!isLive,
        isFinished: status.toLowerCase().includes('finished') || status.toLowerCase().includes('ft'),
      })
    }
  } catch (e) {
    console.error('ScoreBat fetch error:', e)
  }

  return scores
}

// TheSportsDB — FREE, NO KEY NEEDED for live scores
// Covers multiple sports: soccer, basketball, baseball, hockey
export async function fetchFastLiveScores_TheSportsDB(): Promise<FastLiveScore[]> {
  const scores: FastLiveScore[] = []

  try {
    // Get live soccer scores
    const res = await fetch('https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=LIVE&s=Soccer')
    if (res.ok) {
      const data = await res.json()
      for (const ev of data.event || []) {
        const homeScore = parseInt(ev.intHomeScore || '0') || 0
        const awayScore = parseInt(ev.intAwayScore || '0') || 0
        const status = ev.strStatus || ''
        const minute = ev.intProgress ? `${ev.intProgress}'` : undefined
        const isLive = status === 'Live' || status === '1H' || status === '2H' || status === 'HT' || !!ev.intProgress

        scores.push({
          id: `tsdb-${ev.idEvent}`,
          source: 'scorebat', // reuse the source type for free sources
          sport: 'soccer',
          leagueName: ev.strLeague || '',
          homeTeam: ev.strHomeTeam || 'TBD',
          awayTeam: ev.strAwayTeam || 'TBD',
          homeScore,
          awayScore,
          status: minute || status,
          isLive,
          isFinished: status === 'FT' || status === 'Finished',
        })
      }
    }
  } catch (e) {
    console.error('TheSportsDB soccer fetch error:', e)
  }

  try {
    // Get live basketball scores  
    const res = await fetch('https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=LIVE&s=Basketball')
    if (res.ok) {
      const data = await res.json()
      for (const ev of data.event || []) {
        const homeScore = parseInt(ev.intHomeScore || '0') || 0
        const awayScore = parseInt(ev.intAwayScore || '0') || 0
        const status = ev.strStatus || ''
        const isLive = status === 'Live' || status === '1Q' || status === '2Q' || status === '3Q' || status === '4Q'

        scores.push({
          id: `tsdb-bb-${ev.idEvent}`,
          source: 'scorebat',
          sport: 'basketball',
          leagueName: ev.strLeague || 'NBA',
          homeTeam: ev.strHomeTeam || 'TBD',
          awayTeam: ev.strAwayTeam || 'TBD',
          homeScore,
          awayScore,
          status,
          isLive,
          isFinished: status === 'FT' || status === 'Finished',
        })
      }
    }
  } catch (e) {
    console.error('TheSportsDB basketball fetch error:', e)
  }

  return scores
}

// API-Football via RapidAPI - Free tier: 100 req/day
// Updates near real-time (faster than ESPN, connected to bookmakers)
// Covers: soccer, basketball, baseball, hockey, etc.
export async function fetchFastLiveScores_ApiFootball(rapidApiKey: string): Promise<FastLiveScore[]> {
  const scores: FastLiveScore[] = []

  try {
    // Fetch all live soccer fixtures in one request
    const res = await fetch('https://api-football-v1.p.rapidapi.com/v3/fixtures?live=all', {
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
      },
    })
    if (!res.ok) return scores
    const data = await res.json()

    for (const fixture of data.response || []) {
      const fg = fixture.fixture
      const teams = fixture.teams
      const goals = fixture.goals
      const league = fixture.league

      if (!fg || !teams?.home || !teams?.away) continue

      const status = fg.status?.short || ''
      const isLive = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'].includes(status)
      const isFinished = ['FT', 'AET', 'PEN', 'AWD', 'WO'].includes(status)

      scores.push({
        id: `af-${fg.id}`,
        source: 'api-football',
        sport: 'soccer',
        leagueName: league?.name || 'Unknown',
        homeTeam: teams.home.name || 'TBD',
        awayTeam: teams.away.name || 'TBD',
        homeScore: goals?.home || 0,
        awayScore: goals?.away || 0,
        status: fg.status?.long || status,
        minute: fg.status?.elapsed,
        isLive,
        isFinished,
      })
    }
  } catch (e) {
    console.error('API-Football fetch error:', e)
  }

  // Also fetch live basketball (NBA)
  try {
    const res = await fetch('https://api-basketball-v1.p.rapidapi.com/games?live=all', {
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': 'api-basketball-v1.p.rapidapi.com',
      },
    })
    if (res.ok) {
      const data = await res.json()
      for (const game of data.response || []) {
        const status = game.status?.short || ''
        const isLive = ['1Q', '2Q', '3Q', '4Q', 'OT', 'HT'].includes(status)
        const isFinished = status === 'FT'

        scores.push({
          id: `ab-${game.id}`,
          source: 'api-football',
          sport: 'basketball',
          leagueName: game.league?.name || 'NBA',
          homeTeam: game.teams?.home?.name || 'TBD',
          awayTeam: game.teams?.away?.name || 'TBD',
          homeScore: game.scores?.home?.total || 0,
          awayScore: game.scores?.away?.total || 0,
          status: game.status?.long || status,
          isLive,
          isFinished,
        })
      }
    }
  } catch (e) {
    console.error('API-Basketball fetch error:', e)
  }

  // Also fetch live baseball (MLB)
  try {
    const res = await fetch('https://api-baseball-v1.p.rapidapi.com/games?live=all', {
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': 'api-baseball-v1.p.rapidapi.com',
      },
    })
    if (res.ok) {
      const data = await res.json()
      for (const game of data.response || []) {
        const status = game.status?.short || ''
        const isLive = ['1Q', '2Q', '3Q', '4Q', 'OT', 'HT', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'IN9'].some(s => status.includes(s))
        const isFinished = status === 'FT' || status === 'AWD'

        scores.push({
          id: `abbl-${game.id}`,
          source: 'api-football',
          sport: 'baseball',
          leagueName: game.league?.name || 'MLB',
          homeTeam: game.teams?.home?.name || 'TBD',
          awayTeam: game.teams?.away?.name || 'TBD',
          homeScore: game.scores?.home?.total || 0,
          awayScore: game.scores?.away?.total || 0,
          status: game.status?.long || status,
          isLive,
          isFinished,
        })
      }
    }
  } catch (e) {
    console.error('API-Baseball fetch error:', e)
  }

  // Also fetch live hockey (NHL)
  try {
    const res = await fetch('https://api-hockey-v1.p.rapidapi.com/games?live=all', {
      headers: {
        'X-RapidAPI-Key': rapidApiKey,
        'X-RapidAPI-Host': 'api-hockey-v1.p.rapidapi.com',
      },
    })
    if (res.ok) {
      const data = await res.json()
      for (const game of data.response || []) {
        const status = game.status?.short || ''
        const isLive = ['1P', '2P', '3P', 'OT', 'SO'].includes(status)
        const isFinished = status === 'FT' || status === 'AWD'

        scores.push({
          id: `ahk-${game.id}`,
          source: 'api-football',
          sport: 'hockey',
          leagueName: game.league?.name || 'NHL',
          homeTeam: game.teams?.home?.name || 'TBD',
          awayTeam: game.teams?.away?.name || 'TBD',
          homeScore: game.scores?.home || 0,
          awayScore: game.scores?.away || 0,
          status: game.status?.long || status,
          isLive,
          isFinished,
        })
      }
    }
  } catch (e) {
    console.error('API-Hockey fetch error:', e)
  }

  return scores
}

// football-data.org - Free tier: 10 req/min
// Soccer only, updates every ~30 seconds (faster than ESPN)
export async function fetchFastLiveScores_FootballData(apiToken: string): Promise<FastLiveScore[]> {
  const scores: FastLiveScore[] = []

  try {
    const res = await fetch('https://api.football-data.org/v4/matches?status=LIVE', {
      headers: { 'X-Auth-Token': apiToken },
    })
    if (!res.ok) return scores
    const data = await res.json()

    for (const match of data.matches || []) {
      const status = match.status || ''
      const isLive = ['IN_PLAY', 'PAUSED', 'HALFTIME', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'].includes(status)
      const isFinished = ['FINISHED', 'AWARDED'].includes(status)
      const minute = match.minute

      scores.push({
        id: `fd-${match.id}`,
        source: 'football-data',
        sport: 'soccer',
        leagueName: match.competition?.name || 'Unknown',
        homeTeam: match.homeTeam?.shortName || match.homeTeam?.name || 'TBD',
        awayTeam: match.awayTeam?.shortName || match.awayTeam?.name || 'TBD',
        homeScore: match.score?.fullTime?.home ?? match.score?.halfTime?.home ?? 0,
        awayScore: match.score?.fullTime?.away ?? match.score?.halfTime?.away ?? 0,
        status: status === 'IN_PLAY' ? 'Live' : status === 'PAUSED' ? 'Intervallo' : status === 'HALFTIME' ? 'Intervallo' : status,
        minute: minute || undefined,
        isLive,
        isFinished,
      })
    }
  } catch (e) {
    console.error('football-data.org fetch error:', e)
  }

  return scores
}

// Match fast scores to ESPN games by team name similarity
export function matchFastScoreToGame(game: Game, fastScores: FastLiveScore[]): FastLiveScore | null {
  // Try exact team name match first
  for (const fs of fastScores) {
    if (fs.sport !== game.sport) continue
    const homeMatch = fs.homeTeam.toLowerCase().includes(game.homeTeam.toLowerCase()) ||
                      game.homeTeam.toLowerCase().includes(fs.homeTeam.toLowerCase())
    const awayMatch = fs.awayTeam.toLowerCase().includes(game.awayTeam.toLowerCase()) ||
                      game.awayTeam.toLowerCase().includes(fs.awayTeam.toLowerCase())
    if (homeMatch && awayMatch) return fs
  }
  return null
}

// Merge fast scores into existing games - prefer fast source scores when available
export function mergeFastScores(games: Game[], fastScores: FastLiveScore[]): Game[] {
  return games.map(game => {
    const fastScore = matchFastScoreToGame(game, fastScores)
    if (!fastScore) return game

    // Use fast source score if it's different/more recent
    const scoreChanged = fastScore.homeScore !== game.homeScore || fastScore.awayScore !== game.awayScore
    if (scoreChanged || fastScore.isLive) {
      return {
        ...game,
        homeScore: fastScore.homeScore,
        awayScore: fastScore.awayScore,
        status: fastScore.minute ? `${fastScore.minute}'` : game.status,
        isLive: fastScore.isLive,
        _fastSource: fastScore.source, // Track which source provided the fast data
      } as Game & { _fastSource?: string }
    }
    return game
  })
}

// ===== DATA FETCHING (client-side) =====

const SPORTS_CONFIG = [
  // Top 5 europei
  { sport: 'soccer', league: 'eng.1', name: 'Premier League', emoji: '⚽' },
  { sport: 'soccer', league: 'ita.1', name: 'Serie A', emoji: '⚽' },
  { sport: 'soccer', league: 'esp.1', name: 'La Liga', emoji: '⚽' },
  { sport: 'soccer', league: 'ger.1', name: 'Bundesliga', emoji: '⚽' },
  { sport: 'soccer', league: 'fra.1', name: 'Ligue 1', emoji: '⚽' },
  // Coppe europee
  { sport: 'soccer', league: 'uefa.champions', name: 'Champions League', emoji: '🏆' },
  { sport: 'soccer', league: 'uefa.europa', name: 'Europa League', emoji: '🏆' },
  { sport: 'soccer', league: 'uefa.europa.conf', name: 'Conference League', emoji: '🏆' },
  // Seconde divisioni
  { sport: 'soccer', league: 'eng.2', name: 'Championship', emoji: '⚽' },
  { sport: 'soccer', league: 'ita.2', name: 'Serie B', emoji: '⚽' },
  { sport: 'soccer', league: 'esp.2', name: 'La Liga 2', emoji: '⚽' },
  { sport: 'soccer', league: 'ger.2', name: '2. Bundesliga', emoji: '⚽' },
  { sport: 'soccer', league: 'fra.2', name: 'Ligue 2', emoji: '⚽' },
  // Altre leghe europee
  { sport: 'soccer', league: 'por.1', name: 'Liga Portugal', emoji: '⚽' },
  { sport: 'soccer', league: 'ned.1', name: 'Eredivisie', emoji: '⚽' },
  { sport: 'soccer', league: 'bel.1', name: 'Pro League', emoji: '⚽' },
  { sport: 'soccer', league: 'tur.1', name: 'Süper Lig', emoji: '⚽' },
  { sport: 'soccer', league: 'swe.1', name: 'Allsvenskan', emoji: '⚽' },
  { sport: 'soccer', league: 'nor.1', name: 'Eliteserien', emoji: '⚽' },
  { sport: 'soccer', league: 'den.1', name: 'Superliga', emoji: '⚽' },
  { sport: 'soccer', league: 'irl.1', name: 'League of Ireland', emoji: '⚽' },
  { sport: 'soccer', league: 'sui.1', name: 'Super League', emoji: '⚽' },
  { sport: 'soccer', league: 'aut.1', name: 'Bundesliga (AUT)', emoji: '⚽' },
  { sport: 'soccer', league: 'pol.1', name: 'Ekstraklasa', emoji: '⚽' },
  { sport: 'soccer', league: 'cze.1', name: 'First League', emoji: '⚽' },
  { sport: 'soccer', league: 'gre.1', name: 'Super League', emoji: '⚽' },
  { sport: 'soccer', league: 'rus.1', name: 'Premier League (RUS)', emoji: '⚽' },
  // Americhe
  { sport: 'soccer', league: 'bra.1', name: 'Brasileirão', emoji: '⚽' },
  { sport: 'soccer', league: 'arg.1', name: 'Liga Profesional', emoji: '⚽' },
  { sport: 'soccer', league: 'mex.1', name: 'Liga MX', emoji: '⚽' },
  { sport: 'soccer', league: 'usa.1', name: 'MLS', emoji: '⚽' },
  { sport: 'soccer', league: 'concacaf.champions', name: 'CONCACAF CL', emoji: '🏆' },
  // Asia
  { sport: 'soccer', league: 'jpn.1', name: 'J-League', emoji: '⚽' },
  { sport: 'soccer', league: 'kor.1', name: 'K League', emoji: '⚽' },
  { sport: 'soccer', league: 'chn.1', name: 'Super League', emoji: '⚽' },
  // Altri sport
  { sport: 'baseball', league: 'mlb', name: 'MLB', emoji: '⚾' },
  { sport: 'hockey', league: 'nhl', name: 'NHL', emoji: '🏒' },
  { sport: 'basketball', league: 'nba', name: 'NBA', emoji: '🏀' },
  { sport: 'basketball', league: 'wnba', name: 'WNBA', emoji: '🏀' },
  { sport: 'football', league: 'nfl', name: 'NFL', emoji: '🏈' },
  { sport: 'football', league: 'cfb', name: 'NCAAF', emoji: '🏈' },
];

export async function fetchAllGames(sportFilter: string = 'all'): Promise<Game[]> {
  const configs = sportFilter === 'all'
    ? SPORTS_CONFIG
    : SPORTS_CONFIG.filter(c => c.sport === sportFilter);

  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();

      const games: Game[] = [];
      for (const ev of data.events || []) {
        const comps = ev.competitions?.[0];
        if (!comps) continue;

        const status = ev.status?.type?.shortDetail || '';
        const statusCode = ev.status?.type?.name || '';
        const isUpcoming = status.includes('Scheduled') || status === "0'" || status === 'TBD' || statusCode === 'STATUS_SCHEDULED';
        const isFinished = status.includes('FT') || status.includes('Final') || status.includes('AET') || status.includes('PEN') || status.includes('Postponed') || status.includes('Cancel') || status.includes('Suspended') || status.includes('Delay') || status.includes('AWD') || status.includes('WO') || statusCode === 'STATUS_FINAL' || statusCode === 'STATUS_POSTPONED' || statusCode === 'STATUS_CANCELED' || statusCode === 'STATUS_SUSPENDED';
        const isLive = !isUpcoming && !isFinished;

        if (!isLive && !isUpcoming) continue;

        const competitors = comps.competitors || [];
        if (competitors.length < 2) continue;

        const home = competitors.find((c: { homeAway: string }) => c.homeAway === 'home') || competitors[0];
        const away = competitors.find((c: { homeAway: string }) => c.homeAway === 'away') || competitors[1];

        games.push({
          id: String(ev.id),
          sport: config.sport,
          sportEmoji: config.emoji,
          league: config.league,
          leagueName: config.name,
          homeTeam: home.team?.shortDisplayName || 'TBD',
          awayTeam: away.team?.shortDisplayName || 'TBD',
          homeScore: parseInt(home.score || '0'),
          awayScore: parseInt(away.score || '0'),
          status,
          startTime: ev.date || '',
          homeRecord: home.records?.[0]?.summary || '',
          awayRecord: away.records?.[0]?.summary || '',
          homeForm: home.form || '',
          awayForm: away.form || '',
          isLive,
        });
      }
      return games;
    })
  );

  let allGames: Game[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') allGames = allGames.concat(r.value);
  }
  return allGames;
}

export async function fetchGameOdds(sport: string, league: string, eventId: string): Promise<OddsData | null> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${eventId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    // Prova pickcenter (primo provider)
    let pick = data.pickcenter?.[0];
    
    // Se il primo non ha O/U, prova gli altri provider
    if (!pick?.overUnder && data.pickcenter) {
      for (const p of data.pickcenter) {
        if (p.overUnder) { pick = p; break; }
      }
    }
    
    // Fallback: prova da winsProjections (alternate odds source)
    if (!pick?.overUnder) {
      const wp = data.winsProjections?.[0];
      if (wp) {
        pick = pick || {};
        pick.overUnder = pick.overUnder || wp.overUnder;
        pick.overOdds = pick.overOdds || wp.overOdds;
        pick.underOdds = pick.underOdds || wp.underOdds;
      }
    }
    
    if (!pick) return null;

    return {
      gameId: eventId,
      overUnder: pick.overUnder,
      overOdds: pick.overOdds,
      underOdds: pick.underOdds,
      homeML: pick.homeTeamOdds?.moneyLine,
      awayML: pick.awayTeamOdds?.moneyLine,
      spread: pick.spread,
      favorite: pick.details,
    };
  } catch {
    return null;
  }
}

export async function fetchAllRecommendations(bankroll: number, sportFilter: string = 'all'): Promise<Recommendation[]> {
  const games = await fetchAllGames(sportFilter);
  
  // Fetch odds for all games (limit parallel requests)
  const oddsPromises = games.map(g => fetchGameOdds(g.sport, g.league, g.id));
  const oddsResults = await Promise.allSettled(oddsPromises);

  const allRecs: Recommendation[] = [];
  const leagueBetCount: Record<string, number> = {};

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const odds = oddsResults[i].status === 'fulfilled' ? oddsResults[i].value : null;
    if (!odds) continue;

    const recs = analyzeGame(game, odds, bankroll);
    for (const rec of recs) {
      const count = leagueBetCount[game.league] || 0;
      if (count >= 4) continue; // Aumentato da 2 a 4 pick per lega
      leagueBetCount[game.league] = count + 1;
      allRecs.push(rec);
    }
  }

  allRecs.sort((a, b) => b.edge - a.edge);
  return allRecs;
}
