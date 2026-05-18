import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

type Mode = 'learn' | 'speed'
type NoteSet = 'natural' | 'chromatic'
type Clef = 'treble' | 'alto' | 'tenor' | 'bass'
type Instrument = 'violin' | 'viola' | 'cello' | 'bass'
type RoundStatus = 'active' | 'answered' | 'timed_out'
type Feedback = 'correct' | 'wrong' | null

type Setup = {
  mode: Mode
  noteSet: NoteSet
  instrument: Instrument
  clef: Clef
  fretMin: number
  fretMax: number
  enabledStrings: number[]
  timeLimitMs: number | null
  questionCount: number
  showStringLabels: boolean
}

type Round = {
  targetMidi: number
  targetLabel: string
  startedAt: number
  deadlineAt: number | null
  status: RoundStatus
}

type Session = {
  currentQuestion: number
  correctCount: number
  wrongCount: number
  reactionTimes: number[]
  mistakesByNote: Record<number, number>
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
const SINGLE_INLAY_FRETS = new Set([3, 5, 7, 9, 15, 17])
const DOUBLE_INLAY_FRETS = new Set([12, 24])

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

const CLEF_META: Record<Clef, { label: string; symbol: string; bottomLineMidi: number }> = {
  treble: { label: 'Violin clef', symbol: '𝄞', bottomLineMidi: 64 },
  alto: { label: 'Viola clef', symbol: '𝄡', bottomLineMidi: 53 },
  tenor: { label: 'Tenor clef', symbol: '𝄡', bottomLineMidi: 50 },
  bass: { label: 'Bass clef', symbol: '𝄢', bottomLineMidi: 43 },
}

const DEFAULT_SETUP: Setup = {
  mode: 'learn',
  noteSet: 'chromatic',
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

function getWrittenNoteLabel(midi: number, instrument: Instrument) {
  return getNoteLabel(getWrittenMidi(midi, instrument))
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

function generateNextTarget(setup: Setup, previousMidi?: number) {
  const playableMidis = getAvailableTargetMidis(setup)
  const availableMidis =
    previousMidi === undefined || playableMidis.length === 1
      ? playableMidis
      : playableMidis.filter((midi) => midi !== previousMidi)
  const targetMidi = availableMidis[Math.floor(Math.random() * availableMidis.length)]

  return {
    targetMidi,
    targetLabel: getWrittenNoteLabel(targetMidi, setup.instrument),
  }
}

function evaluateAnswer(cell: FretCellData, round: Round, setup: Setup) {
  const correct = cell.midi === round.targetMidi
  const validPositions = getValidPositions(round.targetMidi, setup)

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
  const [screen, setScreen] = useState<'setup' | 'game' | 'results'>('setup')
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP)
  const [session, setSession] = useState<Session>(createEmptySession)
  const [round, setRound] = useState<Round | null>(null)
  const [ui, setUi] = useState<UIState>(createInitialUI)
  const [timeRemainingMs, setTimeRemainingMs] = useState<number | null>(null)
  const advanceTimeoutRef = useRef<number | null>(null)
  const sessionRef = useRef(session)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current !== null) {
        window.clearTimeout(advanceTimeoutRef.current)
      }
    }
  }, [])

  const beginRound = useCallback(
    (nextSession = session) => {
      const target = generateNextTarget(setup, round?.targetMidi)
      const deadlineAt = setup.mode === 'speed' && setup.timeLimitMs !== null ? Date.now() + setup.timeLimitMs : null

      setSession(nextSession)
      setUi(createInitialUI())
      setRound({
        targetMidi: target.targetMidi,
        targetLabel: target.targetLabel,
        startedAt: Date.now(),
        deadlineAt,
        status: 'active',
      })
      setTimeRemainingMs(deadlineAt === null ? null : setup.timeLimitMs)
    },
    [round?.targetMidi, session, setup],
  )

  const scheduleAdvance = useCallback((nextSession: Session) => {
    if (advanceTimeoutRef.current !== null) {
      window.clearTimeout(advanceTimeoutRef.current)
    }

    advanceTimeoutRef.current = window.setTimeout(() => {
      if (nextSession.currentQuestion > setup.questionCount) {
        setScreen('results')
        setRound(null)
        setTimeRemainingMs(null)
      } else {
        beginRound(nextSession)
      }
    }, 650)
  }, [beginRound, setup.questionCount])

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
      const revealedCorrectPositions = getValidPositions(currentRound.targetMidi, setup)
      const updatedSession: Session = {
        ...currentSession,
        wrongCount: currentSession.wrongCount + 1,
        mistakesByNote: {
          ...currentSession.mistakesByNote,
          [currentRound.targetMidi]: (currentSession.mistakesByNote[currentRound.targetMidi] ?? 0) + 1,
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
    if (round === null || round.status !== 'active') {
      return
    }

    const currentSession = sessionRef.current
    const result = evaluateAnswer(cell, round, setup)
    const selectedCell = { stringIndex: cell.stringIndex, fret: cell.fret }

    if (result.correct) {
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
        [round.targetMidi]: (currentSession.mistakesByNote[round.targetMidi] ?? 0) + 1,
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

  const totalAttempts = session.correctCount + session.wrongCount
  const accuracy = totalAttempts === 0 ? 0 : Math.round((session.correctCount / totalAttempts) * 100)
  const averageReactionTime =
    session.reactionTimes.length === 0
      ? null
      : Math.round(session.reactionTimes.reduce((sum, value) => sum + value, 0) / session.reactionTimes.length)

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
          </div>
          <NoteStaff midi={round.targetMidi} clef={setup.clef} instrument={setup.instrument} />
          <p className="prompt-copy">Tap any matching written note on the fretboard.</p>
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
  midi,
  clef,
  instrument,
}: {
  midi: number
  clef: Clef
  instrument: Instrument
}) {
  const lineGap = 14
  const stepGap = lineGap / 2
  const bottomLineY = 88
  const noteX = 144
  const clefMeta = CLEF_META[clef]
  const writtenMidi = getWrittenMidi(midi, instrument)
  const noteIndex = getDiatonicIndex(writtenMidi)
  const bottomLineIndex = getDiatonicIndex(clefMeta.bottomLineMidi)
  const stepOffset = noteIndex - bottomLineIndex
  const noteY = bottomLineY - stepOffset * stepGap
  const pitchClass = getPitchClass(writtenMidi)
  const hasAccidental = !NATURAL_PITCH_CLASSES.includes(pitchClass)
  const ledgerLines: number[] = []
  const noteTop = noteY - 12
  const noteBottom = noteY + 12

  for (let lineOffset = -2; lineOffset >= stepOffset; lineOffset -= 2) {
    ledgerLines.push(bottomLineY - lineOffset * stepGap)
  }

  for (let lineOffset = 10; lineOffset <= stepOffset; lineOffset += 2) {
    ledgerLines.push(bottomLineY - lineOffset * stepGap)
  }

  const stemDirection = stepOffset >= 4 ? 'down' : 'up'
  const stemTop = stemDirection === 'up' ? noteY - 42 : noteY
  const stemBottom = stemDirection === 'down' ? noteY + 42 : noteY
  const contentTop = Math.min(20, bottomLineY - 4 * lineGap, ...ledgerLines, noteTop, stemTop, hasAccidental ? noteY - 18 : noteTop)
  const contentBottom = Math.max(96, bottomLineY, ...ledgerLines, noteBottom, stemBottom, hasAccidental ? noteY + 18 : noteBottom)
  const viewBoxY = contentTop - 10
  const viewBoxHeight = contentBottom - contentTop + 20

  return (
    <div className="prompt-note" aria-label={`${clefMeta.label}, ${getWrittenNoteLabel(midi, instrument)}`}>
      <svg viewBox={`0 ${viewBoxY} 260 ${viewBoxHeight}`} role="img" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((lineIndex) => {
          const y = bottomLineY - lineIndex * lineGap
          return <line key={lineIndex} x1="20" y1={y} x2="236" y2={y} className="staff-line" />
        })}

        {ledgerLines.map((y) => (
          <line key={y} x1={noteX - 20} y1={y} x2={noteX + 20} y2={y} className="ledger-line" />
        ))}

        <text x="56" y="64" className="clef-glyph">
          {clefMeta.symbol}
        </text>

        {hasAccidental && (
          <text x={noteX - 34} y={noteY + 6} className="accidental-glyph">
            #
          </text>
        )}

        <ellipse cx={noteX} cy={noteY} rx="16" ry="11" className="note-head" transform={`rotate(-20 ${noteX} ${noteY})`} />

        {stemDirection === 'up' ? (
          <line x1={noteX + 12} y1={noteY} x2={noteX + 12} y2={noteY - 42} className="note-stem" />
        ) : (
          <line x1={noteX - 12} y1={noteY} x2={noteX - 12} y2={noteY + 42} className="note-stem" />
        )}
      </svg>
    </div>
  )
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
}: {
  setup: Setup
  session: Session
  accuracy: number
  averageReactionTime: number | null
  onRestart: () => void
  onBackToSetup: () => void
}) {
  const mistakeEntries = Object.entries(session.mistakesByNote)
    .sort((first, second) => Number(first[0]) - Number(second[0]))
    .map(([midi, count]) => `${getWrittenNoteLabel(Number(midi), setup.instrument)}: ${count}`)

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
        <button type="button" onClick={onBackToSetup}>
          Change Setup
        </button>
      </div>
    </section>
  )
}

export default App
