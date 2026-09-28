import json, sys
def view(h, s, a, n=40):
    return f"(()=>{{ APP.setHour({h}); APP.jump({s}); for(let k=0;k<{n};k++) APP.step(1/30,false); APP.freeCam=true; APP.viewSD({a}); APP.step(1/30); return 1; }})()"
def chase(h, s, n=60, extra=""):
    return f"(()=>{{ APP.freeCam=false; APP.setHour({h}); APP.jump({s}); for(let k=0;k<{n};k++) APP.step(1/30, false); {extra} APP.step(1/30); return APP.S.hour.toFixed(2); }})()"
