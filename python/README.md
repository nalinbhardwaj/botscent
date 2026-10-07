[![Botscent — Detect AI agents on your site.](https://raw.githubusercontent.com/nalinbhardwaj/botscent/main/docs/assets/botscent-social.png)](https://botscent.nibnalin.me)

# Botscent

Botscent tells your site if an AI agent is browsing it, and which agent.

[Website](https://botscent.nibnalin.me) · [Docs](https://botscent.nibnalin.me/docs) · [GitHub](https://github.com/nalinbhardwaj/botscent)

This package is the server half of Botscent for Python. It reads what one request declares: a [Web Bot Auth](https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol/) signature checked against the keys bundled in each release, a user-agent token that an agent or crawler publishes for itself, or your host's verified-bot field. It reads headers only and calls no service. Its one dependency is `cryptography`.

The page half runs in the browser and finds agents inside a person's own browser. Add it from npm or with a script tag. See the [quickstart](https://botscent.nibnalin.me/docs/quickstart).

## Install

```sh
pip install botscent
```

## Add it

```python
# FastAPI and Starlette: request.state.botscent
from botscent.asgi import BotscentMiddleware
app.add_middleware(BotscentMiddleware)
```

```python
# Django: request.botscent
MIDDLEWARE = [..., "botscent.django.BotscentMiddleware"]
```

```python
# Flask: flask.g.botscent
from botscent.flask import Botscent
Botscent(app)
```

```python
# Any other framework
import botscent
verdict = botscent.inspect(request)  # a Request, a dict of headers, or anything with .headers
```

Each call returns a verdict:

```python
{"type": "agent", "agent_name": "chatgpt", "reasons": ["signer.web-bot-auth.verified"]}
```

`human` means that Botscent found no agent evidence. It does not prove that a person is there.

## Give an agent access

```python
if botscent.is_verified(verdict, "chatgpt"):
    ...  # a signature verified against ChatGPT's bundled keys
```

> **Warning:** Use only `is_verified` for access. Anyone can send the headers that produce a name.

## Verify

```sh
npx botscent check https://your-site.example/
```

## More

- [FastAPI](https://botscent.nibnalin.me/docs/fastapi), [Django](https://botscent.nibnalin.me/docs/django) and [Flask](https://botscent.nibnalin.me/docs/flask) guides
- [Python API](https://botscent.nibnalin.me/docs/python-api)
- [Repository](https://github.com/nalinbhardwaj/botscent): the README, the contract and the agents Botscent names

MIT.
