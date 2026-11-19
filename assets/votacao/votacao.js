/* Votação do novo nome e da nova logo do Dashboard.
   Fica fora do index.html porque ele já está perto do limite de tamanho (test/auth_exigencia).
   O servidor é o api/_votacao.js (/api/rh?modulo=votacao): um voto por pessoa, que pode ser trocado até encerrar;
   o resultado só aparece para todos depois de encerrada (durante, só o administrador acompanha, e sem ver o voto de cada um).
   • janela de aviso logo depois do login, enquanto a pessoa não votou (uma vez por entrada; "Depois" fecha);
   • a guia "🗳️ Votação" (menu Dashboard) tem o vídeo, as opções em tamanho grande e o botão de confirmar. */
(function(raiz){
"use strict";
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uk=()=>sessionStorage.getItem("userKey")||"";
const logado=()=>sessionStorage.getItem("logged")==="1"&&!!uk();
const toast=t=>{if(typeof hqToast==="function")hqToast(t);};
const VT={dono:null,est:null,escolha:null,enviando:false};

async function api(t,metodo,corpo){
  const r=await fetch("/api/rh?modulo=votacao"+(t?"&t="+t:""),{method:metodo||"GET",headers:corpo?{"Content-Type":"application/json"}:{},body:corpo?JSON.stringify(corpo):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||("Falha ("+r.status+")"));
  return j;
}
function dataHora(iso){
  if(!iso)return"";
  try{return new Date(iso).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});}catch(e){return"";}
}
function checarDono(){if(VT.dono!==uk()){VT.dono=uk();VT.est=null;VT.escolha=null;VT.iniciou=null;}}
function nomeDe(o,e){const x=((e&&e.votacao&&e.votacao.opcoes)||[]).find(y=>y.id===o);return x?x.nome:o;}

async function carregar(){
  checarDono();
  if(!logado())return null;
  try{VT.est=await api("");}catch(e){VT.est={ativo:false,erro:String(e&&e.message||e)};}
  return VT.est;
}

/* ── janela de aviso depois do login ──────────────────────────────────── */
function fecharAviso(){const el=document.getElementById("vt-aviso");if(el)el.remove();}
async function votIniciar(){
  checarDono();
  if(!logado()||VT.iniciou===uk())return; // o menu se redesenha a cada atualização de guias: só pergunta ao servidor uma vez por entrada
  VT.iniciou=uk();
  const e=await carregar();
  if(!e||!e.ativo||!e.aberta||e.meuVoto)return;
  try{if(sessionStorage.getItem("vtAviso")===uk()+"|"+e.votacao.id)return;sessionStorage.setItem("vtAviso",uk()+"|"+e.votacao.id);}catch(x){}
  // espera a tela de boas-vindas sair, para a janela não aparecer por cima dela
  setTimeout(function(){
    if(!logado()||document.getElementById("vt-aviso"))return;
    const d=document.createElement("div");
    d.id="vt-aviso";d.className="vt-aviso";d.setAttribute("role","dialog");d.setAttribute("aria-modal","true");d.setAttribute("aria-label","Votação aberta");
    d.innerHTML='<div class="vt-aviso-c">'+
      '<div class="vt-aviso-ic">🗳️</div>'+
      '<div class="vt-aviso-k">Votação aberta</div>'+
      '<div class="vt-aviso-t">'+esc(e.votacao.titulo)+'</div>'+
      '<p>'+esc(e.votacao.chamada)+' Leva menos de um minuto e a sua opinião conta.</p>'+
      '<div class="vt-aviso-b"><button type="button" class="vt-btn" id="vt-aviso-ir">Votar agora</button><button type="button" class="vt-btn vt-sec" id="vt-aviso-dep">Depois</button></div>'+
      '</div>';
    document.body.appendChild(d);
    document.getElementById("vt-aviso-ir").onclick=function(){fecharAviso();ir();};
    document.getElementById("vt-aviso-dep").onclick=fecharAviso;
    d.addEventListener("keydown",function(ev){if(ev.key==="Escape")fecharAviso();});
    document.getElementById("vt-aviso-ir").focus();
  },4200);
}
function ir(){
  if(typeof navTo==="function")navTo("votacao",document.querySelector('.ni[data-pg="votacao"]'));
}

/* ── tela da votação ──────────────────────────────────────────────────── */
function chip(e){
  if(e.aberta)return'<span class="vt-chip on">● Aberta</span>'+(e.votacao.ate?'<span class="vt-chip">até '+esc(dataHora(e.votacao.ate))+'</span>':"");
  return'<span class="vt-chip off">Encerrada'+(e.encerradaEm?" em "+esc(dataHora(e.encerradaEm)):"")+'</span>';
}
function barras(e){
  if(!e.resultado)return"";
  const max=Math.max.apply(null,e.resultado.map(r=>r.votos));
  const venc=!e.aberta&&max>0?e.resultado.filter(r=>r.votos===max):[];
  return'<div class="vt-res">'+e.resultado.map(r=>
    '<div class="vt-res-l'+(venc.length===1&&venc[0].id===r.id?" venc":"")+'"><div class="vt-res-n"><b>'+esc(r.nome)+'</b>'+(venc.length===1&&venc[0].id===r.id?' <span class="vt-coroa">🏆 mais votado</span>':"")+'<span>'+r.votos+' voto'+(r.votos===1?"":"s")+" · "+String(r.pct).replace(".",",")+'%</span></div>'+
    '<div class="vt-bar"><i style="width:'+r.pct+'%"></i></div></div>').join("")+
    (venc.length>1?'<div class="vt-nota">Empate entre '+venc.map(v=>esc(v.nome)).join(" e ")+'.</div>':"")+
    '<div class="vt-nota">'+e.totalVotos+' pessoa'+(e.totalVotos===1?"":"s")+' '+(e.totalVotos===1?"votou":"votaram")+'.</div></div>';
}
function painelAdmin(e){
  if(!e.admin)return"";
  const p=e.participacao||{eleitores:0,votaram:[],faltam:[]};
  const lista=a=>a.length?a.map(x=>'<li>'+esc(x.nome||x.user_key)+(x.em?' <small>'+esc(dataHora(x.em))+'</small>':"")+'</li>').join(""):'<li class="vt-vazio">ninguém</li>';
  return'<section class="vt-card vt-adm"><div class="vt-adm-h"><h3>👑 Acompanhamento (só administrador)</h3>'+
    '<button type="button" class="vt-btn '+(e.aberta?"vt-perigo":"")+'" id="vt-enc">'+(e.aberta?"Encerrar votação":"Reabrir votação")+'</button></div>'+
    '<p class="vt-nota">O voto é secreto: aqui aparece quem já votou, não em quê. Os usuários só veem o resultado depois que você encerrar.</p>'+
    barras(e)+
    '<div class="vt-part"><div><h4>Já votaram ('+p.votaram.length+' de '+p.eleitores+')</h4><ul>'+lista(p.votaram)+'</ul></div>'+
    '<div><h4>Ainda faltam ('+p.faltam.length+')</h4><ul>'+lista(p.faltam)+'</ul></div></div></section>';
}
function ampliar(src,alt){
  const d=document.createElement("div");d.className="vt-zoom";d.setAttribute("role","dialog");d.setAttribute("aria-label",alt);
  d.innerHTML='<img src="'+esc(src)+'" alt="'+esc(alt)+'"><button type="button" class="vt-zoom-x" aria-label="Fechar">✕</button>';
  const fechar=()=>{d.remove();document.removeEventListener("keydown",tecla);};
  const tecla=ev=>{if(ev.key==="Escape")fechar();};
  d.onclick=fechar;document.addEventListener("keydown",tecla);document.body.appendChild(d);
  d.querySelector("button").focus();
}
function render(){
  const el=document.getElementById("vt-content");if(!el)return;
  const e=VT.est;
  if(!e){el.innerHTML='<div class="vt-msg">Carregando…</div>';return;}
  if(!e.ativo){el.innerHTML='<div class="vt-msg">'+(e.erro?esc(e.erro):"A votação aparece depois que você entra com o seu login.")+'</div>';return;}
  const v=e.votacao;
  const escolhida=VT.escolha||e.meuVoto;
  const podeVotar=e.aberta;
  const opcoes=v.opcoes.map(o=>{
    const sel=escolhida===o.id;
    return'<div class="vt-op'+(sel?" sel":"")+(podeVotar?"":" fechada")+'">'+
      '<button type="button" class="vt-img" data-zoom="'+esc(o.id)+'" aria-label="Ampliar a imagem de '+esc(o.nome)+'"><img src="'+esc(o.img)+'" alt="Proposta '+esc(o.nome)+'" loading="lazy"></button>'+
      '<label class="vt-esc"><input type="radio" name="vt-op" value="'+esc(o.id)+'"'+(sel?" checked":"")+(podeVotar?"":" disabled")+'>'+
      '<span><b>'+esc(o.nome)+'</b><small>'+esc(o.sub||"")+'</small></span>'+(e.meuVoto===o.id?'<em class="vt-meu">seu voto</em>':"")+'</label></div>';
  }).join("");
  let rodape="";
  if(podeVotar){
    const mudou=!!VT.escolha&&VT.escolha!==e.meuVoto;
    rodape='<div class="vt-acao"><button type="button" class="vt-btn" id="vt-ok"'+(mudou&&!VT.enviando?"":" disabled")+'>'+(VT.enviando?"Enviando…":e.meuVoto?"Trocar meu voto":"Confirmar meu voto")+'</button>'+
      '<span class="vt-nota">'+(e.meuVoto?"✓ Você votou em <b>"+esc(nomeDe(e.meuVoto,e))+"</b>. Pode trocar até a votação encerrar.":"Escolha uma opção e confirme. Você pode trocar o voto até a votação encerrar.")+'</span></div>';
  }else{
    rodape='<div class="vt-acao"><span class="vt-nota">'+(e.meuVoto?"Você votou em <b>"+esc(nomeDe(e.meuVoto,e))+"</b>.":"Você não votou.")+' Obrigado por participar!</span></div>';
  }
  el.innerHTML=
    '<section class="vt-card vt-hero"><div class="vt-hero-t"><h2>'+esc(v.titulo)+'</h2><div class="vt-chips">'+chip(e)+'</div></div><p>'+esc(v.chamada)+'</p>'+
    '<video class="vt-video" controls preload="metadata" playsinline src="'+esc(v.video)+'" aria-label="Apresentação das propostas"></video></section>'+
    '<section class="vt-card"><h3>'+(podeVotar?"Qual você escolhe?":"As propostas")+'</h3><div class="vt-ops">'+opcoes+'</div>'+rodape+'</section>'+
    (!e.aberta&&!e.admin?'<section class="vt-card"><h3>Resultado</h3>'+barras(e)+'</section>':"")+
    painelAdmin(e);
  el.querySelectorAll("[data-zoom]").forEach(b=>{b.onclick=()=>{const o=v.opcoes.find(x=>x.id===b.dataset.zoom);if(o)ampliar(o.img,"Proposta "+o.nome);};});
  el.querySelectorAll('input[name="vt-op"]').forEach(i=>{i.onchange=()=>{VT.escolha=i.value;render();};});
  const ok=document.getElementById("vt-ok");if(ok)ok.onclick=confirmar;
  const enc=document.getElementById("vt-enc");if(enc)enc.onclick=alternar;
}
async function confirmar(){
  if(VT.enviando||!VT.escolha)return;
  VT.enviando=true;render();
  try{
    VT.est=await api("","POST",{opcao:VT.escolha});
    VT.escolha=null;
    toast("🗳️ Voto registrado. Obrigado!");
  }catch(e){alert("Não foi possível registrar o voto: "+((e&&e.message)||e));}
  VT.enviando=false;render();
}
async function alternar(){
  const e=VT.est;if(!e||!e.admin)return;
  const msg=e.aberta?"Encerrar a votação?\n\nNinguém mais poderá votar ou trocar o voto, e o resultado passa a aparecer para todos. Você pode reabrir depois.":"Reabrir a votação?\n\nOs usuários voltam a poder votar e o resultado volta a ficar escondido deles.";
  if(!confirm(msg))return;
  try{VT.est=await api(e.aberta?"encerrar":"reabrir","POST",{});toast(e.aberta?"🗳️ Votação encerrada":"🗳️ Votação reaberta");}
  catch(x){alert("Não foi possível concluir: "+((x&&x.message)||x));}
  render();
}
async function votLoad(){
  checarDono();
  const el=document.getElementById("vt-content");
  if(el&&!VT.est)el.innerHTML='<div class="vt-msg">Carregando…</div>';
  await carregar();
  render();
}

raiz.votIniciar=votIniciar;
raiz.votLoad=votLoad;
raiz.votEsquecer=function(){VT.dono=null;VT.est=null;VT.escolha=null;VT.iniciou=null;fecharAviso();};
})(window);
