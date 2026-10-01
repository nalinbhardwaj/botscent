# Botscent

Tells a website when software rather than a person is operating a visit, and names the agent when the evidence allows.

**Under development. Nothing here is ready to use yet.**

Botscent has two halves that give the same small verdict:

- a server function that reports what one request declared (TypeScript and Python);
- a page script that reports whether agent evidence has been observed during the document's lifetime.

```ts
type Verdict = {
  type: 'agent' | 'human'  // 'human' means no agent evidence observed
  agent_name?: string      // present when the agent is identified
  reasons: Reason[]        // rule ids, strongest first; [] for 'human'
}
```

MIT licensed.
