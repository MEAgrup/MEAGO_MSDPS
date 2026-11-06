# Hitung metrik laporan ala "Analisa Sushi Yay" dari export Video List (Agu & Sep 2026).
# Hanya memakai kolom yang akan disimpan tabel snapshot MSDPS.
import sys, json, re, statistics, collections, datetime as dt
import openpyxl
src, out = sys.argv[1], sys.argv[2]
MONTHS = [("Agus 2026","2026-08","Agu"),("SEPT 2026","2026-09","Sep")]
ALIAS = {"current status":"status","creator binding status":"creator link status","industry":"location industry"}
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
def num(v):
    try: return float(v) if v not in (None,"") else 0.0
    except: return 0.0
rows=[]  # post x outlet x month, aggregated
for sheet, ym, label in MONTHS:
    ws = wb[sheet]; it = ws.iter_rows(values_only=True)
    hdr=[ALIAS.get(str(h).strip().lower(), str(h).strip().lower()) for h in next(it)]
    ix={h:i for i,h in enumerate(hdr)}
    agg={}
    for r in it:
        if r[ix["post id"]] in (None,""): continue
        if str(r[ix["status"]]).strip()!="Valid posts": continue
        key=(str(r[ix["post id"]]), str(r[ix["location id"]]))
        a=agg.setdefault(key, dict(month=ym, label=label, post_id=key[0], location_id=key[1],
            location_name=re.sub(r"^Sushi Yay!?\s*-\s*","",str(r[ix["location name"]]).strip()),
            city=str(r[ix["location city"]] or "").strip(), title=str(r[ix["post title"]] or ""),
            post_date=str(r[ix["post date"]] or ""), duration=num(r[ix["duration"]]) or None,
            task=str(r[ix["task type"]] or ""), creator=str(r[ix["creator id"]] or "").lower(),
            creator_name=str(r[ix["creator name"]] or ""), link=str(r[ix["creator link status"]] or "").strip(),
            level=str(r[ix["creator level"]] or ""), creator_city=str(r[ix["creator city"]] or ""),
            gmv=0.0, orders=0, red=0.0, red_orders=0, views=0))
        a["gmv"]+=num(r[ix["sales value"]]); a["orders"]+=int(num(r[ix["orders"]]))
        a["red"]+=num(r[ix["redemption amount"]]); a["red_orders"]+=int(num(r[ix["redeemed orders"]]))
        a["views"]+=int(num(r[ix["video views"]]))
    rows+=list(agg.values())
def bucket(o):
    return "0" if o==0 else "1-5" if o<=5 else "6-10" if o<=10 else "11-20" if o<=20 else "21-50" if o<=50 else ">50"
def prank(vals):  # percentile rank 0..1 (inclusive, like PERCENTRANK.INC-ish)
    s=sorted(vals); n=len(s)
    return {v:(s.index(v)/(n-1) if n>1 else 1.0) for v in set(vals)}
res={"brand":"Sushi Yay","period":[m[1] for m in MONTHS],"labels":[m[2] for m in MONTHS]}
# --- bulanan
monthly=[]
for sheet,ym,label in MONTHS:
    R=[r for r in rows if r["month"]==ym]
    gmv=sum(r["gmv"] for r in R); orders=sum(r["orders"] for r in R); views=sum(r["views"] for r in R); red=sum(r["red"] for r in R)
    posts={r["post_id"] for r in R}; newposts={r["post_id"] for r in R if r["post_date"].startswith(ym.replace("-",""))}
    creators={r["creator"] for r in R}; cre_gmv={r["creator"] for r in R if r["gmv"]>0}
    outlets={r["location_id"] for r in R}; outlet_orders=collections.Counter()
    for r in R: outlet_orders[r["location_id"]]+=r["orders"]
    monthly.append(dict(label=label, gmv=gmv, orders=orders, views=views, redemption=red,
        red_rate=red/gmv if gmv else 0, aov=gmv/orders if orders else 0, new_posts=len(newposts), active_posts=len(posts),
        gmv_per_post=gmv/len(posts) if posts else 0, order_per_1k=orders/(views/1000) if views else 0,
        outlets_seen=len(outlets), outlets_active=sum(1 for v in outlet_orders.values() if v>0),
        creators_active=len(creators), creators_gmv=len(cre_gmv), outlets_gt50=sum(1 for v in outlet_orders.values() if v>50),
        buckets=collections.Counter(bucket(outlet_orders[o]) for o in outlets)))
