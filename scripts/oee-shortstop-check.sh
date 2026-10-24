#!/bin/bash
# Salt okunur: kısa duruş bölünmesini (#46, #47) en yeni günlük yedekteki gerçek veriyle denetler.
# Koddan bağımsız hesaplar (yalnız ham alanlar), böylece src/lib/oeeShortStops.ts'i doğrular, kopyalamaz.
#  (a) gün × iş yeri: Loading − Production ≈ ≥ eşik dk plansız duruş toplamı mı (MES_SHORT_STOP_MIN varsayımı)
#  (b) Dashboard A / P / Q / OEE (son 2 hafta, tesis) — Loss Bridge'te aynı hafta ile göz ile karşılaştırılır
#  (c) kod başına kısa (< eşik) duruş dk / adet ve arıza gruplarında MTTR eski (tümü) → yeni (≥ eşik)
#  Ayrıca OEE Settings: SCHED_DOWN Reason Code 1'in molada (breakReasonCodes) olduğu.
# Kullanım (sunucu): bash /opt/planningexpert/scripts/oee-shortstop-check.sh [yedek.zip]
REPO=${REPO:-/opt/planningexpert}
ZIP=${1:-$(ls -t "$REPO"/backups/daily-*.zip 2>/dev/null | head -1)}
[ -f "$ZIP" ] || { echo "Yedek bulunamadı"; exit 1; }
echo "Yedek: $ZIP"
python3 -c "
import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);n=set(z.namelist())
for t in ['oeeSettings','oeeDays','oeeStopDays']:
  f=t+'/documents.jsonl'
  if f in n:
    for l in z.read(f).decode().splitlines(): print(t+'\t'+l)" "$ZIP" |
