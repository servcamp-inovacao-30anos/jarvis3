/* Medida disciplinar gerada pelo Painel ServCamp (plano em docs/medida-disciplinar.md).
   Fica fora do index.html porque ele está no limite de tamanho (test/auth_exigencia).
   O servidor é o api/_faltas.js (rotas medida, medida_lancada, medida_cancelar, medidas_geradas).
   Aqui, encaixado na tela Faltas da Supervisão:
   • em cada falta em aberto, o botão "Gerar medida": tipo, dias, data, as faltas e situações,
     o motivo, e o documento A4 mudando ao vivo ao lado; depois imprime ou salva em PDF;
   • a aba "Medidas geradas": o que cada supervisor gerou e ainda falta lançar no SAR2G
     (a coordenação vê todas as áreas, separadas por supervisor);
   • o lembrete no perfil de quem gerou: enquanto a medida não aparece no SAR2G, ele fica lá.
   Quem decide a medida é o supervisor: o sistema não sugere tipo nem cria regra.
   Esconder botão é conveniência: quem barra é o servidor. */
(function(){
"use strict";
const MDS={lista:null,em:0,carregando:null,erro:null,coord:false,minhas:0,filtro:"PENDENTE",busca:"",ed:null,avisado:false,zoom:null};
const TIPOS={
  ADVERTENCIA_VERBAL:{rot:"Advertência verbal",sub:"Conversa registrada por escrito",dica:"Para a primeira ocorrência leve: o registro guarda que a conversa aconteceu."},
  ADVERTENCIA_ESCRITA:{rot:"Advertência escrita",sub:"Aviso formal assinado",dica:"Aviso formal que o colaborador assina. Conta no histórico de reincidência."},
  SUSPENSAO:{rot:"Suspensão",sub:"Afastamento sem remuneração",dica:"Afasta o colaborador sem salário pelos dias escolhidos (de 1 a 30)."}
};
const SITUACOES={FALTA_INJUSTIFICADA:"Falta injustificada",ATRASO:"Atraso",SAIDA_ANTECIPADA:"Saída antecipada sem autorização",ABANDONO_POSTO:"Abandono de posto",DESCUMPRIMENTO:"Descumprimento de norma ou procedimento",CONDUTA:"Conduta inadequada no posto"};
const MES=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const iso=d=>String(d||"").slice(0,10);
const dma=d=>{const s=iso(d);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4):"—";};
const dm=d=>{const s=iso(d);return s?s.slice(8,10)+"/"+s.slice(5,7):"—";};
const extenso=d=>{const s=iso(d);return s?(+s.slice(8,10))+" de "+MES[+s.slice(5,7)-1]+" de "+s.slice(0,4):"";};
const hojeSP=()=>new Date(Date.now()-3*3600000).toISOString().slice(0,10);
const quando=t=>{const x=Date.parse(t);if(!x)return"";const s=new Date(x-3*3600000).toISOString();return s.slice(8,10)+"/"+s.slice(5,7)+" às "+s.slice(11,16);};
const lista=l=>l.length<2?l.join(""):l.slice(0,-1).join(", ")+" e "+l[l.length-1];
const uk=()=>sessionStorage.getItem("userKey")||"";
const logado=()=>sessionStorage.getItem("logged")==="1";
const nomeDe=k=>{try{return(USERS[k]&&USERS[k].nome)||k;}catch(e){return k;}};
const titulo=s=>typeof fmNomeCard==="function"?fmNomeCard(s):String(s||"");
const svg=p=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';
const IC={
  doc:svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
  imp:svg('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
  ok:svg('<path d="m5 12 5 5 9-10"/>'),
  x:svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  clip:svg('<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>'),
  olho:svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  ADVERTENCIA_VERBAL:svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h6M9 14h4"/>'),
  ADVERTENCIA_ESCRITA:svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="m9 16 1.5-3.5L16 7l2 2-5.5 5.5z"/>'),
  SUSPENSAO:svg('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4M10 14v4M14 14v4"/>'),
  seta:svg('<path d="m9 6 6 6-6 6"/>'),menos:svg('<path d="M5 12h14"/>'),mais:svg('<path d="M12 5v14M5 12h14"/>'),
  ajustar:svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  info:svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')
};

async function api(t,metodo,corpo){
  const r=await fetch("/api/rh?modulo=faltas&t="+t,{method:metodo||"GET",headers:corpo?{"Content-Type":"application/json"}:{},body:corpo?JSON.stringify(corpo):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(j.error||("Falha ("+r.status+")"));e.codigo=j.codigo;e.dados=j;e.status=r.status;throw e;}
  return j;
}
function podeGerar(){
  const d=typeof FM!=="undefined"&&FM.dados;
  return !!(d&&d.medida&&d.medida.pode_gerar);
}
function carregar(forcar){
  if(!logado())return Promise.resolve();
  if(MDS.carregando)return MDS.carregando;
  if(!forcar&&MDS.lista&&Date.now()-MDS.em<60000)return Promise.resolve();
  MDS.carregando=api("medidas_geradas").then(j=>{
    MDS.lista=j.geradas||[];MDS.coord=!!j.coordenacao;MDS.minhas=j.minhasPendentes||0;MDS.em=Date.now();MDS.erro=null;
  }).catch(e=>{if(e.status===403){MDS.lista=[];MDS.em=Date.now();}else MDS.erro=e.message;})
    .finally(()=>{MDS.carregando=null;lembrete();if(document.querySelector("#pg-faltassup.active"))redesenhar();});
  return MDS.carregando;
}
const geradasDoCaso=k=>(MDS.lista||[]).filter(g=>g.caso===k&&g.status!=="CANCELADA");

/* ═════════ documento ═════════
   O mesmo HTML na prévia e na impressão. Suspensão: modelo oficial transcrito do PDF de 26/10/2026.
   Advertência: provisório, no mesmo formato, até chegar o modelo oficial. */
const DOC_CSS=`.md-doc{box-sizing:border-box;width:794px;min-height:1123px;padding:64px 72px 70px;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.55;position:relative}
.md-doc .logo{text-align:center;margin:-16px 0 4px}
.md-doc .logo svg{width:230px;height:auto}
.md-doc .emp{text-align:center;font-weight:700;font-size:15px;letter-spacing:.02em}
.md-doc h1{margin:26px 0 22px;text-align:center;font-size:15.5px;font-weight:700}
.md-doc .re{font-weight:700;margin:0 0 18px}
.md-doc p{margin:0 0 16px;text-align:justify}
.md-doc .mt{font-weight:700;text-decoration:underline;margin:22px 0 10px;text-align:left}
.md-doc .mv{font-weight:700;text-decoration:underline;text-transform:uppercase;text-align:justify;white-space:pre-wrap;margin:0 0 22px}
.md-doc .lc{display:flex;justify-content:space-between;margin:34px 0 54px}
.md-doc .ass{display:grid;grid-template-columns:1fr 1fr;gap:34px 46px}
.md-doc .ln{border-top:1px solid #111;padding-top:5px;font-size:12px;text-align:center}
.md-doc .ci{font-size:12.5px}
.md-doc .tes{font-size:12px;line-height:2.1}
.md-doc .rod{position:absolute;left:72px;right:72px;bottom:28px;border-top:1px solid #ccc;padding-top:6px;font-size:9.5px;color:#555;display:flex;justify-content:space-between;gap:12px}
.md-doc .vz{color:#b42318;font-style:italic;text-decoration:none;text-transform:none;font-weight:400}`;
function injetaCss(){if(document.getElementById("md-doc-css"))return;const s=document.createElement("style");s.id="md-doc-css";s.textContent=DOC_CSS;document.head.appendChild(s);}
// Logo do Grupo ServCamp para papel branco (vetor: sai nítido na prévia, na impressão e no PDF)
const LOGO_SC='<svg class="logo-sc" viewBox="0 0 400 140" role="img" aria-label="Grupo ServCamp terceirizações"><defs><linearGradient id="mdLgC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ced6"/><stop offset="1" stop-color="#848a94"/></linearGradient><linearGradient id="mdLgA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f78f0"/><stop offset="1" stop-color="#1b3f9e"/></linearGradient><clipPath id="mdLcC"><rect x="-20" y="-20" width="122" height="260"/></clipPath><clipPath id="mdLcA"><rect x="16" y="-20" width="140" height="260"/></clipPath></defs><g transform="translate(4 2)"><g clip-path="url(#mdLcC)"><path d="M103.54 41.46A47 47 0 1 0 55.36 94.97L56.27 68.99A21 21 0 1 1 77.8 45.08Z" fill="#5d636d" transform="translate(-6 3)"/><path d="M103.54 41.46A47 47 0 1 0 55.36 94.97L56.27 68.99A21 21 0 1 1 77.8 45.08Z" fill="url(#mdLgC)"/></g><g clip-path="url(#mdLcA)"><path d="M52.84 45.71A47 47 0 1 1 14.46 85.46L40.2 89.08A21 21 0 1 0 57.35 71.32Z" fill="#14307f" transform="translate(-6 3)"/><path d="M52.84 45.71A47 47 0 1 1 14.46 85.46L40.2 89.08A21 21 0 1 0 57.35 71.32Z" fill="url(#mdLgA)"/></g></g><text x="132" y="44" font-size="25" fill="#7d838d" style="font-family:Segoe UI,Arial,sans-serif;font-style:italic">Grupo</text><text x="124" y="96" font-size="54" font-style="italic" textLength="268" lengthAdjust="spacingAndGlyphs" style="font-family:Segoe UI Black,Arial Black,Arial,sans-serif;font-weight:900;letter-spacing:-1px"><tspan fill="#7d838d">SERV</tspan><tspan fill="#1b3f9e">CAMP</tspan></text><text x="390" y="126" font-size="21" fill="#7d838d" text-anchor="end" style="font-family:Segoe UI,Arial,sans-serif;font-style:italic">terceirizações</text></svg>';
const FECHO="Não só esperamos que tome as necessárias providências a fim de que não se repita (m) a (s) irregularidade (s) acima discriminada (s), como também aproveitamos para esclarecer-lhes que a repetição ou a prática de outra Prevista em nossos Regulamentos, Ordens de Serviços, etc., irá contribuir desfavoravelmente em seu progresso nesta Empresa, além de poder acarretar-lhe penalidades mais severas, conforme preceitua as disposições do Artigo 482 e suas alíneas da Consolidação das leis do trabalho.";
// d: { empresa, re, nome, tipoId, dias, inicio, motivo, docData, numero, geradoPor, geradoEm }
function docHtml(d){
  const vz=t=>`<span class="vz">${t}</span>`;
  const nome=esc(String(d.nome||"").toUpperCase()),re=esc(d.re);
  const dt=d.inicio?esc(dma(d.inicio)):vz("(data)");
  let tit,abre,mt;
  if(d.tipoId==="SUSPENSAO"){
    const n=Number(d.dias)||0;
    tit="AVISO DO EMPREGADOR PARA SUSPENDER O EMPREGADO DO SERVIÇO";
    abre=`Na conformidade da Consolidação das leis do trabalho pelo presente o notificamos que a partir de <b>${dt}</b> esta suspenso de suas atividades pelo período de <b>${n||vz("(dias)")}</b> dia (s) pelo seguinte motivo:`;
    mt="MOTIVO DA SUSPENSÃO";
  }else if(d.tipoId==="ADVERTENCIA_VERBAL"){
    tit="REGISTRO DE ADVERTÊNCIA VERBAL";
    abre=`Na conformidade da Consolidação das leis do trabalho, registramos que em <b>${dt}</b> o(a) colaborador(a) acima foi advertido(a) verbalmente pelo seguinte motivo:`;
    mt="MOTIVO DA ADVERTÊNCIA VERBAL";
  }else if(d.tipoId==="ADVERTENCIA_ESCRITA"){
    tit="AVISO DO EMPREGADOR DE ADVERTÊNCIA DISCIPLINAR";
    abre=`Na conformidade da Consolidação das leis do trabalho pelo presente o advertimos formalmente, em <b>${dt}</b>, pelo seguinte motivo:`;
    mt="MOTIVO DA ADVERTÊNCIA";
  }else{
    tit=vz("Escolha o tipo da medida ao lado");abre=vz("O texto do documento aparece aqui conforme o tipo escolhido.");mt="MOTIVO";
  }
  const motivo=String(d.motivo||"").trim();
  const rod=d.numero?`<div class="rod"><span>Painel ServCamp · documento <b>${esc(d.numero)}</b></span><span>Gerado em ${esc(dma(d.geradoEm))}${d.geradoPor?" por "+esc(nomeDe(d.geradoPor)):""}</span></div>`
    :`<div class="rod"><span>Painel ServCamp · prévia: o número do documento sai ao gerar</span><span></span></div>`;
  return `<div class="md-doc">
  <div class="logo">${LOGO_SC}</div>
  <div class="emp">${d.empresa?esc(String(d.empresa).toUpperCase()):vz("(empresa)")}</div>
  <h1>${tit}</h1>
  <div class="re">RE: ${re} – ${nome}</div>
  <p>${abre}</p>
  <div class="mt">${mt}</div>
  <div class="mv">${motivo?esc(motivo):vz("O motivo escrito ao lado aparece aqui.")}</div>
  <p>${FECHO}</p>
  <div class="lc"><span>Campinas, ${esc(extenso(d.docData||hojeSP()))}</span><span>atenciosamente</span></div>
  <div class="ass">
    <div><div class="ci">CIENTE: ____/____/______</div><div style="height:46px"></div><div class="ln">Assinatura do Colaborador</div></div>
    <div><div style="height:30px"></div><div class="ln">ASSINATURA DO EMPREGADOR</div>
      <div class="tes">TESTEMUNHA:<br>Nome: ______________________________<br>Doc.: _______________________________<br>TESTEMUNHA:<br>Nome: ______________________________<br>Doc.: _______________________________</div></div>
  </div>
  ${rod}
</div>`;
}
// Imprime numa moldura escondida: a janela de impressão do navegador já oferece "Salvar como PDF".
function imprimir(d){
  const f=document.createElement("iframe");
  f.setAttribute("aria-hidden","true");f.style.cssText="position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(f);
  const doc=f.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc((d.numero||"Medida disciplinar")+" - "+d.nome)}</title><style>@page{size:A4;margin:0}html,body{margin:0;background:#fff}${DOC_CSS}.md-doc{min-height:297mm;width:210mm}</style></head><body>${docHtml(d)}</body></html>`);
  doc.close();
  setTimeout(()=>{try{f.contentWindow.focus();f.contentWindow.print();}catch(e){alert("Não foi possível abrir a impressão: "+e.message);}setTimeout(()=>f.remove(),60000);},250);
}
const docDaGerada=g=>({empresa:g.empresa,re:g.re,nome:g.nome,tipoId:g.tipoId,dias:g.dias,inicio:g.inicio,motivo:g.motivo,docData:iso(new Date(Date.parse(g.geradaEm)-3*3600000).toISOString()),numero:g.numero,geradoPor:g.geradaPor,geradoEm:new Date(Date.parse(g.geradaEm)-3*3600000).toISOString()});

/* ═════════ editor ═════════ */
function casoDe(k){const d=FM.dados;return d&&d.casos.find(c=>c.re+"|"+c.primeiraFalta===k)||null;}
function histDe(c){
  const H=FM.hist;
  const med=H&&!H.erro?((H.porRE[c.re]||[]).filter(m=>!/CANCEL/i.test(m.fase||""))):null;
  const p=H&&!H.erro?(H.faltas||[]).find(f=>String(f.re)===String(c.re)&&String(f.nome||"").split(" ")[0]===String(c.nome||"").split(" ")[0]):null;
  return{med,faltasAno:p?p.datas.length:null,datas:p?p.datas.map(iso):(H&&!H.erro?[]:null)};
}
function motivoAuto(E){
  const c=E.c,fl=[...E.faltas].sort(),p=[];
  if(E.sits.has("FALTA_INJUSTIFICADA")&&fl.length){
    const posto=c.posto&&!/^Reserva técnica/.test(c.posto)?" no posto "+c.posto:"";
    p.push(`Faltou ao trabalho sem apresentar justificativa ${fl.length===1?"no dia":"nos dias"} ${lista(fl.map(dma))}${posto}.`);
  }
  const outras=[...E.sits].filter(s=>s!=="FALTA_INJUSTIFICADA").map(s=>SITUACOES[s].toLowerCase());
  if(outras.length)p.push((p.length?"Também foi registrado: ":"Foi registrado: ")+lista(outras)+".");
  return p.join(" ");
}
function abrir(k){
  const c=casoDe(k);if(!c){alert("Não encontrei esta ocorrência. Atualize a tela.");return;}
  const fl=[...new Set(c.faltas||[])].sort();
  MDS.ed={c,k,foco:"tipo",tipo:"",dias:1,inicio:hojeSP(),docData:hojeSP(),empresa:c.empresa||"",faltas:new Set(fl),sits:new Set(["FALTA_INJUSTIFICADA"]),motivo:"",manual:false,confirma:false,sair:false,enviando:false,erro:null,repetida:null,gerada:null};
  MDS.ed.motivo=motivoAuto(MDS.ed);
  injetaCss();
  const ov=document.createElement("div");ov.id="md-ov";ov.className="md-ov";
  ov.innerHTML=`<div class="md-win" role="dialog" aria-modal="true" aria-labelledby="md-tit">`+
    `<div class="md-hd"><div class="md-hd-ic">${IC.doc}</div><div class="t"><b id="md-tit">Gerar medida disciplinar</b><span><strong>${esc(titulo(c.nome))}</strong> · RE ${esc(c.re)} · ${esc(c.posto||"sem posto")}</span></div>`+
      `<button type="button" class="md-x" data-md="fechar" aria-label="Fechar a janela" title="Fechar (Esc)">${IC.x}</button></div>`+
    `<nav class="md-passos" id="md-passos" aria-label="Passos"></nav>`+
    `<div class="md-corpo"><div class="md-form" id="md-form"></div><div class="md-prev" id="md-prev"></div></div><div class="md-rod" id="md-rod"></div></div>`;
  ov.addEventListener("click",cliqueEd);ov.addEventListener("input",digitouEd);ov.addEventListener("change",mudouEd);
  document.body.appendChild(ov);document.body.style.overflow="hidden";
  document.addEventListener("keydown",teclaEd);window.addEventListener("resize",escala);
  pintaForm();pintaPrev();pintaRod();
  setTimeout(()=>{const b=ov.querySelector(".md-tipo");if(b)b.focus({preventScroll:true});},60);
  setTimeout(()=>ov.classList.add("pintou"),500); // a entrada em cascata só na abertura, não a cada clique
}
const iniciaisDe=n=>String(n||"").split(" ").filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
// Fechar com algo preenchido pede confirmação DENTRO da janela (o confirm() do navegador pode não aparecer e a
// janela ficava presa: o X e o Cancelar não faziam nada).
function fecharEd(forcar){
  const E=MDS.ed;
  if(!forcar&&E&&!E.gerada&&(E.tipo||E.manual)){E.sair=true;E.confirma=false;pintaRod();const b=document.querySelector('#md-rod [data-md="ficar"]');if(b)b.focus();return;}
  const ov=document.getElementById("md-ov");
  document.body.style.overflow="";document.removeEventListener("keydown",teclaEd);window.removeEventListener("resize",escala);
  MDS.ed=null;
  if(ov){ov.classList.add("sai");setTimeout(()=>ov.remove(),180);}
}
function teclaEd(e){
  if(e.key!=="Escape"||!MDS.ed||document.querySelector(".fs-calpop"))return;
  if(MDS.ed.sair){MDS.ed.sair=false;pintaRod();return;} // Esc de novo: continua editando
  fecharEd(false);
}
function docDoEd(E){return{empresa:E.empresa,re:E.c.re,nome:E.c.nome,tipoId:E.tipo,dias:E.dias,inicio:E.inicio,motivo:E.motivo,docData:E.docData,numero:E.gerada&&E.gerada.numero,geradoPor:E.gerada&&E.gerada.geradaPor,geradoEm:E.gerada?new Date(Date.parse(E.gerada.geradaEm)-3*3600000).toISOString():null};}

// Os 4 passos e quando cada um está pronto: o que move a barra de progresso e os ✓ de cada seção.
function passos(E){
  return[
    {k:"tipo",rot:"Tipo da medida",ok:!!E.tipo&&(E.tipo!=="SUSPENSAO"||(E.dias>=1&&E.dias<=30))},
    {k:"datas",rot:"Data e empresa",ok:!!E.inicio&&!!String(E.empresa).trim()},
    {k:"ocor",rot:"O que aconteceu (opcional)",ok:true,opc:true},
    {k:"motivo",rot:"Motivo",ok:String(E.motivo).trim().length>=5}
  ];
}
function pintaPassos(){
  const E=MDS.ed,el=document.getElementById("md-passos");if(!E||!el)return;
  const p=passos(E),feitos=p.filter(x=>x.ok).length;
  el.style.setProperty("--md-prog",(E.gerada?100:feitos/p.length*100)+"%");
  el.innerHTML=`<div class="md-passos-l">${p.map((x,i)=>`<button type="button" class="md-passo${x.ok||E.gerada?" ok":""}" data-md="ir" data-v="${x.k}"><span class="n">${x.ok||E.gerada?IC.ok:i+1}</span><span class="r"><b>${x.rot}</b></span></button>`).join("")}</div>`+
    `<div class="md-passos-b" aria-hidden="true"><i></i></div><span class="md-passos-c">${E.gerada?"Documento gerado":feitos===p.length?"Tudo pronto para gerar":feitos+" de "+p.length+" passos prontos"}</span>`;
}
const cabPasso=(k,n,tit,sub,ok)=>`<div class="md-sec-h" title="${esc(sub)}"><span class="md-n${ok?" ok":""}">${ok?IC.ok:n}</span><h5>${tit}</h5></div>`;
function pintaForm(){
  const E=MDS.ed,el=document.getElementById("md-form");if(!E||!el)return;
  const c=E.c,h=histDe(c),trava=!!E.gerada,P=passos(E);
  let hist;
  if(!h.med)hist=`<div class="md-hist-v">Carregando o histórico…</div>`;
  else{
    // os dois cartões abrem a lista que está por trás do número (clicar de novo fecha)
    const n=h.med.length,ult=h.med[0],nf=h.datas?h.datas.length:h.faltasAno;
    const cartao=(k,num,rot,cls)=>`<button type="button" class="md-hk${E.ver===k?" on":""}${cls?" "+cls:""}" data-md="ver" data-v="${k}" aria-expanded="${E.ver===k}"><b>${num}</b><span>${rot}</span><i aria-hidden="true">›</i></button>`;
    hist=`<div class="md-hist-k">${cartao("faltas",nf==null?"—":nf,(nf===1?"falta injustificada":"faltas injustificadas")+" no ano","")}${cartao("medidas",n,(n===1?"medida":"medidas")+" no ano"+(n>=2?" · reincidente":"")+(ult?" · última em "+esc(dm(ult.data)):""),n>=2?"er":"")}</div>`;
    if(E.ver==="faltas")hist+=h.datas&&h.datas.length?`<div class="md-hist-d"><span class="md-rot">Faltas injustificadas desde ${esc(dma(FM.hist.desde))}</span><div class="md-hist-dt">${[...h.datas].sort().reverse().map(d=>`<span${E.faltas.has(d)?' class="atual" title="Falta desta ocorrência"':""}>${esc(dm(d))}</span>`).join("")}</div></div>`:`<div class="md-hist-d md-hist-v">Nenhuma falta injustificada no ano.</div>`;
    if(E.ver==="medidas")hist+=n?`<div class="md-hist-d"><span class="md-rot">Medidas desde ${esc(dma(FM.hist.desde))}</span><div class="md-hist-l">${h.med.map(m=>`<div><b>${esc(dm(m.data))}</b><span>${esc(typeof fmMedTxtH==="function"?fmMedTxtH(m):m.tipo)}${m.motivo?`<em>${esc(m.motivo)}</em>`:""}</span></div>`).join("")}</div></div>`:`<div class="md-hist-d md-hist-v">Nenhuma medida no ano: esta seria a primeira.</div>`;
  }
  const ant=geradasDoCaso(E.k).filter(g=>!E.gerada||g.chave!==E.gerada.chave);
  const avisoAnt=ant.length?`<div class="md-alerta"><b>Atenção:</b> já ${ant.length===1?"existe a medida":"existem as medidas"} ${lista(ant.map(g=>`<b>${esc(g.numero)}</b> (${esc(TIPOS[g.tipoId]?TIPOS[g.tipoId].rot:g.tipo)}, ${g.status==="LANCADA"?"lançada no SAR2G":"falta lançar no SAR2G"})`))} para esta ocorrência.</div>`:"";
  const tipos=Object.keys(TIPOS).map(t=>`<button type="button" class="md-tipo${E.tipo===t?" on":""}" data-md="tipo" data-v="${t}" title="${esc(TIPOS[t].dica)}" aria-pressed="${E.tipo===t}"${trava?" disabled":""}><span class="ic">${IC[t]}</span><b>${TIPOS[t].rot}</b><span>${TIPOS[t].sub}</span></button>`).join("");
  const explica=E.tipo?`<div class="md-explica">${IC.info}<span>${esc(TIPOS[E.tipo].dica)}</span></div>`:`<div class="md-explica vz">${IC.info}<span>Escolha um dos três tipos. O título e o texto do documento mudam conforme a escolha.</span></div>`;
  const dias=E.tipo==="SUSPENSAO"?`<div class="md-dias"><div><label for="md-dias">Quantos dias de suspensão?</label><small>De 1 a 30 dias, contados a partir da data do passo 2.</small></div><div class="md-step"><button type="button" data-md="dias" data-v="-1" aria-label="Menos um dia"${trava||E.dias<=1?" disabled":""}>${IC.menos}</button><input id="md-dias" type="number" min="1" max="30" value="${E.dias}" data-md="diasIn"${trava?" disabled":""}><button type="button" data-md="dias" data-v="1" aria-label="Mais um dia"${trava||E.dias>=30?" disabled":""}>${IC.mais}</button></div></div>`:"";
  const prov=E.tipo&&E.tipo!=="SUSPENSAO"?`<p class="md-dica">Modelo de advertência provisório, até chegar o oficial.</p>`:"";
  const fl=[...new Set(c.faltas||[])].sort();
  const dts=fl.map(d=>`<button type="button" class="md-chip dt${E.faltas.has(d)?" on":""}" data-md="falta" data-v="${d}" aria-pressed="${E.faltas.has(d)}"${trava?" disabled":""}>${esc(typeof fmDdS==="function"?fmDdS(d):dm(d))}</button>`).join("");
  const sits=Object.keys(SITUACOES).map(s=>`<button type="button" class="md-chip${E.sits.has(s)?" on":""}" data-md="sit" data-v="${s}" aria-pressed="${E.sits.has(s)}"${trava?" disabled":""}>${esc(SITUACOES[s])}</button>`).join("");
  const conta=E.motivo.length,limite=1500;
  // Um foco por vez: o passo aberto aparece completo; os outros viram uma linha com o resumo e "Editar".
  const foco=E.gerada?null:(E.foco||"tipo"),ORDEM=["tipo","datas","ocor","motivo"];
  const resumo={
    tipo:()=>E.tipo?TIPOS[E.tipo].rot+(E.tipo==="SUSPENSAO"?" · "+E.dias+(E.dias===1?" dia":" dias"):""):"Nenhum tipo escolhido",
    datas:()=>(E.inicio?dma(E.inicio):"sem data")+" · "+(String(E.empresa).trim()||"sem empresa"),
    ocor:()=>E.faltas.size||E.sits.size?E.faltas.size+(E.faltas.size===1?" falta":" faltas")+(E.sits.size?" · "+[...E.sits].slice(0,2).map(s=>SITUACOES[s]).join(", ")+(E.sits.size>2?"…":""):""):"Nada marcado · você escreve o motivo",
    motivo:()=>String(E.motivo).trim()?String(E.motivo).trim().slice(0,80)+(String(E.motivo).trim().length>80?"…":""):"Motivo ainda em branco"
  };
  const TIT={tipo:"Qual medida aplicar?",datas:E.tipo==="SUSPENSAO"?"Quando começa e em qual empresa?":"Quando e em qual empresa?",ocor:"O que aconteceu? (opcional)",motivo:"Motivo que vai no documento"};
  const SUB={tipo:"Escolha o tipo. Na suspensão, diga também quantos dias.",datas:"A data da medida, a data impressa no documento e a empresa do cabeçalho.",ocor:"Opcional. Marque as faltas e o que houve para o motivo, no passo 4, já vir escrito; ou pule este passo e escreva o motivo à mão.",motivo:"Já vem escrito a partir do passo 3. Pode reescrever com as suas palavras: o texto sai igual no papel."};
  const passo=(k,corpo)=>{
    const i=ORDEM.indexOf(k),ok=P[i].ok;
    if(foco!==k)return `<button type="button" class="md-res${ok?" ok":" pend"}" id="md-p-${k}" data-md="foco" data-v="${k}"${trava?" disabled":""}><span class="md-n${ok?" ok":""}">${ok?IC.ok:i+1}</span><span class="t"><b>${TIT[k]}</b><small>${esc(resumo[k]())}</small></span><em>${trava?"":ok?"Editar":"Preencher"}</em></button>`;
    const prox=ORDEM[i+1],cont=prox?`<div class="md-cont"><button type="button" class="md-b pri" data-md="prox" data-v="${prox}"${ok?"":" disabled"} title="${ok?"":"Falta preencher este passo"}">Continuar ${IC.seta}</button>${ok?"":`<span class="md-falta">Falta preencher este passo</span>`}</div>`:"";
    return `<section class="md-sec foco" id="md-p-${k}">${cabPasso(k,i+1,TIT[k],SUB[k],ok)}<p class="md-sub">${SUB[k]}</p>${corpo}${cont}</section>`;
  };
  const corpoTipo=`<div class="md-tipos" role="group" aria-label="Tipo da medida">${tipos}</div>${dias}${prov}`;
  const corpoDatas=`<div class="md-grid2"><label class="md-campo">${E.tipo==="SUSPENSAO"?"Suspenso a partir de":"Data da medida"}<input class="md-in" type="date" value="${E.inicio}" data-md="inicio"${trava?" disabled":""}></label><label class="md-campo">Data do documento<input class="md-in" type="date" value="${E.docData}" data-md="docData"${trava?" disabled":""}></label></div>`+
    `<label class="md-campo" style="margin-top:14px">Empresa (vai no cabeçalho)<input class="md-in" value="${esc(E.empresa)}" placeholder="Ex.: SERV CAMP TERCEIRIZAÇÃO" data-md="empresa" maxlength="80"${trava?" disabled":""}></label>${E.empresa?"":`<p class="md-dica at">A empresa não veio na última planilha para este colaborador: preencha.</p>`}`;
  const corpoOcor=`<span class="md-rot">Faltas desta ocorrência</span><div class="md-chips">${dts||'<span class="md-dica">Sem datas.</span>'}</div><span class="md-rot" style="margin-top:16px">Situações</span><div class="md-chips">${sits}</div>`;
  const corpoMotivo=`<div class="md-ta-h"><span class="md-tag ${E.manual?"man":"auto"}">${E.manual?"Escrito por você":"Texto automático"}</span>${E.manual&&!trava?`<button type="button" data-md="refaz">Voltar ao texto automático</button>`:""}<small class="md-conta${conta>limite*.9?" quase":""}">${conta}/${limite}</small></div>`+
    `<textarea class="md-ta" data-md="motivo" maxlength="${limite}" placeholder="Descreva o motivo da medida"${trava?" disabled":""}>${esc(E.motivo)}</textarea>`;
  el.innerHTML=
    `<section class="md-sec md-ctx"><div class="md-sec-h"><h5>Histórico no ano</h5><small class="md-sec-d">clique num número para ver a lista</small></div><div class="md-hist">${hist}</div>${avisoAnt}</section>`+
    passo("tipo",corpoTipo)+passo("datas",corpoDatas)+passo("ocor",corpoOcor)+passo("motivo",corpoMotivo);
}
function pintaPrev(mudou){
  const E=MDS.ed,el=document.getElementById("md-prev");if(!E||!el)return;
  const z=MDS.zoom;
  el.innerHTML=`<div class="md-prev-h"><div><b>Prévia do documento</b><span>${E.gerada?"Documento "+esc(E.gerada.numero)+" · pronto para imprimir":"Folha A4 · muda na hora conforme você preenche"}</span></div>`+
    `<div class="md-zoom" role="group" aria-label="Zoom da prévia"><button type="button" data-md="zoom" data-v="-1" aria-label="Diminuir">${IC.menos}</button><span id="md-zoom-v">${z?Math.round(z*100)+"%":"Ajustado"}</span><button type="button" data-md="zoom" data-v="1" aria-label="Aumentar">${IC.mais}</button><button type="button" data-md="zoom" data-v="fit" aria-label="Ajustar à largura" title="Ajustar à largura">${IC.ajustar}</button></div></div>`+
    `<div id="md-cx"><div class="md-papel${mudou?" mudou":""}" id="md-papel">${docHtml(docDoEd(E))}</div></div>`;
  escala();
}
// Ajuste automático: a folha inteira cabe na área da prévia quando a tela deixa (largura E altura); em tela baixa
// não passa de 62% (abaixo disso o texto fica ilegível) e a prévia rola. O zoom manual sempre vale.
function ajusteDe(){
  const p=document.getElementById("md-papel"),pv=document.getElementById("md-prev");if(!p||!pv)return 1;
  const larg=(pv.clientWidth-56)/794,alt=(pv.clientHeight-84)/Math.max(1,p.offsetHeight);
  let a=Math.min(1,larg,alt);if(a<.62)a=Math.min(larg,.62);
  return Math.max(.35,a);
}
function escala(){
  const p=document.getElementById("md-papel"),cx=document.getElementById("md-cx"),pv=document.getElementById("md-prev");if(!p||!cx||!pv)return;
  const s=MDS.zoom||ajusteDe();
  p.style.transform="scale("+s+")";p.style.transformOrigin="top left";cx.style.width=(794*s)+"px";cx.style.height=(p.offsetHeight*s)+"px";
  const v=document.getElementById("md-zoom-v");if(v)v.textContent=MDS.zoom?Math.round(s*100)+"%":"Ajustado ("+Math.round(s*100)+"%)";
}
function faltando(E){
  const f=[];
  if(!E.tipo)f.push("o tipo da medida");
  if(E.tipo==="SUSPENSAO"&&!(E.dias>=1&&E.dias<=30))f.push("os dias de suspensão");
  if(!E.inicio)f.push("a data");
  if(String(E.motivo).trim().length<5)f.push("o motivo");
  if(!String(E.empresa).trim())f.push("a empresa");
  return f;
}
function pintaRod(){
  const E=MDS.ed,el=document.getElementById("md-rod");if(!E||!el)return;
  pintaPassos();
  el.classList.toggle("alerta",!!(E.sair||E.confirma||E.repetida));
  if(E.sair){
    el.innerHTML=`<div class="md-rod-txt"><b>Fechar sem gerar a medida?</b><span>O que foi preenchido nesta janela se perde.</span></div><button type="button" class="md-b" data-md="ficar">Continuar preenchendo</button><button type="button" class="md-b er" data-md="descartar">${IC.x}Descartar e fechar</button>`;
    return;
  }
  if(E.gerada){
    el.innerHTML=`<div class="md-rod-txt ok"><span class="md-selo">${IC.ok}</span><div><b>Medida ${esc(E.gerada.numero)} gerada.</b><span>Agora: 1) imprima e colha as assinaturas; 2) lance no SAR2G. Até a planilha trazer a medida, ela fica no seu perfil como pendente. Depois, anexe a foto do documento assinado em "Medidas geradas".</span></div></div><button type="button" class="md-b" data-md="fechar">Fechar</button><button type="button" class="md-b pri" data-md="imprimir">${IC.imp}Imprimir ou salvar PDF</button>`;
    return;
  }
  const f=faltando(E),t=TIPOS[E.tipo];
  if(E.repetida){
    el.innerHTML=`<div class="md-rod-txt am"><b>Já existe medida para esta ocorrência</b><span>${esc(E.repetida)}</span></div><button type="button" class="md-b" data-md="voltar">Voltar</button><button type="button" class="md-b pri" data-md="repetir"${E.enviando?" disabled":""}>Gerar outra mesmo assim</button>`;
    return;
  }
  if(E.confirma){
    el.innerHTML=`<div class="md-rod-txt"><b>Gerar ${esc(t.rot.toLowerCase())}${E.tipo==="SUSPENSAO"?" de "+E.dias+(E.dias===1?" dia":" dias"):""} para ${esc(titulo(E.c.nome))}?</b><span>O documento recebe um número e fica registrado em seu nome, pendente de lançar no SAR2G.</span></div><button type="button" class="md-b" data-md="voltar"${E.enviando?" disabled":""}>Voltar e revisar</button><button type="button" class="md-b pri" data-md="gerar"${E.enviando?" disabled":""}>${E.enviando?'<span class="md-gira"></span>Gerando…':IC.ok+"Confirmar e gerar"}</button>`;
    return;
  }
  const resumo=t?`${t.rot}${E.tipo==="SUSPENSAO"?" · "+E.dias+(E.dias===1?" dia":" dias"):""}${E.inicio?" · "+dma(E.inicio):""}`:"Nenhum tipo escolhido";
  el.innerHTML=(E.erro?`<div class="md-rod-txt er"><b>Não deu para gerar</b><span>${esc(E.erro)}</span></div>`:
    `<div class="md-rod-txt"><b>${esc(resumo)}</b><span>${f.length?"Falta preencher "+lista(f)+".":"Tudo pronto. Confira o documento ao lado: o SAR2G continua sendo o sistema oficial, depois de gerar lance a medida lá."}</span></div>`)+
    `<button type="button" class="md-b" data-md="fechar">Cancelar</button><button type="button" class="md-b pri" data-md="confirmar"${f.length?" disabled":""} title="${f.length?"Falta preencher "+esc(lista(f)):"Gerar o documento"}">${IC.doc}Gerar documento</button>`;
}
function atualizaMotivo(){const E=MDS.ed;if(E&&!E.manual)E.motivo=motivoAuto(E);}
function cliqueEd(e){
  const E=MDS.ed;if(!E)return;
  if(e.target.id==="md-ov"){fecharEd(false);return;}
  const b=e.target.closest("[data-md]");if(!b||b.disabled)return;
  const a=b.dataset.md,v=b.dataset.v;
  if(a==="fechar"){fecharEd(!!E.gerada);return;}
  if(a==="ficar"){E.sair=false;pintaRod();return;}
  if(a==="ver"){E.ver=E.ver===v?null:v;const fm=document.getElementById("md-form"),y=fm?fm.scrollTop:0;pintaForm();if(fm)fm.scrollTop=y;return;}
  if(a==="descartar"){fecharEd(true);return;}
  if(a==="ir"||a==="foco"||a==="prox"){if(E.gerada)return;E.foco=v;const fm=document.getElementById("md-form");pintaForm();const s=document.getElementById("md-p-"+v);if(s){s.classList.add("abre");if(fm)fm.scrollTo({top:Math.max(0,s.offsetTop-12),behavior:"smooth"});}return;}
  if(a==="zoom"){
    const ajuste=ajusteDe();
    MDS.zoom=v==="fit"?null:Math.min(1.5,Math.max(.35,Math.round(((MDS.zoom||ajuste)+Number(v)*.1)*10)/10));
    escala();return;
  }
  if(a==="imprimir"){imprimir(docDoEd(E));return;}
  if(a==="tipo"){E.tipo=v;E.erro=null;}
  else if(a==="dias"){E.dias=Math.min(30,Math.max(1,(Number(E.dias)||1)+Number(v)));}
  else if(a==="falta"){E.faltas.has(v)?E.faltas.delete(v):E.faltas.add(v);atualizaMotivo();}
  else if(a==="sit"){E.sits.has(v)?E.sits.delete(v):E.sits.add(v);atualizaMotivo();}
  else if(a==="refaz"){E.manual=false;atualizaMotivo();}
  else if(a==="confirmar"){E.confirma=true;E.erro=null;pintaRod();const g=document.querySelector('#md-rod [data-md="gerar"]');if(g)g.focus();return;}
  else if(a==="voltar"){E.confirma=false;E.repetida=null;pintaRod();return;}
  else if(a==="gerar"){gerar(false);return;}
  else if(a==="repetir"){gerar(true);return;}
  else return;
  // redesenhar o formulário não pode jogar a rolagem para o topo
  const fm=document.getElementById("md-form"),y=fm?fm.scrollTop:0;
  pintaForm();if(fm)fm.scrollTop=y;pintaPrev(true);pintaRod();
}
function digitouEd(e){
  const E=MDS.ed,a=e.target.dataset&&e.target.dataset.md;if(!E||!a)return;
  if(a==="motivo"){
    E.motivo=e.target.value;E.manual=true;
    const sec=e.target.closest(".md-sec"),h=sec&&sec.querySelector(".md-ta-h");
    if(h){
      const tag=h.querySelector(".md-tag");if(tag){tag.className="md-tag man";tag.textContent="Escrito por você";}
      if(!h.querySelector("button")&&tag)tag.insertAdjacentHTML("afterend",`<button type="button" data-md="refaz">Voltar ao texto automático</button>`);
      const ct=h.querySelector(".md-conta");if(ct){ct.textContent=E.motivo.length+"/1500";ct.classList.toggle("quase",E.motivo.length>1350);}
    }
    const n=sec&&sec.querySelector(".md-n"),ok=E.motivo.trim().length>=5;
    if(n&&n.classList.contains("ok")!==ok){n.classList.toggle("ok",ok);n.innerHTML=ok?IC.ok:"4";}
  }
  else if(a==="empresa")E.empresa=e.target.value;
  else if(a==="diasIn")E.dias=Math.min(30,Math.max(1,parseInt(e.target.value,10)||1));
  else return;
  pintaPrev();pintaRod();
}
function mudouEd(e){
  const E=MDS.ed,a=e.target.dataset&&e.target.dataset.md;if(!E||!a)return;
  if(a==="inicio")E.inicio=e.target.value;
  else if(a==="docData")E.docData=e.target.value||hojeSP();
  else if(a==="diasIn"){const fm=document.getElementById("md-form"),y=fm?fm.scrollTop:0;pintaForm();if(fm)fm.scrollTop=y;return;}
  else return;
  const fm=document.getElementById("md-form"),y=fm?fm.scrollTop:0;
  pintaForm();if(fm)fm.scrollTop=y;pintaPrev(true);pintaRod();
}
async function gerar(repetir){
  const E=MDS.ed;if(!E||E.enviando)return;
  E.enviando=true;E.erro=null;pintaRod();
  const c=E.c;
  try{
    const j=await api("medida","POST",{tipo:E.tipo,dias:E.tipo==="SUSPENSAO"?E.dias:0,inicio:E.inicio,motivo:E.motivo,situacoes:[...E.sits],faltas:[...E.faltas],caso:E.k,
      re:c.re,nome:c.nome,empresa:E.empresa,cargo:c.cargo,posto:c.posto,supervisor:c.supervisor,repetir:!!repetir});
    E.gerada=j.medida;E.confirma=false;E.repetida=null;
    carregar(true);
    if(typeof hqToast==="function")hqToast("📄 Medida "+(j.medida&&j.medida.numero||"")+" gerada · lance no SAR2G");
  }catch(err){
    if(err.codigo==="JA_GERADA"){E.repetida=err.message;E.confirma=false;}
    else{E.erro=err.message;E.confirma=false;}
  }finally{
    if(MDS.ed===E){E.enviando=false;pintaForm();pintaPrev();pintaRod();}
  }
}

/* ═════════ dentro da tela Faltas da Supervisão ═════════ */
function acaoCaso(c){
  if(!podeGerar())return"";
  const k=c.re+"|"+c.primeiraFalta,gs=geradasDoCaso(k);
  const sel=gs.map(g=>`<span class="md-pill ${g.status==="LANCADA"?"ok":"pend"}"><i></i>${esc(g.numero)} · ${g.status==="LANCADA"?"lançada no SAR2G":"falta lançar no SAR2G"}</span>`).join(" ");
  return `<div class="md-acao"><button type="button" class="md-b pri" data-k="${esc(k)}" onclick="event.stopPropagation();mdAbrir(this.dataset.k)">${IC.doc}${gs.length?"Gerar outra medida":"Gerar medida"}</button>${sel}<small>${gs.length?"":"Escolha a medida, escreva o motivo e confira o documento antes de imprimir."}</small></div>`;
}
// Situações em que ainda cabe medida (as mesmas que a TV mostra como em aberto): nas outras o botão não aparece.
const ABERTAS=["PRAZO_VENCIDO","NO_PRAZO","AGUARDANDO_RETORNO","COORDENACAO"];
function selosNasLinhas(){
  document.querySelectorAll("#fs-sec .fs-row[data-k]").forEach(r=>{
    const k=r.dataset.k,gs=geradasDoCaso(k),lim=r.querySelector(".fs-c.lim")||r.lastElementChild;
    if(!lim)return;
    if(gs.length&&!r.querySelector(".md-pill")){
      const g=gs[0];
      lim.insertAdjacentHTML("beforeend",`<span class="md-pill ${g.status==="LANCADA"?"ok":"pend"}" title="${esc(g.numero)}"><i></i>${g.status==="LANCADA"?"Medida no SAR2G":"Gerada · lançar no SAR2G"}</span>`);
    }
    // botão direto na linha da situação: o supervisor não precisa abrir o caso antes
    const c=casoDe(k);
    if(podeGerar()&&c&&ABERTAS.indexOf(c.situacao)>=0&&!r.querySelector(".md-rowbtn")){
      lim.insertAdjacentHTML("beforeend",`<button type="button" class="md-b pri sm md-rowbtn" data-k="${esc(k)}" title="Gerar a medida de ${esc(titulo(c.nome))}" aria-label="Gerar medida de ${esc(titulo(c.nome))}" onclick="event.stopPropagation();mdAbrir(this.dataset.k)">${IC.doc}${gs.length?"Gerar outra":"Gerar medida"}</button>`);
    }
  });
}

/* ── aba "Medidas geradas" ── */
const STATUS={PENDENTE:["Falta lançar no SAR2G","pend"],LANCADA:["Lançada no SAR2G","ok"],CANCELADA:["Cancelada","canc"]};
function tela(){
  if(MDS.erro)return `<div class="md-vazio"><b>Não foi possível carregar as medidas geradas</b>${esc(MDS.erro)}</div>`;
  if(!MDS.lista){carregar();return `<div class="md-vazio"><b>Carregando…</b></div>`;}
  const e=typeof fsEscopo==="function"?fsEscopo():{vista:"todas"};
  const naArea=g=>typeof fsNaArea!=="function"||fsNaArea(g.supervisor||""); // o mesmo filtro de área/"ver como" da tela
  const L=MDS.lista.filter(naArea),q=MDS.busca.trim().toLowerCase();
  const n=s=>L.filter(g=>g.status===s).length,atras=L.filter(g=>g.status==="PENDENTE"&&g.diasPendente>=3).length;
  const semAss=g=>g.status!=="CANCELADA"&&!g.assinado,nSem=L.filter(semAss).length;
  const k=(id,cls,rot,val,sub)=>`<button type="button" class="md-kpi ${cls}${MDS.filtro===id?" on":""}" onclick="mdFiltro('${id}')"><small>${rot}</small><b>${val}</b><span>${sub}</span></button>`;
  let h=`<div class="md-tela"><div class="md-kpis k5">`+
    k("PENDENTE","am","Falta lançar no SAR2G",n("PENDENTE"),atras?`${atras} há 3 dias ou mais`:"geradas no painel")+
    k("SEMASS",nSem?"am":"","Sem documento assinado",nSem,"falta anexar a foto ou o PDF")+
    k("LANCADA","ok","Lançadas no SAR2G",n("LANCADA"),"pela planilha ou marcadas")+
    k("CANCELADA","","Canceladas",n("CANCELADA"),"geradas por engano")+
    k("TODAS","","Todas",L.length,MDS.coord?"de todas as áreas":"da sua área")+`</div>`;
  h+=`<div class="md-bar"><input class="md-in md-busca" id="md-busca" placeholder="Buscar por colaborador, RE, número ou motivo" value="${esc(MDS.busca)}" oninput="mdBusca(this.value)"><span class="md-dica" style="margin:0">A medida sai de "falta lançar" sozinha quando a planilha diária trouxer a medida do colaborador.</span></div>`;
  const vis=L.filter(g=>(MDS.filtro==="TODAS"||(MDS.filtro==="SEMASS"?semAss(g):g.status===MDS.filtro))&&(!q||[g.nome,g.re,g.numero,g.motivo,g.posto].some(v=>String(v||"").toLowerCase().indexOf(q)>=0)));
  if(!vis.length)return h+`<div class="md-vazio"><b>${MDS.filtro==="PENDENTE"?"Nada pendente":MDS.filtro==="SEMASS"?"Todas com o documento assinado":"Nenhuma medida"}</b>${MDS.filtro==="PENDENTE"?"Todas as medidas geradas já estão no SAR2G.":MDS.filtro==="SEMASS"?"Todas as medidas têm a foto ou o PDF do documento assinado.":"Nenhuma medida com esse filtro."}</div></div>`;
  const grupos={};vis.forEach(g=>{const s=titulo(g.supervisor||"Sem supervisor");(grupos[s]=grupos[s]||[]).push(g);});
  Object.keys(grupos).sort((a,b)=>grupos[b].filter(g=>g.status==="PENDENTE").length-grupos[a].filter(g=>g.status==="PENDENTE").length||a.localeCompare(b)).forEach(s=>{
    const gs=grupos[s],p=gs.filter(g=>g.status==="PENDENTE").length,sa=gs.filter(semAss).length;
    h+=`<div class="md-grupo"><div class="md-grupo-h"><b>${esc(s)}</b><span>${gs.length} ${gs.length===1?"medida":"medidas"}${p?` · <span class="md-pill pend"><i></i>${p} falta lançar</span>`:""}${sa?` · <span class="md-pill pend"><i></i>${sa} sem assinatura</span>`:""}</span></div>`+gs.map(item).join("")+`</div>`;
  });
  return h+`</div>`;
}
function item(g){
  const st=STATUS[g.status]||["",""],eu=uk(),pode=MDS.coord||g.geradaPor===eu;
  const t=TIPOS[g.tipoId]?TIPOS[g.tipoId].rot:g.tipo,dias=g.tipoId==="SUSPENSAO"?" · "+g.dias+(g.dias===1?" dia":" dias"):"";
  const sub=g.status==="PENDENTE"?(g.diasPendente?`há ${g.diasPendente} ${g.diasPendente===1?"dia":"dias"}`:"gerada hoje"):g.status==="LANCADA"?(g.lancadaPor==="planilha"?`na planilha em ${esc(dm(g.lancadaEm))}`:`marcada por ${esc(nomeDe(g.lancadaPor))}`):`por ${esc(nomeDe(g.canceladaPor))}: ${esc(g.motivoCancelamento)}`;
  const ac=[`<button type="button" class="md-b sm" data-c="${g.chave}" onclick="mdReimprimir(this.dataset.c)" title="Imprimir de novo">${IC.imp}Imprimir</button>`];
  // documento assinado: ver quem tem; anexar (ou trocar) quem pode mexer na medida
  if(g.assinado)ac.push(`<button type="button" class="md-b sm ok" data-c="${g.chave}" onclick="mdVerAssinado(this.dataset.c)" title="Anexado por ${esc(nomeDe(g.assinado.por))} em ${esc(quando(g.assinado.em))}">${IC.olho}Assinado</button>`);
  if(g.status!=="CANCELADA")ac.push(`<label class="md-b sm${g.assinado?"":" pri"}" title="${g.assinado?"Trocar o arquivo":"Foto ou PDF do documento assinado pelo colaborador"}">${IC.clip}${g.assinado?"Trocar":"Anexar assinado"}<input type="file" accept="image/*,application/pdf" data-c="${g.chave}" onchange="mdAnexar(this)" hidden></label>`);
  if(pode&&g.status==="PENDENTE")ac.push(`<button type="button" class="md-b sm ok" data-c="${g.chave}" onclick="mdLancada(this.dataset.c,true)">${IC.ok}Já lancei no SAR2G</button>`);
  if(pode&&g.status==="LANCADA"&&g.manual)ac.push(`<button type="button" class="md-b sm" data-c="${g.chave}" onclick="mdLancada(this.dataset.c,false)">Desfazer</button>`);
  if(pode&&g.status!=="CANCELADA")ac.push(`<button type="button" class="md-b sm er" data-c="${g.chave}" onclick="mdCancelar(this.dataset.c)" title="Cancelar (gerada por engano)">${IC.x}</button>`);
  return `<div class="md-it${g.status==="PENDENTE"&&g.diasPendente>=3?" atr":""}">`+
    `<div class="num"><b>${esc(g.numero)}</b><small>${esc(quando(g.geradaEm))}<br>por ${esc(nomeDe(g.geradaPor))}</small></div>`+
    `<div><b>${esc(titulo(g.nome))}</b><small>RE ${esc(g.re)} · ${esc(g.posto||"")}</small></div>`+
    `<div><b>${esc(t)}${esc(dias)}</b><small>a partir de ${esc(dma(g.inicio))}</small></div>`+
    `<div class="mot" title="${esc(g.motivo)}">${esc(g.motivo)}</div>`+
    `<div><span class="md-pill ${st[1]}"><i></i>${st[0]}</span><small>${sub}</small></div>`+
    `<div class="ac">${ac.join("")}</div></div>`;
}
window.mdFiltro=f=>{MDS.filtro=f;redesenhar();};
window.mdBusca=v=>{MDS.busca=v;clearTimeout(MDS.tb);MDS.tb=setTimeout(()=>{redesenhar();const i=document.getElementById("md-busca");if(i){i.focus();i.setSelectionRange(v.length,v.length);}},180);};
window.mdReimprimir=ch=>{const g=(MDS.lista||[]).find(x=>x.chave===ch);if(g){injetaCss();imprimir(docDaGerada(g));}};
window.mdLancada=async(ch,v)=>{
  try{await api("medida_lancada","POST",{chave:ch,lancado:v});await carregar(true);if(typeof hqToast==="function")hqToast(v?"✅ Marcada como lançada no SAR2G":"Voltou para pendente");}
  catch(e){alert(e.message);}
};
window.mdCancelar=async ch=>{
  const g=(MDS.lista||[]).find(x=>x.chave===ch);if(!g)return;
  const m=prompt(`Cancelar a medida ${g.numero} (${titulo(g.nome)})?\nEla sai da lista de pendentes, mas o registro fica.\n\nEscreva o motivo do cancelamento:`);
  if(m==null)return;
  try{await api("medida_cancelar","POST",{chave:ch,motivo:m});await carregar(true);}
  catch(e){alert(e.message);}
};
window.mdAbrir=abrir;

/* ── documento assinado: foto (reduzida aqui, como a assinatura do e-mail) ou PDF ── */
const ANEXO_MAX=2400*1024; // o servidor aceita até 2,5 MB
const bytesDe=u=>{const b=u.slice(u.indexOf(",")+1);return Math.floor(b.length*3/4)-(b.endsWith("==")?2:b.endsWith("=")?1:0);};
const lerArquivo=f=>new Promise((ok,err)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>err(new Error("Não deu para ler o arquivo."));r.readAsDataURL(f);});
function reduzirFoto(dataUrl){
  return new Promise((ok,err)=>{
    const img=new Image();
    img.onload=()=>{
      // 1800 px no lado maior lê bem a assinatura e o texto; JPEG baixando a qualidade até caber
      for(const lado of [1800,1500,1200]){
        const s=Math.min(1,lado/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.round(img.naturalWidth*s),h=Math.round(img.naturalHeight*s);
        const c=document.createElement("canvas");c.width=w;c.height=h;
        const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,w,h);g.imageSmoothingQuality="high";g.drawImage(img,0,0,w,h);
        for(const q of [.85,.75,.65]){const u=c.toDataURL("image/jpeg",q);if(bytesDe(u)<=ANEXO_MAX)return ok(u);}
      }
      err(new Error("Não consegui reduzir a foto. Tire de novo, mais perto do documento."));
    };
    img.onerror=()=>err(new Error("Não deu para abrir essa imagem. Envie uma foto JPG ou PNG, ou um PDF."));
    img.src=dataUrl;
  });
}
window.mdAnexar=async function(inp){
  const f=inp.files&&inp.files[0],ch=inp.dataset.c;inp.value="";
  if(!f)return;
  const g=(MDS.lista||[]).find(x=>x.chave===ch);
  try{
    let u=await lerArquivo(f);
    if(f.type==="application/pdf"){if(bytesDe(u)>ANEXO_MAX)throw new Error("O PDF passa de 2,4 MB. Salve com qualidade menor ou envie uma foto.");}
    else if(/^image\//.test(f.type))u=await reduzirFoto(u);
    else throw new Error("Envie uma foto ou um PDF do documento assinado.");
    if(typeof hqToast==="function")hqToast("Enviando o documento assinado…");
    await api("medida_assinado","POST",{chave:ch,arquivo:u,nome:f.name});
    await carregar(true);
    if(typeof hqToast==="function")hqToast("📎 Documento assinado anexado"+(g?" à "+g.numero:""));
  }catch(e){alert(e.message);}
};
window.mdVerAssinado=async function(ch){
  const g=(MDS.lista||[]).find(x=>x.chave===ch);
  const ov=document.createElement("div");ov.className="md-ov";ov.id="md-anexo";
  const fechar=()=>{const u=ov.dataset.url;if(u)URL.revokeObjectURL(u);ov.remove();document.removeEventListener("keydown",esc1);};
  const esc1=e=>{if(e.key==="Escape")fechar();};
  ov.innerHTML=`<div class="md-win" style="width:min(980px,100%)" role="dialog" aria-modal="true" aria-label="Documento assinado"><div class="md-hd"><div class="t"><b>Documento assinado · ${esc(g?g.numero:"")}</b><span>${g?esc(titulo(g.nome))+" · anexado por "+esc(nomeDe(g.assinado&&g.assinado.por))+" em "+esc(quando(g.assinado&&g.assinado.em)):""}</span></div><button type="button" class="md-x" aria-label="Fechar">✕</button></div><div class="md-anexo-c"><p class="md-dica">Carregando…</p></div></div>`;
  ov.addEventListener("click",e=>{if(e.target===ov||e.target.closest(".md-x"))fechar();});
  document.addEventListener("keydown",esc1);
  document.body.appendChild(ov);
  const c=ov.querySelector(".md-anexo-c");
  try{
    const j=await api("medida_assinado&chave="+encodeURIComponent(ch));
    const bin=atob(j.base64),arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([arr],{type:j.tipo}));ov.dataset.url=url;
    const nome=(j.numero||"medida")+"-assinada."+(j.tipo==="application/pdf"?"pdf":j.tipo==="image/png"?"png":"jpg");
    // PDF não abre em quadro dentro da página (a política de segurança do vercel.json só deixa a própria página): abre numa aba
    c.innerHTML=(j.tipo==="application/pdf"?`<div class="md-alerta" style="margin:20px">Documento em PDF${j.nome?" ("+esc(j.nome)+")":""}. Abra numa aba nova ou baixe.</div>`:`<img src="${url}" alt="Documento assinado">`)+
      `<div class="md-anexo-r">${j.tipo==="application/pdf"?`<a class="md-b pri" href="${url}" target="_blank" rel="noopener">Abrir o PDF</a>`:""}<a class="md-b" href="${url}" download="${esc(nome)}">Baixar</a></div>`;
  }catch(e){c.innerHTML=`<div class="md-alerta er">${esc(e.message)}</div>`;}
};

/* ── encaixe na tela dos supervisores (sem mexer no index.html, que está no limite) ── */
function redesenhar(){if(typeof fsRender==="function")fsRender();}
function encaixar(){
  if(typeof window.fsRender!=="function"||window.fsRender.__md)return;
  const r0=window.fsRender,d0=window.fsDetalhe,l0=window.fsLoad;
  window.fsRender=function(){
    r0.apply(this,arguments);
    const box=document.getElementById("fs-sec"),tabs=box&&box.querySelector(".fm-tabs");
    if(!tabs||!podeGerar())return;
    const p=(MDS.lista||[]).filter(g=>g.status==="PENDENTE").length;
    const on=typeof FS!=="undefined"&&FS.aba==="MEDIDA";
    tabs.insertAdjacentHTML("beforeend",`<button type="button" role="tab" aria-selected="${on}" class="fm-tab${on?" on":""}" onclick="FS.aba='MEDIDA';fsRender();mdCarregar()">Medidas geradas<span class="n">${MDS.lista?p:"…"}</span></button>`);
    if(on){let x=tabs.nextSibling;while(x){const y=x.nextSibling;x.remove();x=y;}tabs.insertAdjacentHTML("afterend",tela());}
    else selosNasLinhas();
  };
  window.fsRender.__md=true;
  if(typeof d0==="function")window.fsDetalhe=function(c){return d0.apply(this,arguments)+acaoCaso(c);};
  if(typeof l0==="function")window.fsLoad=function(){const r=l0.apply(this,arguments);carregar();return r;};
  if(typeof window.sbPerfilRender==="function"){const s0=window.sbPerfilRender;window.sbPerfilRender=function(){s0.apply(this,arguments);lembrete();};}
  if(typeof window._abrirSessao==="function"){const a0=window._abrirSessao;window._abrirSessao=function(){const r=a0.apply(this,arguments);MDS.lista=null;MDS.avisado=false;setTimeout(()=>{carregar(true);irDoLink();},300);return r;};}
}
window.mdCarregar=()=>carregar(true);

/* ── lembrete no perfil: enquanto houver medida gerada sem lançar no SAR2G ── */
function lembrete(){
  const box=document.getElementById("sbPerfil");
  const velho=document.getElementById("md-lembra");if(velho)velho.remove();
  if(!box||!logado()||!MDS.lista)return;
  const eu=uk(),pend=MDS.lista.filter(g=>g.status==="PENDENTE");
  const minhas=pend.filter(g=>g.geradaPor===eu).length,n=MDS.coord?pend.length:minhas;
  if(!n)return;
  const txt=MDS.coord&&n!==minhas?`${n===1?"medida gerada":"medidas geradas"} aguardando o SAR2G`:`${n===1?"medida":"medidas"} para lançar no SAR2G`;
  box.insertAdjacentHTML("afterend",`<button type="button" id="md-lembra" class="md-lembra" onclick="mdIrPendentes()" title="Medidas geradas no painel que ainda não aparecem no SAR2G"><b>${n}</b><span>${txt}</span></button>`);
  if(!MDS.avisado&&minhas&&typeof hqToast==="function"){MDS.avisado=true;hqToast(`⚠️ Você tem ${minhas} ${minhas===1?"medida":"medidas"} para lançar no SAR2G`);}
}
window.mdIrPendentes=function(){
  if(typeof FS!=="undefined"){FS.aba="MEDIDA";}MDS.filtro="PENDENTE";
  if(typeof navTo==="function")navTo("faltassup",document.querySelector('.ni[data-pg="faltassup"]'));
};

/* ── link do e-mail: /?pg=faltassup abre as faltas em aberto (onde fica "Gerar medida") depois do login ── */
(function(){
  try{
    const q=new URLSearchParams(location.search),pg=q.get("pg");
    if(pg==="faltassup"){sessionStorage.setItem("mdIr",JSON.stringify({pg,aba:q.get("aba")==="MEDIDA"?"MEDIDA":"ABERTAS"}));history.replaceState(null,"",location.pathname);}
  }catch(e){}
})();
function irDoLink(){
  let ir=null;try{ir=JSON.parse(sessionStorage.getItem("mdIr")||"null");}catch(e){}
  if(!ir||!logado())return;
  sessionStorage.removeItem("mdIr");
  if(typeof fsPermitido==="function"&&!fsPermitido())return;
  if(typeof FS!=="undefined")FS.aba=ir.aba;
  if(typeof navTo==="function")navTo("faltassup",document.querySelector('.ni[data-pg="faltassup"]'));
}

encaixar();
setTimeout(()=>{encaixar();if(logado()){carregar();irDoLink();}},0);
})();