res["monthly"]=monthly
tot=dict(gmv=sum(m["gmv"] for m in monthly), orders=sum(m["orders"] for m in monthly), views=sum(m["views"] for m in monthly), red=sum(m["redemption"] for m in monthly))
tot["red_rate"]=tot["red"]/tot["gmv"]; tot["aov"]=tot["gmv"]/tot["orders"]; res["total"]=tot
# --- outlet
O=collections.defaultdict(lambda: dict(gmv=0,orders=0,red=0,views=0,city="",name="",by_month=collections.Counter(),newpost=collections.Counter()))
for r in rows:
    o=O[r["location_id"]]; o["gmv"]+=r["gmv"]; o["orders"]+=r["orders"]; o["red"]+=r["red"]; o["views"]+=r["views"]
    o["name"]=o["name"] or r["location_name"]; o["city"]=o["city"] or r["city"]; o["by_month"][r["label"]]+=r["orders"]
    if r["post_date"].startswith(r["month"].replace("-","")): o["newpost"][r["label"]]+=1
pg=prank([o["gmv"] for o in O.values()]); pr=prank([o["red"] for o in O.values()]); po=prank([o["orders"] for o in O.values()])
outlets=[]
for lid,o in O.items():
    score=0.4*pg[o["gmv"]]+0.3*pr[o["red"]]+0.3*po[o["orders"]]
    outlets.append(dict(id=lid, name=o["name"], city=o["city"], gmv=o["gmv"], orders=o["orders"], red=o["red"], views=o["views"],
        red_rate=o["red"]/o["gmv"] if o["gmv"] else 0, score=score, layer=1 if score>=0.8 else 2 if score>=0.4 else 3,
        orders_by_month={m[2]:o["by_month"][m[2]] for m in MONTHS}, newpost_by_month={m[2]:o["newpost"][m[2]] for m in MONTHS}))
outlets.sort(key=lambda x:-x["gmv"]); res["outlets"]=outlets
res["layer_outlet"]={L:dict(n=sum(1 for o in outlets if o["layer"]==L), gmv=sum(o["gmv"] for o in outlets if o["layer"]==L), orders=sum(o["orders"] for o in outlets if o["layer"]==L)) for L in (1,2,3)}
# --- kota
C=collections.defaultdict(lambda: dict(gmv=0,orders=0,views=0,outlets=set(),by_month=collections.Counter()))
for o in outlets:
    c=C[o["city"] or "(tanpa kota)"]; c["gmv"]+=o["gmv"]; c["orders"]+=o["orders"]; c["views"]+=o["views"]; c["outlets"].add(o["id"])
for r in rows: C[r["city"] or "(tanpa kota)"]["by_month"][r["label"]]+=r["gmv"]
res["cities"]=sorted([dict(city=k, gmv=v["gmv"], orders=v["orders"], n_outlets=len(v["outlets"]), gmv_per_outlet=v["gmv"]/len(v["outlets"]),
    by_month={m[2]:v["by_month"][m[2]] for m in MONTHS}) for k,v in C.items()], key=lambda x:-x["gmv"])
# --- creator
K=collections.defaultdict(lambda: dict(gmv=0,orders=0,red=0,views=0,posts=set(),name="",city="",level="",link="",last_post="",by_month=collections.Counter()))
last_month=MONTHS[-1][1]
for r in rows:
    k=K[r["creator"]]; k["gmv"]+=r["gmv"]; k["orders"]+=r["orders"]; k["red"]+=r["red"]; k["views"]+=r["views"]; k["posts"].add(r["post_id"])
    k["name"]=k["name"] or r["creator_name"]; k["city"]=r["creator_city"] or k["city"]; k["level"]=r["level"] or k["level"]
    if r["month"]==last_month and r["link"]: k["link"]=r["link"]
    k["last_post"]=max(k["last_post"], r["post_date"]); k["by_month"][r["label"]]+=r["gmv"]
