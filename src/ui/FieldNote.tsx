import { useI18n } from '../i18n/index.ts'
import type { Committed } from './numberInput.ts'

/** Inline hint under a number field: live range warning while typing, or what blur/Enter/Plan changed. */
export function FieldNote(props: {
  id: string
  note?: Committed
  outOfRange: boolean
  invalid: boolean
  prefix: 'target' | 'stride'
  range: { min: string; max: string }
  format: (v: number) => string
}) {
  const { t } = useI18n()
  const { note, prefix, range } = props
  let text: string | undefined
  if (note?.note === 'invalid') text = t(`${prefix}.invalid`, { value: props.format(note.value) })
  else if (note) text = t(`${prefix}.adjusted`, { value: props.format(note.value), ...range })
  else if (props.outOfRange || props.invalid) text = t(`${prefix}.range`, range)
  return (
    <p id={props.id} className={`field-note ${note ? 'warn' : ''}`} role="status" aria-live="polite">
      {text}
    </p>
  )
}
