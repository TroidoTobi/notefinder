import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

type Mode = 'learn' | 'speed'
type NoteSet = 'natural' | 'chromatic'
type Clef = 'treble' | 'alto' | 'tenor' | 'bass'
type Instrument = 'violin' | 'viola' | 'cello' | 'bass'
type TrainingType = 'single' | 'interval'
type IntervalDifficulty = 1 | 2 | 3
type RoundStatus = 'active' | 'answered' | 'timed_out'
type Feedback = 'correct' | 'wrong' | null
type NoteLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

type NoteSpelling = {
  letter: NoteLetter
  accidental: '#' | 'b' | null
  octave: number
  label: string
  diatonicIndex: number
}

type HistoryFilterValue<T extends string> = T | 'all'

type SessionHistoryEntry = {
  id: string
  completedAt: number
  instrument: Instrument
  clef: Clef
  noteSet: NoteSet
  training: TrainingType
  intervalDifficulty: IntervalDifficulty
  mode: Mode
  questionCount: number
  correctCount: number
  wrongCount: number
  accuracy: number
  averageReactionTime: number | null
  mistakesByNote: Record<string, number>
  mistakesByString: Record<number, number>
}

type Setup = {
  mode: Mode
  noteSet: NoteSet
  training: TrainingType
  intervalDifficulty: IntervalDifficulty
  instrument: Instrument
  clef: Clef
  fretMin: number
  fretMax: number
  enabledStrings: number[]
  timeLimitMs: number | null
  questionCount: number
  showStringLabels: boolean
}

type PromptTarget = {
  midi: number
  spelling: NoteSpelling
  label: string
}

type Round = {
  targets: PromptTarget[]
  activeTargetIndex: number
  startedAt: number
  deadlineAt: number | null
  status: RoundStatus
}

type Session = {
  currentQuestion: number
  correctCount: number
  wrongCount: number
  reactionTimes: number[]
  mistakesByNote: Record<string, number>
  mistakesByString: Record<number, number>
}

type CellPosition = {
  stringIndex: number
  fret: number
}

type FretCellData = CellPosition & {
  pitchClass: number
  midi: number
}

type UIState = {
  selectedCell: CellPosition | null
  feedback: Feedback
  revealedCorrectPositions: CellPosition[]
}

const STRING_THICKNESS = [2, 2.5, 3, 3.5]
const CHROMATIC_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11]
const LETTER_INDEX: Record<NoteLetter, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
const SINGLE_INLAY_FRETS = new Set([3, 5, 7, 9, 15, 17])
const DOUBLE_INLAY_FRETS = new Set([12, 24])
const SESSION_HISTORY_STORAGE_KEY = 'notefinder-session-history-v1'
const SESSION_HISTORY_LIMIT = 100
const INTERVAL_ADVANCE_DELAY_MS = 450

const INSTRUMENT_PRESETS: Record<
  Instrument,
  { label: string; stringLabels: string[]; openStringMidis: number[]; writtenMidiOffset: number }
> = {
  violin: {
    label: 'Violin',
    stringLabels: ['E', 'A', 'D', 'G'],
    openStringMidis: [76, 69, 62, 55],
    writtenMidiOffset: 0,
  },
  viola: {
    label: 'Viola',
    stringLabels: ['A', 'D', 'G', 'C'],
    openStringMidis: [69, 62, 55, 48],
    writtenMidiOffset: 0,
  },
  cello: {
    label: 'Cello',
    stringLabels: ['A', 'D', 'G', 'C'],
    openStringMidis: [57, 50, 43, 36],
    writtenMidiOffset: 0,
  },
  bass: {
    label: 'Bass',
    stringLabels: ['G', 'D', 'A', 'E'],
    openStringMidis: [43, 38, 33, 28],
    writtenMidiOffset: 12,
  },
}

const CLEF_META: Record<
  Clef,
  { label: string; symbol: string; bottomLineMidi: number; x: number; yOffset: number; fontSize: number }
> = {
  treble: { label: 'Violin clef', symbol: '𝄞', bottomLineMidi: 64, x: 54, yOffset: -18, fontSize: 56 },
  alto: { label: 'Viola clef', symbol: '𝄡', bottomLineMidi: 53, x: 58, yOffset: 0, fontSize: 58 },
  tenor: { label: 'Tenor clef', symbol: '𝄡', bottomLineMidi: 50, x: 58, yOffset: -1, fontSize: 58 },
  bass: { label: 'Bass clef', symbol: '𝄢', bottomLineMidi: 43, x: 58, yOffset: 9, fontSize: 54 },
}

const STAFF_VIEWBOX = {
  x: 0,
  y: -16,
  width: 260,
  height: 164,
}

const DEFAULT_SETUP: Setup = {
  mode: 'learn',
  noteSet: 'chromatic',
  training: 'single',
  intervalDifficulty: 1,
  instrument: 'viola',
  clef: 'alto',
  fretMin: 0,
  fretMax: 7,
  enabledStrings: [0, 1, 2, 3],
  timeLimitMs: 5000,
  questionCount: 12,
  showStringLabels: false,
}

const createEmptySession = (): Session => ({
  currentQuestion: 1,
  correctCount: 0,
  wrongCount: 0,
  reactionTimes: [],
  mistakesByNote: {},
  mistakesByString: {},
})

const createInitialUI = (): UIState => ({
  selectedCell: null,
  feedback: null,
  revealedCorrectPositions: [],
})

function getPitchClass(midi: number) {
  return ((midi % 12) + 12) % 12
}

function getInstrumentPreset(instrument: Instrument) {
  return INSTRUMENT_PRESETS[instrument]
}

function getMidiNote(stringIndex: number, fret: number, setup: Setup) {
  return getInstrumentPreset(setup.instrument).openStringMidis[stringIndex] + fret
}

function getWrittenMidi(midi: number, instrument: Instrument) {
  return midi + getInstrumentPreset(instrument).writtenMidiOffset
}

function isPlayableTarget(midi: number, noteSet: NoteSet) {
  return noteSet === 'chromatic' || NATURAL_PITCH_CLASSES.includes(getPitchClass(midi))
}

function getNoteLabel(midi: number) {
  const pitchClass = getPitchClass(midi)
  const octave = Math.floor(midi / 12) - 1

  return `${CHROMATIC_LABELS[pitchClass]}${octave}`
}

function getDiatonicIndexFromParts(letter: NoteLetter, octave: number) {
  return octave * 7 + LETTER_INDEX[letter]
}