asof=dt.date(2026,9,30)
creators=[]
for u,k in K.items():
    try: lp=dt.datetime.strptime(k["last_post"],"%Y%m%d").date(); days=(asof-lp).days
    except: days=None
    creators.append(dict(username=u, name=k["name"], city=k["city"], level=k["level"], bound=bool(k["link"]), gmv=k["gmv"], orders=k["orders"], red=k["red"], views=k["views"],
        posts=len(k["posts"]), gmv_per_post=k["gmv"]/len(k["posts"]) if k["posts"] else 0, days_since=days,
        activity="Aktif" if days is not None and days<=14 else "Melambat" if days is not None and days<=30 else "Tidak posting >30 hari",
        by_month={m[2]:k["by_month"][m[2]] for m in MONTHS}))
creators.sort(key=lambda x:-x["gmv"])
tg=sum(c["gmv"] for c in creators)
res["creator_share"]=dict(top2=sum(c["gmv"] for c in creators[:2])/tg, top10=sum(c["gmv"] for c in creators[:10])/tg, n=len(creators), n_gmv=sum(1 for c in creators if c["gmv"]>0))
elig=[c for c in creators if c["bound"] and c["gmv"]>0]
pg=prank([c["gmv"] for c in elig]); pr=prank([c["red"] for c in elig]); po=prank([c["orders"] for c in elig])
for c in creators:
    if c in elig:
        s=0.4*pg[c["gmv"]]+0.3*pr[c["red"]]+0.3*po[c["orders"]]; c["score"]=s; c["layer"]="Layer 1" if s>=0.9 else "Layer 2" if s>=0.6 else "Monitor"
    elif c["bound"] and c["views"]>=1000: c["layer"]="Layer 3"
    elif c["bound"]: c["layer"]="Monitor"
    else: c["layer"]="Tidak bound/linked"
res["creator_layers"]={L:dict(n=sum(1 for c in creators if c["layer"]==L), gmv=sum(c["gmv"] for c in creators if c["layer"]==L)) for L in ("Layer 1","Layer 2","Layer 3","Monitor","Tidak bound/linked")}
res["creator_activity"]=collections.Counter(c["activity"] for c in creators if c["bound"])
res["creators_top"]=creators[:10]
# --- best practice (post-level, post x outlet rows)
P=sorted(rows, key=lambda r:-r["gmv"]); n5=max(1,round(len(P)*0.05)); top=P[:n5]; rest=P[n5:]
res["best"]=dict(top5_share=sum(r["gmv"] for r in top)/sum(r["gmv"] for r in P), n_rows=len(P), n_top=n5,
    median_views_top=statistics.median([r["views"] for r in top]), median_views_rest=statistics.median([r["views"] for r in rest]))
def dbucket(d): return "≤15 dtk" if d<=15 else "16–25 dtk" if d<=25 else "26–35 dtk" if d<=35 else ">35 dtk"
def vbucket(v): return "≤500" if v<=500 else "501–2.000" if v<=2000 else "2.000–10.000" if v<=10000 else "10.000–50.000" if v<=50000 else ">50.000"
dur=collections.defaultdict(lambda:[0,0]); vw=collections.defaultdict(lambda:[0,0])
for r in rows:
    if r["duration"]: b=dbucket(r["duration"]); dur[b][0]+=1; dur[b][1]+= r["gmv"]>0
    b=vbucket(r["views"]); vw[b][0]+=1; vw[b][1]+= r["gmv"]>0
