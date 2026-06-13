'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { RefreshCw, TrendingUp, TrendingDown, Wallet, Zap, Target, AlertTriangle, RotateCcw, FlaskConical, Settings, Bolt, X } from 'lucide-react'
import {
  fetchAllGames, fetchAllRecommendations, americanToDecimal,
  fetchFastLiveScores_ApiFootball, fetchFastLiveScores_FootballData,
  fetchFastLiveScores_ScoreBat, fetchFastLiveScores_TheSportsDB,
  mergeFastScores, matchFastScoreToGame,
  type Game, type OddsData, type Recommendation, type FastLiveScore
} from '@/lib/betting-engine-client'

interface BetRecord {
  id: string
  pick: string
  stake: number
  quota: number
  result: 'pending' | 'won' | 'lost'
  date: string
  betType: 'played' | 'simulated' // NUOVO: distingue GIOCA da SIMULA
  // Simulation data
  gameId: string
  sport: string
  league: string
  pickType: 'ML' | 'OVER' | 'UNDER' | 'SPREAD'
  overUnder?: number
  homeTeam: string
  awayTeam: string
  pickedTeam?: string 
}

interface SimResult {
  betId: string
  homeScore: number
  awayScore: number
  status: string
  isLive: boolean
  isFinished: boolean
  wouldWin: boolean | null 
  reason: string
}

const DEFAULT_BANKROLL = 150

// Load from localStorage
function loadState<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) : fallback
  } catch {
    return fallback
  }
}

// Save to localStorage
function saveState(key: string, value: any) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

function confidenceStars(n: number): string { return '⭐'.repeat(n) }

function edgeColor(edge: number): string {
  if (edge > 0.08) return 'text-emerald-400'
  if (edge > 0.05) return 'text-green-400'
  if (edge > 0.03) return 'text-yellow-400'
  return 'text-orange-400'
}

function pickTypeColor(type: string): string {
  switch (type) {
    case 'UNDER': return 'bg-blue-600/20 text-blue-400 border-blue-600/30'
    case 'OVER': return 'bg-amber-600/20 text-amber-400 border-amber-600/30'
    case 'ML': return 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30'
    case 'SPREAD': return 'bg-purple-600/20 text-purple-400 border-purple-600/30'
    default: return 'bg-gray-600/20 text-gray-300 border-gray-600/30'
  }
}

