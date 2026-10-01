// Writes vectors/requests.json: requests and the verdicts both implementations
// must give for them. Signatures are made with the Ed25519 test key published in
// RFC 9421 (Appendix B.1.4), whose private half is public, so nothing secret is
// involved; each signature base is written out here by hand, independently of
// the library's own construction. The first vectors are the IETF draft's own.
import { createPrivateKey, sign } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const TEST_KEY = {
  kty: 'OKP',
  crv: 'Ed25519',
  d: 'n4Ni-HpISpVObnQMW0wOhCKROaIKqKtW_2ZYb2p9KcU',
  x: 'JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs',
}
const THUMBPRINT = 'poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U'
const OTHER_X = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' // RFC 8037's example public key, standing in for a second signer
const privateKey = createPrivateKey({ key: TEST_KEY, format: 'jwk' })

const NOW = 1759300000000 // 2025-10-01T06:26:40Z
const CREATED = 1759299990
const EXPIRES = 1759300600
const params = (extra = '') =>
  `;created=${CREATED};keyid="${THUMBPRINT}";alg="ed25519";expires=${EXPIRES}${extra};tag="web-bot-auth"`

/** Signature-Input and Signature for components written out by hand: [identifier, value]. */
function signed(label: string, components: [string, string][], parameters: string) {
  const inner = `(${components.map(([id]) => id).join(' ')})${parameters}`
  const base = [...components.map(([id, value]) => `${id}: ${value}`), `"@signature-params": ${inner}`].join('\n')
  const signature = sign(null, Buffer.from(base), privateKey).toString('base64')
  return { 'signature-input': `${label}=${inner}`, signature: `${label}=:${signature}:` }
}

type Case = {
  name: string
  headers: [string, string][]
  method?: string
  url?: string
  now?: number
  cf?: Record<string, unknown>
  verdict: { type: 'agent' | 'human'; agent_name?: string; reasons: string[] }
}
const agent = (reasons: string[], agent_name?: string) =>
  agent_name ? { type: 'agent' as const, agent_name, reasons } : { type: 'agent' as const, reasons }
const human = { type: 'human' as const, reasons: [] }
const VERIFIED = 'signer.web-bot-auth.verified'
const DECLARED = 'signer.web-bot-auth.declared'
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

// draft-ietf-webbotauth-httpsig-protocol-00, Appendix E.2.1 and E.2.2, verbatim.
const E21 = {
  agent: 'agent2="https://signature-agent.test"',
  input:
    'sig2=("@authority" "signature-agent";key="agent2");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=4889289600;nonce="n9p433xm+NJ3ph3upfBIGmsuwHw387YV7Q/F+6BSpGCVjYCqQw6rznNA8PVVLySrAWsv0hQtFioQb6E1YsauiA==";tag="web-bot-auth"',
  signature: 'sig2=:RdNFx5Bj6au3YgAMQL/RzmUlZE8QZLIaXGRpw985hWnwPfMxT228NMk6ehRS1PSl4e8PhbNZACSanGdhEwYCCg==:',
}
const E22 = {
  agent: '"https://signature-agent.test"',
  input:
    'sig2=("@authority" "signature-agent");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=1735693200;nonce="e8N7S2MFd/qrd6T2R3tdfAuuANngKI7LFtKYI/vowzk4lAZYadIX6wW25MwG7DCT9RUKAJ0qVkU0mEeLElW1qg==";tag="web-bot-auth"',
  signature: 'sig2=:jdq0SqOwHdyHr9+r5jw3iYZH6aNGKijYp/EstF4RQTQdi5N5YYKrD+mCT1HA1nZDsi6nJKuHxUi/5Syp3rLWBA==:',
}
const draft = (d: typeof E21, host = 'example.com'): [string, string][] => [
  ['host', host],
  ['signature-agent', d.agent],
  ['signature-input', d.input],
  ['signature', d.signature],
]