node -e '
const fs=require("fs"),MES=2
const r1=v=>Math.round(v*10)/10,pct=v=>v==null?"-":(v*100).toFixed(1)+"%"
const plants=new Map(),P=id=>{const k=id??"-";if(!plants.has(k))plants.set(k,{set:null,days:[],stops:new Map()});return plants.get(k)}
for(const l of fs.readFileSync(0,"utf8").split("\n")){const i=l.indexOf("\t");if(i<0)continue
const t=l.slice(0,i),d=JSON.parse(l.slice(i+1)),p=P(d.plantId)
if(t==="oeeSettings")p.set=d;else if(t==="oeeDays")p.days.push(d);else p.stops.set(d.date+"|"+d.workCenter,d.bins??[])}
for(const[id,p]of plants){
const s=p.set??{},T=s.shortStopMin>0?s.shortStopMin:MES,loss=s.lossReasonCodes??[],brk=s.breakReasonCodes??[]
console.log("\n== Tesis "+id+" ==")
if(!p.set)console.log("UYARI: OEE Settings yok — kayıp kodları bilinmiyor")
console.log("Ayar: shortStopMin="+T+" (MES "+MES+")"+(T!==MES?" UYARI: farklı":"")+" bridgeBase="+(s.bridgeBase??"loading")+" | kayıp RC1: "+loss.join(",")+" | mola RC1: "+brk.join(","))
const sd=brk.includes("SCHED_DOWN")?"molada (doğru)":loss.includes("SCHED_DOWN")?"UYARI: kayıp sayılıyor (SCHED_DOWN YNT OEE kaybına girer)":"UYARI: hiçbir listede değil (sınıfsız)"
console.log("SCHED_DOWN:",sd)
// (a)
const rows=[],cls=new Map()
for(const d of p.days){const bins=p.stops.get(d.date+"|"+d.workCenter);if(!bins||!(d.loadingMin>0))continue
let lng=0,sht=0,other=0
for(const[rc1,,,bin,,min]of bins){const m=+min||0
if(!loss.includes(rc1)){if(!brk.includes(rc1)){other+=m;cls.set(rc1,(cls.get(rc1)??0)+m)}continue}
if(bin>=T)lng+=m;else sht+=m}
rows.push({k:d.date+" "+d.workCenter,lp:d.loadingMin-d.productionMin,lng,sht,other})}
console.log("\n(a) Loading − Production ≈ ≥ "+T+" dk plansız duruş — duruş verili gün × iş yeri:",rows.length)
if(rows.length){const n=f=>rows.filter(f).length,mad=f=>r1(rows.reduce((a,r)=>a+Math.abs(r.lp-f(r)),0)/rows.length)
console.log("  |fark| ≤ 1 dk:",n(r=>Math.abs(r.lp-r.lng)<=1)," ≤ %5:",n(r=>Math.abs(r.lp-r.lng)<=Math.max(1,0.05*r.lp)))
console.log("  ortalama |fark| — ≥ "+T+" dk ile:",mad(r=>r.lng),"dk | bütün plansızla:",mad(r=>r.lng+r.sht),"dk | ≥ "+T+" + sınıfsız ile:",mad(r=>r.lng+r.other),"dk")
console.log("  En büyük 10 fark (tarih iş yeri: L−P | ≥"+T+" | <"+T+" | sınıfsız | fark):")
for(const r of [...rows].sort((a,b)=>Math.abs(b.lp-b.lng)-Math.abs(a.lp-a.lng)).slice(0,10))
console.log("   ",r.k+":",r1(r.lp),"|",r1(r.lng),"|",r1(r.sht),"|",r1(r.other),"|",r1(r.lp-r.lng))
if(cls.size)console.log("  Sınıfsız RC1 (ne kayıp ne mola):",[...cls].map(([k,v])=>k+" "+Math.round(v)+"dk").join(" | "))}
// (b)
const mon=iso=>{const d=new Date(iso+"T00:00:00Z");d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10)}
const wk=new Map();for(const d of p.days){const k=mon(d.date),w=wk.get(k)??{L:0,P:0,O:0,g:0,t:0}
w.L+=d.loadingMin;w.P+=d.productionMin;w.O+=d.operatingMin;w.g+=d.good;w.t+=d.good+d.scrap+d.reject;wk.set(k,w)}
console.log("\n(b) Dashboard oranları (tesis, hafta) — Loss Bridge’te aynı hafta, All seçiliyken A / P / Q / OEE aynı olmalı:")
for(const k of [...wk.keys()].sort().slice(-2)){const w=wk.get(k),A=w.L>0?w.P/w.L:null,Pf=w.P>0?w.O/w.P:0,Q=w.t>0?w.g/w.t:1
console.log("  hafta "+k+": A",pct(A),"P",pct(A==null?null:Pf),"Q",pct(A==null?null:Q),"OEE",pct(A==null?null:A*Pf*Q))}
if((s.bridgeBase??"loading")!=="loading")console.log("  Not: bridgeBase=shift — köprünün OEE’si vardiya tabanlı, Dashboard’dan düşük olabilir")
// (c)
const code=new Map(),bd=new Set((s.lossGroups??[]).filter(g=>g.breakdown).map(g=>g.code))
for(const bins of p.stops.values())for(const[rc1,rc2,,bin,n,min]of bins){if(!loss.includes(rc1))continue
const e=code.get(rc2||"#")??{sm:0,sn:0,lm:0,ln:0};if(bin<T){e.sm+=+min||0;e.sn+=+n||0}else{e.lm+=+min||0;e.ln+=+n||0};code.set(rc2||"#",e)}
console.log("\n(c) Kısa duruşlar (< "+T+" dk) — kod: kısa dk / adet (kodun dakikasının payı); arıza grubu: MTTR eski → yeni")
for(const[k,e]of [...code].sort((a,b)=>b[1].sm-a[1].sm)){if(!e.sn&&!bd.has(k))continue
const mt=bd.has(k)?"  MTTR "+(e.sn+e.ln?r1((e.sm+e.lm)/(e.sn+e.ln)):"-")+" → "+(e.ln?r1(e.lm/e.ln):"-")+" dk":""
console.log("  "+k+": "+r1(e.sm)+" dk / "+e.sn+" adet ("+pct(e.sm+e.lm>0?e.sm/(e.sm+e.lm):0)+")"+mt)}}'
