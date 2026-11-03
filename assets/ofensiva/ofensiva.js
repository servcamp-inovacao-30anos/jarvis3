/* Ofensiva — dias seguidos de uso do Dashboard (como no Duolingo).
   Fica fora do index.html porque ele já está perto do limite de tamanho (test/auth_exigencia).
   O servidor é o api/_ofensiva.js (/api/rh?modulo=ofensiva); as regras estão em api/_ofensiva_regras.js:
   • só dias úteis (seg a sex); o dia vale com 3 guias diferentes abertas por CLIQUE da pessoa;
   • 2 congelamentos por mês: um dia útil perdido gasta 1 e a sequência continua;
   • o contador aparece no cartão do usuário (menu) e na tela de boas-vindas, e o ranking só na Base Virtual.
   Quem deixa a TV aberta, ou o Modo TV trocando de tela sozinho, não pontua: a tela só avisa o servidor
   quando a troca de guia veio de um evento de verdade (isTrusted), nunca de temporizador. */
(function(raiz){
"use strict";
const META=3;
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uk=()=>sessionStorage.getItem("userKey")||"";
const logado=()=>sessionStorage.getItem("logged")==="1"&&!!uk();
const toast=t=>{if(typeof hqToast==="function")hqToast(t);};
const diaBR=()=>new Date().toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"});
const OF={dono:null,est:null,rank:null,pedindo:false,fila:Promise.resolve(),rankEm:0};

function nomeDe(r){
  if(r.nome)return r.nome;
  try{if(typeof USERS!=="undefined"&&USERS[r.user_key]&&USERS[r.user_key].nome)return USERS[r.user_key].nome;}catch(e){}
  return r.user_key;
}
async function api(t,metodo,corpo){
  const r=await fetch("/api/rh?modulo=ofensiva"+(t?"&t="+t:""),{method:metodo||"GET",headers:corpo?{"Content-Type":"application/json"}:{},body:corpo?JSON.stringify(corpo):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||("Falha ("+r.status+")"));
  return j;
}
function esquecer(){
  OF.dono=null;OF.est=null;OF.rank=null;OF.rankEm=0;
  const c=document.getElementById("sbOfensiva");if(c){c.hidden=true;c.innerHTML="";}
  const r=document.getElementById("of-ranking");if(r){r.hidden=true;r.innerHTML="";}
}
function checarDono(){if(OF.dono!==uk()){esquecer();OF.dono=uk();}}

/* ── contador no cartão do usuário ─────────────────────────────────────── */
function renderContador(){
  const el=document.getElementById("sbOfensiva");if(!el)return;
  const e=OF.est;
  if(!logado()||!e||!e.ativo){el.hidden=true;el.innerHTML="";return;}
  const n=e.sequencia||0;
  let linha2;
  if(!e.util)linha2="fim de semana: a sequência descansa";
  else if(e.hojeOk)linha2="✓ hoje feito";
  else linha2="hoje: "+e.guiasHoje+" de "+META+" guias";
  const cong=e.congelamentosRestantes!=null?"❄️ "+e.congelamentosRestantes+" congelamento"+(e.congelamentosRestantes===1?"":"s")+" no mês":"";
  const aviso=e.congeladoRecente?" · ❄️ congelou ontem":"";
  el.hidden=false;
  el.className="sb-of"+(n>0?" on":"")+(e.util&&e.hojeOk?" ok":"");
  el.title="Ofensiva: dias úteis seguidos em que você abriu "+META+" guias diferentes.\nMelhor sequência: "+(e.melhor||0)+" dia"+((e.melhor||0)===1?"":"s")+".\n"+cong.replace("❄️ ","")+" (o dia útil perdido gasta 1 e a sequência segue).";
  el.innerHTML='<div class="sb-of-n"><span class="sb-of-ic">🔥</span><b>'+n+'</b> dia'+(n===1?"":"s")+' seguido'+(n===1?"":"s")+'</div>'+
    '<div class="sb-of-s">'+esc(linha2)+esc(aviso)+'</div>';
  renderBoasVindas();
}

/* ── tela de boas-vindas (logo depois do login) ─────────────────────────── */
// O servidor responde em instantes; se a tela já estiver aberta quando o estado chegar, o renderContador chama aqui de novo.
function renderBoasVindas(){
  const el=document.getElementById("welOfensiva");if(!el)return;
  const e=OF.est;
  if(!logado()||!e||!e.ativo){el.innerHTML="";return;}
  const n=e.sequencia||0;
  let sub;
  if(!e.util)sub="Fim de semana: a sua sequência descansa";
  else if(e.hojeOk)sub="✓ Hoje já está feito";
  else if(n>0)sub="Abra "+META+" guias hoje para manter a sequência ("+e.guiasHoje+" de "+META+")";
  else sub="Abra "+META+" guias hoje para começar a sua ofensiva";
  const frio=n===0;
  el.innerHTML='<div style="margin-top:16px;padding:12px 18px;border-radius:14px;background:rgba(251,146,60,.16);border:1px solid rgba(251,146,60,.5)">'+
    '<div style="color:#fff;font-size:1.05rem;font-weight:900"><span style="'+(frio?"filter:grayscale(1);opacity:.6":"")+'">🔥</span> '+(frio?"Sem sequência ainda":n+" dia"+(n===1?"":"s")+" seguido"+(n===1?"":"s"))+'</div>'+
    '<div style="color:#fdba74;font-size:.72rem;font-weight:700;margin-top:3px">'+esc(sub)+'</div>'+
    (e.congeladoRecente?'<div style="color:#bfdbfe;font-size:.66rem;margin-top:3px">❄️ Um congelamento salvou a sua sequência ontem</div>':"")+'</div>';
}
raiz.ofBoasVindas=renderBoasVindas;

/* ── ranking, só na Base Virtual ──────────────────────────────────────── */
const MEDALHA=["🥇","🥈","🥉"];
function renderRanking(){
  const el=document.getElementById("of-ranking");if(!el)return;
  const r=OF.rank;
  if(!logado()||!r||!r.ranking||!r.ranking.length){el.hidden=true;el.innerHTML="";return;}
  const eu=uk();
  // posição de cada um antes de redesenhar: quem subiu desliza até o lugar novo
  const antes={};
  if(el.querySelectorAll)el.querySelectorAll("[data-k]").forEach(li=>{antes[li.dataset.k]=li.getBoundingClientRect().top;});
  const linhas=r.ranking.map((x,i)=>{
    const prog=x.hojeOk?'<span class="of-hoje" title="Já completou hoje">✓</span>':
      (r.util===false?'':'<span class="of-prog" title="Guias abertas hoje">'+x.guiasHoje+'/'+META+'</span>');
    return'<li class="of-it'+(x.user_key===eu?' eu':'')+(x.sequencia===0?' zero':'')+'" data-k="'+esc(x.user_key)+'"><span class="of-pos">'+(i<3&&x.sequencia>0?MEDALHA[i]:(i+1)+"º")+'</span>'+
      '<span class="of-nm">'+esc(nomeDe(x))+'</span>'+prog+
      '<span class="of-d">🔥 '+x.sequencia+' dia'+(x.sequencia===1?"":"s")+'</span></li>';
  }).join("");
  const voce=r.voce?'Você está em <b>'+r.voce.posicao+'º</b> de '+r.participantes+' · '+r.voce.sequencia+' dia'+(r.voce.sequencia===1?"":"s"):"";
  el.hidden=false;
  el.innerHTML='<div class="of-card"><div class="of-h"><b>🔥 Ofensiva — quem está firme</b><span>dias úteis seguidos com 3 guias abertas · a lista se atualiza sozinha</span></div>'+
    '<ol class="of-l">'+linhas+'</ol><div class="of-f">'+voce+'</div></div>';
  if(el.querySelectorAll)el.querySelectorAll("[data-k]").forEach(li=>{
    const t0=antes[li.dataset.k];if(t0==null||typeof li.animate!=="function")return;
    const dy=t0-li.getBoundingClientRect().top;
    if(Math.abs(dy)>2)li.animate([{transform:"translateY("+dy+"px)",zIndex:2},{transform:"none",zIndex:2}],{duration:600,easing:"cubic-bezier(.2,.8,.2,1)"});
  });
}

/* ── carregar ──────────────────────────────────────────────────────────── */
function carregarEstado(){
  checarDono();const dono=OF.dono;
  return api("").then(j=>{if(dono===uk()){OF.est=j;renderContador();}}).catch(e=>console.warn("ofensiva:",e&&e.message));
}
raiz.ofRankingCarregar=function(forcar){
  if(!logado())return;
  checarDono();
  if(!forcar&&OF.rank&&Date.now()-OF.rankEm<60000){renderRanking();return;}
  if(OF.pedindo)return;
  OF.pedindo=true;const dono=OF.dono;
  api("ranking").then(j=>{if(dono===uk()){OF.rank=j&&j.ranking?j:null;OF.rankEm=Date.now();renderRanking();}})
    .catch(e=>console.warn("ofensiva ranking:",e&&e.message)).then(()=>{OF.pedindo=false;});
};
// Chamado quando o cartão do usuário é desenhado (logo depois do login): busca o contador (o ranking só é buscado na Base Virtual).
raiz.ofIniciar=function(){
  if(!logado()){esquecer();return;}
  checarDono();
  if(!OF.est)carregarEstado();else renderContador();
};

// Com a Base Virtual aberta, o ranking se atualiza sozinho: quem completa as guias sobe na lista.
const ATUALIZA_MS=30000;
setInterval(()=>{
  try{if(logado()&&typeof ST!=="undefined"&&ST.pg==="sede"&&!document.hidden)raiz.ofRankingCarregar(true);}catch(e){}
},ATUALIZA_MS);

/* ── registrar a guia aberta ───────────────────────────────────────────── */
// Só conta troca de guia que veio de um evento do usuário (clique ou tecla): window.event não existe em
// temporizador, e o Modo TV troca de tela por temporizador.
raiz.ofRegistrar=function(guia){
  try{
    if(!logado()||!guia)return;
    const ev=raiz.event;
    if(!ev||ev.isTrusted!==true)return;
    checarDono();
    const dia=diaBR();
    let vistas;
    try{vistas=JSON.parse(sessionStorage.getItem("of_vistas")||"null");}catch(e){vistas=null;}
    if(!vistas||vistas.dia!==dia||vistas.u!==uk())vistas={dia,u:uk(),g:[]};
    if(vistas.g.indexOf(guia)>=0)return; // já avisei o servidor desta guia hoje
    vistas.g.push(guia);
    try{sessionStorage.setItem("of_vistas",JSON.stringify(vistas));}catch(e){}
    const dono=OF.dono,antes=OF.est&&OF.est.hojeOk;
    OF.fila=OF.fila.then(()=>api("","POST",{guia})).then(j=>{
      if(dono!==uk())return;
      OF.est=j;renderContador();
      if(j.ativo&&j.hojeOk&&!antes&&j.util){toast("🔥 Ofensiva: "+j.sequencia+" dia"+(j.sequencia===1?"":"s")+" seguido"+(j.sequencia===1?"":"s")+"!");raiz.ofRankingCarregar(true);}
    }).catch(e=>{
      // não chegou ao servidor: libera a guia para tentar de novo no próximo clique
      try{const v=JSON.parse(sessionStorage.getItem("of_vistas")||"null");if(v&&v.g)v.g=v.g.filter(x=>x!==guia),sessionStorage.setItem("of_vistas",JSON.stringify(v));}catch(_){}
      console.warn("ofensiva:",e&&e.message);
    });
  }catch(e){console.warn("ofensiva:",e&&e.message);}
};

// Sessão caiu ou outra pessoa entrou na mesma aba: nada da anterior fica na tela.
function ligarSessao(){
  if(typeof raiz._sessaoExpirou==="function"&&!raiz._sessaoExpirou.__of){
    const e0=raiz._sessaoExpirou;
    raiz._sessaoExpirou=function(){esquecer();return e0.apply(this,arguments);};
    raiz._sessaoExpirou.__of=true;
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ligarSessao);else ligarSessao();
// Recarregar a página já logado: o cartão do usuário é desenhado antes deste arquivo carregar, então ele mesmo começa.
setTimeout(()=>{if(logado())raiz.ofIniciar();},0);

if(typeof module==="object"&&module.exports)module.exports={nomeDe};
})(typeof window!=="undefined"?window:globalThis);
