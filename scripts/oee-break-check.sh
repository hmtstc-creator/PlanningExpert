#!/bin/bash
# Salt okunur: en yeni günlük yedekte PLANSIZ (kayıp sayılan RC1) duruş metinlerinden MOLA / PAUZ / BREAK / 5S
# geçip AFTER_BREAK / FIVE_S kalıbına uymayanları listeler. Kalıplar src/lib/oeeInsights.ts'ten okunur.
# Kullanım (sunucu): bash /opt/planningexpert/scripts/oee-break-check.sh [yedek.zip]
REPO=${REPO:-/opt/planningexpert}
ZIP=${1:-$(ls -t "$REPO"/backups/daily-*.zip 2>/dev/null | head -1)}
[ -f "$ZIP" ] || { echo "Yedek bulunamadı"; exit 1; }
echo "Yedek: $ZIP"
python3 -c "
import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);n=set(z.namelist())
for t in ['oeeSettings','oeeLossDays']:
  f=t+'/documents.jsonl'
  if f in n:
    for l in z.read(f).decode().splitlines(): print(t+'\t'+l)" "$ZIP" |
SRC="$REPO/src/lib/oeeInsights.ts" node -e '
const fs=require("fs"),src=fs.readFileSync(process.env.SRC,"utf8")
const re=n=>new RegExp(src.match(new RegExp("export const "+n+" =\\s*/(.*)/\\s*\\n"))[1])
const AB=re("AFTER_BREAK"),FS=re("FIVE_S")
const W=/MOLA|PAUZ|PAUS|BREAK|LUNCH|YEMEK|MAS[AĂ]|5\s*-?\s*S|CAFEA|COFFEE|CEAI/
let set=[],days=[]
for(const l of fs.readFileSync(0,"utf8").split("\n")){const i=l.indexOf("\t");if(i<0)continue
const t=l.slice(0,i),d=JSON.parse(l.slice(i+1));if(t==="oeeSettings")set.push(...(d.lossReasonCodes??[]));else days.push(d)}
const loss=set.length?rc=>set.includes(rc):rc=>rc==="#"||/UN/i.test(rc)
const seen=new Map(),m=new Map()
for(const d of days)for(const[rc1,g,x,min,n]of d.reasonList??[]){const t=String(x??"").trim().toUpperCase()
seen.set(rc1,(seen.get(rc1)??0)+(+min||0));if(!loss(rc1)||!W.test(t))continue
const k=t+"|"+(g||"#"),e=m.get(k)??{t,g:g||"#",min:0,n:0};e.min+=+min||0;e.n+=+n||0;m.set(k,e)}
console.log("RC1:",[...seen].map(([k,v])=>(loss(k)?"[kayıp] ":"[planlı] ")+k+" "+Math.round(v)+"dk").join(" | "))
const r=[...m.values()].sort((a,b)=>b.min-a.min),ok=e=>AB.test(e.t)||FS.test(e.t)
console.log("Aday (yalnız plansız):",r.length)
for(const e of r.filter(e=>!ok(e)))console.log("UYMUYOR",Math.round(e.min),"dk",e.n,"adet grup",e.g,JSON.stringify(e.t))
console.log("Uyan:",r.filter(ok).length)'
