// Page to server (contract section 12): nothing leaves the page unless the
// developer uses a carrier, and carriers only ever go to the page's own origin.
import type { Verdict } from '../core/verdict.ts'
import { encode } from '../core/wire.ts'

function sameOrigin(url: string | URL): boolean {
  try {
    return new URL(String(url), location.href).origin === location.origin
  } catch {
    return false
  }
}

/** { 'Botscent-Report': entry } when agent evidence has been observed and url is same-origin; {} otherwise. */
export function reportHeaders(verdict: Verdict, url: string | URL): Record<string, string> {
  if (verdict.type !== 'agent' || !sameOrigin(url)) return {}
  const entry = encode(verdict)
  return entry ? { 'Botscent-Report': entry } : {}
}

/** Adds botscent=<entry> to opted-in POST forms to the same origin when they are serialised. */
export function installFormField(current: () => Verdict): () => void {
  const submitters = new WeakMap<EventTarget, HTMLElement | null>()
  const onSubmit = (event: Event) => {
    if (event.target) submitters.set(event.target, (event as SubmitEvent).submitter ?? null)
  }
  const onFormData = (event: Event) => {
    try {
      const form = event.target
      if (!(form instanceof HTMLFormElement)) return
      if (!form.hasAttribute('data-botscent-field') && !form.querySelector('[data-botscent-field]')) return
      const submitter = submitters.get(form) as HTMLButtonElement | HTMLInputElement | null | undefined
      submitters.delete(form)
      const method = submitter?.hasAttribute('formmethod') ? submitter.formMethod : form.method
      const action = submitter?.hasAttribute('formaction') ? submitter.formAction : form.action
      if (method.toLowerCase() !== 'post' || !sameOrigin(action)) return
      const entry = encode(current())
      if (entry) (event as FormDataEvent).formData.set('botscent', entry)
    } catch {}
  }
  document.addEventListener('submit', onSubmit, true)
  document.addEventListener('formdata', onFormData, true)
  return () => {
    document.removeEventListener('submit', onSubmit, true)
    document.removeEventListener('formdata', onFormData, true)
  }
}
