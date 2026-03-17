type Props = {
  connectedToServer: boolean
  connectedToObs: boolean
}

export default function ConnectionBadge({ connectedToServer, connectedToObs }: Props) {
  if (connectedToServer && connectedToObs) return null

  const text = !connectedToServer ? 'SEM SERVIDOR' : !connectedToObs ? 'OBS OFF' : 'OK'
  const bg = !connectedToServer ? 'rgba(180, 0, 0, 0.75)' : !connectedToObs ? 'rgba(150, 105, 0, 0.75)' : 'rgba(0, 120, 40, 0.6)'

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        padding: '6px 10px',
        borderRadius: 999,
        fontSize: 12,
        letterSpacing: 0.3,
        background: bg,
        border: '1px solid rgba(255,255,255,0.18)',
        color: '#fff',
        userSelect: 'none',
      }}
    >
      {text}
    </div>
  )
}
