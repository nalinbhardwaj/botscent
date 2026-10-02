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

/** Adds botscent=<entry> to an opted-in form's own submission when it POSTs to the same origin.
 * The submission is the one its submit event announced: that event has finished dispatching, so no
 * listener can still cancel it, and was not canceled. form.submit() and new FormData(form) fire no
 * submit event, and what code does with their data is not the form's to say, so they get nothing. */
export function installFormField(current: () => Verdict): () => void {
  const submissions = new WeakMap<EventTarget, SubmitEvent>()
  const onSubmit = (event: Event) => {
    if (event.target) submissions.set(event.target, event as SubmitEvent)
  }
  const onFormData = (event: Event) => {
    try {
      const form = event.target
      if (!(form instanceof HTMLFormElement)) return
      const submit = submissions.get(form)
      // A current target means the submit event is still dispatching: a listener serialising the form
      // itself. The submission's own formdata comes later. (Firefox keeps eventPhase set after dispatch.)
      if (!submit || submit.currentTarget) return
      submissions.delete(form)
      if (submit.defaultPrevented) return
      if (!form.hasAttribute('data-botscent-field') && !form.querySelector('[data-botscent-field]')) return
      const submitter = submit.submitter as HTMLButtonElement | HTMLInputElement | null
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