function createNoteSpelling(writtenMidi: number, preferFlats = false): NoteSpelling {
  const pitchClass = getPitchClass(writtenMidi)
  const octave = Math.floor(writtenMidi / 12) - 1

  const sharpSpellings: Record<number, { letter: NoteLetter; accidental: '#' | null }> = {
    0: { letter: 'C', accidental: null },
    1: { letter: 'C', accidental: '#' },
    2: { letter: 'D', accidental: null },
    3: { letter: 'D', accidental: '#' },
    4: { letter: 'E', accidental: null },
    5: { letter: 'F', accidental: null },
    6: { letter: 'F', accidental: '#' },
    7: { letter: 'G', accidental: null },
    8: { letter: 'G', accidental: '#' },
    9: { letter: 'A', accidental: null },
    10: { letter: 'A', accidental: '#' },
    11: { letter: 'B', accidental: null },
  }
  const flatSpellings: Record<number, { letter: NoteLetter; accidental: 'b' | null }> = {
    0: { letter: 'C', accidental: null },
    1: { letter: 'D', accidental: 'b' },
    2: { letter: 'D', accidental: null },
    3: { letter: 'E', accidental: 'b' },
    4: { letter: 'E', accidental: null },
    5: { letter: 'F', accidental: null },
    6: { letter: 'G', accidental: 'b' },
    7: { letter: 'G', accidental: null },
    8: { letter: 'A', accidental: 'b' },
    9: { letter: 'A', accidental: null },
    10: { letter: 'B', accidental: 'b' },
    11: { letter: 'B', accidental: null },
  }

  const spelling = preferFlats ? flatSpellings[pitchClass] : sharpSpellings[pitchClass]
  const label = `${spelling.letter}${spelling.accidental ?? ''}${octave}`

  return {
    letter: spelling.letter,
    accidental: spelling.accidental,
    octave,
    label,
    diatonicIndex: getDiatonicIndexFromParts(spelling.letter, octave),
  }
}

function getWrittenNoteLabel(midi: number, instrument: Instrument) {
  return getNoteLabel(getWrittenMidi(midi, instrument))
}

function calculateAccuracy(session: Session) {
  const totalAttempts = session.correctCount + session.wrongCount
  return totalAttempts === 0 ? 0 : Math.round((session.correctCount / totalAttempts) * 100)
}

function calculateAverageReactionTime(session: Session) {
  return session.reactionTimes.length === 0
    ? null
    : Math.round(session.reactionTimes.reduce((sum, value) => sum + value, 0) / session.reactionTimes.length)
}

function createSessionHistoryEntry(setup: Setup, session: Session): SessionHistoryEntry | null {
  const totalAttempts = session.correctCount + session.wrongCount

  if (totalAttempts === 0) {
    return null
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    completedAt: Date.now(),
    instrument: setup.instrument,
    clef: setup.clef,
    noteSet: setup.noteSet,
    training: setup.training,
    intervalDifficulty: setup.intervalDifficulty,
    mode: setup.mode,
    questionCount: setup.questionCount,
    correctCount: session.correctCount,
    wrongCount: session.wrongCount,
    accuracy: calculateAccuracy(session),
    averageReactionTime: calculateAverageReactionTime(session),
    mistakesByNote: session.mistakesByNote,
    mistakesByString: session.mistakesByString,
  }
}

function loadSessionHistory() {
  if (typeof window === 'undefined') {
    return [] as SessionHistoryEntry[]
  }

  try {
    const raw = window.localStorage.getItem(SESSION_HISTORY_STORAGE_KEY)
    if (raw === null) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((entry): entry is SessionHistoryEntry => {
      return (
        typeof entry?.id === 'string' &&
        typeof entry?.completedAt === 'number' &&
        typeof entry?.instrument === 'string' &&
        typeof entry?.clef === 'string' &&
        typeof entry?.noteSet === 'string' &&
        typeof entry?.training === 'string' &&
        typeof entry?.intervalDifficulty === 'number' &&
        typeof entry?.mode === 'string' &&
        typeof entry?.questionCount === 'number' &&
        typeof entry?.correctCount === 'number' &&
        typeof entry?.wrongCount === 'number' &&
        typeof entry?.accuracy === 'number' &&
        (typeof entry?.averageReactionTime === 'number' || entry?.averageReactionTime === null) &&
        typeof entry?.mistakesByNote === 'object' &&
        entry?.mistakesByNote !== null &&
        typeof entry?.mistakesByString === 'object' &&
        entry?.mistakesByString !== null
      )
    })
  } catch {
    return []
  }
}

