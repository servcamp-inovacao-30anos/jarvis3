/* Assinatura da medida disciplinar no celular (plano: plano-medida-disciplinar-assinatura-digital.md).
   Fica fora do index.html porque ele está no limite de tamanho (test/auth_exigencia). O servidor é o api/_assinatura.js.

   Tela cheia, feita primeiro para o celular Android do supervisor, na rua:
     1) o supervisor assina (a assinatura do perfil, com um toque, ou desenhando);
     2) entrega o celular; o colaborador lê o documento inteiro, marca "Li e estou ciente" e escreve o próprio nome com o dedo
        (ou o supervisor registra a recusa; testemunhas são opcionais);
     3) o servidor sela o PDF e a tela mostra o QR da via: o colaborador aponta a câmera do próprio celular e baixa o documento.

   Sinal fraco: a coleta fica guardada no aparelho e é reenviada sozinha até o servidor confirmar; "Assinado" só aparece depois
   da confirmação. Cada coleta tem uma chave única: toque duplo ou reenvio não criam segunda assinatura.
   Quem barra é o servidor; esconder botão é conveniência. */
(function(){
"use strict";
const FILA="mdAssFila";
const AS={g:null,etapa:null,idem:null,perfil:undefined,sup:null,col:null,aceite:false,recusa:{t:[{nome:"",doc:""},{nome:"",doc:""}],obs:""},enviando:false,erro:null,res:null,pads:{}};
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const uk=()=>sessionStorage.getItem("userKey")||"";
const nomeDe=k=>{try{return(USERS[k]&&USERS[k].nome)||k;}catch(e){return k;}};
const titulo=s=>typeof fmNomeCard==="function"?fmNomeCard(s):String(s||"");
const toast=m=>{if(typeof hqToast==="function")hqToast(m);};
const api=(t,m,c)=>window.mdApi(t,m,c);
const svg=p=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';
const IC={x:svg('<path d="M18 6 6 18M6 6l12 12"/>'),ok:svg('<path d="m5 12 5 5 9-10"/>'),
  qr:svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/>')};
function novoId(){const a=new Uint8Array(16);(window.crypto||{getRandomValues:x=>{for(let i=0;i<x.length;i++)x[i]=Math.floor(Math.random()*256);}}).getRandomValues(a);return"as"+Array.from(a,b=>b.toString(16).padStart(2,"0")).join("");}

/* ═════════ campo de assinatura ═════════
   Eventos de ponteiro com touch-action:none (o dedo desenha sem a página rolar) e resolução da tela (o traço não serrilha).
   O traço é guardado em coordenadas relativas ao campo: girar o celular não apaga o que foi desenhado. */
const PROP=3; // o campo tem sempre 3 de largura para 1 de altura
function pad(cv,aoMudar){
  const ctx=cv.getContext("2d");
  let tracos=[],atual=null,ativo=false;
  const m=()=>{const b={x0:1,x1:0,y0:1,y1:0,n:0};tracos.forEach(t=>t.forEach(p=>{b.x0=Math.min(b.x0,p[0]);b.x1=Math.max(b.x1,p[0]);b.y0=Math.min(b.y0,p[1]);b.y1=Math.max(b.y1,p[1]);b.n++;}));return b;};
  function desenha(c,w,h,larg){
    c.clearRect(0,0,w,h);c.lineCap="round";c.lineJoin="round";c.strokeStyle="#0a1450";c.fillStyle="#0a1450";c.lineWidth=larg;
    tracos.forEach(t=>{
      if(t.length===1){c.beginPath();c.arc(t[0][0]*w,t[0][1]*h,larg/2,0,7);c.fill();return;}
      c.beginPath();c.moveTo(t[0][0]*w,t[0][1]*h);
      for(let i=1;i<t.length-1;i++){const x=(t[i][0]+t[i+1][0])/2*w,y=(t[i][1]+t[i+1][1])/2*h;c.quadraticCurveTo(t[i][0]*w,t[i][1]*h,x,y);}
      const u=t[t.length-1];c.lineTo(u[0]*w,u[1]*h);c.stroke();
    });
  }
  function ajusta(){
    const r=cv.getBoundingClientRect();if(!r.width)return;
    const dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1));
    cv.width=Math.round(r.width*dpr);cv.height=Math.round(r.height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    desenha(ctx,r.width,r.height,2.6);
  }
  const ponto=e=>{const r=cv.getBoundingClientRect();return[Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))];};
  cv.addEventListener("pointerdown",e=>{if(cv.dataset.off==="1")return;e.preventDefault();try{cv.setPointerCapture(e.pointerId);}catch(x){}ativo=true;atual=[ponto(e)];tracos.push(atual);ajusta();aoMudar();});
  cv.addEventListener("pointermove",e=>{if(!ativo)return;e.preventDefault();atual.push(ponto(e));ajusta();aoMudar();});
  const fim=e=>{if(!ativo)return;ativo=false;atual=null;aoMudar();};
  cv.addEventListener("pointerup",fim);cv.addEventListener("pointercancel",fim);cv.addEventListener("lostpointercapture",fim);
  cv.addEventListener("contextmenu",e=>e.preventDefault());
  window.addEventListener("resize",ajusta);
  setTimeout(ajusta,0);
  return{
    limpa(){tracos=[];atual=null;ativo=false;ajusta();aoMudar();},
    vazio:()=>!tracos.length,
    // as mesmas medidas que o servidor confere (api/_assinatura.js conferirTraco): um toque solto não vale
    metricas(){const b=m(),r=cv.getBoundingClientRect();return{pontos:b.n,tracos:tracos.length,larg:Math.round((b.x1-b.x0)*r.width),alt:Math.round((b.y1-b.y0)*r.height)};},
    valido(){const k=this.metricas();return k.pontos>=12&&k.larg>=60&&k.alt>=8;},
    png(){const c=document.createElement("canvas");c.width=600;c.height=Math.round(600/PROP);desenha(c.getContext("2d"),c.width,c.height,4.2);return c.toDataURL("image/png");},
    solta(){window.removeEventListener("resize",ajusta);}
  };
}

