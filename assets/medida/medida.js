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
const MDS={lista:null,em:0,carregando:null,erro:null,coord:false,minhas:0,filtro:"PENDENTE",busca:"",ed:null,avisado:false};
const TIPOS={
  ADVERTENCIA_VERBAL:{rot:"Advertência verbal",sub:"Conversa registrada por escrito"},
  ADVERTENCIA_ESCRITA:{rot:"Advertência escrita",sub:"Aviso formal assinado"},
  SUSPENSAO:{rot:"Suspensão",sub:"Afastamento sem remuneração"}
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
  x:svg('<path d="M18 6 6 18M6 6l12 12"/>')
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
  <div class="emp">${d.empresa?esc(String(d.empresa).toUpperCase()):vz("(empresa)")}</div>
  <h1>${tit}</h1>
  <div class="re">RE: ${re} – ${nome}</div>
  <p>${abre}</p>
  <div class="mt">${mt} – ${nome} | RE: ${re}</div>
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
  return{med,faltasAno:p?p.datas.length:null};
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
  MDS.ed={c,k,tipo:"",dias:1,inicio:hojeSP(),docData:hojeSP(),empresa:c.empresa||"",faltas:new Set(fl),sits:new Set(["FALTA_INJUSTIFICADA"]),motivo:"",manual:false,confirma:false,enviando:false,erro:null,repetida:null,gerada:null};
  MDS.ed.motivo=motivoAuto(MDS.ed);
  injetaCss();
  const ov=document.createElement("div");ov.id="md-ov";ov.className="md-ov";
  ov.innerHTML=`<div class="md-win" role="dialog" aria-modal="true" aria-label="Gerar medida disciplinar"><div class="md-hd"><div class="t"><b>Gerar medida disciplinar</b><span>${esc(titulo(c.nome))} · RE ${esc(c.re)} · ${esc(c.posto||"")}</span></div><button type="button" class="md-x" data-md="fechar" aria-label="Fechar">✕</button></div>`+
    `<div class="md-corpo"><div class="md-form" id="md-form"></div><div class="md-prev" id="md-prev"></div></div><div class="md-rod" id="md-rod"></div></div>`;
  ov.addEventListener("click",cliqueEd);ov.addEventListener("input",digitouEd);ov.addEventListener("change",mudouEd);
  document.body.appendChild(ov);document.body.style.overflow="hidden";
  document.addEventListener("keydown",teclaEd);window.addEventListener("resize",escala);
  pintaForm();pintaPrev();pintaRod();
  setTimeout(()=>{const b=ov.querySelector(".md-tipo");if(b)b.focus();},40);
}
function fecharEd(forcar){
  const E=MDS.ed;
  if(!forcar&&E&&!E.gerada&&(E.tipo||E.manual)&&!confirm("Fechar sem gerar a medida? O que foi preenchido se perde."))return;
  const ov=document.getElementById("md-ov");if(ov)ov.remove();
  document.body.style.overflow="";document.removeEventListener("keydown",teclaEd);window.removeEventListener("resize",escala);
  MDS.ed=null;
}
function teclaEd(e){if(e.key==="Escape"&&MDS.ed&&!document.querySelector(".fs-calpop"))fecharEd(false);}
function docDoEd(E){return{empresa:E.empresa,re:E.c.re,nome:E.c.nome,tipoId:E.tipo,dias:E.dias,inicio:E.inicio,motivo:E.motivo,docData:E.docData,numero:E.gerada&&E.gerada.numero,geradoPor:E.gerada&&E.gerada.geradaPor,geradoEm:E.gerada?new Date(Date.parse(E.gerada.geradaEm)-3*3600000).toISOString():null};}