export default function Home() {
  const [bankroll, setBankroll] = useState(DEFAULT_BANKROLL)
  const [games, setGames] = useState<Game[]>([])
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [bets, setBets] = useState<BetRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [recLoading, setRecLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState('')
  const [activeTab, setActiveTab] = useState('recommendations')
  const [sportFilter, setSportFilter] = useState('all')
  const [mounted, setMounted] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [simResults, setSimResults] = useState<Record<string, SimResult>>({})
  const [showSettings, setShowSettings] = useState(false)
  const [rapidApiKey, setRapidApiKey] = useState('')
  const [footballDataToken, setFootballDataToken] = useState('')
  const [bet365Key, setBet365Key] = useState('')
  const [fastScores, setFastScores] = useState<FastLiveScore[]>([])
  const [fetchingFast, setFetchingFast] = useState(false)

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const PULL_THRESHOLD = 80

  // Load saved state on mount
  useEffect(() => {
    const savedBankroll = loadState<number>('bef-bankroll', DEFAULT_BANKROLL)
    const savedBets = loadState<BetRecord[]>('bef-bets', [])
    const savedRapidKey = loadState<string>('bef-rapidapi-key', '')
    const savedFdToken = loadState<string>('bef-footballdata-token', '')
    const savedBet365Key = loadState<string>('bef-bet365-key', '')
    const migratedBets = savedBets.map(b => ({
      ...b,
      gameId: b.gameId || '',
      sport: b.sport || 'soccer',
      league: b.league || '',
      pickType: b.pickType || 'OVER' as const,
      overUnder: b.overUnder,
      homeTeam: b.homeTeam || '',
      awayTeam: b.awayTeam || '',
      pickedTeam: b.pickedTeam,
      betType: b.betType || 'played' as const, // MIGRAZIONE
    }))
    setBankroll(savedBankroll)
    setBets(migratedBets)
    setRapidApiKey(savedRapidKey)
    setFootballDataToken(savedFdToken)
    setBet365Key(savedBet365Key)
    setMounted(true)
  }, [])

  // Save states
  useEffect(() => { if (mounted) saveState('bef-bankroll', bankroll) }, [bankroll, mounted])
  useEffect(() => { if (mounted) saveState('bef-bets', bets) }, [bets, mounted])
  useEffect(() => { if (mounted) saveState('bef-rapidapi-key', rapidApiKey) }, [rapidApiKey, mounted])
  useEffect(() => { if (mounted) saveState('bef-footballdata-token', footballDataToken) }, [footballDataToken, mounted])
  useEffect(() => { if (mounted) saveState('bef-bet365-key', bet365Key) }, [bet365Key, mounted])

  const fetchGames = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAllGames(sportFilter)
      if (fastScores.length > 0) {
        setGames(mergeFastScores(data, fastScores))
      } else {
        setGames(data)
      }
      setLastUpdate(new Date().toISOString())
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [sportFilter, fastScores])

  const fetchFastLive = async () => {
    setFetchingFast(true)
    const allFast: FastLiveScore[] = []
    const [sbScores, tsdbScores] = await Promise.allSettled([
      fetchFastLiveScores_ScoreBat(),
      fetchFastLiveScores_TheSportsDB(),
    ])
    if (sbScores.status === 'fulfilled') allFast.push(...sbScores.value)
    if (tsdbScores.status === 'fulfilled') allFast.push(...tsdbScores.value)

    if (rapidApiKey || bet365Key) {
      const afScores = await fetchFastLiveScores_ApiFootball(rapidApiKey || bet365Key)
      allFast.push(...afScores)
    }
    if (footballDataToken) {
      const fdScores = await fetchFastLiveScores_FootballData(footballDataToken)
      allFast.push(...fdScores)
    }

    setFastScores(allFast)

    if (allFast.length > 0 && games.length > 0) {
      setGames(mergeFastScores(games, allFast))
    }

    setFetchingFast(false)
    setLastUpdate(new Date().toISOString())
  }

  const fetchRecs = useCallback(async () => {
    setRecLoading(true)
    try {
      const data = await fetchAllRecommendations(bankroll, sportFilter)
      setRecommendations(data)
      setLastUpdate(new Date().toISOString())
    } catch (e) { console.error(e) }
    setRecLoading(false)
  }, [bankroll, sportFilter])

  useEffect(() => {
    if (!mounted) return
    fetchGames()
    fetchRecs()
    const interval = setInterval(() => { fetchGames(); fetchRecs() }, 30000)
    return () => clearInterval(interval)
  }, [fetchGames, fetchRecs, mounted])

  // Pull-to-refresh handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0) { touchStartY.current = e.touches[0].clientY; isPulling.current = true }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current) return
    const diff = e.touches[0].clientY - touchStartY.current
    if (diff > 0 && window.scrollY === 0) { setPullDistance(Math.min(diff * 0.5, 120)) } else { setPullDistance(0); isPulling.current = false }
  }, [])

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true); setPullDistance(0); isPulling.current = false
      await Promise.all([fetchGames(), fetchRecs()])
      setIsRefreshing(false)
    } else { setPullDistance(0); isPulling.current = false }
  }, [pullDistance, isRefreshing, fetchGames, fetchRecs])

  // LOGICA GIOCA / SIMULA
  const addBet = (rec: Recommendation, isSimulated: boolean) => {
    const type = isSimulated ? 'simulated' : 'played'
    // Previente duplicati per lo stesso tipo (es. non posso fare GIOCA 2 volte)
    const alreadyBet = bets.some(b => b.gameId === rec.game.id && b.pickType === rec.pickType && b.result === 'pending' && b.betType === type)
    if (alreadyBet) return

    const quota = rec.pickType === 'UNDER' && rec.odds.underOdds
      ? americanToDecimal(rec.odds.underOdds)
      : rec.pickType === 'OVER' && rec.odds.overOdds
      ? americanToDecimal(rec.odds.overOdds)
      : rec.pickType === 'ML' && rec.odds.homeML
      ? americanToDecimal(rec.odds.homeML)
      : 1.80

    let pickedTeam: string | undefined
    if (rec.pickType === 'ML') {
      pickedTeam = rec.pick.includes(rec.game.homeTeam) ? 'home' : 'away'
    }

    setBets(prev => [{
      id: `${rec.id}-${type}`, // ID unico per GIOCA e SIMULA
      pick: `${rec.game.sportEmoji} ${rec.game.homeTeam}-${rec.game.awayTeam} ${rec.pick}`,
      stake: rec.suggestedStake,
      quota: Math.round(quota * 100) / 100,
      result: 'pending' as const,
      date: new Date().toISOString(),
      gameId: rec.game.id,
      sport: rec.game.sport,
      league: rec.game.league,
      pickType: rec.pickType,
      overUnder: rec.odds.overUnder,
      homeTeam: rec.game.homeTeam,
      awayTeam: rec.game.awayTeam,
      pickedTeam,
      betType: type,
    }, ...prev])
    
    // Scala dal bankroll SOLO se è GIOCA
    if (!isSimulated) {
      setBankroll(prev => prev - rec.suggestedStake)
    }
  }

  const settleBet = (id: string, result: 'won' | 'lost') => {
    const bet = bets.find(b => b.id === id)
    // Aggiorna il bankroll SOLO se la scommessa era reale (GIOCA)
    if (bet && result === 'won' && bet.betType === 'played') {
      setBankroll(prev => prev + bet.stake * bet.quota)
    }
    setBets(prev => prev.map(b => b.id === id ? { ...b, result } : b))
  }

  const resetBankroll = () => {
    setBankroll(DEFAULT_BANKROLL)
    setBets([])
    setShowResetConfirm(false)
  }

  const deleteBet = (id: string) => {
    const bet = bets.find(b => b.id === id)
    if (bet && bet.result === 'pending' && bet.betType === 'played') {
      setBankroll(prev => prev + bet.stake) // Ritorna i soldi solo se era GIOCA
    }
    setBets(prev => prev.filter(b => b.id !== id))
  }

  // Simulazione automatica (bottone SIMULA in alto per controllare i risultati live)
  const simulateBets = async () => {
    const pending = bets.filter(b => b.result === 'pending')
    if (pending.length === 0) return

    setSimulating(true)
    const results: Record<string, SimResult> = {}

    const allFast: FastLiveScore[] = []
    const [sbScores, tsdbScores] = await Promise.allSettled([
      fetchFastLiveScores_ScoreBat(),
      fetchFastLiveScores_TheSportsDB(),
    ])
    if (sbScores.status === 'fulfilled') allFast.push(...sbScores.value)
    if (tsdbScores.status === 'fulfilled') allFast.push(...tsdbScores.value)

    if (rapidApiKey || bet365Key) {
      const afScores = await fetchFastLiveScores_ApiFootball(rapidApiKey || bet365Key)
      allFast.push(...afScores)
    }
    if (footballDataToken) {
      const fdScores = await fetchFastLiveScores_FootballData(footballDataToken)
      allFast.push(...fdScores)
    }
    setFastScores(allFast)

    for (const bet of pending) {
      const fastScore = allFast.find(fs => {
        if (fs.sport !== bet.sport) return false
        const homeMatch = fs.homeTeam.toLowerCase().includes(bet.homeTeam.toLowerCase()) || bet.homeTeam.toLowerCase().includes(fs.homeTeam.toLowerCase())
        const awayMatch = fs.awayTeam.toLowerCase().includes(bet.awayTeam.toLowerCase()) || bet.awayTeam.toLowerCase().includes(fs.awayTeam.toLowerCase())
        return homeMatch && awayMatch
      })

      if (fastScore) {
        const totalPoints = fastScore.homeScore + fastScore.awayScore
        let wouldWin: boolean | null = null
        let reason = ''

        if (bet.pickType === 'OVER' && bet.overUnder) {
          if (fastScore.isFinished) { wouldWin = totalPoints > bet.overUnder; reason = wouldWin ? `${totalPoints} > ${bet.overUnder} → OVER VINCE ✓ [FAST]` : `${totalPoints} ≤ ${bet.overUnder} → OVER PERDE ✗ [FAST]` }
          else if (fastScore.isLive) { wouldWin = totalPoints > bet.overUnder; reason = `${totalPoints} vs linea ${bet.overUnder} (LIVE ${fastScore.minute ? fastScore.minute + "'" : fastScore.status}) ${wouldWin ? '→ Sopra linea ✓' : '→ Sotto linea ✗'} [FAST ${fastScore.source}]` }
          else { wouldWin = null; reason = `Non ancora iniziata (${fastScore.status})` }
        } else if (bet.pickType === 'UNDER' && bet.overUnder) {
          if (fastScore.isFinished) { wouldWin = totalPoints < bet.overUnder; reason = wouldWin ? `${totalPoints} < ${bet.overUnder} → UNDER VINCE ✓ [FAST]` : `${totalPoints} ≥ ${bet.overUnder} → UNDER PERDE ✗ [FAST]` }
          else if (fastScore.isLive) { wouldWin = totalPoints < bet.overUnder; reason = `${totalPoints} vs linea ${bet.overUnder} (LIVE ${fastScore.minute ? fastScore.minute + "'" : fastScore.status}) ${wouldWin ? '→ Sotto linea ✓' : '→ Sopra linea ✗'} [FAST ${fastScore.source}]` }
          else { wouldWin = null; reason = `Non ancora iniziata (${fastScore.status})` }
        } else if (bet.pickType === 'ML') {
          if (fastScore.isFinished) {
            const homeWon = fastScore.homeScore > fastScore.awayScore
            if (bet.pickedTeam === 'home') { wouldWin = homeWon; reason = `${fastScore.homeScore}-${fastScore.awayScore} → ${bet.homeTeam} ${homeWon ? 'vince ✓' : 'perde ✗'} [FAST]` }
            else { wouldWin = !homeWon; reason = `${fastScore.homeScore}-${fastScore.awayScore} → ${bet.awayTeam} ${!homeWon ? 'vince ✓' : 'perde ✗'} [FAST]` }
          } else if (fastScore.isLive) {
            const homeLeading = fastScore.homeScore > fastScore.awayScore
            wouldWin = bet.pickedTeam === 'home' ? homeLeading : !homeLeading
            reason = `${fastScore.homeScore}-${fastScore.awayScore} (LIVE) [FAST ${fastScore.source}]`
          }
        }
        results[bet.id] = { betId: bet.id, homeScore: fastScore.homeScore, awayScore: fastScore.awayScore, status: fastScore.minute ? `${fastScore.minute}'` : fastScore.status, isLive: fastScore.isLive, isFinished: fastScore.isFinished, wouldWin, reason }
      }
    }

    const unresolvedBets = pending.filter(b => !results[b.id])
    if (unresolvedBets.length > 0) {
      const leagueGroups: Record<string, BetRecord[]> = {}
      for (const bet of unresolvedBets) { const key = `${bet.sport}:${bet.league}`; if (!leagueGroups[key]) leagueGroups[key] = []; leagueGroups[key].push(bet) }

      for (const [key, leagueBets] of Object.entries(leagueGroups)) {
        const [sport, league] = key.split(':')
        try {
          const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`
          const res = await fetch(url)
          if (!res.ok) continue
          const data = await res.json()

          const scoreMap: Record<string, { homeScore: number; awayScore: number; status: string; statusCode: string; isFinished: boolean; isLive: boolean }> = {}
          for (const ev of data.events || []) {
            const comps = ev.competitions?.[0]; if (!comps) continue
            const competitors = comps.competitors || []; if (competitors.length < 2) continue
            const home = competitors.find((c: { homeAway: string }) => c.homeAway === 'home') || competitors[0]
            const away = competitors.find((c: { homeAway: string }) => c.homeAway === 'away') || competitors[1]
            const status = ev.status?.type?.shortDetail || ''
            const statusCode = ev.status?.type?.name || ''
            const isFinished = status.includes('FT') || status.includes('Final') || statusCode === 'STATUS_FINAL'
            const isUpcoming = status.includes('Scheduled') || status === "0'" || status === 'TBD' || statusCode === 'STATUS_SCHEDULED'
            const isLive = !isFinished && !isUpcoming
            scoreMap[ev.id] = { homeScore: parseInt(home.score || '0'), awayScore: parseInt(away.score || '0'), status, statusCode, isFinished, isLive }
          }

          for (const bet of leagueBets) {
            const score = scoreMap[bet.gameId]
            if (!score) { results[bet.id] = { betId: bet.id, homeScore: 0, awayScore: 0, status: 'Non trovato', isLive: false, isFinished: false, wouldWin: null, reason: 'Partita non trovata' }; continue }
            const totalPoints = score.homeScore + score.awayScore
            let wouldWin: boolean | null = null; let reason = ''

            if (bet.pickType === 'OVER' && bet.overUnder) {
              if (score.isFinished) { wouldWin = totalPoints > bet.overUnder; reason = wouldWin ? `${totalPoints} > ${bet.overUnder} → OVER VINCE ✓` : `${totalPoints} ≤ ${bet.overUnder} → OVER PERDE ✗` }
              else if (score.isLive) { wouldWin = totalPoints > bet.overUnder; reason = `${totalPoints} vs linea ${bet.overUnder} (LIVE) ${wouldWin ? '→ Sopra ✓' : '→ Sotto ✗'}` }
              else { wouldWin = null; reason = `Non iniziata (${score.status})` }
            } else if (bet.pickType === 'UNDER' && bet.overUnder) {
              if (score.isFinished) { wouldWin = totalPoints < bet.overUnder; reason = wouldWin ? `${totalPoints} < ${bet.overUnder} → UNDER VINCE ✓` : `${totalPoints} ≥ ${bet.overUnder} → UNDER PERDE ✗` }
              else if (score.isLive) { wouldWin = totalPoints < bet.overUnder; reason = `${totalPoints} vs linea ${bet.overUnder} (LIVE) ${wouldWin ? '→ Sotto ✓' : '→ Sopra ✗'}` }
              else { wouldWin = null; reason = `Non iniziata (${score.status})` }
            } else if (bet.pickType === 'ML') {
              if (score.isFinished) { const homeWon = score.homeScore > score.awayScore; wouldWin = bet.pickedTeam === 'home' ? homeWon : !homeWon; reason = `${score.homeScore}-${score.awayScore} → ${wouldWin ? 'VINCE ✓' : 'PERDE ✗'}` }
              else if (score.isLive) { const homeLeading = score.homeScore > score.awayScore; wouldWin = bet.pickedTeam === 'home' ? homeLeading : !homeLeading; reason = `${score.homeScore}-${score.awayScore} (LIVE ESPN)` }
            }
            results[bet.id] = { betId: bet.id, homeScore: score.homeScore, awayScore: score.awayScore, status: score.status, isLive: score.isLive, isFinished: score.isFinished, wouldWin, reason }
          }
        } catch (e) { console.error(`Error fetching ${key}:`, e) }
      }
    }

    setSimResults(results)
    setSimulating(false)

    for (const [betId, sim] of Object.entries(results)) {
      if (sim.isFinished && sim.wouldWin !== null) {
        settleBet(betId, sim.wouldWin ? 'won' : 'lost')
      }
    }
  }

  const pendingBets = bets.filter(b => b.result === 'pending')
  const wonBets = bets.filter(b => b.result === 'won')
  const lostBets = bets.filter(b => b.result === 'lost')
  const totalStaked = bets.filter(b => b.betType === 'played').reduce((s, b) => s + b.stake, 0) // Solo soldi reali
  const totalWon = wonBets.filter(b => b.betType === 'played').reduce((s, b) => s + b.stake * b.quota, 0)
  const profit = totalWon - totalStaked
  const winRate = (wonBets.length + lostBets.length) > 0 ? ((wonBets.length / (wonBets.length + lostBets.length)) * 100).toFixed(0) : '-'

  const liveGames = games.filter(g => g.isLive)
  const upcomingGames = games.filter(g => !g.isLive)
  
  // FILTRO FONDAMENTALE: Nasconde i consigli se sono già stati giocati con GIOCA
  const visibleRecommendations = recommendations.filter(rec => 
    !bets.some(b => b.gameId === rec.game.id && b.pickType === rec.pickType && b.result === 'pending' && b.betType === 'played')
  )

  if (!mounted) {
    return (
      <div className="min-h-screen bg-[#0a0e17] text-white flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center transition-all duration-200 overflow-hidden" style={{ height: pullDistance > 0 ? pullDistance : isRefreshing ? 48 : 0, opacity: pullDistance > 0 || isRefreshing ? 1 : 0 }}>
        <div className="flex flex-col items-center gap-0.5 pt-2">
          <RefreshCw className={`w-5 h-5 ${isRefreshing || pullDistance >= PULL_THRESHOLD ? 'animate-spin text-emerald-400' : 'text-gray-300'}`} />
          <span className="text-[9px] font-bold text-gray-300">{isRefreshing ? 'Aggiornamento...' : pullDistance >= PULL_THRESHOLD ? 'Rilascia per aggiornare' : 'Scorri giù'}</span>
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0e17]/95 backdrop-blur border-b border-white/10">
        <div className="max-w-4xl mx-auto px-3 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="text-xl">🎯</div>
            <div>
              <h1 className="text-sm font-black tracking-tight text-white">BET EDGE FINDER</h1>
              <p className="text-[8px] text-gray-300 tracking-widest uppercase">Live AI Recommendations</p>
            </div>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-right shrink-0">
              <div className="flex items-center gap-1">
                <Wallet className="w-3 h-3 text-emerald-400" />
                <span className="text-sm font-black text-emerald-400">€{bankroll.toFixed(2)}</span>
              </div>
              <p className="text-[8px] text-gray-300">{profit >= 0 ? '+' : ''}€{profit.toFixed(2)} tot</p>
            </div>
            <div className="flex gap-1 flex-wrap justify-end max-w-[50vw]">
              <Button size="sm" className="h-7 w-7 p-0 bg-white/5 hover:bg-white/10 text-gray-300" onClick={() => setShowSettings(true)}>
                <Settings className="w-3 h-3" />
              </Button>
              <Button size="sm" className="h-7 px-1.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 font-bold text-[9px] gap-0.5" onClick={fetchFastLive} disabled={fetchingFast}>
                <Bolt className={`w-2.5 h-2.5 ${fetchingFast ? 'animate-pulse' : ''}`} /> FAST
              </Button>
              {pendingBets.length > 0 && (
                <Button size="sm" className="h-7 px-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30 font-bold text-[9px] gap-0.5" onClick={simulateBets} disabled={simulating}>
                  <FlaskConical className={`w-2.5 h-2.5 ${simulating ? 'animate-pulse' : ''}`} /> LIVE CHECK
                </Button>
              )}
              <Button size="sm" className="h-7 px-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 font-bold text-[9px] gap-0.5" onClick={() => { fetchGames(); fetchRecs() }} disabled={loading || recLoading}>
                <RefreshCw className={`w-2.5 h-2.5 ${loading || recLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Sport Filter */}
      <div className="max-w-4xl mx-auto px-4 pt-3">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[ { key: 'all', label: '🔥 Tutti' }, { key: 'soccer', label: '⚽ Calcio' }, { key: 'baseball', label: '⚾ MLB' }, { key: 'basketball', label: '🏀 NBA' }, { key: 'hockey', label: '🏒 NHL' }].map(f => (
            <button key={f.key} onClick={() => setSportFilter(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${sportFilter === f.key ? 'bg-emerald-500 text-black' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="grid grid-cols-5 gap-2">
          <div className="bg-white/5 rounded-xl p-2.5 text-center"><p className="text-[10px] text-gray-300 font-medium">GIOCATE</p><p className="text-lg font-black text-white">{bets.length}</p></div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center"><p className="text-[10px] text-gray-300 font-medium">VINTE</p><p className="text-lg font-black text-emerald-400">{wonBets.length}</p></div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center"><p className="text-[10px] text-gray-300 font-medium">PERSE</p><p className="text-lg font-black text-red-400">{lostBets.length}</p></div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center"><p className="text-[10px] text-gray-300 font-medium">WIN%</p><p className="text-lg font-black text-amber-400">{winRate}%</p></div>
          <div className="bg-white/5 rounded-xl p-2.5 text-center"><p className="text-[10px] text-gray-300 font-medium">IN GIOCO</p><p className="text-lg font-black text-amber-400">€{pendingBets.filter(b => b.betType==='played').reduce((s, b) => s + b.stake, 0)}</p></div>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="max-w-4xl mx-auto px-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full bg-white/5 h-9 p-0.5">
            <TabsTrigger value="recommendations" className="flex-1 text-xs font-bold data-[state=active]:bg-emerald-500 data-[state=active]:text-black"><Zap className="w-3 h-3 mr-1" /> CONSIGLI</TabsTrigger>
            <TabsTrigger value="live" className="flex-1 text-xs font-bold data-[state=active]:bg-emerald-500 data-[state=active]:text-black"><Target className="w-3 h-3 mr-1" /> LIVE</TabsTrigger>
            <TabsTrigger value="bets" className="flex-1 text-xs font-bold data-[state=active]:bg-emerald-500 data-[state=active]:text-black"><Wallet className="w-3 h-3 mr-1" /> SCOMMESSE</TabsTrigger>
          </TabsList>

          {/* RECOMMENDATIONS TAB - Usa visibleRecommendations per nascondere i GIOCA */}
          <TabsContent value="recommendations" className="mt-3">
            {recLoading ? (
              <div className="flex items-center justify-center py-20"><RefreshCw className="w-8 h-8 animate-spin text-emerald-400" /><span className="ml-3 text-gray-300">Analisi in corso...</span></div>
            ) : visibleRecommendations.length === 0 ? (
              <Card className="bg-white/5 border-white/10"><CardContent className="py-12 text-center"><AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" /><p className="text-gray-300 font-medium">Nessun consiglio con edge trovato</p><p className="text-gray-300 text-sm mt-1">Le quote attuali non offrono vantaggio o hai giocato tutto!</p><Button variant="outline" className="mt-4 text-white border-white/20 hover:bg-white/10" onClick={fetchRecs}><RefreshCw className="w-4 h-4 mr-2" /> Riprova</Button></CardContent></Card>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-gray-300">{visibleRecommendations.length} pick con edge trovati</p>
                  <p className="text-[10px] text-gray-300">{sportFilter === 'soccer' ? '⚽ Solo O/U' : 'Tutti i mercati'}</p>
                </div>
                {visibleRecommendations.map((rec) => {
                  const isAlreadySimulated = bets.some(b => b.gameId === rec.game.id && b.pickType === rec.pickType && b.result === 'pending' && b.betType === 'simulated')
                  return (
                    <Card key={rec.id} className="bg-white/5 border-white/10 hover:border-emerald-500/30 transition-all">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-base">{rec.game.sportEmoji}</span>
                              <span className="text-[10px] text-gray-300 font-medium">{rec.game.leagueName}</span>
                              {rec.game.isLive && (<span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[9px] font-bold rounded">LIVE</span>)}
                              {isAlreadySimulated && (<span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[9px] font-bold rounded">SIM IN CORSO</span>)}
                            </div>
                            <p className="font-bold text-sm text-white truncate">{rec.game.homeTeam} vs {rec.game.awayTeam}</p>
                            {(rec.game.homeScore > 0 || rec.game.awayScore > 0) ? (<p className="text-xs text-gray-300">{rec.game.homeScore}-{rec.game.awayScore} | {rec.game.status}</p>) : (<p className="text-xs text-gray-300">{rec.game.status}</p>)}
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${pickTypeColor(rec.pickType)}`}>{rec.pick}</span>
                              <span className="text-[11px] font-bold text-yellow-300">Quota {(() => { const q = rec.pickType === 'UNDER' && rec.odds.underOdds ? americanToDecimal(rec.odds.underOdds) : rec.pickType === 'OVER' && rec.odds.overOdds ? americanToDecimal(rec.odds.overOdds) : rec.pickType === 'ML' && rec.odds.homeML ? americanToDecimal(rec.odds.homeML) : 0; return q > 0 ? q.toFixed(2) : '-' })()}</span>
                              <span className={`text-[11px] font-bold ${edgeColor(rec.edge)}`}>Edge +{(rec.edge * 100).toFixed(1)}%</span>
                              <span className="text-[11px] text-gray-300">{confidenceStars(rec.confidence)}</span>
                            </div>
                            {(() => { const q = rec.pickType === 'UNDER' && rec.odds.underOdds ? americanToDecimal(rec.odds.underOdds) : rec.pickType === 'OVER' && rec.odds.overOdds ? americanToDecimal(rec.odds.overOdds) : rec.pickType === 'ML' && rec.odds.homeML ? americanToDecimal(rec.odds.homeML) : 0; if (q <= 0) return null; const isLive = rec.game.isLive; const minQ = isLive ? q * 0.90 : q * 0.97; const maxQ = q * 1.08; return (<div className={`mt-1.5 flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${isLive ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}><span className="text-[10px] text-gray-300">Bet365 deve essere:</span><span className="text-[12px] font-black text-amber-400">{minQ.toFixed(2)}</span><span className="text-[10px] text-gray-400">—</span><span className="text-[12px] font-black text-emerald-400">{maxQ.toFixed(2)}</span>{isLive && (<span className="ml-auto text-[8px] font-bold text-amber-400 animate-pulse">LIVE</span>)}</div>) })()}
                            <p className="text-[11px] text-gray-300 mt-1">{rec.reasoning}</p>
                          </div>
                          <div className="text-right ml-3 shrink-0">
                            <p className="text-lg font-black text-emerald-400">€{rec.suggestedStake}</p>
                            <p className="text-[11px] text-gray-300">Guad. +€{rec.potentialWin.toFixed(2)}</p>
                            <div className="flex gap-1 mt-2 justify-end">
                              <Button size="sm" className="h-7 bg-emerald-500 hover:bg-emerald-600 text-black font-bold text-[11px] px-3" onClick={() => addBet(rec, false)}>GIOCA</Button>
                              <Button size="sm" className="h-7 bg-amber-500 hover:bg-amber-600 text-black font-bold text-[11px] px-3" onClick={() => addBet(rec, true)}>SIMULA</Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* LIVE GAMES TAB */}
          <TabsContent value="live" className="mt-3">
            {loading ? (
              <div className="flex items-center justify-center py-20"><RefreshCw className="w-8 h-8 animate-spin text-emerald-400" /><span className="ml-3 text-gray-300">Caricamento partite...</span></div>
            ) : games.length === 0 ? (
              <Card className="bg-white/5 border-white/10"><CardContent className="py-12 text-center"><p className="text-gray-300">Nessuna partita live o imminente</p><Button variant="outline" className="mt-4 text-white border-white/20 hover:bg-white/10" onClick={fetchGames}><RefreshCw className="w-4 h-4 mr-2" /> Aggiorna</Button></CardContent></Card>
            ) : (
              <ScrollArea className="max-h-[70vh]">
                {liveGames.length > 0 && (<div className="mb-4"><h3 className="text-xs font-bold text-red-400 mb-2 flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />LIVE ADESSO ({liveGames.length})</h3><div className="space-y-1.5">{liveGames.map(g => { const fastMatch = fastScores.find(fs => { if (fs.sport !== g.sport) return false; return (fs.homeTeam.toLowerCase().includes(g.homeTeam.toLowerCase()) || g.homeTeam.toLowerCase().includes(fs.homeTeam.toLowerCase())) && (fs.awayTeam.toLowerCase().includes(g.awayTeam.toLowerCase()) || g.awayTeam.toLowerCase().includes(fs.awayTeam.toLowerCase())) }); const isFastScore = fastMatch && (fastMatch.homeScore !== g.homeScore || fastMatch.awayScore !== g.awayScore); return (<Card key={g.id} className={`bg-red-950/40 ${isFastScore ? 'border-orange-500/50' : 'border-red-500/40'}`}><CardContent className="p-2.5"><div className="flex items-center justify-between"><div className="flex items-center gap-2 min-w-0"><span className="text-base">{g.sportEmoji}</span><div className="min-w-0"><p className="text-xs font-bold text-red-100 truncate">{g.homeTeam} {isFastScore ? fastMatch!.homeScore : g.homeScore} - {isFastScore ? fastMatch!.awayScore : g.awayScore} {g.awayTeam}</p><div className="flex items-center gap-1.5"><span className="text-[9px] text-red-300/70">{g.leagueName}</span><span className="px-1 py-0.5 bg-red-500/30 text-red-300 text-[8px] font-bold rounded">{g.status}</span>{isFastScore && (<span className="px-1 py-0.5 bg-orange-500/30 text-orange-300 text-[8px] font-bold rounded flex items-center gap-0.5"><Bolt className="w-2 h-2" /> FAST</span>)}</div></div></div></div>{(g.homeForm || g.awayForm) && (<div className="mt-1 flex gap-3"><span className="text-[9px] text-red-300/60">{g.homeTeam}: {g.homeForm}</span><span className="text-[9px] text-red-300/60">{g.awayTeam}: {g.awayForm}</span></div>)}</CardContent></Card>) })}</div></div>)}
                {upcomingGames.length > 0 && (<div><h3 className="text-xs font-bold text-blue-400 mb-2 flex items-center gap-1">📋 IN PROGRAMMA ({upcomingGames.length})</h3><div className="space-y-1.5">{upcomingGames.map(g => (<Card key={g.id} className="bg-blue-950/30 border-blue-500/20"><CardContent className="p-2.5"><div className="flex items-center justify-between"><div className="flex items-center gap-2 min-w-0"><span className="text-base">{g.sportEmoji}</span><div className="min-w-0"><p className="text-xs font-bold text-blue-100 truncate">{g.homeTeam} vs {g.awayTeam}</p><div className="flex items-center gap-1.5"><span className="text-[9px] text-blue-300/70">{g.leagueName}</span><span className="px-1 py-0.5 bg-blue-500/20 text-blue-300 text-[8px] font-bold rounded">{g.status}</span></div></div></div></div>{(g.homeForm || g.awayForm) && (<div className="mt-1 flex gap-3"><span className="text-[9px] text-blue-300/50">{g.homeTeam}: {g.homeForm}</span><span className="text-[9px] text-blue-300/50">{g.awayTeam}: {g.awayForm}</span></div>)}{g.homeRecord && g.awayRecord && (<div className="mt-0.5 flex gap-3"><span className="text-[9px] text-blue-300/40">{g.homeRecord}</span><span className="text-[9px] text-blue-300/40">{g.awayRecord}</span></div>)}</CardContent></Card>))}</div></div>)}
              </ScrollArea>
            )}
          </TabsContent>

          {/* BETS TAB */}
          <TabsContent value="bets" className="mt-3">
            <div className="flex justify-end mb-2">
              {showResetConfirm ? (
                <div className="flex items-center gap-2"><span className="text-[10px] text-red-400 font-bold">Sicuro? Tutto viene cancellato!</span><Button size="sm" className="h-6 px-2 bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold" onClick={resetBankroll}>SI, AZZERA</Button><Button size="sm" variant="outline" className="h-6 px-2 text-[10px] font-bold text-white border-white/20 hover:bg-white/10" onClick={() => setShowResetConfirm(false)}>NO</Button></div>
              ) : (
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] font-bold text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={() => setShowResetConfirm(true)}><RotateCcw className="w-3 h-3 mr-1" /> RESET €{DEFAULT_BANKROLL}</Button>
              )}
            </div>

            {bets.length === 0 ? (
              <Card className="bg-white/5 border-white/10"><CardContent className="py-12 text-center"><Wallet className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-300">Nessuna scommessa ancora</p><p className="text-gray-300 text-sm mt-1">Vai ai Consigli per trovare pick con edge!</p></CardContent></Card>
            ) : (
              <div className="space-y-2">
                {pendingBets.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-1"><span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />IN GIOCO ({pendingBets.length})</h3>
                    {pendingBets.map(b => {
                      const sim = simResults[b.id]
                      return (
                        <Card key={b.id} className={`mb-1.5 ${sim ? sim.wouldWin === true ? 'bg-emerald-500/10 border-emerald-500/30' : sim.wouldWin === false ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/5 border-amber-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
                          <CardContent className="p-2.5">
                            <div className="flex items-center justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold text-white truncate">
                                  {b.pick} {b.betType === 'simulated' && <span className="text-amber-400 text-[10px]">(SIM)</span>}
                                </p>
                                <p className="text-[10px] text-gray-300">Quota {b.quota.toFixed(2)} | €{b.stake} | {new Date(b.date).toLocaleDateString('it-IT')}</p>
                              </div>
                              <div className="flex gap-1.5 shrink-0">
                                <Button size="sm" className="h-6 px-2 bg-emerald-500 hover:bg-emerald-600 text-black text-[10px] font-bold" onClick={() => settleBet(b.id, 'won')}><TrendingUp className="w-3 h-3 mr-1" /> VINTA</Button>
                                <Button size="sm" className="h-6 px-2 bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold" onClick={() => settleBet(b.id, 'lost')}><TrendingDown className="w-3 h-3 mr-1" /> PERSA</Button>
                              </div>
                            </div>
                            {sim && (
                              <div className={`mt-2 p-2 rounded text-[11px] font-bold ${sim.wouldWin === true ? 'bg-emerald-500/20 text-emerald-300' : sim.wouldWin === false ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300'}`}>
                                <div className="flex items-center justify-between"><span>{sim.homeScore}-{sim.awayScore}</span><span className="text-[9px] font-normal opacity-70">{sim.status}</span></div>
                                <p className="mt-0.5">{sim.reason}</p>
                                {sim.isFinished && sim.wouldWin !== null && (<p className="mt-1 text-[10px]">{sim.wouldWin ? `✓ +€${(b.stake * b.quota - b.stake).toFixed(2)}` : `✗ -€${b.stake.toFixed(2)}`}</p>)}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )}
                {[...wonBets, ...lostBets].length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-white mb-2">CHIUSE</h3>
                    {[...wonBets, ...lostBets].map(b => (
                      <Card key={b.id} className={`mb-1.5 ${b.result === 'won' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                        <CardContent className="p-2.5 flex items-center justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-white truncate">{b.pick} {b.betType === 'simulated' && <span className="text-amber-400 text-[10px]">(SIM)</span>}</p>
                            <p className="text-[10px] text-gray-300">Quota {b.quota.toFixed(2)} | €{b.stake} | {new Date(b.date).toLocaleDateString('it-IT')}</p>
                          </div>
                          <Badge variant={b.result === 'won' ? 'default' : 'destructive'} className="text-[10px]">
                            {b.result === 'won' ? `+€${(b.stake * b.quota - b.stake).toFixed(2)}` : `-€${b.stake}`}
                          </Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Settings Modal - COMPLETATO E RIPRISTINATO */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <Card className="bg-[#111827] border-white/10 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-black text-white">IMPOSTAZIONI FONTI LIVE</h2>
                <Button size="sm" className="h-6 w-6 p-0 bg-white/5 hover:bg-white/10" onClick={() => setShowSettings(false)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Bolt className="w-3.5 h-3.5 text-orange-400" />
                    <span className="text-xs font-bold text-orange-400">API-Football (RapidAPI)</span>
                  </div>
                  <p className="text-[10px] text-gray-300 mb-1.5">100 req/giorno gratuite. Aggiorna i risultati PRIMA di ESPN. Copre calcio, NBA, MLB, NHL.</p>
                  <input
                    type="password"
                    value={rapidApiKey}
                    onChange={e => setRapidApiKey(e.target.value)}
                    placeholder="Inserisci RapidAPI Key..."
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Bolt className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-400">Bet365 Quote</span>
                  </div>
                  <p className="text-[10px] text-gray-300 mb-1.5">Per sbloccare le quote di Bet365, incolla qui la stessa RapidAPI Key.</p>
                  <input
                    type="password"
                    value={bet365Key}
                    onChange={e => setBet365Key(e.target.value)}
                    placeholder="Incolla la tua RapidAPI Key..."
                    className="w-full bg-white/5 border border-emerald-500/30 rounded px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Bolt className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-bold text-blue-400">Football-Data.org</span>
                  </div>
                  <p className="text-[10px] text-gray-300 mb-1.5">10 req/minuto gratuite. Ottimo per il calcio europeo.</p>
                  <input
                    type="password"
                    value={footballDataToken}
                    onChange={e => setFootballDataToken(e.target.value)}
                    placeholder="Inserisci Football-Data Token..."
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="pt-2 border-t border-white/10">
                  <p className="text-[10px] text-gray-400 text-center">Le chiavi vengono salvate localmente sul tuo dispositivo.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}