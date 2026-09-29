#!/usr/bin/env node
/* ═════════════════════════════════════════════════════════════════
   ARCHIVIO ALABAY — pagine per Google (una per cane) + sitemap.
   Eseguito in automatico da GitHub a ogni aggiornamento del sito
   (.github/workflows/pages.yml). Non serve lanciarlo a mano.

   Legge:   database_cani_fixed.json (o database_cani.json) e index.html
   Scrive:  _site/  = copia del sito + cane/<codice>.html + sitemap.xml + robots.txt
   Il proprietario NON viene pubblicato in queste pagine (privacy).
═════════════════════════════════════════════════════════════════ */
'use strict';
const fs=require('fs'), path=require('path');
const ROOT=process.cwd(), OUT=path.join(ROOT,'_site');
const SKIP=new Set(['.git','.github','_site','tools','node_modules']);

function copyDir(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const e of fs.readdirSync(src,{withFileTypes:true})){
    if(SKIP.has(e.name)) continue;
    const s=path.join(src,e.name), d=path.join(dst,e.name);
    if(e.isDirectory()) copyDir(s,d); else fs.copyFileSync(s,d);
  }
}
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const clean=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
const slug=id=>String(id||'').replace(/[^A-Za-z0-9_-]/g,'_');
const PH_RE=/^\s*(UNKNOWN?|UNKNOW|SCONOSCIUT[OA])\b/i;
const isPh=r=>!!(r&&PH_RE.test(String(r.name||'')));
const phDetail=r=>{ const d=String(r&&r.name||'').replace(PH_RE,'').replace(/^[\s(\-–—:]+|[\s)]+$/g,'').trim(); return /^X+$/i.test(d)?'':d; };

/* ── dati ── */
const dbFile=['database_cani_fixed.json','database_cani.json'].map(f=>path.join(ROOT,f)).find(f=>fs.existsSync(f));
if(!dbFile){ console.error('Database non trovato (database_cani_fixed.json).'); process.exit(1); }
const DB=JSON.parse(fs.readFileSync(dbFile,'utf8')).filter(r=>r&&r.id);
const INDEX=new Map(DB.map(r=>[String(r.id),r]));
const indexHtml=fs.existsSync(path.join(ROOT,'index.html'))?fs.readFileSync(path.join(ROOT,'index.html'),'utf8'):'';
let SITE=process.env.SITE_URL||((/var ALABAY_SITE_URL='([^']+)'/.exec(indexHtml)||[])[1])||'';
if(SITE&&!SITE.endsWith('/')) SITE+='/';
if(/var ALABAY_ADMIN\s*=\s*true/.test(indexHtml)){ console.error('ATTENZIONE: index.html è la copia ADMIN. Pubblica solo la copia pubblica.'); process.exit(1); }