function saveSessionHistory(history: SessionHistoryEntry[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(SESSION_HISTORY_STORAGE_KEY, JSON.stringify(history))
}

function getValidPositions(targetMidi: number, setup: Setup) {
  const positions: FretCellData[] = []

  for (const stringIndex of setup.enabledStrings) {
    for (let fret = setup.fretMin; fret <= setup.fretMax; fret += 1) {
      const midi = getMidiNote(stringIndex, fret, setup)
      const pitchClass = getPitchClass(midi)

      if (midi === targetMidi) {
        positions.push({ stringIndex, fret, pitchClass, midi })
      }
    }
  }

  return positions
}

function getAvailableTargetMidis(setup: Setup) {
  const availableMidis = new Set<number>()

  for (const stringIndex of setup.enabledStrings) {
    for (let fret = setup.fretMin; fret <= setup.fretMax; fret += 1) {
      const midi = getMidiNote(stringIndex, fret, setup)

      if (isPlayableTarget(midi, setup.noteSet)) {
        availableMidis.add(midi)
      }
    }
  }

  return [...availableMidis].sort((first, second) => first - second)
}

function createPromptTarget(midi: number, setup: Setup): PromptTarget {
  const writtenMidi = getWrittenMidi(midi, setup.instrument)
  const pitchClass = getPitchClass(writtenMidi)
  const spelling = createNoteSpelling(
    writtenMidi,
    setup.noteSet === 'chromatic' && !NATURAL_PITCH_CLASSES.includes(pitchClass) && Math.random() < 0.5,
  )

  return {
    midi,
    spelling,
    label: spelling.label,
  }
}

function getIntervalMaxSemitones(difficulty: IntervalDifficulty) {
  switch (difficulty) {
    case 1:
      return 5
    case 2:
      return 9
    case 3:
      return 12
  }
}

function generateNextRoundTargets(setup: Setup, previousMidi?: number) {
  const playableMidis = getAvailableTargetMidis(setup)
  const availableMidis =
    previousMidi === undefined || playableMidis.length === 1
      ? playableMidis
      : playableMidis.filter((midi) => midi !== previousMidi)
  const firstMidi = availableMidis[Math.floor(Math.random() * availableMidis.length)]

  if (setup.training === 'single') {
    return [createPromptTarget(firstMidi, setup)]
  }

  const maxSemitones = getIntervalMaxSemitones(setup.intervalDifficulty)
  const validFirstMidis = availableMidis.filter((candidateMidi) => {
    return playableMidis.some((midi) => {
      const distance = Math.abs(midi - candidateMidi)
      return distance >= 1 && distance <= maxSemitones
    })
  })
  const resolvedFirstMidi =
    validFirstMidis.length > 0
      ? validFirstMidis[Math.floor(Math.random() * validFirstMidis.length)]
      : firstMidi
  const intervalOptions = playableMidis.filter((midi) => {
    const distance = Math.abs(midi - resolvedFirstMidi)
    return distance >= 1 && distance <= maxSemitones
  })

  const secondMidi =
    intervalOptions.length > 0
      ? intervalOptions[Math.floor(Math.random() * intervalOptions.length)]
      : resolvedFirstMidi

  return [createPromptTarget(resolvedFirstMidi, setup), createPromptTarget(secondMidi, setup)]
}

function evaluateAnswer(cell: FretCellData, round: Round, setup: Setup) {
  const activeTarget = round.targets[round.activeTargetIndex]
  const correct = cell.midi === activeTarget.midi
  const validPositions = getValidPositions(activeTarget.midi, setup)

  return {
    correct,
    validPositions,
    reactionTimeMs: Date.now() - round.startedAt,
  }
}

function finalizeRound(session: Session, result: { correct: boolean; reactionTimeMs: number | null }) {
  const nextSession: Session = {
    ...session,
    currentQuestion: session.currentQuestion + 1,
    correctCount: session.correctCount + (result.correct ? 1 : 0),
    reactionTimes:
      result.reactionTimeMs === null
        ? session.reactionTimes
        : [...session.reactionTimes, result.reactionTimeMs],
  }

  return {
    session: nextSession,
    wasCorrect: result.correct,
    reactionTimeMs: result.reactionTimeMs,
  }
}

function App() {
  const [screen, setScreen] = useState<'setup' | 'game' | 'results' | 'history'>('setup')
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP)
  const [session, setSession] = useState<Session>(createEmptySession)
  const [round, setRound] = useState<Round | null>(null)
  const [ui, setUi] = useState<UIState>(createInitialUI)
  const [timeRemainingMs, setTimeRemainingMs] = useState<number | null>(null)
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([])
  const advanceTimeoutRef = useRef<number | null>(null)
  const intervalAdvanceTimeoutRef = useRef<number | null>(null)
  const sessionRef = useRef(session)

  useEffect(() => {
    setSessionHistory(loadSessionHistory())
  }, [])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current !== null) {
        window.clearTimeout(advanceTimeoutRef.current)
      }

      if (intervalAdvanceTimeoutRef.current !== null) {
        window.clearTimeout(intervalAdvanceTimeoutRef.current)
      }
    }
  }, [])

  const beginRound = useCallback(
    (nextSession = session) => {
      const previousMidi = round?.targets[round.targets.length - 1]?.midi
      const targets = generateNextRoundTargets(setup, previousMidi)
      const deadlineAt = setup.mode === 'speed' && setup.timeLimitMs !== null ? Date.now() + setup.timeLimitMs : null

      setSession(nextSession)
      setUi(createInitialUI())
      setRound({
        targets,
        activeTargetIndex: 0,
        startedAt: Date.now(),
        deadlineAt,
        status: 'active',
      })
      setTimeRemainingMs(deadlineAt === null ? null : setup.timeLimitMs)
    },
    [round, session, setup],
  )

  const persistCompletedSession = useCallback((setupSnapshot: Setup, sessionSnapshot: Session) => {
    const entry = createSessionHistoryEntry(setupSnapshot, sessionSnapshot)

    if (entry === null) {
      return
    }

    setSessionHistory((currentHistory) => {
      const nextHistory = [...currentHistory, entry].slice(-SESSION_HISTORY_LIMIT)
      saveSessionHistory(nextHistory)
      return nextHistory
    })
  }, [])

  const scheduleAdvance = useCallback((nextSession: Session) => {
    if (advanceTimeoutRef.current !== null) {
      window.clearTimeout(advanceTimeoutRef.current)
    }

    advanceTimeoutRef.current = window.setTimeout(() => {
      if (nextSession.currentQuestion > setup.questionCount) {
        persistCompletedSession(setup, nextSession)
        setScreen('results')
        setRound(null)
        setTimeRemainingMs(null)
      } else {
        beginRound(nextSession)
      }
    }, 650)
  }, [beginRound, persistCompletedSession, setup])

  function startSession() {
    const nextSession = createEmptySession()
    setScreen('game')
    beginRound(nextSession)
  }

  function endSession() {
    if (advanceTimeoutRef.current !== null) {
      window.clearTimeout(advanceTimeoutRef.current)
      advanceTimeoutRef.current = null
    }

    if (intervalAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(intervalAdvanceTimeoutRef.current)
      intervalAdvanceTimeoutRef.current = null
    }

    persistCompletedSession(setup, sessionRef.current)
    setScreen('results')
    setRound(null)
    setTimeRemainingMs(null)
    setUi(createInitialUI())
  }

  function restartToSetup() {
    if (advanceTimeoutRef.current !== null) {
      window.clearTimeout(advanceTimeoutRef.current)
      advanceTimeoutRef.current = null
    }

    if (intervalAdvanceTimeoutRef.current !== null) {
      window.clearTimeout(intervalAdvanceTimeoutRef.current)
      intervalAdvanceTimeoutRef.current = null
    }

    setScreen('setup')
    setSession(createEmptySession())
    setRound(null)
    setUi(createInitialUI())
    setTimeRemainingMs(null)
  }

  const handleTimeout = useCallback(() => {
    setRound((currentRound) => {
      if (currentRound === null || currentRound.status !== 'active') {
        return currentRound
      }

      const currentSession = sessionRef.current
      const activeTarget = currentRound.targets[currentRound.activeTargetIndex]
      const revealedCorrectPositions = getValidPositions(activeTarget.midi, setup)
      const updatedSession: Session = {
        ...currentSession,
        wrongCount: currentSession.wrongCount + 1,
        mistakesByNote: {
          ...currentSession.mistakesByNote,
          [activeTarget.label]: (currentSession.mistakesByNote[activeTarget.label] ?? 0) + 1,
        },
      }
      const finalized = finalizeRound(updatedSession, { correct: false, reactionTimeMs: null })

      setUi({
        selectedCell: null,
        feedback: 'wrong',
        revealedCorrectPositions,
      })
      setSession(finalized.session)
      scheduleAdvance(finalized.session)
      setTimeRemainingMs(0)

      return {
        ...currentRound,
        status: 'timed_out',
      }
    })
  }, [scheduleAdvance, setup])

  useEffect(() => {
    if (screen !== 'game' || round === null || round.status !== 'active' || round.deadlineAt === null) {
      return
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, round.deadlineAt! - Date.now())
      setTimeRemainingMs(remaining)

      if (remaining === 0) {
        handleTimeout()
      }
    }

    updateRemaining()
    const intervalId = window.setInterval(updateRemaining, 50)

    return () => window.clearInterval(intervalId)
  }, [handleTimeout, round, screen])

  function handleCellClick(cell: FretCellData) {
    if (round === null || round.status !== 'active' || ui.feedback === 'correct') {
      return
    }

    const currentSession = sessionRef.current
    const result = evaluateAnswer(cell, round, setup)
    const selectedCell = { stringIndex: cell.stringIndex, fret: cell.fret }

    if (result.correct) {
      const isLastTarget = round.activeTargetIndex === round.targets.length - 1

      if (!isLastTarget) {
        const updatedSession: Session = {
          ...currentSession,
          reactionTimes: [...currentSession.reactionTimes, result.reactionTimeMs],
        }

        setUi({
          selectedCell,
          feedback: 'correct',
          revealedCorrectPositions: result.validPositions,
        })
        setSession(updatedSession)

        if (intervalAdvanceTimeoutRef.current !== null) {
          window.clearTimeout(intervalAdvanceTimeoutRef.current)
        }

        intervalAdvanceTimeoutRef.current = window.setTimeout(() => {
          setUi(createInitialUI())
          setRound((currentRound) => {
            if (currentRound === null) {
              return currentRound
            }

            return {
              ...currentRound,
              activeTargetIndex: currentRound.activeTargetIndex + 1,
              startedAt: Date.now(),
            }
          })
          intervalAdvanceTimeoutRef.current = null
        }, INTERVAL_ADVANCE_DELAY_MS)

        return
      }

      const finalized = finalizeRound(currentSession, {
        correct: true,
        reactionTimeMs: result.reactionTimeMs,
      })

      setUi({
        selectedCell,
        feedback: 'correct',
        revealedCorrectPositions: result.validPositions,
      })
      setRound({
        ...round,
        status: 'answered',
      })
      setSession(finalized.session)
      scheduleAdvance(finalized.session)
      return
    }

    const updatedSession: Session = {
      ...currentSession,
      wrongCount: currentSession.wrongCount + 1,
      mistakesByNote: {
        ...currentSession.mistakesByNote,
        [round.targets[round.activeTargetIndex].label]:
          (currentSession.mistakesByNote[round.targets[round.activeTargetIndex].label] ?? 0) + 1,
      },
      mistakesByString: {
        ...currentSession.mistakesByString,
        [cell.stringIndex]: (currentSession.mistakesByString[cell.stringIndex] ?? 0) + 1,
      },
    }

    setUi({
      selectedCell,
      feedback: 'wrong',
      revealedCorrectPositions: result.validPositions,
    })
    setSession(updatedSession)

    if (setup.mode === 'speed') {
      const finalized = finalizeRound(updatedSession, {
        correct: false,
        reactionTimeMs: result.reactionTimeMs,
      })

      setRound({
        ...round,
        status: 'answered',
      })
      setSession(finalized.session)
      scheduleAdvance(finalized.session)
    }
  }

  const accuracy = calculateAccuracy(session)
  const averageReactionTime = calculateAverageReactionTime(session)

  return (
    <div className="app-shell">
      <div className={`app-card screen-${screen}`}>
        {screen !== 'game' && (
          <header className="hero">
            <div>
              <p className="eyebrow">Fretboard Staff Trainer</p>
              <h1>Match written notes to the right places on a 4-string fretboard.</h1>
            </div>
            <p className="hero-copy">
              Choose an instrument preset, choose a clef, and answer from standard notation instead of note names.
            </p>
          </header>
        )}

        {screen === 'setup' && (
          <SetupPanel
            setup={setup}
            onChange={setSetup}
            onStart={startSession}
          />
        )}

        {screen === 'game' && round !== null && (
          <GameScreen
            setup={setup}
            round={round}
            session={session}
            ui={ui}
            accuracy={accuracy}
            timeRemainingMs={timeRemainingMs}
            onCellClick={handleCellClick}
            onRestart={restartToSetup}
            onEnd={endSession}
          />
        )}

        {screen === 'results' && (
          <ResultsScreen
            setup={setup}
            session={session}
            accuracy={accuracy}
            averageReactionTime={averageReactionTime}
            onRestart={startSession}
            onBackToSetup={restartToSetup}
            onViewHistory={() => setScreen('history')}
          />
        )}

        {screen === 'history' && (
          <HistoryScreen
            history={sessionHistory}
            onBack={() => setScreen('results')}
          />
        )}
      </div>
    </div>
  )
}

