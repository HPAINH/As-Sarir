import sys, json, time, subprocess, os, argparse
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("--q", default="quick=avar")
ap.add_argument("--out", default="/tmp/shot.png")
ap.add_argument("--wait", type=float, default=4.0)
ap.add_argument("--steps", default="[]")
ap.add_argument("--w", type=int, default=800)
ap.add_argument("--h", type=int, default=450)
ap.add_argument("--port", type=int, default=8765)
ap.add_argument("--timeout", type=float, default=90)
a = ap.parse_args()

srv = subprocess.Popen([sys.executable, "-m", "http.server", str(a.port), "--bind", "127.0.0.1"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.6)
logs = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                                    "--ignore-gpu-blocklist", "--enable-webgl"])
        pg = b.new_page(viewport={"width": a.w, "height": a.h})
        pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e} {getattr(e, "stack", "")}"))
        t0 = time.time()
        pg.goto(f"http://127.0.0.1:{a.port}/index.html?{a.q}")
        ok = True
        try:
            pg.wait_for_function("window.GAME_READY === true", timeout=a.timeout * 1000)
        except Exception as e:
            ok = False
            logs.append(f"[harness] not ready: {e}")
        logs.append(f"[harness] ready={ok} in {time.time() - t0:.1f}s")
        for st in json.loads(a.steps):
            kind = st[0]
            if kind == "wait":
                pg.wait_for_timeout(st[1] * 1000)
            elif kind == "key":
                pg.keyboard.down(st[1]); pg.wait_for_timeout(st[2] * 1000); pg.keyboard.up(st[1])
            elif kind == "press":
                pg.keyboard.press(st[1])
            elif kind == "js":
                r = pg.evaluate(st[1])
                logs.append(f"[js] {json.dumps(r, ensure_ascii=False)[:2000]}")
            elif kind == "shot":
                pg.screenshot(path=st[1], timeout=120000)
            elif kind == "click":
                pg.mouse.click(st[1], st[2], button=st[3] if len(st) > 3 else "left")
            elif kind == "mousedown":
                pg.mouse.down(button=st[1])
            elif kind == "mouseup":
                pg.mouse.up(button=st[1])
        pg.wait_for_timeout(a.wait * 1000)
        try:
            stats = pg.evaluate("window.G && window.G.engine ? {fps: Math.round(window.G.engine.fps), calls: window.G.engine.stats.calls, tris: window.G.engine.stats.tris, pos: window.G.player ? window.G.player.pos.toArray().map(v=>Math.round(v*10)/10) : null} : null")
            logs.append(f"[stats] {json.dumps(stats)}")
        except Exception as e:
            logs.append(f"[stats] err {e}")
        for l in logs:
            print(l[:1500], flush=True)
        logs.clear()
        try:
            pg.screenshot(path=a.out, timeout=120000)
        except Exception as e:
            print("[harness] screenshot failed", str(e)[:200])
        b.close()
finally:
    srv.terminate()
seen = set()
for l in logs:
    if l in seen:
        continue
    seen.add(l)
    print(l[:1500])
