/* Comunicado semanal de faltas injustificadas dentro do painel (aba "Comunicado da semana" em Faltas da Supervisão).
   Fica fora do index.html porque ele está no limite de tamanho (test/auth_exigencia).
   O servidor é o api/_comunicado.js (rotas comunicados e comunicado do módulo faltas).
   É o MESMO comunicado que o supervisor recebeu no e-mail, guardado no momento do envio: se alguma falta for
   abonada depois, o texto continua o do e-mail, e ao lado de cada colaborador a tela mostra a situação de agora.
   "Gerar medida" abre a janela da medida (assets/medida/medida.js) já no caso daquele colaborador.
   Abrir o comunicado fica registrado (o painel do aviso mostra quem abriu); a coordenação olhando não conta.
   Feita primeiro para o celular: uma coluna, botão de 48 px, nada depende de passar o mouse. */
(function(){
"use strict";
const CO={lista:null,sel:null,dados:null,erro:null,carregando:false,carregandoUm:false};
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const iso=d=>String(d||"").slice(0,10);
const dm=d=>{const s=iso(d);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(8,10)+"/"+s.slice(5,7):"—";};
const dma=d=>{const s=iso(d);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4):"—";};
const SEM=["dom","seg","ter","qua","qui","sex","sáb"];
const diaSem=d=>SEM[new Date(iso(d)+"T12:00:00Z").getUTCDay()];
const quando=t=>{const x=Date.parse(t);if(!x)return"";const s=new Date(x-3*3600000).toISOString();return s.slice(8,10)+"/"+s.slice(5,7)+" às "+s.slice(11,16);};
const logado=()=>sessionStorage.getItem("logged")==="1";
const titulo=s=>typeof fmNomeCard==="function"?fmNomeCard(s):String(s||"");
const podeGerar=()=>{const d=typeof FM!=="undefined"&&FM.dados;return !!(d&&d.medida&&d.medida.pode_gerar);};

async function api(t,extra){
  const r=await fetch("/api/rh?modulo=faltas&t="+t+(extra||""));
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(j.error||("Falha ("+r.status+")"));e.status=r.status;e.codigo=j.codigo;throw e;}
  return j;
}
const redesenhar=()=>{if(document.querySelector("#pg-faltassup.active")&&typeof fsRender==="function")fsRender();};

/* ── dados ── */
function carregarLista(forcar){
  if(!logado()||CO.carregando||(CO.lista&&!forcar))return;
  CO.carregando=true;
  api("comunicados").then(j=>{
    CO.lista=j.comunicados||[];CO.erro=null;
    if(!CO.sel||!CO.lista.some(c=>c.semana===CO.sel.semana&&c.area===CO.sel.area)){
      const c0=CO.lista[0];CO.sel=c0?{semana:c0.semana,area:c0.area}:null;CO.dados=null;
    }
  }).catch(e=>{CO.erro=e.message;CO.lista=[];})
    .finally(()=>{CO.carregando=false;if(CO.sel)carregarUm();redesenhar();});
}
function carregarUm(){
  const s=CO.sel;if(!s||CO.carregandoUm||(CO.dados&&CO.dados.semana===s.semana&&CO.dados.area===s.area))return;
  CO.carregandoUm=true;CO.dados=null;
  api("comunicado","&semana="+encodeURIComponent(s.semana)+"&area="+encodeURIComponent(s.area)).then(j=>{
    CO.dados=j.comunicado;CO.erro=null;
  }).catch(e=>{CO.erro=e.message;})
    .finally(()=>{CO.carregandoUm=false;redesenhar();if(CO.sel&&(!CO.dados||CO.dados.semana!==CO.sel.semana||CO.dados.area!==CO.sel.area)&&!CO.erro)carregarUm();});
}

