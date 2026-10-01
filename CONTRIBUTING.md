# Contributing

Issues and pull requests are welcome, in particular reports of agents that Botscent misses (with what the agent sends or shows) and of people it reports as agents (see [SECURITY.md](SECURITY.md): those are urgent).

## Developer Certificate of Origin

Contributions are accepted under the [Developer Certificate of Origin](https://developercert.org/), not a contributor licence agreement. Sign off every commit:

```sh
git commit -s
```

The sign-off certifies that you wrote the change or otherwise have the right to submit it under the project's MIT licence.

## Development

[AGENTS.md](AGENTS.md) lists the commands and the rules of the repository; they apply to people as much as to agents. In short: the contract in `spec/` is the specification, the TypeScript and Python halves must agree on `vectors/`, `registry/*.json` is the one source of data, and generated files are never edited by hand.

## Adding an agent or a declaration

1. Add the name to `registry/names.json` with its display name, vendor, kind and sources.
2. Add what identifies it: a user-agent token in `registry/tokens.json` (with a link to the vendor's own documentation of the token in the pull request), a Web Bot Auth signer in `registry/signers.json` and its keys in `registry/keys.json`, or a page declaration in `registry/page.json`.
3. Run `npm run generate`, add a case to `scripts/vectors.ts` and run `npm run vectors`, then `node scripts/docs.ts`.
4. Add a changeset (`npx changeset`, minor): any change to a verdict is a minor release.