/* ── COI (Wright, metodo di Meuwissen & Luo), come nell'archivio ── */
function buildML(){
  const n=DB.length, idx=new Map(), order=[], state=new Uint8Array(n);
  DB.forEach((r,i)=>idx.set(String(r.id),i));
  const par=(i,k)=>{ const p=k?DB[i].madre:DB[i].padre; if(!p) return -1; const j=idx.get(String(p)); return (j==null||j===i)?-1:j; };
  for(let s=0;s<n;s++){ if(state[s]) continue; const st=[s];
    while(st.length){ const v=st[st.length-1];
      if(state[v]===0){ state[v]=1; const a=par(v,0), b=par(v,1); if(b>=0&&state[b]===0) st.push(b); if(a>=0&&state[a]===0) st.push(a); }
      else { st.pop(); if(state[v]===1){ state[v]=2; order.push(v); } } } }
  const pos=new Map(), S=new Int32Array(n+1), D=new Int32Array(n+1), tmp=new Int32Array(n);
  for(let q=0;q<n;q++){ tmp[order[q]]=q+1; pos.set(String(DB[order[q]].id),q+1); }
  for(let q=0;q<n;q++){ const o=order[q], a=par(o,0), b=par(o,1); const ps=a>=0?tmp[a]:0, pd=b>=0?tmp[b]:0; S[q+1]=ps>q?0:ps; D[q+1]=pd>q?0:pd; }
  const F=new Float64Array(n+1), Dv=new Float64Array(n+1), L=new Float64Array(n+1), heap=new Int32Array(n+2), inH=new Uint8Array(n+1);
  F[0]=-1;
  function walk(starts,coefs,init){
    let hs=0, ai=init;
    const push=x=>{ if(inH[x]) return; inH[x]=1; let c=hs++; heap[c]=x; while(c>0){ const p=(c-1)>>1; if(heap[p]>=heap[c]) break; const t=heap[p]; heap[p]=heap[c]; heap[c]=t; c=p; } };
    const pop=()=>{ const top=heap[0]; hs--; if(hs>0){ heap[0]=heap[hs]; let c=0; for(;;){ const l=2*c+1, r=l+1; let m=c; if(l<hs&&heap[l]>heap[m]) m=l; if(r<hs&&heap[r]>heap[m]) m=r; if(m===c) break; const t=heap[m]; heap[m]=heap[c]; heap[c]=t; c=m; } } inH[top]=0; return top; };
    starts.forEach((x,i)=>{ if(!x) return; L[x]+=coefs[i]; push(x); });
    while(hs>0){ const j=pop(), lj=L[j], sj=S[j], dj=D[j]; if(sj){ L[sj]+=0.5*lj; push(sj); } if(dj){ L[dj]+=0.5*lj; push(dj); } ai+=lj*lj*Dv[j]; L[j]=0; }
    return ai;
  }
  for(let i=1;i<=n;i++){ const si=S[i], di=D[i]; Dv[i]=0.5-0.25*(F[si]+F[di]);
    if(si===0||di===0){ F[i]=0; continue; } if(si===S[i-1]&&di===D[i-1]){ F[i]=F[i-1]; continue; }
    F[i]=walk([si,di],[0.5,0.5],Dv[i])-1; }
  return id=>{ const p=pos.get(String(id)); const f=p?F[p]:0; return Math.abs(f)<1e-12?0:f; };
}
const t0=Date.now(); const F_of=buildML(); console.log('COI calcolato in',Date.now()-t0,'ms');
const coiLabel=p=>p<5?['Basso','Low']:p<10?['Moderato','Moderate']:p<20?['Alto','High']:['Molto alto','Very high'];
const coiColor=p=>p<5?'#1A5C3A':p<10?'#8A5A00':p<20?'#A4461A':'#A12020';

/* figli */
const KIDS=new Map();
DB.forEach(r=>{ ['padre','madre'].forEach(k=>{ const p=r[k]; if(!p||!INDEX.has(String(p))) return; if(!KIDS.has(String(p))) KIDS.set(String(p),[]); KIDS.get(String(p)).push(r); }); });