/* ── situação de agora de cada colaborador (a tela de faltas em aberto) ── */
function casosDe(re,datas){
  const d=typeof FM!=="undefined"&&FM.dados;if(!d||!d.casos)return null;
  const alvo=new Set(datas||[]);
  return d.casos.filter(c=>String(c.re)===String(re)&&(c.faltas||[]).some(x=>alvo.has(iso(x))));
}
const ABERTAS=["PRAZO_VENCIDO","NO_PRAZO","AGUARDANDO_RETORNO","COORDENACAO"];
function geradas(k){return typeof window.mdGeradasDoCaso==="function"?window.mdGeradasDoCaso(k):[];}
function situacao(l){
  const cs=casosDe(l.re,l.datas);
  if(cs==null)return{html:'<span class="co-st mut">Conferindo a situação…</span>',abertos:[]};
  const abertos=cs.filter(c=>ABERTAS.indexOf(c.situacao)>=0);
  const pills=cs.flatMap(c=>geradas(c.re+"|"+c.primeiraFalta)).map(g=>`<span class="md-pill ${g.status==="LANCADA"?"ok":"pend"}"><i></i>${esc(g.numero)} · ${g.status==="LANCADA"?"lançada no SAR2G":"falta lançar no SAR2G"}</span>`).join(" ");
  let t;
  if(abertos.length)t='<span class="co-st abe">Em aberto agora</span>';
  else if(cs.some(c=>c.situacao==="TRATADA"||c.situacao==="TRATADA_FORA_DO_PRAZO"))t='<span class="co-st ok">Medida já aplicada</span>';
  else t='<span class="co-st mut">Não consta mais como falta em aberto</span>';
  return{html:t+(pills?" "+pills:""),abertos};
}

/* ── tela ── */
const ROT={RETIRADA:"Retirada",ABONADA:"Abonada",MEDIDA:"Medida aplicada",NOVA:"Lançada depois"};
function cartao(l){
  const h=l.hist,s=situacao(l);
  const datas=(l.datas||[]).map(d=>`<span class="co-dt">${esc(diaSem(d))} ${esc(dm(d))}</span>`).join("");
  const hist=h?`<div class="co-h"><span><b>${h.faltasAno}</b> ${h.faltasAno===1?"falta injustificada":"faltas injustificadas"} no ano</span><span>Medidas disciplinares: <b>${esc(h.txt||"Nenhuma medida")}</b></span>${h.reincidente?'<span class="md-pill rein">Reincidente</span>':""}</div>`:"";
  // um botão por ocorrência em aberto do colaborador (quase sempre uma só)
  const botao=podeGerar()?s.abertos.map(c=>{const k=c.re+"|"+c.primeiraFalta;return `<button type="button" class="md-b pri co-gerar" data-k="${esc(k)}" onclick="coGerar(this.dataset.k)">Gerar medida${s.abertos.length>1?" · falta de "+esc(dm(c.primeiraFalta)):""}</button>`;}).join(""):"";
  return `<article class="co-c"><header><b>${esc(titulo(l.nome))}</b><span>RE ${esc(l.re)}</span></header>`+
    `<div class="co-meta">${[l.posto,l.cargo,l.escala].filter(Boolean).map(esc).join(" · ")}</div>`+
    `<div class="co-rot">${(l.datas||[]).length===1?"Falta":"Faltas"}</div><div class="co-dts">${datas}</div>${hist}`+
    `<footer><div class="co-sit">${s.html}</div>${botao}</footer></article>`;
}
function atualizacoes(a){
  if(!a||!a.itens||!a.itens.length)return"";
  return `<section class="co-at"><h5>Desde o aviso anterior (${esc(dma(a.de))} a ${esc(dma(a.ate))})</h5>`+
    a.itens.map(i=>`<div class="co-ai"><span class="co-tag ${esc(String(i.tipo).toLowerCase())}">${esc(ROT[i.tipo]||i.tipo)}</span><div><b>${esc(titulo(i.nome))}</b> · RE ${esc(i.re)} · ${esc(dm(i.data))}<small>${esc(i.detalhe)}</small></div></div>`).join("")+`</section>`;
}
function seletores(){
  const L=CO.lista||[],s=CO.sel;if(!s)return"";
  const semanas=[...new Set(L.map(c=>c.semana))];
  const areas=L.filter(c=>c.semana===s.semana);
  const sem=`<label class="co-sel"><span>Semana</span><select aria-label="Semana do comunicado" onchange="coEscolhe(this.value,'')">${semanas.map(w=>{const c=L.find(x=>x.semana===w);return `<option value="${esc(w)}"${w===s.semana?" selected":""}>${esc(dm(c.inicio))} a ${esc(dm(c.fim))}</option>`;}).join("")}</select></label>`;
  const ar=areas.length>1?`<label class="co-sel"><span>Área</span><select aria-label="Área do comunicado" onchange="coEscolhe('${esc(s.semana)}',this.value)">${areas.map(c=>`<option value="${esc(c.area)}"${c.area===s.area?" selected":""}>${esc(titulo(c.nome))}</option>`).join("")}</select></label>`:"";
  return `<div class="co-sels">${sem}${ar}</div>`;
}
function tela(){
  if(CO.erro&&!CO.lista)return `<div class="co"><div class="md-alerta er">${esc(CO.erro)}</div></div>`;
  if(!CO.lista){carregarLista();return `<div class="co"><div class="co-vz"><b>Carregando o comunicado…</b></div></div>`;}
  if(!CO.lista.length)return `<div class="co"><div class="co-vz"><b>Ainda não há comunicado guardado</b>O comunicado aparece aqui a partir do próximo envio oficial do aviso semanal. Enquanto isso, as faltas continuam na aba <b>Faltas em aberto</b>.<button type="button" class="md-b" onclick="FS.aba='ABERTAS';fsRender()">Ver faltas em aberto</button></div></div>`;
  const d=CO.dados;
  let corpo;
  if(CO.erro)corpo=`<div class="md-alerta er">${esc(CO.erro)}</div>`;
  else if(!d||!CO.sel||d.semana!==CO.sel.semana||d.area!==CO.sel.area){carregarUm();corpo=`<div class="co-vz"><b>Carregando…</b></div>`;}
  else{
    const L=d.linhas||[];
    corpo=`<div class="co-top"><div><h4>Comunicado semanal de faltas injustificadas</h4><p>${esc(titulo(d.nome))} · semana de ${esc(dma(d.inicio))} a ${esc(dma(d.fim))} · enviado em ${esc(quando(d.enviadoEm))}</p></div>`+
      `<div class="co-n"><b>${d.colaboradores}</b><span>${d.colaboradores===1?"colaborador":"colaboradores"}</span><b>${d.qtd}</b><span>${d.qtd===1?"ocorrência":"ocorrências"}</span></div></div>`+
      `<p class="co-nota">É o mesmo comunicado do e-mail, como foi enviado. A situação de cada colaborador abaixo é a de agora.</p>`+
      (L.length?L.map(cartao).join(""):`<div class="co-vz"><b>Nenhuma falta injustificada na sua área nesta semana</b>O e-mail desta semana informou isso.</div>`)+atualizacoes(d.atualizacoes);
  }
  return `<div class="co">${seletores()}${corpo}</div>`;
}