function pintaForm(){
  const E=MDS.ed,el=document.getElementById("md-form");if(!E||!el)return;
  const c=E.c,h=histDe(c),trava=!!E.gerada;
  const ini=String(c.nome||"").split(" ").filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  let hist;
  if(!h.med)hist=`<div class="md-hist-v">Carregando o histórico…</div>`;
  else{
    const n=h.med.length,ult=h.med[0];
    hist=`<div class="md-hist-k"><div><b>${h.faltasAno==null?"—":h.faltasAno}</b><span>faltas injustificadas no ano</span></div><div class="${n>=2?"er":""}"><b>${n}</b><span>${n===1?"medida":"medidas"} no ano${n>=2?" · reincidente":""}</span></div><div><b>${ult?esc(dm(ult.data)):"—"}</b><span>última medida</span></div></div>`+
      (n?`<div class="md-hist-l">${h.med.map(m=>`<div><b>${esc(dm(m.data))}</b><span>${esc(typeof fmMedTxtH==="function"?fmMedTxtH(m):m.tipo)}${m.motivo?`<em>${esc(m.motivo)}</em>`:""}</span></div>`).join("")}</div>`:`<div class="md-hist-v">Nenhuma medida desde ${esc(dma(FM.hist.desde))}: esta é a primeira no ano.</div>`);
  }
  const ant=geradasDoCaso(E.k).filter(g=>!E.gerada||g.chave!==E.gerada.chave);
  const avisoAnt=ant.length?`<div class="md-alerta"><b>Atenção:</b> já ${ant.length===1?"existe a medida":"existem as medidas"} ${lista(ant.map(g=>`<b>${esc(g.numero)}</b> (${esc(TIPOS[g.tipoId]?TIPOS[g.tipoId].rot:g.tipo)}, ${g.status==="LANCADA"?"lançada no SAR2G":"falta lançar no SAR2G"})`))} para esta ocorrência.</div>`:"";
  const tipos=Object.keys(TIPOS).map(t=>`<button type="button" class="md-tipo${E.tipo===t?" on":""}" data-md="tipo" data-v="${t}" aria-pressed="${E.tipo===t}"${trava?" disabled":""}><b>${TIPOS[t].rot}</b><span>${TIPOS[t].sub}</span></button>`).join("");
  const dias=E.tipo==="SUSPENSAO"?`<div class="md-dias"><label for="md-dias">Dias de suspensão</label><div class="md-step"><button type="button" data-md="dias" data-v="-1" aria-label="Menos um dia"${trava?" disabled":""}>−</button><input id="md-dias" type="number" min="1" max="30" value="${E.dias}" data-md="diasIn"${trava?" disabled":""}><button type="button" data-md="dias" data-v="1" aria-label="Mais um dia"${trava?" disabled":""}>+</button></div></div>`:"";
  const prov=E.tipo&&E.tipo!=="SUSPENSAO"?`<p class="md-dica">Modelo de advertência provisório, no mesmo formato da suspensão, até chegar o modelo oficial.</p>`:"";
  const fl=[...new Set(c.faltas||[])].sort();
  const dts=fl.map(d=>`<button type="button" class="md-chip dt${E.faltas.has(d)?" on":""}" data-md="falta" data-v="${d}" aria-pressed="${E.faltas.has(d)}"${trava?" disabled":""}>${esc(typeof fmDdS==="function"?fmDdS(d):dm(d))}</button>`).join("");
  const sits=Object.keys(SITUACOES).map(s=>`<button type="button" class="md-chip${E.sits.has(s)?" on":""}" data-md="sit" data-v="${s}" aria-pressed="${E.sits.has(s)}"${trava?" disabled":""}>${esc(SITUACOES[s])}</button>`).join("");
  el.innerHTML=
    `<div class="md-sec"><h5>Colaborador</h5><div class="md-colab"><div class="md-av">${esc(ini)}</div><div><b>${esc(titulo(c.nome))}</b><small>RE ${esc(c.re)} · ${esc(titulo(c.cargo||""))}<br>${esc(c.posto||"")} · supervisor ${esc(titulo(c.supervisor||"—"))}</small></div></div></div>`+
    `<div class="md-sec"><h5>Histórico no ano</h5><div class="md-hist">${hist}</div>${avisoAnt}</div>`+
    `<div class="md-sec"><h5>Medida</h5><div class="md-tipos" role="group" aria-label="Tipo da medida">${tipos}</div>${dias}${prov}</div>`+
    `<div class="md-sec"><div class="md-grid2"><label class="md-campo">${E.tipo==="SUSPENSAO"?"Suspenso a partir de":"Data da medida"}<input class="md-in" type="date" value="${E.inicio}" data-md="inicio"${trava?" disabled":""}></label><label class="md-campo">Data do documento<input class="md-in" type="date" value="${E.docData}" data-md="docData"${trava?" disabled":""}></label></div>`+
      `<label class="md-campo" style="margin-top:10px">Empresa (cabeçalho)<input class="md-in" value="${esc(E.empresa)}" placeholder="Ex.: SERV CAMP TERCEIRIZAÇÃO" data-md="empresa" maxlength="80"${trava?" disabled":""}></label>${E.empresa?"":`<p class="md-dica">A empresa não veio na última planilha para este colaborador: preencha.</p>`}</div>`+
    `<div class="md-sec"><h5>Faltas desta ocorrência</h5><div class="md-chips">${dts||'<span class="md-dica">Sem datas.</span>'}</div></div>`+
    `<div class="md-sec"><h5>Situações</h5><div class="md-chips">${sits}</div><p class="md-dica">Marque o que aconteceu: o texto do motivo se monta sozinho, e você pode reescrever.</p></div>`+
    `<div class="md-sec"><div class="md-ta-h"><h5 style="margin:0">Motivo (aparece no documento)</h5>${E.manual&&!trava?`<button type="button" data-md="refaz">Refazer texto automático</button>`:`<small>${E.motivo.length}/1500</small>`}</div><textarea class="md-ta" data-md="motivo" maxlength="1500" placeholder="Descreva o motivo da medida"${trava?" disabled":""}>${esc(E.motivo)}</textarea></div>`;
}
function pintaPrev(){
  const E=MDS.ed,el=document.getElementById("md-prev");if(!E||!el)return;
  el.innerHTML=`<div class="md-prev-h"><b>Prévia do documento · A4</b><span>${E.gerada?"Documento "+esc(E.gerada.numero):"Muda na hora conforme você preenche"}</span></div><div id="md-cx"><div class="md-papel" id="md-papel">${docHtml(docDoEd(E))}</div></div>`;
  escala();
}
function escala(){
  const p=document.getElementById("md-papel"),cx=document.getElementById("md-cx"),pv=document.getElementById("md-prev");if(!p||!cx||!pv)return;
  const s=Math.min(1,Math.max(.35,(pv.clientWidth-44)/794));
  p.style.transform="scale("+s+")";p.style.transformOrigin="top left";cx.style.width=(794*s)+"px";cx.style.height=(p.offsetHeight*s)+"px";
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
  if(E.gerada){
    el.innerHTML=`<div class="md-alerta ok" style="margin:0;flex:1"><b>Medida ${esc(E.gerada.numero)} gerada.</b> Imprima, colha as assinaturas e <b>lance no SAR2G</b>: até a planilha trazer a medida, ela fica no seu perfil como pendente.</div><button type="button" class="md-b" data-md="fechar">Fechar</button><button type="button" class="md-b pri" data-md="imprimir">${IC.imp}Imprimir ou salvar PDF</button>`;
    return;
  }
  const f=faltando(E),t=TIPOS[E.tipo];
  if(E.repetida){
    el.innerHTML=`<div class="md-alerta" style="margin:0;flex:1">${esc(E.repetida)}</div><button type="button" class="md-b" data-md="voltar">Voltar</button><button type="button" class="md-b pri" data-md="repetir"${E.enviando?" disabled":""}>Gerar outra mesmo assim</button>`;
    return;
  }
  if(E.confirma){
    el.innerHTML=`<div class="md-aviso" style="flex:1;font-size:.82rem;color:inherit">Gerar <b>${esc(t.rot.toLowerCase())}${E.tipo==="SUSPENSAO"?" de "+E.dias+(E.dias===1?" dia":" dias"):""}</b> para <b>${esc(titulo(E.c.nome))}</b>? O documento recebe um número e fica registrado em seu nome, pendente de lançar no SAR2G.</div><button type="button" class="md-b" data-md="voltar"${E.enviando?" disabled":""}>Voltar</button><button type="button" class="md-b pri" data-md="gerar"${E.enviando?" disabled":""}>${E.enviando?"Gerando…":IC.ok+"Confirmar e gerar"}</button>`;
    return;
  }
  el.innerHTML=(E.erro?`<div class="md-alerta er" style="margin:0;flex:1">${esc(E.erro)}</div>`:`<div class="md-aviso">${f.length?"Falta preencher "+lista(f)+".":"Confira o documento ao lado. O SAR2G continua sendo o sistema oficial: depois de gerar, lance a medida lá."}</div><span class="sp"></span>`)+
    `<button type="button" class="md-b" data-md="fechar">Cancelar</button><button type="button" class="md-b pri" data-md="confirmar"${f.length?" disabled":""}>${IC.doc}Gerar documento</button>`;
}
function atualizaMotivo(){const E=MDS.ed;if(E&&!E.manual)E.motivo=motivoAuto(E);}
function cliqueEd(e){
  const E=MDS.ed;if(!E)return;
  if(e.target.id==="md-ov"){fecharEd(false);return;}
  const b=e.target.closest("[data-md]");if(!b||b.disabled)return;
  const a=b.dataset.md,v=b.dataset.v;
  if(a==="fechar"){fecharEd(!!E.gerada);return;}
  if(a==="imprimir"){imprimir(docDoEd(E));return;}
  if(a==="tipo"){E.tipo=v;E.erro=null;}
  else if(a==="dias"){E.dias=Math.min(30,Math.max(1,(Number(E.dias)||1)+Number(v)));}
  else if(a==="falta"){E.faltas.has(v)?E.faltas.delete(v):E.faltas.add(v);atualizaMotivo();}
  else if(a==="sit"){E.sits.has(v)?E.sits.delete(v):E.sits.add(v);atualizaMotivo();}
  else if(a==="refaz"){E.manual=false;atualizaMotivo();}
  else if(a==="confirmar"){E.confirma=true;E.erro=null;pintaRod();return;}
  else if(a==="voltar"){E.confirma=false;E.repetida=null;pintaRod();return;}
  else if(a==="gerar"){gerar(false);return;}
  else if(a==="repetir"){gerar(true);return;}
  else return;
  pintaForm();pintaPrev();pintaRod();
}
function digitouEd(e){
  const E=MDS.ed,a=e.target.dataset&&e.target.dataset.md;if(!E||!a)return;
  if(a==="motivo"){E.motivo=e.target.value;E.manual=true;const h=e.target.closest(".md-sec").querySelector(".md-ta-h");if(h&&!h.querySelector("button")){h.innerHTML=`<h5 style="margin:0">Motivo (aparece no documento)</h5><button type="button" data-md="refaz">Refazer texto automático</button>`;}}
  else if(a==="empresa")E.empresa=e.target.value;
  else if(a==="diasIn")E.dias=Math.min(30,Math.max(1,parseInt(e.target.value,10)||1));
  else return;
  pintaPrev();pintaRod();
}
function mudouEd(e){
  const E=MDS.ed,a=e.target.dataset&&e.target.dataset.md;if(!E||!a)return;
  if(a==="inicio")E.inicio=e.target.value;
  else if(a==="docData")E.docData=e.target.value||hojeSP();
  else if(a==="diasIn"){pintaForm();return;}
  else return;
  pintaForm();pintaPrev();pintaRod();
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
function selosNasLinhas(){
  if(!MDS.lista||!MDS.lista.length)return;
  document.querySelectorAll("#fs-sec .fs-row[data-k]").forEach(r=>{
    if(r.querySelector(".md-pill"))return;
    const gs=geradasDoCaso(r.dataset.k);if(!gs.length)return;
    const g=gs[0],lim=r.querySelector(".fs-c.lim");if(!lim)return;
    lim.insertAdjacentHTML("beforeend",`<span class="md-pill ${g.status==="LANCADA"?"ok":"pend"}" title="${esc(g.numero)}"><i></i>${g.status==="LANCADA"?"Medida no SAR2G":"Gerada · lançar no SAR2G"}</span>`);
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
  const k=(id,cls,rot,val,sub)=>`<button type="button" class="md-kpi ${cls}${MDS.filtro===id?" on":""}" onclick="mdFiltro('${id}')"><small>${rot}</small><b>${val}</b><span>${sub}</span></button>`;
  let h=`<div class="md-tela"><div class="md-kpis">`+
    k("PENDENTE","am","Falta lançar no SAR2G",n("PENDENTE"),atras?`${atras} há 3 dias ou mais`:"geradas no painel")+
    k("LANCADA","ok","Lançadas no SAR2G",n("LANCADA"),"pela planilha ou marcadas")+
    k("CANCELADA","","Canceladas",n("CANCELADA"),"geradas por engano")+
    k("TODAS","","Todas",L.length,MDS.coord?"de todas as áreas":"da sua área")+`</div>`;
  h+=`<div class="md-bar"><input class="md-in md-busca" id="md-busca" placeholder="Buscar por colaborador, RE, número ou motivo" value="${esc(MDS.busca)}" oninput="mdBusca(this.value)"><span class="md-dica" style="margin:0">A medida sai de "falta lançar" sozinha quando a planilha diária trouxer a medida do colaborador.</span></div>`;
  const vis=L.filter(g=>(MDS.filtro==="TODAS"||g.status===MDS.filtro)&&(!q||[g.nome,g.re,g.numero,g.motivo,g.posto].some(v=>String(v||"").toLowerCase().indexOf(q)>=0)));
  if(!vis.length)return h+`<div class="md-vazio"><b>${MDS.filtro==="PENDENTE"?"Nada pendente":"Nenhuma medida"}</b>${MDS.filtro==="PENDENTE"?"Todas as medidas geradas já estão no SAR2G.":"Nenhuma medida com esse filtro."}</div></div>`;
  const grupos={};vis.forEach(g=>{const s=titulo(g.supervisor||"Sem supervisor");(grupos[s]=grupos[s]||[]).push(g);});
  Object.keys(grupos).sort((a,b)=>grupos[b].filter(g=>g.status==="PENDENTE").length-grupos[a].filter(g=>g.status==="PENDENTE").length||a.localeCompare(b)).forEach(s=>{
    const gs=grupos[s],p=gs.filter(g=>g.status==="PENDENTE").length;
    h+=`<div class="md-grupo"><div class="md-grupo-h"><b>${esc(s)}</b><span>${gs.length} ${gs.length===1?"medida":"medidas"}${p?` · <span class="md-pill pend"><i></i>${p} falta lançar</span>`:""}</span></div>`+gs.map(item).join("")+`</div>`;
  });
  return h+`</div>`;
}
function item(g){
  const st=STATUS[g.status]||["",""],eu=uk(),pode=MDS.coord||g.geradaPor===eu;
  const t=TIPOS[g.tipoId]?TIPOS[g.tipoId].rot:g.tipo,dias=g.tipoId==="SUSPENSAO"?" · "+g.dias+(g.dias===1?" dia":" dias"):"";
  const sub=g.status==="PENDENTE"?(g.diasPendente?`há ${g.diasPendente} ${g.diasPendente===1?"dia":"dias"}`:"gerada hoje"):g.status==="LANCADA"?(g.lancadaPor==="planilha"?`na planilha em ${esc(dm(g.lancadaEm))}`:`marcada por ${esc(nomeDe(g.lancadaPor))}`):`por ${esc(nomeDe(g.canceladaPor))}: ${esc(g.motivoCancelamento)}`;
  const ac=[`<button type="button" class="md-b sm" data-c="${g.chave}" onclick="mdReimprimir(this.dataset.c)" title="Imprimir de novo">${IC.imp}Imprimir</button>`];
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
