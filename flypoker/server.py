"""The fair screen's backend: plays paced exhibition hands and streams them to every open screen.

    uv run python -m flypoker.server            # http://localhost:8765 (serves web/dist if built)

WebSocket /ws carries JSON text messages (see web/src/protocol.ts) and binary brain frames:
    [u8 kind=1][u8 step][u8 steps][u8 0] + one activity byte per neuron, in brain order.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import numpy as np
from aiohttp import WSMsgType, web

from flypoker.exhibit import Exhibition, Frame, run_stats
from flypoker.positions import POSITIONS, REGIONS

WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"

# Seconds to hold after each kind of event, so a hand reads at human pace from across a gym.
PACE = {
    "hand": 1.5,
    "board": 1.2,
    "action": 1.3,
    "thinking": 0.3,
    "frame": 0.16,
    "decision": 1.8,
    "result": 3.5,
}


class Hub:
    def __init__(self, exhibition: Exhibition):
        self.ex = exhibition
        self.sockets: set[web.WebSocketResponse] = set()
        self.current: list[str] = []  # this hand's JSON events, replayed to late joiners

    async def send(self, msg: str | bytes) -> None:
        for ws in list(self.sockets):
            try:
                await (ws.send_bytes(msg) if isinstance(msg, bytes) else ws.send_str(msg))
            except ConnectionResetError:
                self.sockets.discard(ws)

    async def play_forever(self) -> None:
        while True:
            gen = await asyncio.to_thread(self.ex.hand)
            self.current = []
            while True:
                ev = await asyncio.to_thread(next, gen, None)
                if ev is None:
                    break
                if isinstance(ev, Frame):
                    await self.send(bytes([1, ev.step, ev.steps, 0]) + ev.activity)
                    await asyncio.sleep(PACE["frame"])
                    continue
                text = json.dumps(ev)
                self.current.append(text)
                await self.send(text)
                await asyncio.sleep(PACE[ev["type"]])

    async def stats_forever(self) -> None:
        while True:
            await self.send(json.dumps({"type": "stats", **run_stats()}))
            await asyncio.sleep(15)


def make_app(arm: str) -> web.Application:
    pos = np.load(POSITIONS)
    xyz, region = pos["xyz"].astype(np.float32), pos["region"].astype(np.uint8)
    hub = Hub(Exhibition(arm))
    app = web.Application()

    async def meta(_):
        return web.json_response({
            "neurons": int(len(region)),
            "regions": REGIONS,
            "readout": hub.ex.brain.descending.tolist(),
            "sensory_count": int(len(hub.ex.brain.sensory)),
            "arm": arm,
        })

    async def neurons(_):
        return web.Response(body=xyz.tobytes() + region.tobytes(), content_type="application/octet-stream")

    async def socket(request):
        ws = web.WebSocketResponse(heartbeat=20)
        await ws.prepare(request)
        hub.sockets.add(ws)
        await ws.send_str(json.dumps({"type": "stats", **run_stats()}))
        for text in hub.current:
            await ws.send_str(text)
        async for msg in ws:
            if msg.type == WSMsgType.ERROR:
                break
        hub.sockets.discard(ws)
        return ws

    async def start(app):
        app["tasks"] = [asyncio.create_task(hub.play_forever()), asyncio.create_task(hub.stats_forever())]

    app.router.add_get("/api/meta", meta)
    app.router.add_get("/api/neurons", neurons)
    app.router.add_get("/ws", socket)
    if WEB_DIST.exists():
        async def index(_):
            return web.FileResponse(WEB_DIST / "index.html")
        app.router.add_get("/", index)
        app.router.add_static("/", WEB_DIST)
    app.on_startup.append(start)
    return app


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arm", default="real")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    web.run_app(make_app(a.arm), host="127.0.0.1", port=a.port)


if __name__ == "__main__":
    main()