/** A request signed by the test signer over @authority and its Signature-Agent member. */
function request(
  agentHeader: string,
  coveredAgent: string,
  parameters = params(),
  label = 'sig1',
  host = 'example.com',
  sign_as?: string,
) {
  const s = signed(
    label,
    [
      ['"@authority"', 'example.com'],
      [coveredAgent, sign_as ?? agentHeader.slice(agentHeader.indexOf('=') + 1)],
    ],
    parameters,
  )
  return [
    ['host', host],
    ['signature-agent', agentHeader],
    ['signature-input', s['signature-input']],
    ['signature', s.signature],
  ] as [string, string][]
}
const legacy = (origin: string, parameters = params()) => {
  const s = signed(
    'sig1',
    [
      ['"@authority"', 'example.com'],
      ['"signature-agent"', `"${origin}"`],
    ],
    parameters,
  )
  return [
    ['host', 'example.com'],
    ['signature-agent', `"${origin}"`],
    ['signature-input', s['signature-input']],
    ['signature', s.signature],
  ] as [string, string][]
}
const withMethod = (() => {
  const s = signed(
    'sig1',
    [
      ['"@method"', 'GET'],
      ['"@authority"', 'example.com'],
      ['"signature-agent"', '"https://signature-agent.test"'],
    ],
    params(),
  )
  return [
    ['host', 'example.com'],
    ['signature-agent', '"https://signature-agent.test"'],
    ['signature-input', s['signature-input']],
    ['signature', s.signature],
  ] as [string, string][]
})()
const replace = (headers: [string, string][], name: string, value: string): [string, string][] =>
  headers.map(([n, v]) => [n, n === name ? value : v])

