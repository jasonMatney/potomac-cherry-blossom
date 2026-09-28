import sys, time, json, os
from playwright.sync_api import sync_playwright
# usage: multi.py spec.json  (list of [name, js])
spec = json.load(open(sys.argv[1]))
W = int(os.environ.get("VW","960")); H = int(os.environ.get("VH","540"))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width":W,"height":H})
    logs=[]
    pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    t0=time.time()
    pg.goto("file://" + os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist", "index.html")))
    pg.wait_for_function("window.APP && window.APP.ready", timeout=900000)
    print("ready", round(time.time()-t0), flush=True)
    pg.evaluate("APP.paused=true; const l=document.getElementById('ld'); if(l) l.remove();")
    for name, js in spec:
        r = pg.evaluate(js)
        pg.screenshot(path=f"shots/{name}.png", timeout=600000)
        print(name, r, round(time.time()-t0), flush=True)
    print("\n".join([l for l in logs if 'non-indexed' not in l][:30]), flush=True)
    b.close()