/* ═════════ fila de reenvio (sinal fraco) ═════════ */
function lerFila(){try{return JSON.parse(localStorage.getItem(FILA)||"{}")||{};}catch(e){return{};}}
function gravaFila(f){try{localStorage.setItem(FILA,JSON.stringify(f));return true;}catch(e){return false;}}
function enfileira(corpo){const f=lerFila();f[corpo.chave]=corpo;return gravaFila(f);}
function desenfileira(chave){const f=lerFila();delete f[chave];gravaFila(f);}
let tentando=false;
// Envia uma coleta guardada. Erro de rede ou do servidor (5xx): continua na fila. Resposta definitiva (4xx): sai da fila.
async function enviaCorpo(corpo){
  try{const j=await api("medida_coletar","POST",corpo);desenfileira(corpo.chave);return{ok:true,j};}
  catch(e){
    if(e.status&&e.status>=400&&e.status<500){desenfileira(corpo.chave);return{ok:false,definitivo:true,e};}
    return{ok:false,definitivo:false,e};
  }
}
async function reenviarFila(){
  if(tentando||!sessionStorage.getItem("logged"))return;
  const f=lerFila(),chaves=Object.keys(f);if(!chaves.length)return;
  tentando=true;
  try{
    for(const c of chaves){
      if(AS.g&&AS.g.chave===c&&AS.enviando)continue; // a tela aberta está cuidando desta
      const r=await enviaCorpo(f[c]);
      if(r.ok){toast("✍️ Assinatura enviada ao servidor");if(typeof window.mdRecarregar==="function")window.mdRecarregar();}
      else if(r.definitivo)toast("⚠️ Uma assinatura guardada no aparelho foi recusada: "+r.e.message);
    }
  }finally{tentando=false;}
}
window.addEventListener("online",reenviarFila);
setInterval(reenviarFila,30000);

