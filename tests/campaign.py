import sys, json, time, subprocess, os
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
people = sys.argv[1] if len(sys.argv) > 1 else "avar"
chunks = int(sys.argv[2]) if len(sys.argv) > 2 else 40
port = 8771
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.6)
logs = []
LOOP = """async (n) => { const log=[]; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 for (let k=0;k<n;k++){ if (G.state.flags.campaign_done) { log.push('CAMPAIGN DONE'); break; }
   const s=QA.state();
   if (s.active && s.ready) { try { log.push(await Promise.race([QA.solve(), sleep(9000).then(()=>'TIMEOUT')])); } catch(e) { log.push('ERR '+e.message); } await sleep(250); }
   else if (!s.active) { const nx=G.quests.nextMain(); if(!nx){log.push('no next');break;}
      if (G.quests.giverDef) { log.push('begin '+nx.id); G.quests.begin(G.quests.giverDef,0); }
      else if (!G.quests.available(nx)) { log.push('blocked '+nx.id); }
      await sleep(400); }
   else await sleep(250);
 } return log.join(' | '); }"""
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        pg = b.new_page(viewport={"width": 640, "height": 360})
        pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e} {getattr(e, "stack", "")}"))
        pg.goto(f"http://127.0.0.1:{port}/index.html?quick={people}&q=low&debug=1")
        pg.wait_for_function("window.GAME_READY === true", timeout=120000)
        t0 = time.time()
        frm = sys.argv[3] if len(sys.argv) > 3 else None
        if frm:
            pg.wait_for_timeout(2500)
            print(pg.evaluate("""(frm)=>{const q=G.quests; if(q.job){q.cleanupJob(q.job); q.job=null;} G.state.missions.active=null;
              const ids=q.main.map(m=>m.id); G.state.missions.done=ids.slice(0, ids.indexOf(frm));
              for (const p of ['avar','dargin','lak','lezgin','tabasaran']) if(!G.state.unity.includes(p)) G.state.unity.push(p);
              const m=q.byId[frm]; G.state.act=m.act; q.autoNext(); return frm;}""", frm))
        for c in range(chunks):
            r = pg.evaluate(LOOP, 12)
            dbg = pg.evaluate("(()=>{const p=G.player;const j=G.quests.job;return JSON.stringify({mount:!!p.mount,pos:p.pos.toArray().map(Math.round),at:j&&j.st&&j.st.at,horse:G.playerHorse?G.playerHorse.pos.toArray().map(Math.round):null, rider: G.playerHorse&&!!G.playerHorse.rider, fps:Math.round(G.engine.fps), t: j&&j.st&&Math.round(j.st.t), tok:j&&j.token, ub:G.uiBlocking, failed:j&&j.failed, used:j&&j.st&&j.st.used, npts:j&&j.st&&j.st.pts&&j.st.pts.length, dlg:G.dialog.active, cs:G.cutscene.active, open:G.ui.open})})()")
            print("   dbg", dbg)
            st = pg.evaluate("JSON.stringify(QA.state())")
            print(f"[{time.time()-t0:.0f}s] {r}\n   -> {st}", flush=True)
            while logs: print("  ", logs.pop(0)[:1500], flush=True)
            if "CAMPAIGN DONE" in r or "no next" in r: break
        b.close()
finally:
    srv.terminate()
