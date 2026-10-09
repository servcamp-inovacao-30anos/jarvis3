/* Avisos de faltas — a parte da tela (notificação push no celular dos supervisores).
   Fica fora do index.html porque ele já está no limite de tamanho (test/auth_exigencia).
   O servidor é o api/_avisos.js (/api/rh?modulo=avisos). Aqui:
   • registra o service worker (/sw.js): sem ele nenhum push chega;
   • convite com um toque depois do login, para o supervisor cadastrado ativar o celular;
   • "Avisos neste aparelho" e "Painel de avisos" no menu do perfil;
   • tocar na notificação abre a tela de Faltas da Supervisão (?abrir=faltassup) e,
     por cima, o aviso completo com todas as faltas (&aviso=id).
   Nada essencial vai para o localStorage: o que vale está no servidor. */
(function(){
"use strict";
// Mesma lista do servidor (api/_ponto.js APROVADORES). Aqui só esconde botões;
// quem decide é o servidor (test/avisos.test.js confere que as duas batem).
const AV_APROVADORES=["joaoygor","raphaelvictor"];
const AV_PAGINAS=["faltassup"]; // telas que o toque na notificação pode abrir
const SOM="/assets/som/aviso-faltas.wav";
const AV={status:null,p:null,sel:new Set(),form:null,vista:"lista",aviso:null,modo:"novas",semFaltas:false,teste:"",msg:null,ocupado:false,removendo:null};

const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const uk=()=>sessionStorage.getItem("userKey")||"";
const logado=()=>sessionStorage.getItem("logged")==="1";
const ehAprov=()=>AV_APROVADORES.indexOf(uk())>=0;
const nomeDe=k=>(typeof USERS!=="undefined"&&USERS[k]&&USERS[k].nome)||k;

async function api(t,metodo,corpo){
  const r=await fetch("/api/rh?modulo=avisos&t="+t,{method:metodo||"GET",headers:corpo?{"Content-Type":"application/json"}:{},body:corpo?JSON.stringify(corpo):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(j.error||("Falha ("+r.status+")"));e.codigo=j.codigo;throw e;}
  return j;
}

/* ── service worker e mensagens dele ─────────────────────────────────────── */
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("/sw.js").catch(function(){});
  navigator.serviceWorker.addEventListener("message",function(e){
    const d=e.data||{};
    if(d.tipo==="abrir")avAbrirPg(d.pg,d.aviso);
    else if(d.tipo==="aviso-faltas"){avTocarSom();if(typeof hqToast==="function")hqToast("🔔 Chegou um aviso de faltas");}
  });
}

/* Tocar na notificação com o painel fechado abre /?abrir=faltassup. A tela só
   abre depois do login (e o navTo ainda confere a permissão de quem entrou). */
(function(){
  try{
    const q=new URLSearchParams(location.search),pg=q.get("abrir"),aviso=q.get("aviso");
    if(!pg)return;
    sessionStorage.setItem("avAbrir",pg);
    if(aviso)sessionStorage.setItem("avAviso",aviso);
    q.delete("abrir");q.delete("aviso");
    const resto=q.toString();
    history.replaceState(null,"",location.pathname+(resto?"?"+resto:"")+location.hash);
  }catch(e){}
})();
const ID_AVISO=/^[a-f0-9]{16}$/;
function avAbrirPg(pg,aviso){
  if(AV_PAGINAS.indexOf(pg)<0)return;
  aviso=ID_AVISO.test(String(aviso||""))?aviso:"";
  if(!logado()){try{sessionStorage.setItem("avAbrir",pg);if(aviso)sessionStorage.setItem("avAviso",aviso);}catch(e){}return;}
  if(typeof navTo==="function")navTo(pg,null);
  if(aviso)avMostrarAviso(aviso);
}
function avAbrirPendente(){
  let pg="",aviso="";
  try{pg=sessionStorage.getItem("avAbrir")||"";aviso=sessionStorage.getItem("avAviso")||"";sessionStorage.removeItem("avAbrir");sessionStorage.removeItem("avAviso");}catch(e){}
  if(pg)avAbrirPg(pg,aviso);
}

/* ── aviso completo (aberto pelo toque na notificação) ─────────────────
   A notificação mostra no máximo 10 pessoas; aqui aparecem todas, com o dia de cada falta. */
const SEMANA=["dom","seg","ter","qua","qui","sex","sáb"];
function diaCurto(d){const s=String(d||"");if(!/^\d{4}-\d{2}-\d{2}/.test(s))return"—";const w=new Date(s.slice(0,10)+"T12:00:00Z").getUTCDay();return SEMANA[w]+", "+s.slice(8,10)+"/"+s.slice(5,7);}
function quandoRecebido(iso){const t=Date.parse(iso);if(!t)return"";const sp=new Date(t-3*3600000).toISOString();return sp.slice(8,10)+"/"+sp.slice(5,7)+" às "+sp.slice(11,16);}
async function avMostrarAviso(id){
  const corpo=t=>abrirJanela("avAvisoCompleto",'<div class="av-h"><b>🔔 Aviso de faltas</b><button type="button" class="av-x" aria-label="Fechar" onclick="avFechar(\'avAvisoCompleto\')">✕</button></div><div class="av-c">'+t+'</div>');
  corpo('<p class="av-mut">Carregando o aviso…</p>');
  let a;
  try{a=(await api("aviso&id="+encodeURIComponent(id))).aviso;}
  catch(e){corpo('<div class="av-alerta">'+esc(e.message)+'</div>');return;}
  const linhas=String(a.corpo||"").split("\n"),abertura=linhas[0]||"",fecho=linhas.length>1?linhas[linhas.length-1]:"";
  const f=(a.faltas||[]).slice().sort((x,y)=>String(x.nome||"").localeCompare(String(y.nome||""))||String(x.data||"").localeCompare(String(y.data||"")));
  let h='<div class="av-av-tt"><b>'+esc(a.titulo)+'</b><span>Recebido em '+esc(quandoRecebido(a.enviado_em))+'</span></div>';
  if(!f.length)h+='<p class="av-av-p">'+esc(a.corpo)+'</p>';
  else{
    h+='<p class="av-av-p">'+esc(abertura)+'</p>'+
      '<div class="av-tab-w"><table class="av-tab"><thead><tr><th>Colaborador</th><th>RE</th><th>Posto</th><th>Data da falta</th></tr></thead><tbody>'+
      f.map(x=>'<tr><td data-l="Colaborador"><b>'+esc(x.nome||"—")+'</b></td><td data-l="RE">'+esc(x.re)+'</td><td data-l="Posto">'+esc(x.posto||"Reserva técnica")+'</td><td data-l="Data da falta">'+esc(diaCurto(x.data))+'</td></tr>').join("")+
      '</tbody></table></div>'+
      '<p class="av-av-p av-av-f">'+esc(fecho)+'</p>';
  }
  h+='<div class="av-linha"><button type="button" class="av-b av-pri" onclick="avFechar(\'avAvisoCompleto\')">Ver na tela de Faltas da Supervisão</button></div>';
  corpo(h);
}
window.avMostrarAviso=avMostrarAviso;

/* ── som do aviso ─────────────────────────────────────────────────────────
   A notificação push toca o som do celular (nenhum navegador deixa a página
   escolher). Com o painel aberto, este som próprio toca junto. */
let audio=null;
function avTocarSom(){
  try{
    audio=audio||new Audio(SOM);
    audio.volume=1;audio.currentTime=0;
    const p=audio.play();if(p&&p.catch)p.catch(function(){});
  }catch(e){}
}

/* ── este aparelho ────────────────────────────────────────────────────── */
function suporte(){
  const ua=navigator.userAgent||"";
  const ios=/iphone|ipad|ipod/i.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  const instalado=(window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true;
  const push="serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
  return{ios,instalado,push,ok:push&&(!ios||instalado),negado:("Notification" in window)&&Notification.permission==="denied"};
}
function chaveBytes(b64){
  const s=(b64+"=".repeat((4-b64.length%4)%4)).replace(/-/g,"+").replace(/_/g,"/");
  const bin=atob(s),out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}
async function inscricaoLocal(){
  if(!("serviceWorker" in navigator))return null;
  const reg=await navigator.serviceWorker.getRegistration();
  return reg&&reg.pushManager?reg.pushManager.getSubscription():null;
}
const MSG_IPHONE="No iPhone os avisos só funcionam pelo atalho: toque em Compartilhar → “Adicionar à Tela de Início”, abra o Painel pelo ícone novo e ative por lá (iOS 16.4 ou mais novo).";
async function avAtivar(){
  const s=suporte();
  if(!s.ok)throw new Error(s.ios?MSG_IPHONE:"Este navegador não aceita notificações. Use o Chrome no Android ou o atalho do Painel no iPhone.");
  // a permissão primeiro, ainda dentro do toque: o iPhone recusa o pedido se vier depois de outra espera
  const perm=await Notification.requestPermission();
  if(perm!=="granted")throw new Error(perm==="denied"?"As notificações estão bloqueadas para o Painel. Libere nas configurações do navegador/celular e tente de novo.":"Você não autorizou as notificações.");
  const k=await api("chave");
  if(!k.configurado)throw new Error("O envio ainda não foi configurado no servidor. Avise a mesa operacional.");
  await navigator.serviceWorker.register("/sw.js");
  const reg=await navigator.serviceWorker.ready;
  let sub=await reg.pushManager.getSubscription();
  const nova=()=>reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:chaveBytes(k.chave)});
  try{if(!sub)sub=await nova();}
  catch(e){ // inscrição antiga com outra chave: refaz
    if(sub){try{await sub.unsubscribe();}catch(x){}}
    sub=await nova();
  }
  const j=sub.toJSON();
  await api("inscrever","POST",{endpoint:j.endpoint,keys:j.keys,agente:(navigator.userAgent||"").slice(0,200)});
  await avAtualizarStatus();
  return true;
}
async function avDesativar(){
  const sub=await inscricaoLocal();
  const ep=sub&&sub.endpoint;
  if(sub){try{await sub.unsubscribe();}catch(e){}}
  if(ep)await api("cancelar","POST",{endpoint:ep});
  await avAtualizarStatus();
}

/* ── status, menu do perfil e convite ─────────────────────────────────── */
async function avAtualizarStatus(){
  if(!logado()){AV.status=null;avMenu();return null;}
  try{AV.status=await api("status");}catch(e){AV.status=null;}
  avMenu();
  return AV.status;
}
function avMenu(){
  const s=AV.status,a=document.getElementById("sbAvAparelho"),p=document.getElementById("sbAvPainel");
  if(a)a.style.display=logado()&&((s&&(s.recebe||s.aprovador))||ehAprov())?"block":"none";
  if(p)p.style.display=logado()&&ehAprov()?"block":"none";
}
function avConvite(){
  const s=AV.status;
  if(!s||!s.recebe||s.aparelhos>0||!s.configurado)return;
  if(suporte().negado)return; // já recusou no navegador: insistir aqui não adianta
  try{if(sessionStorage.getItem("avConviteVisto")==="1")return;sessionStorage.setItem("avConviteVisto","1");}catch(e){}
  setTimeout(function(){ // depois das boas-vindas
    if(document.getElementById("avConvite"))return;
    const su=suporte(),el=document.createElement("div");
    el.id="avConvite";el.className="av-convite";el.setAttribute("role","dialog");el.setAttribute("aria-label","Ativar avisos de faltas");
    el.innerHTML='<div class="av-cv-ic">🔔</div><div class="av-cv-tx"><b>Receba os avisos de faltas no celular</b>'+
      '<span>O resumo das faltas injustificadas da sua área chega na tela de bloqueio, logo depois de cada atualização da planilha.</span>'+
      (su.ios&&!su.instalado?'<span class="av-cv-ios">'+esc(MSG_IPHONE)+'</span>':'')+
      '<span class="av-cv-er" id="avCvEr"></span></div>'+
      '<div class="av-cv-bt">'+(su.ok?'<button type="button" class="av-b av-pri" id="avCvOk">Ativar</button>':'')+
      '<button type="button" class="av-b" id="avCvNao">Agora não</button></div>';
    document.body.appendChild(el);
    document.getElementById("avCvNao").onclick=function(){el.remove();};
    const ok=document.getElementById("avCvOk");
    if(ok)ok.onclick=async function(){
      ok.disabled=true;ok.textContent="Ativando…";
      try{await avAtivar();el.innerHTML='<div class="av-cv-ic">✅</div><div class="av-cv-tx"><b>Avisos ativados neste aparelho</b><span>Você vai receber o resumo das faltas da sua área.</span></div>';setTimeout(function(){el.remove();},3500);}
      catch(e){ok.disabled=false;ok.textContent="Ativar";document.getElementById("avCvEr").textContent=e.message;}
    };
  },3200);
}
window.avAposLogin=function(){avAbrirPendente();avAtualizarStatus().then(avConvite);};
// já logado ao abrir a página (recarregou, ou veio pelo toque na notificação)
setTimeout(function(){if(logado())window.avAposLogin();},0);

/* ── janela base ─────────────────────────────────────────────────────── */
function abrirJanela(id,html,largo){
  fecharJanela(id);
  const ov=document.createElement("div");
  ov.id=id;ov.className="av-ov";
  ov.innerHTML='<div class="av-box'+(largo?" av-largo":"")+'" role="dialog" aria-modal="true">'+html+'</div>';
  ov.addEventListener("click",function(e){if(e.target===ov)fecharJanela(id);});
  document.body.appendChild(ov);
  return ov;
}
function fecharJanela(id){const o=document.getElementById(id);if(o)o.remove();}
window.avFechar=fecharJanela;

/* ── "Avisos neste aparelho" ─────────────────────────────────────────── */
window.avAparelhoAbrir=async function(){
  const su=suporte();
  const corpo=t=>abrirJanela("avAparelho",'<div class="av-h"><b>🔔 Avisos neste aparelho</b><button type="button" class="av-x" aria-label="Fechar" onclick="avFechar(\'avAparelho\')">✕</button></div><div class="av-c">'+t+'</div>');
  corpo('<p class="av-mut">Carregando…</p>');
  let sub=null;try{sub=await inscricaoLocal();}catch(e){}
  await avAtualizarStatus();
  const s=AV.status||{};
  const ativo=!!sub&&Notification.permission==="granted";
  let h='<div class="av-st '+(ativo?"ok":"")+'">'+(ativo?"✅ Este aparelho está recebendo os avisos de faltas.":"⚪ Este aparelho ainda não recebe os avisos.")+'</div>'+
    '<p class="av-mut">Aparelhos ativos na sua conta: <b>'+(s.aparelhos||0)+'</b>'+(s.recebe?' · você está cadastrado para receber o resumo da sua área.':s.aprovador?' · como aprovador, você recebe os testes.':'')+'</p>';
  if(!s.configurado)h+='<div class="av-alerta">O envio ainda não foi configurado no servidor (chaves VAPID).</div>';
  if(su.ios&&!su.instalado)h+='<div class="av-alerta">'+esc(MSG_IPHONE)+'</div>';
  else if(su.negado)h+='<div class="av-alerta">As notificações estão bloqueadas para o Painel neste navegador. Libere nas configurações do site e volte aqui.</div>';
  h+='<div class="av-linha">'+(ativo?'<button type="button" class="av-b" id="avApDes">Desativar neste aparelho</button>':(su.ok&&!su.negado?'<button type="button" class="av-b av-pri" id="avApAt">Ativar neste aparelho</button>':''))+'</div><p class="av-er" id="avApEr"></p>'+
    '<div class="av-sec"><b>🔊 Som do aviso de faltas</b><p class="av-mut">Com o Painel aberto, este som toca quando chega um aviso. Na tela de bloqueio o celular usa o toque de notificação dele; no Android dá para trocar pelo som do aviso: baixe o arquivo e, em Configurações → Apps → Painel ServCamp (ou Chrome) → Notificações, escolha o som.</p>'+
    '<div class="av-linha"><button type="button" class="av-b" onclick="avTocarSomTeste()">▶ Ouvir o som</button><a class="av-b" href="'+SOM+'" download="aviso-faltas-servcamp.wav">⬇ Baixar o som</a></div></div>';
  corpo(h);
  const at=document.getElementById("avApAt"),de=document.getElementById("avApDes"),er=document.getElementById("avApEr");
  if(at)at.onclick=async function(){at.disabled=true;at.textContent="Ativando…";try{await avAtivar();window.avAparelhoAbrir();}catch(e){at.disabled=false;at.textContent="Ativar neste aparelho";er.textContent=e.message;}};
  if(de)de.onclick=async function(){de.disabled=true;try{await avDesativar();window.avAparelhoAbrir();}catch(e){de.disabled=false;er.textContent=e.message;}};
};
window.avTocarSomTeste=avTocarSom;

/* ── "Painel de avisos" (só aprovadores) ─────────────────────────────── */
window.avPainelAbrir=async function(){
  if(!ehAprov())return;
  AV.vista="lista";AV.msg=null;AV.form=null;AV.removendo=null;
  abrirJanela("avPainel",'<div class="av-h"><b>📣 Painel de avisos de faltas</b><button type="button" class="av-x" aria-label="Fechar" onclick="avFechar(\'avPainel\')">✕</button></div><div class="av-c" id="avPc"><p class="av-mut">Carregando…</p></div>',true);
  await carregar();
};
async function carregar(){
  try{AV.p=await api("previa");}
  catch(e){const c=document.getElementById("avPc");if(c)c.innerHTML='<div class="av-alerta">'+esc(e.message)+'</div>';return;}
  const ids=new Set(AV.p.contatos.map(c=>c.id));
  AV.sel=new Set([...AV.sel].filter(i=>ids.has(i)));
  render();
}
function msg(tipo,t){AV.msg={tipo,t};}
function selecionaveis(){return AV.p.contatos.filter(c=>c.ativo&&c.aparelhos>0);}

function render(){
  const c=document.getElementById("avPc");if(!c||!AV.p)return;
  const P=AV.p;
  if(AV.vista==="confirmar")return renderConfirmar(c);
  if(AV.vista==="aviso")return renderAviso(c);
  let h="";
  if(AV.msg)h+='<div class="av-msg '+AV.msg.tipo+'">'+esc(AV.msg.t)+'</div>';
  if(!P.configurado)h+='<div class="av-alerta">⚠️ O envio não está configurado: faltam as chaves VAPID na Vercel (VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY). Nada será enviado até lá.</div>';
  // chave do automático
  h+='<div class="av-sec av-auto"><div><b>Envio automático</b><p class="av-mut">Depois de cada atualização da planilha, cada supervisor recebe as faltas injustificadas novas da área dele. Cada falta é avisada uma vez só.</p></div>'+
    '<button type="button" class="av-sw'+(P.auto?" on":"")+'" role="switch" aria-checked="'+P.auto+'" onclick="avAuto('+(!P.auto)+')"><i></i><span>'+(P.auto?"Ligado":"Desligado")+'</span></button></div>';
  // áreas sem cadastro
  const sem=P.semCadastro.filter(a=>a.faltas>0),livres=P.areasLivres||[];
  if(sem.length)h+='<div class="av-alerta">⚠️ Faltas de áreas que ninguém recebe: '+sem.map(a=>'<button type="button" class="av-tag" onclick="avNovo(this.dataset.a)" data-a="'+esc(a.area)+'">'+esc(a.area)+' · '+a.faltas+(a.motivo==="AMBIGUA"?" (nome ambíguo)":"")+'</button>').join(" ")+'<br><span class="av-mut">Toque numa área para cadastrar o supervisor dela.</span></div>';
  // tabela
  const lista=P.contatos;
  h+='<div class="av-sec"><div class="av-sec-h"><b>Supervisores que recebem</b><button type="button" class="av-b sm" onclick="avNovo(\'\')">+ Adicionar</button></div>';
  if(!lista.length)h+='<p class="av-mut">Ninguém cadastrado ainda. Use “+ Adicionar”.</p>';
  else{
    const todos=selecionaveis().length&&selecionaveis().every(x=>AV.sel.has(x.id));
    h+='<div class="av-tb"><div class="av-tr av-th"><label class="av-ck"><input type="checkbox" '+(todos?"checked":"")+' onchange="avSelTodos(this.checked)" aria-label="Selecionar todos"></label><span>Supervisor</span><span>Nome na planilha</span><span>Aparelho</span><span>Faltas novas</span><span></span></div>';
    lista.forEach(x=>{
      const pode=x.ativo&&x.aparelhos>0,rem=AV.removendo===x.id;
      h+='<div class="av-tr'+(x.ativo?"":" pausado")+'">'+
        '<label class="av-ck"><input type="checkbox" '+(AV.sel.has(x.id)?"checked":"")+(pode?"":" disabled")+' onchange="avSel('+x.id+',this.checked)" aria-label="Selecionar '+esc(x.nome)+'"></label>'+
        '<span class="av-nm"><b>'+esc(x.nome)+'</b><small>'+esc(x.user_key)+(x.ativo?"":" · pausado")+'</small></span>'+
        '<span data-l="Planilha">'+esc(x.area)+'</span>'+
        '<span data-l="Aparelho">'+(x.aparelhos?'✅ '+x.aparelhos:'⚠️ não ativou')+'</span>'+
        '<span data-l="Novas"><b class="av-n'+(x.novas?" tem":"")+'">'+x.novas+'</b>'+(x.total>x.novas?'<small> de '+x.total+'</small>':'')+(x.ultimoEnvio?'<small class="av-ult">último: '+esc(x.ultimoEnvio.tipo==="SEM_FALTAS"?"sem faltas":"resumo")+' '+esc(String(x.ultimoEnvio.em||"").slice(11,16))+'</small>':'')+'</span>'+
        '<span class="av-ac"><button type="button" class="av-b sm" onclick="avVerAviso('+x.id+')">Ver aviso</button>'+
        '<button type="button" class="av-b sm ic" title="Editar" aria-label="Editar" onclick="avEditar('+x.id+')">✏️</button>'+
        '<button type="button" class="av-b sm ic" title="'+(x.ativo?"Pausar":"Reativar")+'" aria-label="'+(x.ativo?"Pausar":"Reativar")+'" onclick="avPausar('+x.id+','+(!x.ativo)+')">'+(x.ativo?"⏸":"▶")+'</button>'+
        '<button type="button" class="av-b sm '+(rem?"av-del":"ic")+'" title="Remover" aria-label="Remover" onclick="avRemover('+x.id+')">'+(rem?"Confirmar remoção":"🗑")+'</button></span>'+
      '</div>';
    });
    h+='</div>';
  }
  h+='</div>';
  // formulário
  if(AV.form)h+=renderForm(livres);
  // envio manual
  const n=AV.sel.size;
  h+='<div class="av-sec"><b>Envio manual</b><p class="av-mut">Funciona mesmo com o automático desligado. Antes de sair, aparece a lista de quem vai receber.</p>'+
    '<div class="av-op"><label><input type="radio" name="avModo" value="novas" '+(AV.modo==="novas"?"checked":"")+' onchange="avModo(this.value)"> Só as faltas novas</label>'+
    '<label><input type="radio" name="avModo" value="todas" '+(AV.modo==="todas"?"checked":"")+' onchange="avModo(this.value)"> Reenviar as faltas dos últimos 3 dias</label>'+
    '<label><input type="checkbox" '+(AV.semFaltas?"checked":"")+' onchange="avSemFaltas(this.checked)"> Avisar “sem faltas” a quem não tem falta nova</label></div>'+
    '<button type="button" class="av-b av-pri" '+(n&&P.configurado?"":"disabled")+' onclick="avConfirmar()">Enviar para '+n+' selecionado'+(n===1?"":"s")+'…</button></div>';
  // teste
  h+='<div class="av-sec"><b>Enviar um teste para mim</b><p class="av-mut">Vai só para os seus aparelhos ('+P.meusAparelhos+' ativo'+(P.meusAparelhos===1?"":"s")+'), com “TESTE ·” no título. Não marca nenhuma falta como avisada.</p>'+
    (P.meusAparelhos?'':'<div class="av-alerta">Você ainda não ativou os avisos neste aparelho. <button type="button" class="av-b sm" onclick="avAparelhoAbrir()">Ativar agora</button></div>')+
    '<div class="av-linha"><select id="avTeste" class="av-in" onchange="avTesteSel(this.value)"><option value="">Exemplo fictício (2 faltas)</option>'+lista.map(x=>'<option value="'+x.id+'"'+(String(AV.teste)===String(x.id)?" selected":"")+'>Faltas reais de '+esc(x.nome)+' ('+x.total+')</option>').join("")+'</select>'+
    '<button type="button" class="av-b" '+(P.meusAparelhos&&P.configurado?"":"disabled")+' onclick="avTeste()">Enviar teste</button></div></div>';
  c.innerHTML=h;
}
function renderForm(livres){
  const f=AV.form,users=typeof USERS!=="undefined"?Object.keys(USERS):[];
  const usados=new Set(AV.p.contatos.filter(x=>x.id!==f.id).map(x=>x.user_key));
  return '<div class="av-sec av-form" id="avForm"><b>'+(f.id?"Editar supervisor":"Adicionar supervisor")+'</b>'+
    '<div class="av-fg"><label>Nome<input class="av-in" id="avFNome" maxlength="80" value="'+esc(f.nome)+'" placeholder="Ex.: Frank Pimentel"></label>'+
    '<label>Nome da área na planilha<input class="av-in" id="avFArea" maxlength="120" list="avAreas" value="'+esc(f.area)+'" placeholder="Como vem em AREASUPERVISAO"></label>'+
    '<datalist id="avAreas">'+livres.map(a=>'<option value="'+esc(a)+'">').join("")+'</datalist>'+
    '<label>Login no sistema<select class="av-in" id="avFLogin"><option value="">Escolha…</option>'+users.map(k=>'<option value="'+esc(k)+'"'+(f.user_key===k?" selected":"")+(usados.has(k)?" disabled":"")+'>'+esc(nomeDe(k))+' ('+esc(k)+')'+(usados.has(k)?" — já cadastrado":"")+'</option>').join("")+'</select></label></div>'+
    '<p class="av-er" id="avFEr"></p><div class="av-linha"><button type="button" class="av-b av-pri" onclick="avSalvar()">Salvar</button><button type="button" class="av-b" onclick="avCancelarForm()">Cancelar</button></div></div>';
}
function renderConfirmar(c){
  const P=AV.p,quem=P.contatos.filter(x=>AV.sel.has(x.id));
  const linha=x=>{
    const vai=AV.modo==="todas"?x.total:x.novas;
    const o=vai?(vai===1?"1 falta":vai+" faltas"):(AV.semFaltas||AV.modo==="todas"?"“sem faltas”":"nada (sem falta nova)");
    return'<li><b>'+esc(x.nome)+'</b> — '+o+' · '+x.aparelhos+' aparelho'+(x.aparelhos===1?"":"s")+'</li>';
  };
  c.innerHTML='<div class="av-sec"><b>Confirmar o envio</b><p class="av-mut">'+(AV.modo==="todas"?"Reenvio das faltas dos últimos 3 dias.":"Só as faltas que ainda não foram avisadas.")+'</p><ul class="av-ul">'+quem.map(linha).join("")+'</ul>'+
    '<div class="av-linha"><button type="button" class="av-b av-pri" id="avEnvOk" onclick="avEnviar()">Confirmar envio</button><button type="button" class="av-b" onclick="avVoltar()">Voltar</button></div></div>';
}
function renderAviso(c){
  const x=AV.p.contatos.find(y=>y.id===AV.aviso);if(!x){AV.vista="lista";return render();}
  const a=x.aviso||{titulo:"",corpo:""};
  c.innerHTML='<div class="av-sec"><b>Aviso de '+esc(x.nome)+'</b><p class="av-mut">É exatamente o texto que sai '+(x.novas?"com as faltas novas de agora":"hoje se não chegar falta nova (“sem faltas”)")+'.</p>'+
    '<div class="av-cel"><div class="av-not"><div class="av-not-h"><img src="/icon-192.png" alt=""><span>Painel ServCamp · agora</span></div><b>'+esc(a.titulo)+'</b><p>'+esc(a.corpo).replace(/\n/g,"<br>")+'</p></div></div>'+
    '<div class="av-linha"><button type="button" class="av-b" onclick="avVoltar()">Voltar</button></div></div>';
}

/* ações do painel */
window.avSel=function(id,on){if(on)AV.sel.add(id);else AV.sel.delete(id);render();};
window.avSelTodos=function(on){AV.sel=new Set(on?selecionaveis().map(x=>x.id):[]);render();};
window.avModo=function(v){AV.modo=v==="todas"?"todas":"novas";};
window.avSemFaltas=function(v){AV.semFaltas=!!v;};
window.avTesteSel=function(v){AV.teste=v;};
window.avVoltar=function(){AV.vista="lista";render();};
window.avVerAviso=function(id){AV.aviso=id;AV.vista="aviso";render();};
window.avConfirmar=function(){if(AV.sel.size){AV.vista="confirmar";render();}};
window.avNovo=function(area){AV.form={id:null,nome:"",area:area||"",user_key:""};render();const f=document.getElementById("avForm");if(f)f.scrollIntoView({behavior:"smooth",block:"center"});};
window.avEditar=function(id){const x=AV.p.contatos.find(y=>y.id===id);if(!x)return;AV.form={id:x.id,nome:x.nome,area:x.area,user_key:x.user_key};render();const f=document.getElementById("avForm");if(f)f.scrollIntoView({behavior:"smooth",block:"center"});};
window.avCancelarForm=function(){AV.form=null;render();};
async function acao(fn,ok){
  if(AV.ocupado)return;AV.ocupado=true;
  try{const r=await fn();if(ok)msg("ok",typeof ok==="function"?ok(r):ok);}
  catch(e){msg("er",e.message);}
  AV.ocupado=false;
  await carregar();
}
window.avSalvar=async function(){
  const f=AV.form,er=document.getElementById("avFEr");
  const corpo={nome:document.getElementById("avFNome").value.trim(),area:document.getElementById("avFArea").value.trim(),user_key:document.getElementById("avFLogin").value};
  if(!corpo.nome||!corpo.area||!corpo.user_key){er.textContent="Preencha nome, área e login.";return;}
  try{
    if(f.id)await api("editar","POST",Object.assign({id:f.id},corpo));else await api("contato","POST",corpo);
    AV.form=null;msg("ok",f.id?"Supervisor atualizado.":"Supervisor cadastrado.");await carregar();
  }catch(e){er.textContent=e.message;}
};
window.avPausar=function(id,ativo){acao(()=>api("editar","POST",{id,ativo}),ativo?"Avisos reativados.":"Avisos pausados para este supervisor.");};
window.avRemover=function(id){
  if(AV.removendo!==id){AV.removendo=id;render();setTimeout(function(){if(AV.removendo===id){AV.removendo=null;render();}},4000);return;}
  AV.removendo=null;AV.sel.delete(id);
  acao(()=>api("remover","POST",{id}),"Supervisor removido.");
};
window.avAuto=function(ligado){acao(()=>api("auto","POST",{ligado}),ligado?"Envio automático ligado.":"Envio automático desligado.");};
window.avEnviar=function(){
  const b=document.getElementById("avEnvOk");if(b){b.disabled=true;b.textContent="Enviando…";}
  AV.vista="lista";
  acao(()=>api("enviar","POST",{ids:[...AV.sel],modo:AV.modo,semFaltas:AV.semFaltas,confirmar:true}),r=>
    "Enviado: "+r.avisos+" resumo"+(r.avisos===1?"":"s")+" ("+r.faltas+" falta"+(r.faltas===1?"":"s")+")"+(r.semFaltas?", "+r.semFaltas+" “sem faltas”":"")+
    (r.semAparelho?" · "+r.semAparelho+" sem aparelho":"")+(r.falhou?" · "+r.falhou+" não recebido (as faltas voltaram para a fila)":"")+".");
};
window.avTeste=function(){
  const v=AV.teste,corpo={nome:sessionStorage.getItem("userNome")||""};
  if(v)corpo.contato_id=Number(v);
  acao(()=>api("teste","POST",corpo),r=>r.aparelhos?"Teste enviado para "+r.aparelhos+" aparelho"+(r.aparelhos===1?"":"s")+" seu"+(r.aparelhos===1?"":"s")+".":"O teste não chegou a nenhum aparelho seu. Desative e ative de novo neste aparelho.");
};
})();
