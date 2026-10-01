"""The Python backend for the slice: BotscentMiddleware on a FastAPI app.

request.state.botscent is what each request itself declared; a page report joins it
only through read_report and combine, explicitly."""

from fastapi import FastAPI, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

import botscent
from botscent.asgi import BotscentMiddleware

app = FastAPI()
app.add_middleware(BotscentMiddleware)


@app.post("/checkout")
async def checkout(request: Request):
    own = request.state.botscent
    report = botscent.read_report(request.headers.get("botscent-report"))
    return {"request": own, "report": report, "combined": botscent.combine(own, report)}


@app.post("/form", response_class=HTMLResponse)
async def form(request: Request):
    fields = await request.form()
    own = request.state.botscent
    report = botscent.read_report(fields.get("botscent"))
    import json

    body = {"fields": sorted(fields.keys()), "request": own, "report": report, "combined": botscent.combine(own, report)}
    return f'<!doctype html><pre id="posted">{json.dumps(body)}</pre>'


@app.post("/upload")
async def upload(name: str = "", file: UploadFile | None = None, request: Request = None):
    data = await file.read() if file else b""
    return {"size": len(data), "first": data[:4].hex(), "verdict": request.state.botscent}


@app.get("/stream")
async def stream():
    import asyncio

    async def chunks():
        for i in range(3):
            yield f"chunk {i}\n"
            await asyncio.sleep(0.2)

    return StreamingResponse(chunks(), media_type="text/plain")


@app.api_route("/verdict", methods=["GET", "POST"])
async def verdict(request: Request):
    # The examples' shared check. The stale botscent entry stands in for one a cache
    # might replay; the middleware removes it.
    body = await request.body()
    return JSONResponse(
        {"verdict": request.state.botscent, "bytes": len(body)},
        headers={"Server-Timing": 'botscent;desc="1;chatgpt;1;signer.web-bot-auth.verified", app;dur=1'},
    )