res["best"]["duration"]={k:dict(n=v[0], sell_rate=v[1]/v[0]) for k,v in dur.items()}
res["best"]["views"]={k:dict(n=v[0], sell_rate=v[1]/v[0]) for k,v in vw.items()}
res["best"]["gmv_top_share_by_duration"]={k:sum(r["gmv"] for r in top if r["duration"] and dbucket(r["duration"])==k)/sum(r["gmv"] for r in top) for k in dur}
feats={"Menyebut harga / diskon":r"(\d+\s?(rb|ribu|k)\b|rp\s?\d|diskon|promo|cuma|hanya|murah|gratis)",
       "CTA tag lokasi":r"(tag lokasi|klik.*lokasi|lokasi.*(hijau|klik)|pilih voucher)",
       "Menyebut nama outlet / kota":r"(bandung|jakarta|bogor|depok|bekasi|tangerang|medan|makassar|pekanbaru|cirebon|sidoarjo|surabaya|cimahi|yogyakarta|jogja|semarang|malang|cikarang|bintaro|bsd|cibubur)",
       "Kata urgensi":r"(buruan|sekarang|cepet|cepat|segera|jangan sampai|terbatas|hari ini)",
       "Edukasi AYCE / paket":r"(ayce|all you can eat|premium|ultimate|reguler|paket)"}
bp=[]
for name,rx in feats.items():
    w=[r for r in rows if re.search(rx, r["title"], re.I)]; wo=[r for r in rows if not re.search(rx, r["title"], re.I)]
    bp.append(dict(feature=name, n=len(w), sell_rate=sum(1 for r in w if r["gmv"]>0)/len(w) if w else 0,
        sell_rate_without=sum(1 for r in wo if r["gmv"]>0)/len(wo) if wo else 0,
        lift=(sum(r["gmv"] for r in w)/len(w))/((sum(r["gmv"] for r in wo)/len(wo)) or 1) if w and wo else 0))
res["best"]["features"]=bp
seen=set(); tp=[]
for r in P:
    if r["post_id"] in seen: continue
    seen.add(r["post_id"]); tp.append(dict(creator=r["creator"], outlet=r["location_name"], title=r["title"][:90], views=r["views"], gmv=r["gmv"], duration=r["duration"], month=r["label"]))
    if len(tp)==6: break
res["best"]["top_posts"]=tp
res["task_types"]={}
for t in set(r["task"] for r in rows):
    R=[r for r in rows if r["task"]==t]; res["task_types"][t or "(kosong)"]=dict(n=len(R), gmv_per_post=sum(r["gmv"] for r in R)/len(R))
# scenario (parameter: pengali vs bulan terakhir)
base=monthly[-1]["gmv"]
res["scenario"]={"Konservatif":[base*0.85,base*0.95,base*1.0],"Moderat":[base*1.0,base*1.2,base*1.3],"Agresif":[base*1.15,base*1.5,base*1.7]}
class E(json.JSONEncoder):
    def default(self,o):
        if isinstance(o,(set,)): return list(o)
        if isinstance(o,collections.Counter): return dict(o)
        return super().default(o)
json.dump(res, open(out,"w"), cls=E, ensure_ascii=False, indent=1)
m=res["monthly"]
print("ROWS post×outlet:", len(rows))
for x in m: print(x["label"], "GMV", round(x["gmv"]), "orders", x["orders"], "views", x["views"], "red%", round(x["red_rate"],3), "AOV", round(x["aov"]), "newpost", x["new_posts"], "postaktif", x["active_posts"], "outlet aktif", x["outlets_active"], "/", x["outlets_seen"], "creator", x["creators_active"], "ber-GMV", x["creators_gmv"], ">50:", x["outlets_gt50"], dict(x["buckets"]))
print("total", {k:round(v,3) for k,v in tot.items()})
print("share", res["creator_share"]); print("layers", res["creator_layers"]); print("activity", dict(res["creator_activity"]))
print("layer outlet", res["layer_outlet"]); print("best", {k:v for k,v in res["best"].items() if k in ("top5_share","n_rows","n_top","median_views_top","median_views_rest")})
print("top outlets", [(o["name"],round(o["gmv"]/1e6,1),o["orders"],round(o["red_rate"],2)) for o in outlets[:6]])
print("cities", [(c["city"],round(c["gmv"]/1e6,1),c["n_outlets"]) for c in res["cities"][:8]])
print("features", [(b["feature"],b["n"],round(b["sell_rate"],2),round(b["sell_rate_without"],2),round(b["lift"],1)) for b in bp])
print("duration", res["best"]["duration"]); print("views", res["best"]["views"]); print("task", res["task_types"])