function SetupPanel({
  setup,
  onChange,
  onStart,
}: {
  setup: Setup
  onChange: (next: Setup) => void
  onStart: () => void
}) {
  const instrumentPreset = getInstrumentPreset(setup.instrument)

  function toggleString(stringIndex: number) {
    const enabledStrings = setup.enabledStrings.includes(stringIndex)
      ? setup.enabledStrings.filter((value) => value !== stringIndex)
      : [...setup.enabledStrings, stringIndex].sort((a, b) => a - b)

    if (enabledStrings.length > 0) {
      onChange({ ...setup, enabledStrings })
    }
  }

  return (
    <section className="panel-grid">
      <div className="panel setup-panel">
        <h2>Setup</h2>
        <div className="field-grid">
          <label>
            <span>Instrument</span>
            <select
              value={setup.instrument}
              onChange={(event) => onChange({ ...setup, instrument: event.target.value as Instrument })}
            >
              <option value="violin">Violin</option>
              <option value="viola">Viola</option>
              <option value="cello">Cello</option>
              <option value="bass">Bass</option>
            </select>
          </label>

          <label>
            <span>Clef</span>
            <select value={setup.clef} onChange={(event) => onChange({ ...setup, clef: event.target.value as Clef })}>
              <option value="treble">Violin clef</option>
              <option value="alto">Viola clef</option>
              <option value="tenor">Tenor clef</option>
              <option value="bass">Bass clef</option>
            </select>
          </label>

          <label>
            <span>Training</span>
            <select
              value={setup.training}
              onChange={(event) => onChange({ ...setup, training: event.target.value as TrainingType })}
            >
              <option value="single">Single notes</option>
              <option value="interval">Intervals</option>
            </select>
          </label>

          <label>
            <span>Mode</span>
            <select
              value={setup.mode}
              onChange={(event) =>
                onChange({
                  ...setup,
                  mode: event.target.value as Mode,
                  timeLimitMs:
                    event.target.value === 'speed'
                      ? setup.timeLimitMs ?? 5000
                      : setup.timeLimitMs,
                })
              }
            >
              <option value="learn">Learn</option>
              <option value="speed">Speed</option>
            </select>
          </label>

          <label>
            <span>Note set</span>
            <select
              value={setup.noteSet}
              onChange={(event) => onChange({ ...setup, noteSet: event.target.value as NoteSet })}
            >
              <option value="natural">Natural notes</option>
              <option value="chromatic">Chromatic</option>
            </select>
          </label>

          {setup.training === 'interval' && (
            <label>
              <span>Interval difficulty</span>
              <select
                value={String(setup.intervalDifficulty)}
                onChange={(event) =>
                  onChange({ ...setup, intervalDifficulty: Number(event.target.value) as IntervalDifficulty })
                }
              >
                <option value="1">Level 1: 1-5 semitones</option>
                <option value="2">Level 2: 1-9 semitones</option>
                <option value="3">Level 3: 1-12 semitones</option>
              </select>
            </label>
          )}

          <label>
            <span>Lowest fret</span>
            <input
              type="number"
              min={0}
              max={setup.fretMax}
              value={setup.fretMin}
              onChange={(event) =>
                onChange({
                  ...setup,
                  fretMin: Math.max(0, Math.min(Number(event.target.value), setup.fretMax)),
                })
              }
            />
          </label>

          <label>
            <span>Highest fret</span>
            <input
              type="number"
              min={setup.fretMin}
              max={18}
              value={setup.fretMax}
              onChange={(event) =>
                onChange({
                  ...setup,
                  fretMax: Math.max(setup.fretMin, Math.min(Number(event.target.value), 18)),
                })
              }
            />
          </label>

          <label>
            <span>Questions</span>
            <input
              type="number"
              min={1}
              max={100}
              value={setup.questionCount}
              onChange={(event) =>
                onChange({
                  ...setup,
                  questionCount: Math.max(1, Math.min(Number(event.target.value), 100)),
                })
              }
            />
          </label>

          <label>
            <span>Time limit</span>
            <select
              value={setup.timeLimitMs === null ? 'none' : String(setup.timeLimitMs)}
              onChange={(event) =>
                onChange({
                  ...setup,
                  timeLimitMs: event.target.value === 'none' ? null : Number(event.target.value),
                })
              }
            >
              <option value="none">No timer</option>
              <option value="3000">3 seconds</option>
              <option value="5000">5 seconds</option>
              <option value="8000">8 seconds</option>
              <option value="12000">12 seconds</option>
            </select>
          </label>
        </div>

        <div className="string-picker">
          <span>Enabled strings</span>
          <div className="chip-row">
            {instrumentPreset.stringLabels.map((label, stringIndex) => (
              <button
                key={label}
                type="button"
                className={setup.enabledStrings.includes(stringIndex) ? 'chip active' : 'chip'}
                onClick={() => toggleString(stringIndex)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="toggle-row">
          <span>Show string labels</span>
          <input
            type="checkbox"
            checked={setup.showStringLabels}
            onChange={(event) => onChange({ ...setup, showStringLabels: event.target.checked })}
          />
        </label>

        <button type="button" className="primary-button" onClick={onStart}>
          Start Session
        </button>
      </div>

      <aside className="panel info-panel">
        <h2>How it works</h2>
        <ul>
          <li>The prompt is shown as standard notation on a five-line staff.</li>
          <li>Single-note mode asks for one note. Interval mode asks for two notes in order.</li>
          <li>The clef is chosen separately from the instrument preset.</li>
          <li>Any matching written pitch on the enabled strings and fret range is correct.</li>
          <li>Learn mode lets the player retry the same note after mistakes.</li>
          <li>Speed mode gives one attempt per question and can enforce a timer.</li>
        </ul>
      </aside>
    </section>
  )
}

function GameScreen({
  setup,
  round,
  session,
  ui,
  accuracy,
  timeRemainingMs,
  onCellClick,
  onRestart,
  onEnd,
}: {
  setup: Setup
  round: Round
  session: Session
  ui: UIState
  accuracy: number
  timeRemainingMs: number | null
  onCellClick: (cell: FretCellData) => void
  onRestart: () => void
  onEnd: () => void
}) {
  return (
    <section className="game-layout">
      <div className="game-topbar">
        <div className="panel prompt-panel">
          <div className="progress-row">
            <span>
              Question {Math.min(session.currentQuestion, setup.questionCount)} / {setup.questionCount}
            </span>
            <span>{setup.mode === 'learn' ? 'Learn Mode' : 'Speed Mode'}</span>
          </div>
          <div className="prompt-meta">
            <span className="prompt-chip">{INSTRUMENT_PRESETS[setup.instrument].label}</span>
            <span className="prompt-chip">{CLEF_META[setup.clef].label}</span>
            <span className="prompt-chip">{setup.training === 'single' ? 'Single note' : 'Interval'}</span>
          </div>
          <NoteStaff spellings={round.targets.map((target) => target.spelling)} activeIndex={round.activeTargetIndex} clef={setup.clef} />
          <p className="prompt-copy">
            {setup.training === 'single'
              ? 'Tap any matching written note on the fretboard.'
              : `Tap the ${round.activeTargetIndex === 0 ? 'first' : 'second'} note shown on the staff.`}
          </p>
          {setup.timeLimitMs !== null && timeRemainingMs !== null && (
            <TimerBar remainingMs={timeRemainingMs} totalMs={setup.timeLimitMs} />
          )}
        </div>

        <div className="panel mini-stats">
          <div>
            <span className="stat-label">Correct</span>
            <strong>{session.correctCount}</strong>
          </div>
          <div>
            <span className="stat-label">Wrong</span>
            <strong>{session.wrongCount}</strong>
          </div>
          <div>
            <span className="stat-label">Accuracy</span>
            <strong>{accuracy}%</strong>
          </div>
        </div>
      </div>

      <Fretboard setup={setup} ui={ui} onCellClick={onCellClick} />

      <div className="panel control-bar">
        <span>
          {ui.feedback === 'correct' && 'Correct. Every matching position counts.'}
          {ui.feedback === 'wrong' &&
            (setup.mode === 'learn'
              ? 'Incorrect. The highlighted cells show all valid answers. Try again.'
              : 'Incorrect. The highlighted cells show all valid answers.')}
          {ui.feedback === null && 'Use the control buttons if you want to restart or end early.'}
        </span>
        <div className="control-actions">
          <button type="button" onClick={onRestart}>
            Restart
          </button>
          <button type="button" onClick={onEnd}>
            End Session
          </button>
        </div>
      </div>
    </section>
  )
}

function NoteStaff({
  spellings,
  activeIndex,
  clef,
}: {
  spellings: NoteSpelling[]
  activeIndex: number
  clef: Clef
}) {
  const lineGap = 14
  const stepGap = lineGap / 2
  const bottomLineY = 88
  const noteHeadRx = 10
  const noteHeadRy = 6
  const clefMeta = CLEF_META[clef]
  const clefCenterY = getClefCenterY(clef, bottomLineY, lineGap) + clefMeta.yOffset
  const bottomLineIndex = getDiatonicIndex(clefMeta.bottomLineMidi)
  const noteXs = spellings.length === 1 ? [144] : [118, 188]
  const notes = spellings.map((spelling, index) => {
    const noteIndex = spelling.diatonicIndex
    const stepOffset = noteIndex - bottomLineIndex
    const noteY = bottomLineY - stepOffset * stepGap
    const previousSpelling = index > 0 ? spellings[index - 1] : null
    const showNatural =
      spelling.accidental === null &&
      previousSpelling !== null &&
      previousSpelling.letter === spelling.letter &&
      previousSpelling.accidental !== null
    const accidentalSymbol =
      spelling.accidental === '#'
        ? '♯'
        : spelling.accidental === 'b'
          ? '♭'
          : showNatural
            ? '♮'
            : null
    const noteX = noteXs[index] ?? 144
    const accidentalKind = spelling.accidental ?? (showNatural ? 'natural' : null)
    const accidentalX =
      accidentalKind === 'b' ? noteX - 24 : accidentalKind === 'natural' ? noteX - 27 : noteX - 26
    const accidentalY = noteY + (accidentalKind === 'b' ? -11 : accidentalKind === 'natural' ? -9 : -11)
    const ledgerLines: number[] = []

    for (let lineOffset = -2; lineOffset >= stepOffset; lineOffset -= 2) {
      ledgerLines.push(bottomLineY - lineOffset * stepGap)
    }

    for (let lineOffset = 10; lineOffset <= stepOffset; lineOffset += 2) {
      ledgerLines.push(bottomLineY - lineOffset * stepGap)
    }

    return {
      spelling,
      noteX,
      noteY,
      accidentalX,
      accidentalY,
      accidentalSymbol,
      accidentalKind,
      ledgerLines,
      stemDirection: stepOffset >= 4 ? 'down' : ('up' as const),
      isActive: index === activeIndex,
    }
  })

  return (
    <div className="prompt-note" aria-label={`${clefMeta.label}, ${spellings.map((spelling) => spelling.label).join(', ')}`}>
      <svg
        viewBox={`${STAFF_VIEWBOX.x} ${STAFF_VIEWBOX.y} ${STAFF_VIEWBOX.width} ${STAFF_VIEWBOX.height}`}
        role="img"
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((lineIndex) => {
          const y = bottomLineY - lineIndex * lineGap
          return <line key={lineIndex} x1="20" y1={y} x2="236" y2={y} className="staff-line" />
        })}

        <text
          x={clefMeta.x}
          y={clefCenterY}
          className="clef-glyph"
          style={{ fontSize: `${clefMeta.fontSize}px` }}
        >
          {clefMeta.symbol}
        </text>

        {notes.map((note) => (
          <g key={`${note.spelling.label}-${note.noteX}`} className={note.isActive ? 'staff-note active' : 'staff-note inactive'}>
            {note.ledgerLines.map((y) => (
              <line key={`${note.noteX}-${y}`} x1={note.noteX - 20} y1={y} x2={note.noteX + 20} y2={y} className="ledger-line" />
            ))}

            {note.accidentalSymbol !== null && (
              <text
                x={note.accidentalX}
                y={note.accidentalY}
                className={`accidental-glyph accidental-${note.accidentalKind}`}
              >
                {note.accidentalSymbol}
              </text>
            )}

            <ellipse
              cx={note.noteX}
              cy={note.noteY}
              rx={noteHeadRx}
              ry={noteHeadRy}
              className="note-head"
              transform={`rotate(-20 ${note.noteX} ${note.noteY})`}
            />

            {note.stemDirection === 'up' ? (
              <line x1={note.noteX + 9} y1={note.noteY - 2} x2={note.noteX + 9} y2={note.noteY - 40} className="note-stem" />
            ) : (
              <line x1={note.noteX - 9} y1={note.noteY + 2} x2={note.noteX - 9} y2={note.noteY + 40} className="note-stem" />
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

function getClefCenterY(clef: Clef, bottomLineY: number, lineGap: number) {
  switch (clef) {
    case 'treble':
      return bottomLineY - lineGap
    case 'alto':
      return bottomLineY - 2 * lineGap
    case 'tenor':
    case 'bass':
      return bottomLineY - 3 * lineGap
  }
}

function getDiatonicIndex(midi: number) {
  const pitchClass = getPitchClass(midi)
  const octave = Math.floor(midi / 12) - 1
  const letterIndexByPitchClass: Record<number, number> = {
    0: 0,
    1: 0,
    2: 1,
    3: 1,
    4: 2,
    5: 3,
    6: 3,
    7: 4,
    8: 4,
    9: 5,
    10: 5,
    11: 6,
  }

  return octave * 7 + letterIndexByPitchClass[pitchClass]
}

function TimerBar({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const percentage = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100))

  return (
    <div className="timer-wrap" aria-label="Time remaining">
      <div className="timer-bar">
        <div className="timer-fill" style={{ width: `${percentage}%` }} />
      </div>
      <span>{(remainingMs / 1000).toFixed(1)}s</span>
    </div>
  )
}

function Fretboard({
  setup,
  ui,
  onCellClick,
}: {
  setup: Setup
  ui: UIState
  onCellClick: (cell: FretCellData) => void
}) {
  const stringLabels = getInstrumentPreset(setup.instrument).stringLabels
  const frets: number[] = []
  for (let fret = setup.fretMin; fret <= setup.fretMax; fret += 1) {
    frets.push(fret)
  }

  return (
    <div className="panel fretboard-panel">
      <div className="fretboard-hint">Swipe horizontally if the full neck does not fit on screen.</div>
      <div className="fretboard-scroll">
        <div
          className="fretboard-grid"
          style={{
            gridTemplateColumns: `${setup.showStringLabels ? 56 : 18}px repeat(${frets.length}, minmax(var(--fret-width, 64px), 1fr))`,
          }}
        >
          <div className="corner-cell" />
          {frets.map((fret) => (
            <div key={fret} className="fret-label">
              {fret}
            </div>
          ))}

          {stringLabels.map((stringLabel, stringIndex) => (
            <StringRow
              key={stringLabel}
              setup={setup}
              stringIndex={stringIndex}
              stringLabel={stringLabel}
              frets={frets}
              enabled={setup.enabledStrings.includes(stringIndex)}
              showLabel={setup.showStringLabels}
              ui={ui}
              onCellClick={onCellClick}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function StringRow({
  setup,
  stringIndex,
  stringLabel,
  frets,
  enabled,
  showLabel,
  ui,
  onCellClick,
}: {
  setup: Setup
  stringIndex: number
  stringLabel: string
  frets: number[]
  enabled: boolean
  showLabel: boolean
  ui: UIState
  onCellClick: (cell: FretCellData) => void
}) {
  return (
    <>
      <div className={enabled ? 'string-label' : 'string-label disabled'}>{showLabel ? stringLabel : ''}</div>
      {frets.map((fret) => {
        const midi = getMidiNote(stringIndex, fret, setup)
        const pitchClass = getPitchClass(midi)
        const isSelected =
          ui.selectedCell?.stringIndex === stringIndex && ui.selectedCell?.fret === fret
        const isRevealed = ui.revealedCorrectPositions.some(
          (position) => position.stringIndex === stringIndex && position.fret === fret,
        )
        const showSingleInlay = SINGLE_INLAY_FRETS.has(fret) && stringIndex === 1
        const showDoubleInlayTop = DOUBLE_INLAY_FRETS.has(fret) && stringIndex === 1
        const showDoubleInlayBottom = DOUBLE_INLAY_FRETS.has(fret) && stringIndex === 2
        const isNut = fret === 0

        let visualState = 'neutral'
        if (!enabled) {
          visualState = 'disabled'
        } else if (isSelected && ui.feedback === 'correct') {
          visualState = 'correct'
        } else if (isSelected && ui.feedback === 'wrong') {
          visualState = 'wrong'
        } else if (isRevealed) {
          visualState = 'hint'
        }

        return (
          <button
            key={`${stringIndex}-${fret}`}
            type="button"
            className={`fret-cell ${visualState} ${isNut ? 'nut' : ''}`}
            disabled={!enabled}
            onClick={() => onCellClick({ stringIndex, fret, pitchClass, midi })}
            aria-label={`${stringLabel} string fret ${fret}, ${getWrittenNoteLabel(midi, setup.instrument)}`}
          >
            <span
              className="string-line"
              style={{ height: `${STRING_THICKNESS[stringIndex]}px` }}
              aria-hidden="true"
            />
            {showSingleInlay && <span className="inlay-dot" aria-hidden="true" />}
            {showDoubleInlayTop && <span className="inlay-dot double-top" aria-hidden="true" />}
            {showDoubleInlayBottom && <span className="inlay-dot double-bottom" aria-hidden="true" />}
          </button>
        )
      })}
    </>
  )
}

function ResultsScreen({
  setup,
  session,
  accuracy,
  averageReactionTime,
  onRestart,
  onBackToSetup,
  onViewHistory,
}: {
  setup: Setup
  session: Session
  accuracy: number
  averageReactionTime: number | null
  onRestart: () => void
  onBackToSetup: () => void
  onViewHistory: () => void
}) {
  const mistakeEntries = Object.entries(session.mistakesByNote)
    .sort((first, second) => first[0].localeCompare(second[0]))
    .map(([label, count]) => `${label}: ${count}`)

  return (
    <section className="results-layout">
      <div className="panel results-hero">
        <p className="eyebrow">Session complete</p>
        <h2>
          {session.correctCount} correct out of {setup.questionCount} prompts
        </h2>
        <div className="results-stats">
          <div>
            <span className="stat-label">Accuracy</span>
            <strong>{accuracy}%</strong>
          </div>
          <div>
            <span className="stat-label">Average reaction</span>
            <strong>{averageReactionTime === null ? 'n/a' : `${averageReactionTime} ms`}</strong>
          </div>
          <div>
            <span className="stat-label">Wrong attempts</span>
            <strong>{session.wrongCount}</strong>
          </div>
        </div>
      </div>

      <div className="panel results-detail">
        <h3>Mistakes by note</h3>
        {mistakeEntries.length === 0 ? (
          <p>No mistakes recorded.</p>
        ) : (
          <div className="mistake-grid">
            {mistakeEntries.map((entry) => (
              <span key={entry} className="mistake-pill">
                {entry}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="results-actions">
        <button type="button" className="primary-button" onClick={onRestart}>
          Play Again
        </button>
        <button type="button" onClick={onViewHistory}>
          View History
        </button>
        <button type="button" onClick={onBackToSetup}>
          Change Setup
        </button>
      </div>
    </section>
  )
}

function HistoryScreen({
  history,
  onBack,
}: {
  history: SessionHistoryEntry[]
  onBack: () => void
}) {
  const [trainingFilter, setTrainingFilter] = useState<HistoryFilterValue<TrainingType>>('all')
  const [instrumentFilter, setInstrumentFilter] = useState<HistoryFilterValue<Instrument>>('all')
  const [clefFilter, setClefFilter] = useState<HistoryFilterValue<Clef>>('all')

  const filteredHistory = history.filter((entry) => {
    return (
      (trainingFilter === 'all' || entry.training === trainingFilter) &&
      (instrumentFilter === 'all' || entry.instrument === instrumentFilter) &&
      (clefFilter === 'all' || entry.clef === clefFilter)
    )
  })

  const totalWrong = filteredHistory.reduce((sum, entry) => sum + entry.wrongCount, 0)
  const totalAttempts = filteredHistory.reduce((sum, entry) => sum + entry.correctCount + entry.wrongCount, 0)
  const averageErrorRate = totalAttempts === 0 ? 0 : Math.round((totalWrong / totalAttempts) * 100)
  const reactionTimeEntries = filteredHistory.filter((entry) => entry.averageReactionTime !== null)
  const averageReaction =
    reactionTimeEntries.length === 0
      ? null
      : Math.round(
          reactionTimeEntries.reduce((sum, entry) => sum + (entry.averageReactionTime ?? 0), 0) / reactionTimeEntries.length,
        )

  const noteMistakes = filteredHistory.reduce<Record<string, number>>((accumulator, entry) => {
    for (const [label, count] of Object.entries(entry.mistakesByNote)) {
      accumulator[label] = (accumulator[label] ?? 0) + count
    }

    return accumulator
  }, {})

  const topMistakes = Object.entries(noteMistakes)
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .slice(0, 10)

  const errorSeries = filteredHistory.map((entry) => ({
    id: entry.id,
    value: 100 - entry.accuracy,
    label: new Date(entry.completedAt).toLocaleDateString(),
  }))
  const reactionSeries = filteredHistory.map((entry) => ({
    id: entry.id,
    value: entry.averageReactionTime,
    label: new Date(entry.completedAt).toLocaleDateString(),
  }))

  return (
    <section className="history-layout">
      <div className="panel history-hero">
        <div className="history-heading">
          <div>
            <p className="eyebrow">Progress History</p>
            <h2>Track your last {SESSION_HISTORY_LIMIT} sessions and keep pushing the graph toward 0% error.</h2>
          </div>
          <button type="button" onClick={onBack}>
            Back to Results
          </button>
        </div>

        <div className="history-filters">
          <label>
            <span>Training</span>
            <select
              value={trainingFilter}
              onChange={(event) => setTrainingFilter(event.target.value as HistoryFilterValue<TrainingType>)}
            >
              <option value="all">All training</option>
              <option value="single">Single notes</option>
              <option value="interval">Intervals</option>
            </select>
          </label>

          <label>
            <span>Instrument</span>
            <select
              value={instrumentFilter}
              onChange={(event) => setInstrumentFilter(event.target.value as HistoryFilterValue<Instrument>)}
            >
              <option value="all">All instruments</option>
              <option value="violin">Violin</option>
              <option value="viola">Viola</option>
              <option value="cello">Cello</option>
              <option value="bass">Bass</option>
            </select>
          </label>

          <label>
            <span>Clef</span>
            <select value={clefFilter} onChange={(event) => setClefFilter(event.target.value as HistoryFilterValue<Clef>)}>
              <option value="all">All clefs</option>
              <option value="treble">Violin clef</option>
              <option value="alto">Viola clef</option>
              <option value="tenor">Tenor clef</option>
              <option value="bass">Bass clef</option>
            </select>
          </label>
        </div>

        <div className="history-stats">
          <div>
            <span className="stat-label">Sessions in view</span>
            <strong>{filteredHistory.length}</strong>
          </div>
          <div>
            <span className="stat-label">Average error</span>
            <strong>{averageErrorRate}%</strong>
          </div>
          <div>
            <span className="stat-label">Average speed</span>
            <strong>{averageReaction === null ? 'n/a' : `${averageReaction} ms`}</strong>
          </div>
          <div>
            <span className="stat-label">Total prompts</span>
            <strong>{totalAttempts}</strong>
          </div>
        </div>
      </div>

      <div className="history-chart-grid">
        <TrendChart
          title="Error Rate"
          subtitle="Each point is one finished session. Lower is better."
          series={errorSeries}
          suffix="%"
          minValue={0}
          maxValue={100}
        />
        <TrendChart
          title="Average Answer Speed"
          subtitle="Only answered notes contribute to the average reaction time."
          series={reactionSeries}
          suffix=" ms"
          formatValue={(value) => `${(value / 1000).toFixed(1)} s`}
        />
      </div>

      <div className="panel history-detail">
        <h3>Most Missed Notes</h3>
        {topMistakes.length === 0 ? (
          <p>No mistakes recorded for the selected history yet.</p>
        ) : (
          <div className="history-mistakes">
            {topMistakes.map(([label, count]) => (
              <div key={label} className="history-mistake-row">
                <span>{label}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function TrendChart({
  title,
  subtitle,
  series,
  suffix,
  minValue,
  maxValue,
  formatValue,
}: {
  title: string
  subtitle: string
  series: Array<{ id: string; value: number | null; label: string }>
  suffix: string
  minValue?: number
  maxValue?: number
  formatValue?: (value: number) => string
}) {
  const validValues = series.flatMap((entry) => (entry.value === null ? [] : [entry.value]))
  const resolvedMin = minValue ?? (validValues.length === 0 ? 0 : Math.min(...validValues))
  const resolvedMax = maxValue ?? (validValues.length === 0 ? 100 : Math.max(...validValues))
  const paddedMax = resolvedMax === resolvedMin ? resolvedMax + 1 : resolvedMax
  const chartWidth = 520
  const chartHeight = 220
  const padding = { top: 20, right: 18, bottom: 32, left: 72 }
  const innerWidth = chartWidth - padding.left - padding.right
  const innerHeight = chartHeight - padding.top - padding.bottom

  const points = series.map((entry, index) => {
    const x = padding.left + (series.length <= 1 ? innerWidth / 2 : (index / (series.length - 1)) * innerWidth)
    const y =
      entry.value === null
        ? null
        : padding.top + innerHeight - ((entry.value - resolvedMin) / (paddedMax - resolvedMin)) * innerHeight

    return { ...entry, x, y }
  })

  const linePath = points.reduce((path, point) => {
    if (point.y === null) {
      return path
    }

    return `${path}${path === '' ? 'M' : ' L'} ${point.x} ${point.y}`
  }, '')

  return (
    <div className="panel history-chart-panel">
      <h3>{title}</h3>
      <p>{subtitle}</p>
      {validValues.length === 0 ? (
        <div className="history-empty">No matching session data yet.</div>
      ) : (
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="history-chart" role="img" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => {
            const y = padding.top + (index / 4) * innerHeight
            const tickValue = Math.round(paddedMax - (index / 4) * (paddedMax - resolvedMin))

            return (
              <g key={index}>
                <line x1={padding.left} y1={y} x2={chartWidth - padding.right} y2={y} className="chart-grid-line" />
                <text x={padding.left - 10} y={y} className="chart-axis-label">
                  {formatValue ? formatValue(tickValue) : `${tickValue}${suffix}`}
                </text>
              </g>
            )
          })}

          {linePath !== '' && <path d={linePath} className="chart-line" />}
          {points.map((point) =>
            point.y === null ? null : <circle key={point.id} cx={point.x} cy={point.y} r="4" className="chart-point" />,
          )}
        </svg>
      )}
    </div>
  )
}

export default App
