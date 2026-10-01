"""The server half on Flask: one line, Botscent(app).

The site runs at the origin, which cannot see whether a CDN in front of it stores
HTML, so the Server-Timing transport is off unless Botscent(app, transport=True)."""

from flask import Flask, g, jsonify, request

from botscent.flask import Botscent

app = Flask(__name__)
Botscent(app)


@app.route("/verdict", methods=["GET", "POST"])
def verdict():
    # flask.g.botscent is what this request itself declared. The stale botscent entry
    # stands in for one a cache might replay; the extension removes it.
    response = jsonify(verdict=g.botscent, bytes=len(request.get_data()))
    response.headers["Server-Timing"] = 'botscent;desc="1;chatgpt;1;signer.web-bot-auth.verified", app;dur=1'
    return response