/* ── HTML ── */
fs.rmSync(OUT,{recursive:true,force:true});
copyDir(ROOT,OUT);
const DIR=path.join(OUT,'cane'); fs.mkdirSync(DIR,{recursive:true});
/* logo dall'index (data URI) */
const logoM=/var ALABAY_LOGO\s*=\s*'data:image\/(png|jpeg);base64,([^']+)'/.exec(indexHtml);
let LOGO='';
if(logoM){ LOGO='cane/logo.'+(logoM[1]==='png'?'png':'jpg'); fs.writeFileSync(path.join(OUT,LOGO),Buffer.from(logoM[2],'base64')); }
fs.writeFileSync(path.join(DIR,'style.css'),`
*{box-sizing:border-box}body{margin:0;background:#FBF7EF;color:#2B1D14;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
a{color:#6B1A1A}header{background:#FFFCF6;border-bottom:1px solid #E3D6BD;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
header img{width:36px;height:36px;border-radius:50%}header b{font-family:Georgia,serif;color:#6B1A1A}header .sp{flex:1}
main{max-width:980px;margin:0 auto;padding:16px}h1{font-family:Georgia,serif;font-size:28px;margin:6px 0 2px;color:#2B1D14}
.sub{color:#6B5540;margin-bottom:12px}.btn{display:inline-block;padding:8px 14px;border-radius:8px;background:#6B1A1A;color:#FFF7E6;text-decoration:none;font-weight:700;margin:4px 6px 4px 0}
.btn.g{background:#fff;color:#6B1A1A;border:1px solid #C4A44A}.card{background:#FFFCF6;border:1px solid #E3D6BD;border-radius:12px;padding:12px 14px;margin:12px 0}
.card h2{font-family:Georgia,serif;font-size:17px;margin:0 0 8px;color:#6B1A1A}table.kv{border-collapse:collapse;width:100%}
table.kv th{text-align:left;font-size:12px;color:#8B6914;font-weight:700;padding:5px 10px 5px 0;white-space:nowrap;vertical-align:top;width:34%}
table.kv td{padding:5px 0;border-bottom:1px solid #F0E6D2}.en{color:#8B7355;font-weight:400}
.ver{display:inline-block;background:#E6F3EC;color:#1A5C3A;border:1px solid #9FCDB3;border-radius:99px;padding:1px 9px;font-weight:700;font-size:13px}
.coi{font-weight:800}.ped{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:13.5px}
.ped div{background:#fff;border:1px solid #EFE3C8;border-radius:8px;padding:6px 8px}.ped .s{border-left:3px solid #1A3A6B}.ped .d{border-left:3px solid #8B1A4A}
.ped small{display:block;color:#8B7355}.kids a{display:inline-block;margin:2px 10px 2px 0}.foot{color:#8B7355;font-size:12.5px;margin:20px 0}
@media(max-width:640px){.ped{grid-template-columns:1fr}table.kv th{width:auto}}
`);
const S_LAB=r=>r.sesso==='M'?'Maschio · Male':r.sesso==='F'?'Femmina · Female':'—';
const year=r=>((/^(\d{4})/.exec(String(r&&r.birth||''))||[])[1])||'';
function dogRef(id,role){
  const r=id?INDEX.get(String(id)):null;
  if(!r) return '<span class="en">Sconosciuto · Unknown</span>';
  if(isPh(r)){ const d=phDetail(r); return '<span class="en">Sconosciuto · Unknown'+(d?' ('+esc(d)+')':'')+'</span>'; }
  return '<a href="'+slug(r.id)+'.html">'+esc(clean(r.name))+'</a>'+(year(r)?' <small>'+year(r)+'</small>':'');
}
const vOf=r=>(r&&r.verifica&&r.verifica.data)?r.verifica:null;
const dIt=d=>{ const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(d||'')); return m?m[3]+'/'+m[2]+'/'+m[1]:String(d||''); };
const slugSeen=new Map(); let pages=0; const urls=[];
const letters=new Map();
for(const r of DB){
  if(isPh(r)) continue;
  const sl=slug(r.id);
  if(slugSeen.has(sl)&&slugSeen.get(sl)!==r.id){ console.warn('Codice duplicato dopo la conversione:',r.id); continue; }
  slugSeen.set(sl,r.id);
  const name=clean(r.name)||r.id, tipo=clean(r.tipo), paese=clean(r.paese).toUpperCase(), y=year(r);
  const hasPar=r.padre&&r.madre&&INDEX.has(String(r.padre))&&INDEX.has(String(r.madre))&&!isPh(INDEX.get(String(r.padre)))&&!isPh(INDEX.get(String(r.madre)));
  const coi=hasPar?F_of(r.id)*100:null;
  const sire=r.padre?INDEX.get(String(r.padre)):null, dam=r.madre?INDEX.get(String(r.madre)):null;
  const nm=x=>x&&!isPh(x)?clean(x.name):'';
  const desc=[name+(y?' ('+[r.sesso==='M'?'male':r.sesso==='F'?'female':'',y,paese].filter(Boolean).join(', ')+')':''),
    tipo?'Type '+tipo:'', nm(sire)?'Sire '+nm(sire):'', nm(dam)?'Dam '+nm(dam):'', coi!=null?'COI '+coi.toFixed(2)+'%':'',
    'Pedigree, inbreeding and descendants — Archivio Alabay, Alabay Club Italia'].filter(Boolean).join('. ');
  const url=SITE+'cane/'+sl+'.html', app=SITE+'#'+encodeURIComponent(r.id);
  const photo=Array.isArray(r.foto_list)&&r.foto_list[0]?r.foto_list[0]:'';
  const img=photo?(/^https?:/.test(photo)?photo:SITE+photo.replace(/^\.?\//,'')):(LOGO?SITE+LOGO:'');
  const g2=[sire,dam].map(p=>p&&!isPh(p)?[p.padre,p.madre]:[null,null]);
  const v=vOf(r);
  const kids=(KIDS.get(String(r.id))||[]).filter(k=>!isPh(k)).sort((a,b)=>String(a.birth||'').localeCompare(String(b.birth||'')));
  const cert=(Array.isArray(r.certificati)?r.certificati:[]).filter(c=>c&&c.n);
  const rows=[
    ['Sesso','Sex',S_LAB(r)],['Nascita','Birth',esc(clean(r.birth))||'—'],['Tipo','Type',esc(tipo)||'—'],['Paese','Country',esc(paese)||'—'],
    ['Allevatore','Breeder',esc(clean(r.allevatore))||'—'],['Pedigree','Registration',esc(clean(r.pedigree))||'—'],['Colore','Colour',esc(clean(r.colore))||'—'],
    ['COI','COI',coi==null?'<span class="en">non calcolabile · not available</span>':'<span class="coi" style="color:'+coiColor(coi)+'">'+coi.toFixed(2)+'%</span> '+coiLabel(coi)[0]+' <span class="en">· '+coiLabel(coi)[1]+'</span>']
  ];
  if(clean(r.fonte)) rows.push(['Fonte','Source',esc(clean(r.fonte))]);
  if(v) rows.push(['Verifica','Verification','<span class="ver">✔ Verificato dal Club · Verified by the Club</span> '+dIt(v.data)+(v.note?' · '+esc(v.note):'')]);
  if(cert.length) rows.push(['Certificati','Certificates',cert.map(c=>esc(c.n)+' ('+dIt(c.data)+')').join(', ')]);
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+esc(name)+(tipo?' — '+esc(tipo):'')+' · Pedigree | Archivio Alabay</title>'+
    '<meta name="description" content="'+esc(desc)+'">'+(SITE?'<link rel="canonical" href="'+esc(url)+'">':'')+
    '<meta property="og:type" content="profile"><meta property="og:site_name" content="Archivio Alabay — Alabay Club Italia">'+
    '<meta property="og:title" content="'+esc(name)+(tipo?' · '+esc(tipo):'')+'"><meta property="og:description" content="'+esc(desc)+'">'+
    (SITE?'<meta property="og:url" content="'+esc(url)+'">':'')+(img?'<meta property="og:image" content="'+esc(img)+'">':'')+
    '<link rel="stylesheet" href="style.css"></head><body>'+
    '<header>'+(LOGO?'<img src="logo.'+LOGO.split('.').pop()+'" alt="">':'')+'<b>Archivio Alabay</b><span class="en">Alabay Club Italia</span><span class="sp"></span><a href="../">Archivio · Archive</a></header>'+
    '<main><h1>'+esc(name)+'</h1><div class="sub">'+[esc(tipo),esc(paese),y].filter(Boolean).join(' · ')+'</div>'+
    '<a class="btn" href="'+esc(app)+'">🌳 Apri nell’archivio · Open in the archive</a><a class="btn g" href="'+esc(app)+'">✏️ Segnala una correzione · Report a correction</a>'+
    '<div class="card"><h2>Dati · Details</h2><table class="kv">'+rows.map(x=>'<tr><th>'+x[0]+' <span class="en">· '+x[1]+'</span></th><td>'+x[2]+'</td></tr>').join('')+'</table></div>'+
    '<div class="card"><h2>Genealogia · Pedigree</h2><div class="ped">'+
      '<div class="s"><small>Padre · Sire</small>'+dogRef(r.padre)+'</div><div class="s"><small>Nonno paterno · Paternal grandsire</small>'+dogRef(g2[0][0])+'</div><div class="d"><small>Nonna paterna · Paternal granddam</small>'+dogRef(g2[0][1])+'</div>'+
      '<div class="d"><small>Madre · Dam</small>'+dogRef(r.madre)+'</div><div class="s"><small>Nonno materno · Maternal grandsire</small>'+dogRef(g2[1][0])+'</div><div class="d"><small>Nonna materna · Maternal granddam</small>'+dogRef(g2[1][1])+'</div>'+
    '</div></div>'+
    (kids.length?'<div class="card"><h2>Figli · Offspring ('+kids.length+')</h2><div class="kids">'+kids.slice(0,150).map(k=>dogRef(k.id)).join('')+(kids.length>150?' …':'')+'</div></div>':'')+
    '<div class="foot">Archivio Alabay — database genealogico dell’Alabay Club Italia · pedigree database of the Alabay Club Italia. '+
    'COI calcolato sugli antenati presenti nell’archivio (Wright, Meuwissen &amp; Luo) · COI calculated on the ancestors in the archive. © Alabay Club Italia</div>'+
    '</main></body></html>';
  fs.writeFileSync(path.join(DIR,sl+'.html'),html);
  pages++; urls.push(url);
  const L=(name[0]||'#').toUpperCase(), key=/[A-Z]/.test(L)?L:'#';
  if(!letters.has(key)) letters.set(key,[]); letters.get(key).push([name,sl,y,tipo]);
}
/* indice A–Z */
const LK=[...letters.keys()].sort();
const letterFile=k=>'indice-'+(k==='#'?'0':k.toLowerCase())+'.html';
for(const k of LK){
  const L=letters.get(k).sort((a,b)=>a[0].localeCompare(b[0]));
  fs.writeFileSync(path.join(DIR,letterFile(k)),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dogs '+esc(k)+' — Archivio Alabay</title><link rel="stylesheet" href="style.css"></head><body><header><b>Archivio Alabay</b><span class="sp"></span><a href="../">Archivio · Archive</a></header><main><h1>'+esc(k)+'</h1><p>'+LK.map(x=>'<a href="'+letterFile(x)+'">'+esc(x)+'</a>').join(' · ')+'</p><div class="card kids">'+
    L.map(x=>'<a href="'+x[1]+'.html">'+esc(x[0])+'</a>'+(x[2]?' <small>'+x[2]+'</small>':'')).join(' ')+'</div></main></body></html>');
  urls.push(SITE+'cane/'+letterFile(k));
}
if(SITE){
  const now=new Date().toISOString().slice(0,10);
  fs.writeFileSync(path.join(OUT,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>'+esc(SITE)+'</loc><lastmod>'+now+'</lastmod></url>\n'+urls.map(u=>'<url><loc>'+esc(u)+'</loc></url>').join('\n')+'\n</urlset>\n');
  fs.writeFileSync(path.join(OUT,'robots.txt'),'User-agent: *\nAllow: /\nSitemap: '+SITE+'sitemap.xml\n');
}
console.log('Pagine create:',pages,'· indice A–Z:',LK.length,'· sito:',SITE||'(indirizzo non indicato)','· tempo',Date.now()-t0,'ms');