/* ═════════ tela ═════════ */
function dados(g){return Object.assign({},window.mdDocDaGerada(g),{digital:true});}
const primeiro=g=>titulo(String(g.nome||"").split(" ")[0]);
const mostraPerfil=()=>AS.perfil&&AS.perfil.tem;
let metaVp=null,vpAntes=null;
function travaZoom(sim){
  metaVp=metaVp||document.querySelector('meta[name="viewport"]');if(!metaVp)return;
  if(sim){vpAntes=metaVp.getAttribute("content");metaVp.setAttribute("content","width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover");}
  else if(vpAntes!=null){metaVp.setAttribute("content",vpAntes);vpAntes=null;}
}
function abrirTela(g){
  fechar(true);
  if(typeof window.mdInjetaCss==="function")window.mdInjetaCss(); // o estilo do documento (a folha) é o mesmo da janela da medida
  const ov=document.createElement("div");ov.id="as-ov";ov.className="as-ov";ov.setAttribute("role","dialog");ov.setAttribute("aria-modal","true");ov.setAttribute("aria-label","Assinatura da medida");
  ov.innerHTML=`<div class="as-win"><header class="as-hd"><div><b id="as-tit"></b><span id="as-sub"></span></div><button type="button" class="as-x" data-as="sair" aria-label="Fechar">${IC.x}</button></header><div class="as-corpo" id="as-corpo"></div><footer class="as-rod" id="as-rod"></footer></div>`;
  ov.addEventListener("click",clique);ov.addEventListener("input",digitou);ov.addEventListener("change",digitou);
  document.body.appendChild(ov);document.body.style.overflow="hidden";travaZoom(true);
}
function fechar(silencioso){
  Object.values(AS.pads).forEach(p=>p&&p.solta&&p.solta());AS.pads={};
  const ov=document.getElementById("as-ov");if(ov)ov.remove();
  document.body.style.overflow="";travaZoom(false);
  if(!silencioso)AS.etapa=null;
}
function etapa(e){
  AS.etapa=e;AS.erro=null;
  Object.values(AS.pads).forEach(p=>p&&p.solta&&p.solta());AS.pads={};
  pinta();
}
const cab=(t,s)=>{document.getElementById("as-tit").textContent=t;document.getElementById("as-sub").textContent=s||"";};
const rod=h=>{document.getElementById("as-rod").innerHTML=h;};
const corpo=h=>{const c=document.getElementById("as-corpo");c.innerHTML=h;c.scrollTop=0;};
const campoPad=(id,dica)=>`<div class="as-pad"><canvas id="${id}" aria-label="${esc(dica)}"></canvas><span class="as-linha" aria-hidden="true"></span><span class="as-dica">${esc(dica)}</span></div>`;
const aviso=()=>AS.erro?`<div class="as-erro" role="alert">${esc(AS.erro)}</div>`:"";

function pinta(){
  const g=AS.g;if(!g||!document.getElementById("as-ov"))return;
  const e=AS.etapa;
  if(e==="sup")return pintaSup();
  if(e==="entrega")return pintaEntrega();
  if(e==="ler")return pintaLer();
  if(e==="recusa")return pintaRecusa();
  if(e==="envio")return pintaEnvio();
  if(e==="pronto")return pintaPronto();
}
function ligaPad(id,aoMudar){const cv=document.getElementById(id);if(!cv)return null;const p=pad(cv,aoMudar);AS.pads[id]=p;return p;}

/* 1 · supervisor */
function pintaSup(){
  const g=AS.g,tem=mostraPerfil(),usar=tem&&!AS.sup_novo;
  cab("Assinatura do supervisor",`${g.numero} · ${titulo(g.nome)}`);
  if(AS.perfil===undefined){corpo(`<div class="as-vz"><b>Carregando…</b></div>`);rod("");return;}
  if(usar){
    corpo(`<p class="as-txt">Você assina primeiro, como <b>${esc(nomeDe(uk()))}</b>. A sua assinatura guardada no perfil vai no documento, com o seu login e o horário do servidor.</p>`+
      `<div class="as-previa"><img src="${esc(AS.perfil.png)}" alt="Sua assinatura guardada"></div>${aviso()}<p class="as-peq"><button type="button" class="as-lnk" data-as="sup-novo">Desenhar de novo</button></p>`);
    rod(`<button type="button" class="as-b pri" data-as="sup-perfil">Assinar como ${esc(nomeDe(uk()))}</button>`);
    return;
  }
  corpo(`<p class="as-txt">Desenhe a sua assinatura com o dedo, dentro do campo.</p>${campoPad("as-pad-sup","Assine aqui")}${aviso()}`+
    `<label class="as-chk"><input type="checkbox" id="as-guardar" ${AS.guardar===false?"":"checked"}><span>Guardar minha assinatura para as próximas medidas</span></label>`+
    (tem?`<p class="as-peq"><button type="button" class="as-lnk" data-as="sup-usar">Usar a assinatura guardada</button></p>`:""));
  rod(`<button type="button" class="as-b" data-as="limpar" data-p="as-pad-sup">Limpar</button><button type="button" class="as-b pri" data-as="sup-ok" id="as-ok" disabled>Continuar</button>`);
  ligaPad("as-pad-sup",()=>{const b=document.getElementById("as-ok");if(b)b.disabled=!AS.pads["as-pad-sup"].valido();});
}