const cases: Case[] = [
  {
    name: 'draft E.2.1: dictionary Signature-Agent whose member key differs from the label',
    headers: draft(E21),
    now: NOW,
    verdict: agent([VERIFIED], 'test-signer'),
  },
  {
    name: 'draft E.2.2: legacy bare-string Signature-Agent, inside its window',
    headers: draft(E22),
    now: 1735690000000,
    verdict: agent([VERIFIED], 'test-signer'),
  },
  {
    name: 'draft E.2.2 after it expired: declared, still named',
    headers: draft(E22),
    now: NOW,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'draft E.2.1 replayed to another authority',
    headers: draft(E21, 'example.org'),
    now: NOW,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'draft E.2.1 with a default port on the authority',
    headers: draft(E21, 'Example.COM:443'),
    now: NOW,
    verdict: agent([VERIFIED], 'test-signer'),
  },
  {
    name: 'dictionary member keyed by the label',
    headers: request('sig1="https://signature-agent.test"', '"signature-agent";key="sig1"'),
    now: NOW,
    verdict: agent([VERIFIED], 'test-signer'),
  },
  { name: 'covers @method: GET as signed', headers: withMethod, now: NOW, verdict: agent([VERIFIED], 'test-signer') },
  {
    name: 'covers @method: replayed as POST',
    headers: withMethod,
    method: 'POST',
    now: NOW,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'a valid signature from a signer not in the registry',
    headers: legacy('https://unknown.test'),
    now: NOW,
    verdict: agent([DECLARED]),
  },
  {
    name: 'a near-miss host is a different signer',
    headers: legacy('https://signature-agent.test.evil.example'),
    now: NOW,
    verdict: agent([DECLARED]),
  },
  {
    name: 'a Signature-Agent with a path is not an origin',
    headers: legacy('https://signature-agent.test/agents/1'),
    now: NOW,
    verdict: agent([DECLARED]),
  },
  {
    name: 'a Signature-Agent over http is not an origin',
    headers: legacy('http://signature-agent.test'),
    now: NOW,
    verdict: agent([DECLARED]),
  },
  {
    name: 'no web-bot-auth tag: not a Web Bot Auth signature',
    headers: legacy('https://signature-agent.test', `;created=${CREATED};keyid="${THUMBPRINT}";expires=${EXPIRES}`),
    now: NOW,
    verdict: human,
  },
  {
    name: 'another tag: not a Web Bot Auth signature',
    headers: legacy(
      'https://signature-agent.test',
      `;created=${CREATED};keyid="${THUMBPRINT}";expires=${EXPIRES};tag="other"`,
    ),
    now: NOW,
    verdict: human,
  },
  {
    name: 'origin: host case is not significant',
    headers: legacy('https://Signature-Agent.TEST'),
    now: NOW,
    verdict: agent([VERIFIED], 'test-signer'),
  },
  {
    name: 'origin: the default port is dropped',
    headers: legacy('https://signature-agent.test:443'),
    now: NOW,
    verdict: agent([VERIFIED], 'test-signer'),
  },
  {
    name: 'origin: another port is another signer',
    headers: legacy('https://signature-agent.test:8443'),
    now: NOW,
    verdict: agent([DECLARED]),
  },
  {
    name: 'origin: a trailing dot is another host',
    headers: legacy('https://signature-agent.test.'),
    now: NOW,
    verdict: agent([DECLARED]),
  },
  {
    name: 'origin: credentials are not an origin',
    headers: legacy('https://user@signature-agent.test'),
    now: NOW,
    verdict: agent([DECLARED]),
  },
  {
    name: 'origin: a backslash is not an origin',
    headers: legacy('https:\\\\signature-agent.test'),
    now: NOW,
    verdict: agent([DECLARED]),
  },
  {
    name: 'origin: a trailing slash is still the origin',
    headers: legacy('https://signature-agent.test/'),
    now: NOW,
    verdict: agent([VERIFIED], 'test-signer'),
  },
  {
    name: 'unparseable Signature-Input: no evidence',
    headers: replace(legacy('https://signature-agent.test'), 'signature-input', 'sig1=("@authority" "signature-agent"'),
    now: NOW,
    verdict: human,
  },
  {
    name: 'unknown keyid',
    headers: legacy(
      'https://signature-agent.test',
      `;created=${CREATED};keyid="not-a-bundled-key";expires=${EXPIRES};tag="web-bot-auth"`,
    ),
    now: NOW,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'alg other than ed25519',
    headers: legacy(
      'https://signature-agent.test',
      `;created=${CREATED};keyid="${THUMBPRINT}";alg="rsa-pss-sha512";expires=${EXPIRES};tag="web-bot-auth"`,
    ),
    now: NOW,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'created 3 s after the request time: inside the clock allowance',
    headers: legacy('https://signature-agent.test'),
    now: (CREATED - 3) * 1000,
    verdict: agent([VERIFIED], 'test-signer'),
  },
  {
    name: 'created 10 s after the request time: outside the clock allowance',
    headers: legacy('https://signature-agent.test'),
    now: (CREATED - 10) * 1000,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'one second past expires: no allowance',
    headers: legacy('https://signature-agent.test'),
    now: (EXPIRES + 1) * 1000,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'expires missing',
    headers: legacy('https://signature-agent.test', `;created=${CREATED};keyid="${THUMBPRINT}";tag="web-bot-auth"`),
    now: NOW,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'Signature-Agent covered whole while it has two members',
    headers: (() => {
      const agents = 'sig1="https://signature-agent.test", other="https://other.test"'
      const s = signed(
        'sig1',
        [
          ['"@authority"', 'example.com'],
          ['"signature-agent"', agents],
        ],
        params(),
      )
      return [
        ['host', 'example.com'],
        ['signature-agent', agents],
        ['signature-input', s['signature-input']],
        ['signature', s.signature],
      ] as [string, string][]
    })(),
    now: NOW,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'a member whose discovery type is unsupported is ignored',
    headers: request('sig1="https://signature-agent.test";type=carrier-pigeon', '"signature-agent";key="sig1"'),
    now: NOW,
    verdict: agent([DECLARED]),
  },
  {
    name: 'Signature-Agent absent',
    headers: legacy('https://signature-agent.test').filter(([n]) => n !== 'signature-agent'),
    now: NOW,
    verdict: agent([DECLARED]),
  },
  {
    name: 'signature tampered: one byte changed',
    headers: replace(
      legacy('https://signature-agent.test'),
      'signature',
      legacy('https://signature-agent.test')[3]![1].replace(/:(.)/, (_, c) => `:${c === 'A' ? 'B' : 'A'}`),
    ),
    now: NOW,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'a Signature header mangled on the way: still a declared signer',
    headers: replace(
      legacy('https://signature-agent.test'),
      'signature',
      'sig1=:CylMEf/+fgS0UTU9ARBr/:token/lV2WUpUOk1ze4MeGS4MAZpoDQ==:',
    ),
    now: NOW,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'signature of the wrong length',
    headers: replace(legacy('https://signature-agent.test'), 'signature', 'sig1=:AAAA:'),
    now: NOW,
    verdict: agent([DECLARED], 'test-signer'),
  },
  {
    name: 'two signers that disagree give no name',
    headers: (() => {
      const a = signed(
        'sig1',
        [
          ['"@authority"', 'example.com'],
          ['"signature-agent";key="sig1"', '"https://signature-agent.test"'],
        ],
        params(),
      )
      const b = signed(
        'sig2',
        [
          ['"@authority"', 'example.com'],
          ['"signature-agent";key="sig2"', '"https://other.test"'],
        ],
        params(),
      )
      return [
        ['host', 'example.com'],
        ['signature-agent', 'sig1="https://signature-agent.test", sig2="https://other.test"'],
        ['signature-input', `${a['signature-input']}, ${b['signature-input']}`],
        ['signature', `${a.signature}, ${b.signature}`],
      ] as [string, string][]
    })(),
    now: NOW,
    verdict: agent([VERIFIED, DECLARED]),
  },
  {
    name: 'a verified signer and a token for another agent give no name',
    headers: [
      ...request('sig1="https://signature-agent.test"', '"signature-agent";key="sig1"'),
      ['user-agent', 'Devin/1.0'],
    ],
    now: NOW,
    verdict: agent([VERIFIED, 'ua.declared-agent-token']),
  },
  {
    name: 'a person: Chrome on a Mac',
    headers: [
      ['host', 'example.com'],
      ['user-agent', CHROME],
      ['sec-fetch-dest', 'document'],
    ],
    verdict: human,
  },
  { name: 'no headers at all', headers: [], verdict: human },
  {
    name: 'HeadlessChrome declares automation and names nothing',
    headers: [['user-agent', CHROME.replace('Chrome/', 'HeadlessChrome/')]],
    verdict: agent(['ua.headless-chrome']),
  },
  {
    name: 'a declared token',
    headers: [['user-agent', 'Mozilla/5.0 (compatible; Devin/1.0; +https://devin.ai)']],
    verdict: agent(['ua.declared-agent-token'], 'devin'),
  },
  {
    name: 'a token inside a longer word is not the token',
    headers: [['user-agent', 'Mozilla/5.0 (X11; DevinOS) Chrome/141.0.0.0']],
    verdict: human,
  },
  { name: 'a token with a prefix glued on is not the token', headers: [['user-agent', 'xDevin/1.0']], verdict: human },
  {
    name: 'two tokens for the same agent',
    headers: [['user-agent', 'Manus-User/1.0 Manus-User/2.0']],
    verdict: agent(['ua.declared-agent-token'], 'manus'),
  },
  {
    name: "Cloudflare's verified-bot category",
    headers: [['user-agent', CHROME]],
    cf: { verifiedBotCategory: 'AI Assistant' },
    verdict: agent(['signer.edge-verified-bot']),
  },
  {
    name: 'an empty verified-bot category is no evidence',
    headers: [['user-agent', CHROME]],
    cf: { verifiedBotCategory: '' },
    verdict: human,
  },
  {
    name: "Bot Management's verifiedBot flag",
    headers: [['user-agent', CHROME]],
    cf: { botManagement: { verifiedBot: true } },
    verdict: agent(['signer.edge-verified-bot']),
  },
  {
    name: 'header names in any case, duplicates joined',
    headers: [
      ['User-Agent', 'Devin/1.0'],
      ['Host', 'example.com'],
    ],
    verdict: agent(['ua.declared-agent-token'], 'devin'),
  },
]

const vectors = {
  $comment:
    'inspect must give exactly these verdicts. Run each request with registry.signers and registry.keys (a test signer, using the Ed25519 test key from RFC 9421 Appendix B.1.4) and the bundled tokens; method defaults to GET, now to the time given. Generated by scripts/vectors.ts.',
  registry: {
    signers: { 'signature-agent.test': 'test-signer', 'other.test': 'other-signer' },
    keys: {
      'signature-agent.test': [{ x: TEST_KEY.x, thumbprint: THUMBPRINT, kid: null, nbf: null, exp: null }],
      'other.test': [
        { x: OTHER_X, thumbprint: 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k', kid: null, nbf: null, exp: null },
      ],
    },
  },
  cases,
}
writeFileSync(new URL('../vectors/requests.json', import.meta.url), JSON.stringify(vectors, null, 1) + '\n')
console.log(`wrote vectors/requests.json: ${cases.length} cases`)
