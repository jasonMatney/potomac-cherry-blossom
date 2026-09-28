import os
import sys, time, json
from playwright.sync_api import sync_playwright
# usage: shot.py out_prefix "js to run before shot" ...
args = sys.argv[1:]
W = 1280; H = 720
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--allow-file-access-from-files"])
    pg = b.new_page(viewport={"width":W,"height":H})
    logs = []
    pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    reqs = []
    pg.on("request", lambda r: reqs.append(r.url) if not r.url.startswith("file:") and not r.url.startswith("data:") and not r.url.startswith("blob:") else None)
    t0=time.time()
    pg.goto("file://" + os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dist", "index.html")))
    try:
        pg.wait_for_function("window.APP && window.APP.ready", timeout=600000)
    except Exception as e:
        logs.append("TIMEOUT waiting ready " + str(e)[:200])
    print("load time", round(time.time()-t0,1))
    for i in range(0, len(args), 2):
        name, js = args[i], args[i+1]
        if js: 
            r = pg.evaluate(js)
            if r is not None: print(name, "->", r)
        pg.screenshot(path=f"shots/{name}.png", timeout=600000)
    print("\n".join(logs[:60]))
    print("external requests:", reqs)
    b.close()