/* 2 · entregar o celular */
function pintaEntrega(){
  const g=AS.g;
  cab("Entregue o celular",`${g.numero}`);
  corpo(`<div class="as-passa"><div class="as-passa-ic">${IC.ok}</div><h3>Sua assinatura foi registrada na tela.</h3><p class="as-txt">Agora passe o celular para <b>${esc(primeiro(g))}</b>. Ele vai ler o documento inteiro e escrever o próprio nome com o dedo, como assinatura.</p></div>`);
  rod(`<button type="button" class="as-b" data-as="voltar-sup">Voltar</button><button type="button" class="as-b pri" data-as="ler">O colaborador está com o celular</button>`);
}

/* 3 · o colaborador lê e assina */
function pintaLer(){
  const g=AS.g,html=window.mdDocHtml(dados(g));
  cab("Leia o documento",`${g.numero} · ${titulo(g.nome)}`);
  corpo(`<div class="as-doc md-leitura"><div class="md-papel">${html}</div></div>`+
    `<section class="as-assina"><label class="as-chk grande"><input type="checkbox" id="as-ciente" ${AS.aceite?"checked":""}><span><b>Li e estou ciente</b> do documento acima.</span></label>`+
    `<div id="as-wrap" class="as-wrap${AS.aceite?"":" off"}">${campoPad("as-pad-col","Escreva aqui o seu nome com o dedo")}<p class="as-peq" ${AS.aceite?"hidden":""} id="as-bloq">Marque “Li e estou ciente” para escrever o seu nome.</p></div>${aviso()}`+
    `<p class="as-peq"><button type="button" class="as-lnk er" data-as="recusar">O colaborador recusou-se a assinar</button></p></section>`);
  rod(`<button type="button" class="as-b" data-as="limpar" data-p="as-pad-col">Limpar</button><button type="button" class="as-b pri" data-as="col-ok" id="as-ok" disabled>Confirmar assinatura</button>`);
  ligaPad("as-pad-col",atualizaOk);
  document.getElementById("as-pad-col").dataset.off=AS.aceite?"0":"1";
  function atualizaOk(){const b=document.getElementById("as-ok");if(b)b.disabled=!(AS.aceite&&AS.pads["as-pad-col"]&&AS.pads["as-pad-col"].valido());}
  AS.atualizaOk=atualizaOk;
}

/* 3b · recusa */
function pintaRecusa(){
  const g=AS.g;
  cab("Recusa de assinatura",`${g.numero} · ${titulo(g.nome)}`);
  const t=AS.recusa.t.map((x,i)=>`<fieldset class="as-fs"><legend>Testemunha ${i+1} (opcional)</legend><label>Nome completo<input class="as-in" data-as="tnome" data-i="${i}" value="${esc(x.nome)}" maxlength="80" autocomplete="off"></label><label>Documento (RG ou CPF, opcional)<input class="as-in" data-as="tdoc" data-i="${i}" value="${esc(x.doc)}" maxlength="40" autocomplete="off" inputmode="numeric"></label></fieldset>`).join("");
  corpo(`<p class="as-txt">Registra que <b>${esc(primeiro(g))}</b> recusou-se a assinar, com data e hora do servidor, e entrega a via do mesmo jeito. Se houver testemunhas, informe o nome delas.</p>${t}`+
    `<label class="as-campo">Observação (opcional)<textarea class="as-in" data-as="obs" maxlength="300" rows="3">${esc(AS.recusa.obs)}</textarea></label>${aviso()}`);
  rod(`<button type="button" class="as-b" data-as="voltar-ler">Voltar</button><button type="button" class="as-b pri er" data-as="recusa-ok" id="as-ok">Registrar a recusa</button>`);
  atualizaRecusa();
}
function recusaCompleta(){return AS.recusa.t.every(x=>!x.doc.trim()||x.nome.trim().length>=3)&&AS.recusa.t.every(x=>!x.nome.trim()||x.nome.trim().length>=3);}
function atualizaRecusa(){const b=document.getElementById("as-ok");if(b&&AS.etapa==="recusa")b.disabled=!recusaCompleta();}