window.coEscolhe=function(semana,area){
  const L=CO.lista||[];
  const c=L.find(x=>x.semana===semana&&(!area||x.area===area))||L.find(x=>x.semana===semana);
  if(!c)return;
  CO.sel={semana:c.semana,area:c.area};CO.dados=null;CO.erro=null;redesenhar();carregarUm();
};
window.coGerar=function(k){if(typeof window.mdAbrir==="function")window.mdAbrir(k);};

/* ── encaixe na tela dos supervisores (mesmo padrão da aba "Medidas geradas") ── */
function encaixar(){
  if(typeof window.fsRender!=="function"||window.fsRender.__co)return;
  const r0=window.fsRender;
  window.fsRender=function(){
    r0.apply(this,arguments);
    const box=document.getElementById("fs-sec"),tabs=box&&box.querySelector(".fm-tabs");
    if(!tabs||!podeGerar())return;
    const on=typeof FS!=="undefined"&&FS.aba==="COMUNICADO";
    tabs.insertAdjacentHTML("afterbegin",`<button type="button" role="tab" aria-selected="${on}" class="fm-tab${on?" on":""}" onclick="FS.aba='COMUNICADO';fsRender()">Comunicado da semana</button>`);
    if(on){let x=tabs.nextSibling;while(x){const y=x.nextSibling;x.remove();x=y;}tabs.insertAdjacentHTML("afterend",tela());}
  };
  window.fsRender.__co=true;
  if(typeof window._abrirSessao==="function"){const a0=window._abrirSessao;window._abrirSessao=function(){const r=a0.apply(this,arguments);CO.lista=null;CO.dados=null;CO.sel=null;return r;};}
}
encaixar();
setTimeout(encaixar,0);
})();
