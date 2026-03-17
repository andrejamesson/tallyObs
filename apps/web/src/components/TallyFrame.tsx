import type { ReactNode } from 'react'

type Props = {
  onAir: boolean
  disconnected: boolean
  showBorder?: boolean
  children: ReactNode
}

export default function TallyFrame({ onAir, disconnected, showBorder = true, children }: Props) {
  const borderColor = disconnected ? '#7a1111' : onAir ? '#00ff3b' : '#111'

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        background: '#000',
        border: showBorder ? `18px solid ${borderColor}` : '0 solid transparent',
        padding: 'max(env(safe-area-inset-top), 0px) max(env(safe-area-inset-right), 0px) max(env(safe-area-inset-bottom), 0px) max(env(safe-area-inset-left), 0px)',
      }}
    >
      <div
        style={{
          height: '100%',
          width: '100%',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  )
}