/* 4 · envio ao servidor */
function pintaEnvio(){
  cab("Enviando…",AS.g.numero);
  corpo(`<div class="as-vz"><div class="as-gira" aria-hidden="true"></div><b>${AS.offline?"Sem internet no momento":"Registrando no servidor…"}</b>${AS.offline?`<span>A assinatura está guardada neste celular e será enviada sozinha assim que o sinal voltar. Não feche esta tela.</span>`:`<span>Aguarde. A assinatura só vale depois da confirmação.</span>`}</div>${aviso()}`);
  rod(AS.offline?`<button type="button" class="as-b pri" data-as="tentar">Tentar agora</button>`:"");
}
async function enviar(corpoPedido){
  AS.enviando=true;AS.offline=false;
  enfileira(corpoPedido);
  etapa("envio");
  for(;;){
    const r=await enviaCorpo(corpoPedido);
    if(!document.getElementById("as-ov")&&AS.etapa==null){AS.enviando=false;return;} // a tela foi fechada: a fila cuida do resto
    if(r.ok){AS.enviando=false;AS.res=r.j;if(typeof window.mdRecarregar==="function")window.mdRecarregar();etapa("pronto");carregaContato();return;}
    if(r.definitivo){
      AS.enviando=false;
      if(r.e.codigo==="JA_COLETADA"||r.e.codigo==="JA_ASSINADA_EM_PAPEL"){AS.erro=r.e.message;etapa("pronto");return;}
      if(r.e.codigo==="SEM_ASSINATURA_PERFIL"){AS.perfil={tem:false};etapa("sup");AS.erro=r.e.message;pintaSup();return;}
      AS.erro=r.e.message;etapa(corpoPedido.recusa?"recusa":"ler");return;
    }
    AS.offline=true;pintaEnvio();
    await new Promise(ok=>{AS.espera=ok;setTimeout(ok,5000);}); // sinal fraco: tenta de novo sozinho
  }
}

