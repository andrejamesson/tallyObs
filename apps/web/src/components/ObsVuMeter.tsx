type Props = {
  level: number
  peakLevel?: number
  muted?: boolean
  height?: number | string
}

const SCALE_MIN_DB = -60
const SCALE_MAX_DB = 0
const TICKS = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54, -60]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function linearToDb(level: number) {
  if (!Number.isFinite(level) || level <= 0) return SCALE_MIN_DB
  const db = 20 * Math.log10(level)
  return clamp(db, SCALE_MIN_DB, SCALE_MAX_DB)
}

function pctForDb(db: number) {
  return ((clamp(db, SCALE_MIN_DB, SCALE_MAX_DB) - SCALE_MIN_DB) / (SCALE_MAX_DB - SCALE_MIN_DB)) * 100
}

function colorForDb(db: number) {
  if (db >= -12) return '#cf3b2f'
  if (db >= -18) return '#d6bc34'
  return '#2ccd51'
}

export default function ObsVuMeter({ level, peakLevel, muted = false, height = 124 }: Props) {
  const db = linearToDb(level)
  const peakDb = linearToDb(peakLevel ?? level)
  const fillPct = pctForDb(db)
  const peakPct = pctForDb(peakDb)
  const redStart = pctForDb(-12)
  const yellowStart = pctForDb(-18)
  const peakColor = muted ? 'rgba(220,220,220,0.95)' : colorForDb(peakDb)
  const baseZoneBackground = `linear-gradient(to top,
      rgba(44,205,81,0.28) 0%,
      rgba(44,205,81,0.28) ${yellowStart}%,
      rgba(214,188,52,0.26) ${yellowStart}%,
      rgba(214,188,52,0.26) ${redStart}%,
      rgba(207,59,47,0.26) ${redStart}%,
      rgba(207,59,47,0.26) 100%)`
  const activeZoneBackground = `linear-gradient(to top,
      #29d758 0%,
      #29d758 ${yellowStart}%,
      #f0cc3d ${yellowStart}%,
      #f0cc3d ${redStart}%,
      #e34b3e ${redStart}%,
      #e34b3e 100%)`

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 2,
        height,
        width: '100%',
      }}
      title={`VU ${db.toFixed(1)} dB`}
    >
      <div
        style={{
          width: 14,
          borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.16)',
          background: muted ? 'rgba(255,255,255,0.06)' : baseZoneBackground,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 1,
            right: 1,
            top: 0,
            bottom: 0,
            borderRadius: 2,
            background: muted ? 'linear-gradient(to top, #7f7f7f 0%, #9a9a9a 100%)' : activeZoneBackground,
            filter: muted ? 'none' : 'saturate(1.2) brightness(1.15)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 1,
            right: 1,
            top: 0,
            height: `${Math.max(0, 100 - fillPct)}%`,
            borderRadius: 2,
            background: 'rgba(0,0,0,0.72)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 1,
            right: 1,
            bottom: `calc(${peakPct}% - 1px)`,
            height: 2,
            borderRadius: 2,
            background: peakColor,
            boxShadow: muted ? 'none' : `0 0 3px ${peakColor}`,
          }}
        />
      </div>
      <div
        style={{
          width: 24,
          position: 'relative',
          fontSize: 10,
          color: 'rgba(255,255,255,0.72)',
          lineHeight: 1,
        }}
      >
        {TICKS.map((tick) => {
          const topPct = ((SCALE_MAX_DB - tick) / (SCALE_MAX_DB - SCALE_MIN_DB)) * 100
          return (
            <div
              key={tick}
              style={{
                position: 'absolute',
                top: `calc(${topPct}% - 5px)`,
                right: 0,
              }}
            >
              {tick}
            </div>
          )
        })}
      </div>
    </div>
  )
}