/* 5 · pronto: o QR da via */
let relogio=null;
function pintaPronto(){
  const g=AS.g,r=AS.res,recusou=r&&r.resultado==="RECUSADA";
  if(!r){ // JA_COLETADA: já existe coleta; só mostra o aviso e deixa abrir a via
    cab("Já coletada",g.numero);corpo(`<div class="as-vz"><b>${esc(AS.erro||"Esta medida já foi coletada.")}</b></div>`);rod(`<button type="button" class="as-b pri" data-as="sair">Fechar</button>`);return;
  }
  cab(recusou?"Recusa registrada":"Assinado",`${g.numero}`);
  corpo(`<div class="as-ok"><div class="as-ok-ic ${recusou?"er":""}">${recusou?IC.x:IC.ok}</div><h3>${recusou?"Recusa registrada":"Documento assinado"}</h3>`+
    `<p class="as-txt">O servidor selou o documento <b>${esc(g.numero)}</b>. O hash do arquivo (SHA-256) começa com <code>${esc(String(r.sha256||"").slice(0,12))}</code>.</p></div>`+
    `<section class="as-via" id="as-via"></section>`);
  rod(`<button type="button" class="as-b pri" data-as="sair">Concluir</button>`);
  pintaVia(r.via,r.viaErro);
  if(typeof window.mdRecarregar==="function")window.mdRecarregar();
}
function qrSvg(url){
  if(typeof qrcode!=="function")return"";
  try{const q=qrcode(0,"M");q.addData(url);q.make();return q.createSvgTag({cellSize:6,margin:3,scalable:true});}catch(e){return"";}
}
function pintaVia(via,erro){
  const box=document.getElementById("as-via");if(!box)return;
  clearInterval(relogio);
  const g=AS.g,ctt=AS.contato;
  let h=`<h4>Via do documento para o colaborador</h4>`;
  if(via){
    h+=`<div class="as-qr" id="as-qr">${qrSvg(via.url)||`<p class="as-erro">Não consegui desenhar o QR. Use o SMS ou o e-mail.</p>`}</div>`+
      `<p class="as-txt c">Peça para <b>${esc(primeiro(g))}</b> apontar a câmera do <b>próprio celular</b> para o QR. O documento baixa na hora.</p><p class="as-peq c" id="as-rel"></p>`;
  }else h+=erro?`<div class="as-erro">${esc(erro)}</div>`:`<p class="as-txt c">Gerando o QR…</p>`;
  h+=`<div class="as-canais"><button type="button" class="as-b" data-as="via-qr">Gerar outro QR</button>`+
    `<button type="button" class="as-b" data-as="via-sms" ${ctt&&ctt.sms&&ctt.sms.celular&&ctt.sms.ligado?"":"disabled"}>Enviar por SMS${ctt&&ctt.sms&&ctt.sms.celular?" ("+esc(ctt.sms.mascara)+")":""}</button></div>`+
    (ctt&&!(ctt.sms.celular&&ctt.sms.ligado)?`<p class="as-peq c">${!ctt.sms.celular?"Este colaborador não tem celular cadastrado e liberado para SMS.":"O envio de SMS está desligado."}</p>`:"")+
    `<div class="as-email"><label>Enviar por e-mail (opcional)<input class="as-in" id="as-email" type="email" inputmode="email" autocomplete="off" placeholder="email@exemplo.com.br"></label><button type="button" class="as-b" data-as="via-email">Enviar</button></div><div id="as-via-msg" class="as-peq c" role="status"></div>`;
  box.innerHTML=h;
  if(via){
    const ate=Number(via.expiraEm);
    const t=()=>{const s=Math.max(0,Math.round((ate-Date.now())/1000)),el=document.getElementById("as-rel");if(!el){clearInterval(relogio);return;}
      if(!s){el.textContent="QR vencido: gere outro.";document.getElementById("as-qr").classList.add("venc");clearInterval(relogio);}
      else el.textContent="Vale por mais "+Math.floor(s/60)+":"+String(s%60).padStart(2,"0")+" min";};
    t();relogio=setInterval(t,1000);
  }
}
async function carregaContato(){
  try{AS.contato=await api("medida_contato&chave="+encodeURIComponent(AS.g.chave));}catch(e){AS.contato=null;}
  if(document.getElementById("as-via"))pintaVia(AS.res&&AS.res.via,AS.res&&AS.res.viaErro);
}
async function viaCanal(canal,extra,btn){
  const m=document.getElementById("as-via-msg");if(btn)btn.disabled=true;if(m)m.textContent="Enviando…";
  try{
    const j=await api("medida_via","POST",Object.assign({chave:AS.g.chave,canal:canal},extra||{}));
    if(canal==="qr"){AS.res=Object.assign({},AS.res,{via:j.via,viaErro:null});pintaVia(j.via,null);return;}
    if(m)m.textContent=canal==="sms"?"SMS enviado para "+j.destino+". O link vale 30 dias e pede o RE e os 4 últimos dígitos do celular.":"E-mail enviado. O link vale 30 dias e pede o RE e os 4 últimos dígitos do celular.";
  }catch(e){if(m)m.textContent="⚠️ "+e.message;}
  finally{if(btn)btn.disabled=false;}
}

/* ═════════ ações ═════════ */
function digitou(ev){
  const t=ev.target,a=t.dataset&&t.dataset.as;
  if(t.id==="as-ciente"){
    AS.aceite=t.checked;
    const w=document.getElementById("as-wrap"),cv=document.getElementById("as-pad-col"),b=document.getElementById("as-bloq");
    if(w)w.classList.toggle("off",!AS.aceite);if(cv)cv.dataset.off=AS.aceite?"0":"1";if(b)b.hidden=AS.aceite;
    if(AS.atualizaOk)AS.atualizaOk();return;
  }
  if(t.id==="as-guardar"){AS.guardar=t.checked;return;}
  if(a==="tnome"||a==="tdoc"){AS.recusa.t[+t.dataset.i][a==="tnome"?"nome":"doc"]=t.value;atualizaRecusa();return;}
  if(a==="obs"){AS.recusa.obs=t.value;}
}
function clique(ev){
  const b=ev.target.closest("[data-as]");if(!b||b.tagName==="INPUT"||b.tagName==="TEXTAREA")return;
  const a=b.dataset.as;
  if(a==="sair"){
    if(AS.etapa==="envio"&&AS.enviando&&!window.confirm("A assinatura ainda não foi confirmada pelo servidor. Ela fica guardada neste celular e é enviada sozinha quando houver sinal. Fechar mesmo assim?"))return;
    clearInterval(relogio);fechar();return;
  }
  if(a==="limpar"){const p=AS.pads[b.dataset.p];if(p)p.limpa();return;}
  if(a==="sup-novo"){AS.sup_novo=true;pintaSup();return;}
  if(a==="sup-usar"){AS.sup_novo=false;pintaSup();return;}
  if(a==="sup-perfil"){AS.sup={usarPerfil:true};etapa("entrega");return;}
  if(a==="sup-ok"){
    const p=AS.pads["as-pad-sup"];if(!p||!p.valido())return;
    AS.sup={png:p.png(),metricas:p.metricas(),guardar:!!(document.getElementById("as-guardar")||{}).checked};AS.guardar=AS.sup.guardar;
    etapa("entrega");return;
  }
  if(a==="voltar-sup"){etapa("sup");return;}
  if(a==="ler"){etapa("ler");return;}
  if(a==="recusar"){etapa("recusa");return;}
  if(a==="voltar-ler"){etapa("ler");return;}
  if(a==="col-ok"){
    const p=AS.pads["as-pad-col"];if(!AS.aceite||!p||!p.valido())return;
    AS.col={png:p.png(),metricas:p.metricas(),aceite:true};
    enviar({chave:AS.g.chave,idem:AS.idem,supervisor:AS.sup,colaborador:AS.col});return;
  }
  if(a==="recusa-ok"){
    if(!recusaCompleta())return;
    enviar({chave:AS.g.chave,idem:AS.idem,supervisor:AS.sup,recusa:{testemunhas:AS.recusa.t.map(x=>({nome:x.nome.trim(),doc:x.doc.trim()})).filter(x=>x.nome||x.doc),observacao:AS.recusa.obs.trim()}});return;
  }
  if(a==="tentar"){if(AS.espera)AS.espera();return;}
  if(a==="via-qr"){viaCanal("qr",null,b);return;}
  if(a==="via-sms"){viaCanal("sms",null,b);return;}
  if(a==="via-email"){const e=(document.getElementById("as-email")||{}).value||"";viaCanal("email",{email:e.trim()},b);return;}
}

/* ═════════ pontos de entrada ═════════ */
function achar(x){return typeof x==="object"&&x?x:(typeof window.mdGerada==="function"?window.mdGerada(x):null);}
window.mdAssinar=async function(x){
  const g=achar(x);if(!g){toast("Não achei a medida. Atualize a tela.");return;}
  if(g.assinado&&!g.assinado.digital){toast("Esta medida já tem o documento em papel anexado.");return;}
  if(g.assinado&&g.assinado.digital){window.mdVia(g);return;}
  // uma coleta guardada no aparelho (sinal ruim) é retomada com a mesma chave: não cria segunda assinatura
  const f=lerFila()[g.chave];
  AS.g=g;AS.idem=f?f.idem:novoId();AS.sup=f?f.supervisor:null;AS.col=null;AS.aceite=false;AS.res=null;AS.erro=null;AS.perfil=undefined;AS.sup_novo=false;AS.contato=null;AS.recusa={t:[{nome:"",doc:""},{nome:"",doc:""}],obs:""};
  abrirTela(g);
  if(f){enviar(f);return;}
  etapa("sup");
  try{AS.perfil=await api("assinatura_perfil");}catch(e){AS.perfil={tem:false};}
  if(AS.etapa==="sup")pintaSup();
};
// a via de uma medida já assinada: QR novo, SMS, e-mail
window.mdVia=async function(x){
  const g=achar(x);if(!g)return;
  AS.g=g;AS.res={resultado:g.assinado&&g.assinado.resultado,sha256:g.assinado&&g.assinado.sha256,via:null};AS.contato=null;AS.erro=null;
  abrirTela(g);etapa("pronto");
  carregaContato();viaCanal("qr",null,null);
};
setTimeout(reenviarFila,2500);
})();
