/* Aviso semanal de faltas injustificadas por e-mail — o painel do envio.
   Fica fora do index.html porque ele já está no limite de tamanho (test/auth_exigencia).
   O servidor é o api/_faltas_email.js (/api/rh?modulo=faltasemail). Aqui:
   • botão "Aviso por e-mail" na tela Faltas x Medidas e no menu do perfil (só a conta do Raphael);
   • e-mail do supervisor e nome da saudação de cada área, e quem vai em cópia;
   • a conta de e-mail que envia (a senha vai para o servidor e não volta mais para a tela);
   • liga/desliga o envio automático e escolhe o dia da semana e a hora (padrão: segunda, 14h);
   • teste de todas as áreas de uma vez para quem ele escolher (a coordenação acompanhar o que cada supervisor recebe);
   • a imagem da assinatura, que vai no corpo do e-mail abaixo do cartão;
   • envio oficial da semana anterior, escolhendo áreas e cópias;
   • envio de teste de qualquer período, para quem ele escolher na hora, e a prévia do e-mail.
   Esconder o botão é só conveniência: quem barra os outros é o servidor. */
(function(){
"use strict";
// Mesma conta do servidor (api/_faltas_email.js RESPONSAVEL; test/faltas_email.test.js confere).
const FE_RESPONSAVEL="raphaelvictor";
const FE={conta:null,p:null,sel:new Set(),cc:new Set(),edit:null,copias:null,msg:null,ocupado:false,aba:"geral",ag:null,env:null};
const DIAS=["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"],DIAS_C=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const uk=()=>sessionStorage.getItem("userKey")||"";
const logado=()=>sessionStorage.getItem("logged")==="1";
const dma=d=>{const s=String(d||"");return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4):"—";};
const quando=iso=>{const t=Date.parse(iso);if(!t)return"";const sp=new Date(t-3*3600000).toISOString();return sp.slice(8,10)+"/"+sp.slice(5,7)+" às "+sp.slice(11,16);};
const STATUS={ENVIADO:"Enviado",PENDENTE:"Pendente",SEM_EMAIL:"Sem e-mail",FALHOU:"Falhou",EM_ANDAMENTO:"Enviando"};

async function api(t,metodo,corpo,qs){
  const r=await fetch("/api/rh?modulo=faltasemail&t="+t+(qs||""),{method:metodo||"GET",headers:corpo?{"Content-Type":"application/json"}:{},body:corpo?JSON.stringify(corpo):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false){const e=new Error(j.error||("Falha ("+r.status+")"));e.codigo=j.codigo;throw e;}
  return j;
}

/* ── botões (só a conta do responsável) ─────────────────────────────── */
function botoes(){
  const ok=logado()&&uk()===FE_RESPONSAVEL;
  ["fm-bt-email","sbFeEmail"].forEach(function(id){const el=document.getElementById(id);if(el)el.style.display=ok?"":"none";});
}
window.feAposLogin=botoes;
setTimeout(botoes,0);

/* ── janelas ─────────────────────────────────────────────────────────── */
function janela(id,titulo,sub,html,estreito,shell){
  let ov=document.getElementById(id);
  const novo=!ov;
  if(novo){ov=document.createElement("div");ov.id=id;ov.className="fe-ov";}
  const alvo=ov.querySelector(".fe-main")||ov.querySelector(".fe-box"),rolagem=alvo?alvo.scrollTop:0; // redesenhar não pode jogar a tela para o topo
  ov.innerHTML=shell?'<div class="fe-box fe-shell" role="dialog" aria-modal="true" aria-label="'+esc(titulo)+'">'+html+'</div>':
    '<div class="fe-box'+(estreito?" fe-estreito":"")+'" role="dialog" aria-modal="true" aria-label="'+esc(titulo)+'">'+
    '<div class="fe-h"><div><b>'+esc(titulo)+'</b>'+(sub?'<span>'+esc(sub)+'</span>':'')+'</div><button type="button" class="fe-x" aria-label="Fechar" data-fe="fechar" data-id="'+id+'">✕</button></div>'+
    '<div class="fe-c">'+html+'</div></div>';
  if(novo){
    ov.addEventListener("click",function(e){if(e.target===ov){fechar(id);return;}clique(e);});
    ov.addEventListener("change",mudou);
    ov.addEventListener("input",digitou);
    document.body.appendChild(ov);
  }
  if(rolagem){const m=ov.querySelector(".fe-main")||ov.querySelector(".fe-box");if(m)m.scrollTop=rolagem;}
  return ov;
}
function fechar(id){const o=document.getElementById(id);if(o)o.remove();}
window.feFechar=fechar;

window.feAbrir=async function(){
  if(uk()!==FE_RESPONSAVEL)return;
  FE.msg=null;FE.edit=null;FE.copias=null;FE.p=null;FE.rs=null;FE.rsConf=false;FE.aba="geral";FE.ag=null;FE.env=null;FE.animar=true;
  clearInterval(FE.tk);FE.tk=setInterval(()=>{if(!document.getElementById("feJanela")){clearInterval(FE.tk);return;}relogio();},30000);
  render();
  await carregar(false);
};
async function carregar(manter){
  // o endereço em que o painel foi aberto vira o do botão "Abrir no Painel ServCamp" dos e-mails (o servidor só aceita https)
  try{FE.p=await api("painel","GET",null,"&origem="+encodeURIComponent(location.origin));}
  catch(e){FE.p=null;FE.msg={tipo:"er",t:e.message};render();return;}
  if(!manter){
    FE.sel=new Set(FE.p.areas.filter(a=>a.email&&a.status!=="ENVIADO").map(a=>a.area));
    FE.cc=new Set(FE.p.copias.map(c=>c.email));
    FE.env=null;
    FE.ag={dia:FE.p.agenda.dia,hora:FE.p.agenda.hora,minuto:FE.p.agenda.minuto||0};
  }
  render();
}
function msg(tipo,t){FE.msg={tipo:tipo,t:t,em:Date.now()};if(tipo==="ok"){clearTimeout(FE.tm);FE.tm=setTimeout(()=>{if(FE.msg&&FE.msg.tipo==="ok"){const el=document.querySelector("#feJanela .fe-toast");if(el)el.remove();FE.msg=null;}},5200);}}

/* ── tela ────────────────────────────────────────────────────────────── */
/* ── ícones (traço fino, herdam a cor) ───────────────────────────────── */
const sv=d=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>';
const IC={
  marca:sv('<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="m4 8 8 5.5L20 8"/><circle cx="18" cy="17" r="4.2" fill="currentColor" stroke="none" opacity=".28"/><path d="M18 15.2V17l1.2.9"/>'),
  geral:sv('<rect x="3.5" y="3.5" width="7" height="9" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="15.5" width="7" height="5" rx="2"/>'),
  agenda:sv('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/>'),
  areas:sv('<circle cx="9" cy="8.5" r="3.3"/><path d="M2.8 19c.5-3.2 3-5 6.2-5s5.7 1.8 6.2 5"/><path d="M16.5 5.6a3.1 3.1 0 0 1 0 5.8M18 14.4c1.8.6 3 2 3.3 4.6"/>'),
  dest:sv('<path d="M4 6.5h16v11H4z" stroke-linejoin="round"/><path d="m4.5 7.5 7.5 6 7.5-6"/><path d="M8 3.5h8" opacity=".5"/>'),
  envio:sv('<path d="m21 3-9.5 18-2.2-7.3L2 11.5z"/><path d="m21 3-11.7 10.2"/>'),
  conta:sv('<circle cx="8" cy="15" r="3.8"/><path d="m10.9 12.3 8.1-8.1M16 7.2l2.4 2.4M13.6 9.6l1.9 1.9"/>'),
  hist:sv('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.2 4.5v4.2h4.2"/><path d="M12 7.6V12l3 1.8"/>'),
  cal:sv('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  prev:sv('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  edit:sv('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/>'),
  enviar:sv('<path d="m21 3-9.5 18-2.2-7.3L2 11.5z"/>')
};
// Navegação em três grupos, na ordem em que as perguntas aparecem: como está? → como configurar? → enviar agora.
const ABAS=[
  {k:"geral",g:"Acompanhar",rot:"Visão geral",sub:"Próximo envio e pendências",ic:"geral",tit:"Como está o aviso desta semana",desc:"O próximo envio automático, o que já saiu e o que ainda precisa de atenção. Comece por aqui."},
  {k:"hist",g:"Acompanhar",rot:"Histórico",sub:"Tudo o que já saiu",ic:"hist",tit:"Histórico de envios",desc:"Cada e-mail enviado, oficial ou de teste, com a data, a área e se o servidor confirmou o envio."},
  {k:"agenda",g:"Configurar",rot:"Envio automático",sub:"Dia e hora",ic:"agenda",tit:"Envio automático",desc:"Defina em três passos quando o aviso sai sozinho. Depois de salvar, não precisa fazer mais nada: toda semana ele sai no dia e na hora escolhidos."},
  {k:"areas",g:"Configurar",rot:"Supervisores",sub:"Quem recebe cada área",ic:"areas",tit:"Supervisores e áreas",desc:"Cada área manda o aviso para o e-mail do supervisor dela. Aqui você cadastra o e-mail, o nome usado no \"Olá, …\" e vê a prévia."},
  {k:"dest",g:"Configurar",rot:"Cópias",sub:"Quem acompanha",ic:"dest",tit:"Quem recebe cópia",desc:"Quem vai em cópia de todos os avisos (ex.: a coordenação) e quem recebe o resumo semanal das medidas geradas."},
  {k:"conta",g:"Configurar",rot:"Conta e assinatura",sub:"Remetente do e-mail",ic:"conta",tit:"Conta que envia e assinatura",desc:"O endereço que aparece como remetente e a imagem de assinatura no fim de cada e-mail."},
  {k:"envio",g:"Enviar",rot:"Enviar agora e testar",sub:"Sem esperar o automático",ic:"envio",tit:"Enviar agora ou testar",desc:"Mande o aviso da semana na hora, ou um teste com o conteúdo real para conferir o que cada supervisor vai receber."}
];
// Ícone + título + explicação de cada bloco: tudo que aparece na tela diz o que é e para que serve.
const cab=(ic,tit,sub,extra)=>'<div class="fe-sec-h"><div class="fe-sec-t">'+(ic?'<span class="fe-sec-ic">'+IC[ic]+'</span>':'')+'<div><b>'+tit+'</b>'+(sub?'<span class="fe-mut">'+sub+'</span>':'')+'</div></div>'+(extra||'')+'</div>';
const ajuda=t=>'<span class="fe-aj" tabindex="0" role="note" aria-label="'+esc(t)+'" data-dica="'+esc(t)+'">?</span>';
const horaTxt=(h,m)=>String(h).padStart(2,"0")+":"+String(m||0).padStart(2,"0");
// dias entre duas datas ISO
const difDias=(a,b)=>Math.round((Date.parse(b+"T12:00:00Z")-Date.parse(a+"T12:00:00Z"))/864e5);
const dmCurto=d=>{const s=String(d||"");return s.slice(8,10)+"/"+s.slice(5,7);};
const diaDe=d=>new Date(d+"T12:00:00Z").getUTCDay();
// próximo envio de uma escolha (dia, hora): hoje se ainda não chegou a hora, senão o próximo dia marcado
function proximo(p,ag){
  const ag0=new Date(Date.now()-3*3600000),minAgora=ag0.getUTCHours()*60+ag0.getUTCMinutes();
  let n=(ag.dia-diaDe(p.hoje)+7)%7;if(n===0&&minAgora>=ag.hora*60+(ag.minuto||0))n=7;
  const d=new Date(p.hoje+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);
  return{dia:d.toISOString().slice(0,10),hora:ag.hora,minuto:ag.minuto||0,em:n};
}
const emTxt=n=>n===0?"hoje":n===1?"amanhã":"em "+n+" dias";
const iniciais=n=>String(n||"?").trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();

function render(){
  const p=FE.p;
  if(!p){janela("feJanela","Aviso semanal por e-mail","",'<div class="fe-pg" style="grid-column:1/-1"><div class="fe-top"><div><small>Aviso semanal</small><h2>Central de envios</h2></div></div><div class="fe-main">'+(FE.msg?'<div class="fe-msg er">'+esc(FE.msg.t)+'</div>':'<p class="fe-mut">Carregando…</p>')+'<div style="margin-top:14px"><button type="button" class="fe-b" data-fe="fechar" data-id="feJanela">Fechar</button></div></div></div>',false,true);return;}
  const sem=p.semana,aba=ABAS.find(a=>a.k===FE.aba)||ABAS[0];
  const semEmail=p.areas.filter(a=>!a.email).length;
  const badge=k=>{
    if(k==="conta"&&!p.configurado)return'<span class="fe-bd">!</span>';
    if(k==="areas"&&semEmail)return'<span class="fe-bd">'+semEmail+'</span>';
    if(k==="geral"&&(!p.configurado||!p.link||p.semArea))return'<span class="fe-bd">!</span>';
    return"";
  };
  const nav=ABAS.map((a,i)=>(i===0||ABAS[i-1].g!==a.g?'<span class="fe-nv-g">'+esc(a.g)+'</span>':'')+
    '<button type="button" class="fe-nv'+(a.k===aba.k?" on":"")+'" data-fe="aba" data-aba="'+a.k+'"'+(a.k===aba.k?' aria-current="page"':'')+'>'+IC[a.ic]+'<span class="fe-nv-t"><b>'+esc(a.rot)+'</b><small>'+esc(a.sub)+'</small></span>'+badge(a.k)+'</button>').join("");
  const ag=p.agenda;
  const rail='<aside class="fe-rail" aria-label="Seções">'+
    '<div class="fe-brand"><div class="fe-marca">'+IC.marca+'</div><div><b>Aviso semanal</b><span>Faltas injustificadas por área</span></div></div>'+
    '<div class="fe-semana">'+IC.cal+'<div><small>Semana do aviso</small><b>'+esc(dmCurto(sem.inicio))+' a '+esc(dmCurto(sem.fim))+'</b></div></div>'+
    '<nav class="fe-nav">'+nav+'</nav>'+
    '<div class="fe-rail-foot"><small>Envio automático</small><label class="fe-sw"><span>'+(p.auto?'Ligado · '+DIAS_C[ag.dia]+' '+horaTxt(ag.hora,ag.minuto):'Desligado')+'</span><input type="checkbox" data-fe="auto"'+(p.auto?" checked":"")+' aria-label="Envio automático"></label></div>'+
  '</aside>';
  let corpo='';
  if(aba.k==="geral")corpo+=secGeral(p);
  else if(aba.k==="agenda")corpo+=secAgenda(p);
  else if(aba.k==="areas")corpo+=secAreas(p);
  else if(aba.k==="dest")corpo+=secCopias(p)+secResumo(p);
  else if(aba.k==="envio")corpo+=secEnviar(p);
  else if(aba.k==="conta")corpo+=secConta(p)+secAssinatura(p);
  else corpo+=secHistorico(p);
  const pg='<div class="fe-pg"><header class="fe-top"><div><small>'+esc(aba.g)+' · '+esc(aba.rot)+'</small><h2>'+esc(aba.tit)+'</h2><p>'+esc(aba.desc)+'</p></div><button type="button" class="fe-x" aria-label="Fechar" data-fe="fechar" data-id="feJanela">✕</button></header><div class="fe-main'+(FE.animar?" entra":"")+'">'+corpo+'</div></div>';
  // aviso flutuante: o de sucesso some sozinho em 5 s; o de erro fica até ser fechado
  const m=FE.msg,toast=m&&(m.tipo==="er"||Date.now()-(m.em||0)<5000)?'<div class="fe-toast '+m.tipo+'" role="'+(m.tipo==="er"?"alert":"status")+'"><span class="fe-toast-ic">'+(m.tipo==="er"?"!":"✓")+'</span><span>'+esc(m.t)+'</span><button type="button" data-fe="toast-x" aria-label="Fechar aviso">✕</button><i></i></div>':'';
  janela("feJanela","Aviso semanal por e-mail","Faltas injustificadas por área · só a sua conta envia",rail+pg+toast,false,true);
  if(FE.animar){FE.animar=false;contar();}
  relogio();
}
// números que sobem de 0 até o valor ao abrir uma aba (só na troca de aba, não a cada clique)
function contar(){
  if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  document.querySelectorAll("#feJanela [data-conta]").forEach(function(el){
    const alvo=Number(el.getAttribute("data-conta"))||0;if(!alvo)return;
    const t0=performance.now(),dur=700;
    (function passo(t){const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,3);el.textContent=Math.round(alvo*e);if(k<1)requestAnimationFrame(passo);})(t0);
  });
}
// contagem regressiva do próximo envio ("faltam 5 dias e 3 h"), atualizada a cada 30 s enquanto o painel está aberto
function faltaTxt(alvoMs){
  const ms=alvoMs-Date.now();if(ms<=0)return"saindo agora";
  const min=Math.floor(ms/60000),d=Math.floor(min/1440),h=Math.floor(min%1440/60),mi=min%60;
  return"faltam "+(d?d+(d===1?" dia":" dias")+(h?" e "+h+" h":""):h?h+" h"+(mi?" e "+mi+" min":""):mi+" min");
}
function relogio(){document.querySelectorAll("#feJanela [data-alvo]").forEach(el=>{el.textContent=faltaTxt(Number(el.getAttribute("data-alvo")));});}

/* Visão geral: o próximo envio em destaque, como o aviso funciona, os números da semana e o que falta. */
const somaD=(d,n)=>{const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
// semana que um envio cobre: a anterior ao dia do envio, de segunda a domingo
function semanaDo(d){const seg=somaD(d,-((diaDe(d)+6)%7));return{ini:somaD(seg,-7),fim:somaD(seg,-1)};}
const alvoMs=(dia,hora)=>Date.parse(dia+"T"+String(hora).padStart(2,"0")+":00:00-03:00");
function secGeral(p){
  const ag=p.agenda,pr=ag.proximo,n=difDias(p.hoje,pr.dia);
  const enviadas=p.areas.filter(a=>a.status==="ENVIADO").length,comEmail=p.areas.filter(a=>a.email).length;
  const pct=comEmail?Math.round(100*enviadas/comEmail):0;
  const faltas=p.areas.reduce((s,a)=>s+a.faltas,0),colab=p.areas.reduce((s,a)=>s+a.colaboradores,0),semEmail=p.areas.filter(a=>!a.email).length;
  const cob=semanaDo(pr.dia);
  const ticket='<div class="fe-ticket"><span class="fe-eyebrow">'+(p.auto?"Próximo envio automático":"Envio automático desligado")+'</span>'+
    '<div class="fe-dia-nome">'+esc(DIAS[diaDe(pr.dia)])+'</div><span class="fe-hora">'+horaTxt(pr.hora,pr.minuto)+'</span>'+
    '<div class="fe-data">'+esc(dma(pr.dia))+' · <span data-alvo="'+alvoMs(pr.dia,pr.hora)+'">'+emTxt(n)+'</span></div>'+
    '<p class="fe-ticket-sub">Cada supervisor vai receber as faltas injustificadas da semana de <b>'+esc(dmCurto(cob.ini))+' a '+esc(dmCurto(cob.fim))+'</b>.</p>'+
    '<div class="fe-rod"><span class="fe-st '+(p.auto?"ENVIADO":"PENDENTE")+'">'+(p.auto?"Automático ligado":"Nada sai sozinho")+'</span>'+
    '<button type="button" class="fe-b sm" data-fe="aba" data-aba="agenda">'+IC.agenda+(p.auto?"Mudar dia e hora":"Ligar o envio automático")+'</button></div></div>';
  const kpis='<div class="fe-kpis">'+
    '<div class="fe-kpi lg"><span class="fe-eyebrow">Supervisores que já receberam o aviso desta semana</span><b><span class="fe-n" data-conta="'+enviadas+'">'+enviadas+'</span><i> de '+comEmail+'</i></b><div class="fe-barra" role="img" aria-label="'+pct+'% enviados"><i style="width:'+pct+'%"></i></div></div>'+
    '<div class="fe-kpi"><span class="fe-eyebrow">Faltas no aviso</span><b data-conta="'+faltas+'">'+faltas+'</b><span>de '+colab+' colaborador(es), semana de '+esc(dmCurto(p.semana.inicio))+' a '+esc(dmCurto(p.semana.fim))+'</span></div>'+
    '<div class="fe-kpi'+(semEmail?" alerta":"")+'"><span class="fe-eyebrow">Sem e-mail</span><b data-conta="'+semEmail+'">'+semEmail+'</b><span>'+(semEmail?"não recebem o aviso até cadastrar":"todas recebem o aviso")+'</span></div>'+
  '</div>';
  const fluxo='<div class="fe-sec">'+cab("dest","Como o aviso funciona","Três etapas, toda semana. Você só configura uma vez.")+
    '<ol class="fe-fluxo">'+
      '<li><span class="fe-fluxo-n">1</span><b>A planilha diária atualiza as faltas</b><span>Abonos, afastamentos e demitidos já saem da conta. Só fica a falta injustificada de verdade.</span></li>'+
      '<li><span class="fe-fluxo-n">2</span><b>No dia e hora marcados, sai o e-mail</b><span>Cada supervisor recebe só as faltas da área dele, com a planilha dentro do e-mail. Quem está em cópia acompanha.</span></li>'+
      '<li><span class="fe-fluxo-n">3</span><b>O supervisor gera a medida no painel</b><span>O botão do e-mail abre a mesma lista no Painel ServCamp, onde ele gera o documento e depois lança no SAR2G.</span></li>'+
    '</ol></div>';
  const item=(ok,tit,det,acao)=>'<div class="fe-rd'+(ok?"":" pend")+'"><span class="fe-led '+(ok?"ok":"am")+'"></span><div><b>'+tit+'</b><span>'+det+'</span></div>'+(acao?'<button type="button" class="fe-b sm" data-fe="aba" data-aba="'+acao[0]+'">'+acao[1]+' →</button>':'<span class="fe-ok-txt">'+(ok?"Pronto":"")+'</span>')+'</div>';
  const semAssin=!p.assinatura;
  const itens=[
    [p.configurado,"Conta que envia",p.configurado?"Os e-mails saem por "+esc(p.conta.email)+".":"Nenhuma conta pronta: até cadastrar, nenhum e-mail sai.",p.configurado?null:["conta","Cadastrar"]],
    [p.auto,"Envio automático",p.auto?"Ligado: "+esc(DIAS[ag.dia].toLowerCase())+" às "+horaTxt(ag.hora,ag.minuto)+".":"Desligado: o aviso só sai se você enviar na aba Enviar agora.",p.auto?null:["agenda","Ligar"]],
    [!semEmail,"E-mail dos supervisores",semEmail?semEmail+" área(s) sem e-mail: "+esc(p.areas.filter(a=>!a.email).map(a=>a.nome).join(", "))+".":"Todas as áreas têm e-mail cadastrado.",semEmail?["areas","Cadastrar"]:null],
    [p.copias.length>0,"Cópias",p.copias.length?p.copias.length+" pessoa(s) acompanham em cópia.":"Ninguém em cópia ainda.",p.copias.length?null:["dest","Incluir"]],
    [!!p.link,"Botão para o painel",p.link?"O e-mail leva o botão \"Abrir no Painel ServCamp\".":"Os e-mails saem sem o botão. Abra este painel pelo endereço oficial do sistema (https) para ele ser guardado.",null],
    [!p.semArea,"Faltas com supervisor",p.semArea?p.semArea+" falta(s) da semana vieram sem área na planilha e não têm para quem ir.":"Todas as faltas da semana têm supervisor.",null],
    [!semAssin,"Assinatura",semAssin?"Sem imagem: o e-mail termina no cartão, sem assinatura.":"Imagem cadastrada, entra no fim do e-mail.",semAssin?["conta","Enviar imagem"]:null]
  ];
  const prontos=itens.filter(x=>x[0]).length,pp=Math.round(100*prontos/itens.length);
  const pronto='<div class="fe-sec">'+cab("geral","Está tudo pronto?","O que precisa estar em ordem para o aviso sair certo. Os itens em amarelo pedem atenção.",
      '<div class="fe-anel" style="--p:'+pp+'" role="img" aria-label="'+prontos+' de '+itens.length+' prontos"><b>'+prontos+'<i>/'+itens.length+'</i></b></div>')+
    '<div class="fe-pronto">'+itens.sort((a,b)=>(a[0]?1:0)-(b[0]?1:0)).map(x=>item(x[0],x[1],x[2],x[3])).join("")+'</div></div>';
  return '<div class="fe-hero">'+ticket+kpis+'</div>'+pronto+fluxo;
}

/* Envio automático em três passos: ligar → dia → hora, e a confirmação em português claro antes de salvar. */
function secAgenda(p){
  const a=FE.ag||(FE.ag={dia:p.agenda.dia,hora:p.agenda.hora,minuto:p.agenda.minuto||0}),salvo=p.agenda,mudou=a.dia!==salvo.dia||a.hora!==salvo.hora||(a.minuto||0)!==(salvo.minuto||0);
  const pr=proximo(p,a),MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const passo=(n,tit,sub,ok,corpo)=>'<section class="fe-sec fe-passo"><div class="fe-passo-h"><span class="fe-passo-n'+(ok?" ok":"")+'">'+(ok?"✓":n)+'</span><div><small>Passo '+n+'</small><b>'+tit+'</b><span class="fe-mut">'+sub+'</span></div></div>'+corpo+'</section>';
  const liga='<label class="fe-sw fe-sw-lg"><input type="checkbox" data-fe="auto"'+(p.auto?" checked":"")+'><span><b>'+(p.auto?"Ligado":"Desligado")+'</b><small>'+(p.auto?"O aviso sai sozinho toda semana, no dia e na hora abaixo.":"Nada sai sozinho. Você ainda pode enviar pela aba Enviar agora.")+'</small></span></label>';
  const dias=DIAS_C.map((c,i)=>{
    const prox=proximo(p,{dia:i,hora:a.hora,minuto:a.minuto}).dia;
    return '<button type="button" class="fe-dia'+(i===a.dia?" on":"")+'" data-fe="ag-dia" data-dia="'+i+'" aria-pressed="'+(i===a.dia)+'" title="'+esc(DIAS[i])+', próximo dia '+esc(dma(prox))+'"><small>'+c+'</small><b>'+prox.slice(8,10)+'</b><em>'+MES[Number(prox.slice(5,7))-1]+'</em></button>';
  }).join("");
  const h0=salvo.horas[0],h1=salvo.horas[1],mn=a.minuto||0;
  const ang=(a.hora%12+mn/60)*30,angM=mn*6,pt=(g,r)=>(60+r*Math.sin(g*Math.PI/180)).toFixed(1)+" "+(60-r*Math.cos(g*Math.PI/180)).toFixed(1);
  let marcas="";for(let i=0;i<12;i++){const g=i*30;marcas+='<line x1="'+pt(g,i%3===0?44:47).split(" ")[0]+'" y1="'+pt(g,i%3===0?44:47).split(" ")[1]+'" x2="'+pt(g,52).split(" ")[0]+'" y2="'+pt(g,52).split(" ")[1]+'" class="fe-rl-m'+(i%3===0?" g":"")+'"/>';}
  const svg='<svg class="fe-rl-svg" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" class="fe-rl-face"/>'+marcas+
    '<line x1="60" y1="60" x2="'+pt(ang,30).split(" ")[0]+'" y2="'+pt(ang,30).split(" ")[1]+'" class="fe-rl-h"/><line x1="60" y1="60" x2="'+pt(angM,44).split(" ")[0]+'" y2="'+pt(angM,44).split(" ")[1]+'" class="fe-rl-mn"/><circle cx="60" cy="60" r="3.5" class="fe-rl-c"/></svg>';
  const rapidos=[[8,0],[9,0],[10,0],[14,0],[16,0]].filter(x=>x[0]>=h0&&x[0]<=h1).map(x=>'<button type="button" class="fe-hr'+(x[0]===a.hora&&x[1]===mn?" on":"")+'" data-fe="ag-hora" data-hora="'+x[0]+'" data-minuto="'+x[1]+'">'+horaTxt(x[0],x[1])+'</button>').join("");
  const horas='<div class="fe-relogio">'+svg+'<div class="fe-rl-ctl"><label for="feRelogio" class="fe-eyebrow">Horário do envio (Brasília)</label>'+
    '<div class="fe-rl-in"><button type="button" class="fe-b sm" data-fe="ag-min" data-d="-1" aria-label="Um minuto antes">−1 min</button>'+
    '<input id="feRelogio" class="fe-in fe-rl-t" type="time" step="60" min="'+horaTxt(h0,0)+'" max="'+horaTxt(h1,59)+'" value="'+horaTxt(a.hora,mn)+'" data-fe="ag-relogio" required>'+
    '<button type="button" class="fe-b sm" data-fe="ag-min" data-d="1" aria-label="Um minuto depois">+1 min</button></div>'+
    '<div class="fe-rl-q"><span class="fe-mut">Atalhos</span>'+rapidos+'</div>'+
    '<p class="fe-mut" style="margin:10px 0 0">Digite qualquer horário, até o minuto (por exemplo 13:51), de '+horaTxt(h0,0)+' a '+horaTxt(h1,59)+'.</p></div></div>';
  const prox3=[0,7,14].map(k=>{const d=somaD(pr.dia,k),s=semanaDo(d);return'<li><b>'+esc(DIAS_C[diaDe(d)])+' '+esc(dmCurto(d))+' · '+horaTxt(a.hora,a.minuto)+'</b><span>cobre '+esc(dmCurto(s.ini))+' a '+esc(dmCurto(s.fim))+'</span></li>';}).join("");
  const frase='<div class="fe-frase"><span class="fe-eyebrow">Como vai ficar</span><p>'+(p.auto?'Toda <b>'+esc(DIAS[a.dia].toLowerCase())+'</b>, às <b>'+horaTxt(a.hora,a.minuto)+'</b>, cada supervisor recebe por e-mail as faltas injustificadas da semana anterior, de segunda a domingo.':'O envio automático está <b>desligado</b>. Quando ligar, o aviso vai sair toda <b>'+esc(DIAS[a.dia].toLowerCase())+'</b>, às <b>'+horaTxt(a.hora,a.minuto)+'</b>.')+'</p>'+
    '<span class="fe-eyebrow" style="margin-top:14px">Próximos envios</span><ol class="fe-prox">'+prox3+'</ol></div>';
  const faq='<details class="fe-faq"><summary>Dúvidas comuns sobre o envio automático</summary>'+
    '<div><b>E se o servidor de e-mail falhar?</b><span>A cada hora, no mesmo dia, o sistema tenta de novo e envia só o que ficou para trás.</span></div>'+
    '<div><b>O supervisor pode receber o mesmo aviso duas vezes?</b><span>Não. Área que já recebeu o aviso da semana não recebe de novo, mesmo que alguém clique em enviar.</span></div>'+
    '<div><b>O e-mail sai exatamente no minuto escolhido?</b><span>Sai na primeira verificação do sistema depois do horário. A verificação padrão (Vercel gratuita) acontece uma vez por hora; com a verificação a cada 5 minutos ativada (ver docs/envio-por-minuto.md), o atraso fica em poucos minutos.</span></div>'+
    '<div><b>Qual semana vai no e-mail?</b><span>Sempre a semana anterior completa, de segunda a domingo, já sem abonos, afastamentos e demitidos.</span></div></details>';
  const barra=mudou?'<div class="fe-salvar" role="region" aria-label="Alteração não salva"><div><b>Você mudou o agendamento</b><span>De '+esc(DIAS_C[salvo.dia].toLowerCase())+' às '+horaTxt(salvo.hora,salvo.minuto)+' para '+esc(DIAS_C[a.dia].toLowerCase())+' às '+horaTxt(a.hora,a.minuto)+'. Ainda não está salvo.</span></div>'+
    '<button type="button" class="fe-b" data-fe="ag-descartar">Descartar</button><button type="button" class="fe-b fe-pri" data-fe="ag-salvar"'+(FE.ocupado?" disabled":"")+'>'+(FE.ocupado?"Salvando…":"Salvar agendamento")+'</button></div>':'';
  return '<div class="fe-agenda"><div class="fe-agenda-l">'+
      passo(1,"Ligue o envio automático","Ligado, o aviso sai sozinho toda semana. Desligado, só sai quando você enviar.",p.auto,liga)+
      passo(2,"Escolha o dia da semana","Embaixo de cada dia está a data do próximo envio, se você escolher aquele dia.",true,'<div class="fe-dias" role="group" aria-label="Dia da semana">'+dias+'</div>')+
      passo(3,"Acerte o relógio","Escolha o horário exato do envio, com hora e minuto.",true,horas)+
    '</div><aside class="fe-agenda-r"><div class="fe-sec fe-resumo-ag">'+frase+(mudou?'':'<div class="fe-salvo">✓ Salvo</div>')+'</div>'+faq+'</aside></div>'+barra;
}

/* Enviar agora e testar: um só fluxo em 3 passos. O modo (aviso oficial ou teste) só muda QUEM recebe;
   as áreas, o período e a prévia são os mesmos nos dois. */
function envInicial(p){
  return{modo:"oficial",areas:new Set(FE.sel?[...FE.sel]:p.areas.filter(a=>a.email&&a.status!=="ENVIADO").map(a=>a.area)),de:p.semana.inicio,ate:p.semana.fim,
    eu:false,cc:new Set(p.copias.filter(c=>/jussilene/i.test(c.nome+" "+c.email)).map(c=>c.email)),outro:"",prev:"",conf:false};
}
const envPode=(e,a)=>e.modo!=="oficial"||(!!a.email&&a.status!=="ENVIADO"); // no oficial: só quem tem e-mail e ainda não recebeu
function envSel(p,e){return p.areas.filter(a=>e.areas.has(a.area)&&envPode(e,a));}
function envDestinos(p,e){
  const d=[];
  if(e.eu)d.push(p.conta&&p.conta.email||"a conta de envio");
  p.copias.filter(c=>e.cc.has(c.email)).forEach(c=>d.push(c.nome));
  String(e.outro||"").split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean).forEach(x=>d.push(x));
  return d;
}
function secEnviar(p){
  const e=FE.env||(FE.env=envInicial(p)),of=e.modo==="oficial",sel=envSel(p,e);
  const passo=(n,tit,sub,ok,corpo)=>'<section class="fe-sec fe-passo"><div class="fe-passo-h"><span class="fe-passo-n'+(ok?" ok":"")+'">'+(ok?"✓":n)+'</span><div><small>Passo '+n+'</small><b>'+tit+'</b><span class="fe-mut">'+sub+'</span></div></div>'+corpo+'</section>';
  const modos='<div class="fe-modos" role="group" aria-label="Tipo de envio">'+
    '<button type="button" class="fe-modo'+(of?" on":"")+'" data-fe="env-modo" data-modo="oficial" aria-pressed="'+of+'"><span class="fe-modo-ic">'+IC.envio+'</span><b>Aviso oficial</b><span>Sai para cada supervisor, com a semana da área dele. Conta como enviado e a área não recebe de novo.</span></button>'+
    '<button type="button" class="fe-modo'+(of?"":" on")+'" data-fe="env-modo" data-modo="teste" aria-pressed="'+(!of)+'"><span class="fe-modo-ic">'+IC.prev+'</span><b>Teste</b><span>Só para quem você escolher (a coordenação, por exemplo). Nenhum supervisor é avisado e nada conta como enviado.</span></button></div>';
  const chips=p.areas.map(a=>{
    const ok=envPode(e,a),nota=!ok?(a.status==="ENVIADO"?"já recebeu":"sem e-mail"):a.faltas+(a.faltas===1?" falta":" faltas");
    return '<label class="fe-chip'+(ok?"":" off")+'"><input type="checkbox" data-fe="env-area" data-area="'+esc(a.area)+'"'+(e.areas.has(a.area)&&ok?" checked":"")+(ok?"":" disabled")+'> <b>'+esc(a.nome)+'</b> <span class="fe-mut">'+nota+'</span></label>';
  }).join("");
  const periodo=of?'<p class="fe-mut" style="margin:14px 0 0">Período: <b>'+esc(dma(p.semana.inicio))+' a '+esc(dma(p.semana.fim))+'</b> (a semana anterior, de segunda a domingo).</p>':
    '<div class="fe-grade" style="margin-top:14px;max-width:460px"><div><label for="feEnvDe">De</label><input id="feEnvDe" class="fe-in" type="date" data-fe-campo="env.de" value="'+esc(e.de)+'"></div><div><label for="feEnvAte">Até</label><input id="feEnvAte" class="fe-in" type="date" data-fe-campo="env.ate" value="'+esc(e.ate)+'"></div></div><p class="fe-mut" style="margin:8px 0 0">Até 31 dias.</p>';
  const p1=passo(1,"Qual envio e de quais áreas?","Escolha o tipo de envio e marque quantas áreas quiser.",sel.length>0,modos+
    '<div class="fe-ta-h" style="margin-top:18px"><p class="fe-eyebrow" style="margin:0">Áreas ('+sel.length+' marcadas de '+p.areas.filter(a=>envPode(e,a)).length+')</p><span><button type="button" class="fe-b sm" data-fe="env-todas">Marcar todas</button> <button type="button" class="fe-b sm" data-fe="env-comfaltas">Só com faltas</button> <button type="button" class="fe-b sm" data-fe="env-nenhuma">Limpar</button></span></div><div class="fe-chips">'+chips+'</div>'+periodo);
  const ccOficial=p.copias.map(c=>'<label class="fe-chip"><input type="checkbox" data-fe="cc" data-email="'+esc(c.email)+'"'+(FE.cc.has(c.email)?" checked":"")+'> <b>'+esc(c.nome)+'</b> <span class="fe-mut">'+esc(c.email)+'</span></label>').join("");
  const ccTeste='<label class="fe-chip"><input type="checkbox" data-fe="env-eu"'+(e.eu?" checked":"")+'> <b>Eu</b> <span class="fe-mut">'+esc(p.conta&&p.conta.email||"a conta de envio")+'</span></label>'+
    p.copias.map(c=>'<label class="fe-chip"><input type="checkbox" data-fe="env-cc" data-email="'+esc(c.email)+'"'+(e.cc.has(c.email)?" checked":"")+'> <b>'+esc(c.nome)+'</b> <span class="fe-mut">'+esc(c.email)+'</span></label>').join("");
  const dest=envDestinos(p,e),ccN=p.copias.filter(c=>FE.cc.has(c.email));
  const p2=of?
    passo(2,"Quem recebe cópia?","Cada supervisor recebe o e-mail da própria área. Marque quem acompanha em cópia, ou desmarque para este envio.",true,
      (p.copias.length?'<div class="fe-chips">'+ccOficial+'</div>':'<p class="fe-mut" style="margin:0">Ninguém em cópia. Cadastre na aba Cópias.</p>')):
    passo(2,"Para quem vai o teste?","Marque quem recebe um e-mail por área. Pode incluir qualquer endereço.",dest.length>0,
      '<div class="fe-chips">'+ccTeste+'</div><div class="fe-linha"><input class="fe-in l" type="text" inputmode="email" autocomplete="off" data-fe-campo="env.outro" placeholder="Outros e-mails (opcional; separe por vírgula)" value="'+esc(e.outro)+'"></div>');
  const prontoEnviar=p.configurado&&sel.length&&(of||dest.length);
  const resumo=of?sel.length+(sel.length===1?" e-mail":" e-mails")+', um para cada supervisor'+(ccN.length?", com "+ccN.map(c=>esc(c.nome)).join(", ")+" em cópia":", sem cópia")+".":
    sel.length+(sel.length===1?" e-mail":" e-mails")+' de teste para '+(dest.length?dest.map(esc).join(", "):"ninguém ainda")+".";
  const prev=e.prev&&sel.some(a=>a.area===e.prev)?e.prev:(sel[0]&&sel[0].area)||"";
  let p3='<div class="fe-resumo-env"><span class="fe-eyebrow">Vai sair</span><p>'+resumo+'</p></div>';
  if(e.conf&&prontoEnviar){
    p3+='<div class="fe-conf"><b>'+(of?"Confirma o envio oficial?":"Enviar o teste agora?")+'</b><ul>'+sel.map(a=>'<li>'+esc(a.nome)+(of?' → '+esc(a.email):'')+' · '+a.faltas+' falta(s)</li>').join("")+'</ul>'+
      '<div class="fe-linha"><button class="fe-b fe-pri" data-fe="env-confirmar"'+(FE.ocupado?" disabled":"")+'>'+(FE.ocupado?"Enviando…":"Enviar agora")+'</button><button class="fe-b" data-fe="env-voltar"'+(FE.ocupado?" disabled":"")+'>Voltar</button></div></div>';
  }else{
    p3+='<div class="fe-linha"><select class="fe-in" data-fe-campo="env.prev" aria-label="Área da prévia"'+(sel.length?"":" disabled")+'>'+sel.map(a=>'<option value="'+esc(a.area)+'"'+(a.area===prev?" selected":"")+'>Prévia: '+esc(a.nome)+'</option>').join("")+'</select>'+
      '<button type="button" class="fe-b" data-fe="env-previa"'+(sel.length?"":" disabled")+'>'+IC.prev+'Ver prévia</button><span style="flex:1"></span>'+
      '<button type="button" class="fe-b fe-pri" data-fe="env-enviar"'+(prontoEnviar&&!FE.ocupado?"":" disabled")+'>'+IC.enviar+(of?"Enviar o aviso oficial":"Enviar o teste")+'</button></div>'+
      (!p.configurado?'<p class="fe-falta-env">Cadastre a conta de envio na aba Conta e assinatura.</p>':!sel.length?'<p class="fe-falta-env">Marque ao menos uma área no passo 1.</p>':(!of&&!dest.length)?'<p class="fe-falta-env">Escolha ao menos um destinatário no passo 2.</p>':'');
  }
  return p1+p2+passo(3,"Conferir e enviar","Veja a prévia do e-mail de uma das áreas e confirme.",false,p3);
}

function secConta(p){
  const c=p.conta,f=FE.conta;
  let h='<div class="fe-sec">'+cab("conta","Conta que envia os e-mails","É o remetente que o supervisor vê. Quando ele clicar em Responder, a resposta volta para esta conta, com as cópias junto.");
  if(c&&c.ilegivel&&!f)h+='<div class="fe-alerta" style="margin:0 0 8px">A senha guardada não pode mais ser lida (a chave de login do sistema mudou). Cadastre a conta de novo.</div>';
  if(f){
    return h+'<div class="fe-grade">'+
      '<div><label for="feCEmail">E-mail da conta</label><input id="feCEmail" class="fe-in" type="email" autocomplete="username" maxlength="120" data-fe-campo="conta.email" value="'+esc(f.email)+'"></div>'+
      '<div><label for="feCSenha">Senha</label><input id="feCSenha" class="fe-in" type="password" autocomplete="new-password" maxlength="200" data-fe-campo="conta.senha" value="'+esc(f.senha)+'"></div>'+
      '<div><label for="feCHost">Servidor</label><input id="feCHost" class="fe-in" maxlength="100" data-fe-campo="conta.host" value="'+esc(f.host)+'"></div>'+
      '<div><label for="feCPorta">Porta</label><select id="feCPorta" class="fe-in" data-fe-campo="conta.port"><option value="465"'+(String(f.port)==="465"?" selected":"")+'>465 (SSL)</option><option value="587"'+(String(f.port)==="587"?" selected":"")+'>587 (TLS)</option></select></div>'+
    '</div>'+
    '<p class="fe-mut" style="margin:8px 0 0">Antes de guardar, o sistema entra na conta para conferir (nada é enviado). A senha fica criptografada e não aparece mais aqui.</p>'+
    '<div class="fe-linha"><button class="fe-b fe-pri" data-fe="salvar-conta"'+(FE.ocupado?" disabled":"")+'>'+(FE.ocupado?"Conferindo…":"Salvar e conferir")+'</button><button class="fe-b" data-fe="cancelar-conta"'+(FE.ocupado?" disabled":"")+'>Cancelar</button></div></div>';
  }
  if(c&&c.origem==="vercel")return h+'<p style="margin:0">Enviando por <b>'+esc(c.email)+'</b> <span class="fe-mut">(configurada na Vercel)</span></p></div>';
  if(c)return h+'<div class="fe-linha" style="margin-top:0"><span>Enviando por <b>'+esc(c.email)+'</b> <span class="fe-mut">· '+esc(c.host)+':'+c.port+(c.em?' · cadastrada em '+esc(quando(c.em)):'')+'</span></span><span style="flex:1"></span><button class="fe-b sm" data-fe="editar-conta">Trocar conta</button></div></div>';
  return h+'<div class="fe-linha" style="margin-top:0"><span class="fe-mut">Nenhuma conta cadastrada.</span><button class="fe-b sm fe-pri" data-fe="editar-conta">Cadastrar conta</button></div></div>';
}

function secAssinatura(p){
  const a=p.assinatura;
  const kb=n=>Math.max(1,Math.round((Number(n)||0)/1024))+" KB";
  return '<div class="fe-sec">'+cab("edit","Assinatura no fim do e-mail","Uma imagem (PNG ou JPG) que fecha o e-mail, no lugar de qualquer texto de despedida. Imagem grande é reduzida sozinha.")+
    (a?'<img src="'+esc(a.src)+'" alt="Assinatura atual" style="display:block;max-width:100%;height:auto;border:1px solid var(--fe-ln);border-radius:8px">'+
      '<p class="fe-mut" style="margin:6px 0 0">'+a.largura+' × '+a.altura+' px · '+kb(a.bytes)+(a.em?' · enviada em '+esc(quando(a.em)):'')+'</p>'
      :'<p class="fe-mut" style="margin:0">Nenhuma assinatura cadastrada: o e-mail termina no cartão, sem despedida.</p>')+
    '<div class="fe-linha"><label class="fe-b sm" for="feAssArq" style="cursor:pointer">'+(a?"Trocar imagem":"Enviar imagem")+'</label>'+
    '<input id="feAssArq" type="file" accept="image/*" data-fe="ass-arquivo" style="display:none">'+
    (a?'<button class="fe-b sm" data-fe="ass-remover"'+(FE.ocupado?" disabled":"")+'>Remover</button>':'')+
    '<span class="fe-mut">PNG ou JPG de qualquer tamanho: imagem grande é reduzida sozinha.</span></div></div>';
}
// A assinatura vai em todo e-mail e o servidor aceita até 500 KB. Imagem maior, larga demais
// ou em outro formato que o navegador abra é reduzida aqui, sem pedir nada a ninguém: no
// e-mail ela aparece com até 600 px, então 1200 px (o dobro, para tela de alta resolução) basta.
const ASS_MAX_BYTES=450*1024,ASS_MAX_LARGURA=1200;
function bytesDe(dataUrl){const b=dataUrl.slice(dataUrl.indexOf(",")+1);return Math.floor(b.length*3/4)-(b.endsWith("==")?2:b.endsWith("=")?1:0);}
function reduzirAssinatura(img){
  for(const limite of [ASS_MAX_LARGURA,1000,800,600]){
    const w=Math.min(limite,img.naturalWidth),h=Math.max(1,Math.round(img.naturalHeight*w/img.naturalWidth));
    const c=document.createElement("canvas");c.width=w;c.height=h;
    const g=c.getContext("2d");
    g.fillStyle="#ffffff";g.fillRect(0,0,w,h); // fundo branco, como o do e-mail (o JPG não tem transparência)
    g.imageSmoothingQuality="high";g.drawImage(img,0,0,w,h);
    const png=c.toDataURL("image/png");
    if(bytesDe(png)<=ASS_MAX_BYTES)return{dados:png,largura:w,altura:h};
    for(const q of [0.92,0.85,0.75]){const jpg=c.toDataURL("image/jpeg",q);if(bytesDe(jpg)<=ASS_MAX_BYTES)return{dados:jpg,largura:w,altura:h};}
  }
  return null;
}
// Lê a imagem escolhida, reduz se precisar e manda para o servidor com a largura e a altura finais.
function enviarAssinatura(arq){
  if(!arq)return;
  if(!/^image\//.test(arq.type)){msg("er","Escolha um arquivo de imagem (PNG ou JPG).");render();return;}
  const leitor=new FileReader();
  leitor.onload=function(){
    const img=new Image();
    img.onload=function(){
      const original=leitor.result;
      const pronta=/^data:image\/(png|jpeg);/.test(original)&&bytesDe(original)<=ASS_MAX_BYTES&&img.naturalWidth<=ASS_MAX_LARGURA;
      const r=pronta?{dados:original,largura:img.naturalWidth,altura:img.naturalHeight}:reduzirAssinatura(img);
      if(!r){msg("er","Não consegui reduzir essa imagem. Salve a assinatura como PNG ou JPG e tente de novo.");render();return;}
      const ajuste=pronta?"":" (reduzida para "+r.largura+" × "+r.altura+" px, "+Math.round(bytesDe(r.dados)/1024)+" KB)";
      acao(()=>api("assinatura","POST",{imagem:r.dados,largura:r.largura,altura:r.altura}),"Assinatura salva"+ajuste+". Ela já entra nos próximos e-mails.",true);
    };
    img.onerror=function(){msg("er","Não deu para abrir essa imagem aqui. Salve a assinatura como PNG ou JPG e tente de novo.");render();};
    img.src=leitor.result;
  };
  leitor.readAsDataURL(arq);
}

function secAreas(p){
  const linhas=p.areas.map(function(a){
    const ed=FE.edit&&FE.edit.area===a.area;
    const pode=!!a.email&&a.status!=="ENVIADO";
    const st='<span class="fe-st '+a.status+'">'+STATUS[a.status]+'</span>'+
      (a.enviado?'<span class="fe-sub">'+esc(quando(a.enviado.em))+' · '+(a.enviado.origem==="auto"?"automático":"manual")+'</span>':'')+
      (a.falha?'<span class="fe-sub" title="'+esc(a.falha.erro)+'">última tentativa '+esc(quando(a.falha.em))+'</span>':'');
    if(ed)return '<tr><td></td><td><b>'+esc(a.nome)+'</b></td>'+
      '<td><input class="fe-in" data-fe-campo="edit.saudacao" maxlength="60" placeholder="'+esc(a.nome)+'" value="'+esc(FE.edit.saudacao)+'"></td>'+
      '<td><input class="fe-in" data-fe-campo="edit.email" type="email" maxlength="120" placeholder="supervisor@gruposervcamp.com.br" value="'+esc(FE.edit.email)+'"></td>'+
      '<td>'+a.faltas+'</td><td>'+st+'</td>'+
      '<td style="white-space:nowrap"><button class="fe-b sm fe-pri" data-fe="salvar-area"'+(FE.ocupado?" disabled":"")+'>Salvar</button> <button class="fe-b sm" data-fe="cancelar-area">Cancelar</button></td></tr>';
    return '<tr><td><input type="checkbox" data-fe="sel" data-area="'+esc(a.area)+'"'+(FE.sel.has(a.area)?" checked":"")+(pode?"":" disabled")+' aria-label="Incluir '+esc(a.nome)+'"></td>'+
      '<td><div class="fe-quem"><span class="fe-av" aria-hidden="true">'+esc(iniciais(a.nome))+'</span><b>'+esc(a.nome)+'</b></div></td>'+
      '<td>'+esc(a.saudacao||a.nome)+(a.saudacao?'':'<span class="fe-sub">nome da área</span>')+'</td>'+
      '<td>'+(a.email?esc(a.email):'<span class="fe-mut">—</span>')+'</td>'+
      '<td><span class="fe-num">'+a.faltas+'</span>'+(a.faltas?'<span class="fe-sub">'+a.colaboradores+' colaborador(es)</span>':'')+'</td>'+
      '<td>'+st+'</td>'+
      '<td style="white-space:nowrap"><button class="fe-b sm'+(a.email?" ic":"")+'" data-fe="editar-area" data-area="'+esc(a.area)+'" title="'+(a.email?"Editar e-mail e saudação":"Cadastrar o e-mail do supervisor")+'" aria-label="'+(a.email?"Editar ":"Cadastrar e-mail de ")+esc(a.nome)+'">'+IC.edit+(a.email?"":"Cadastrar e-mail")+'</button> <button class="fe-b sm ic" data-fe="previa" data-area="'+esc(a.area)+'" title="Ver a prévia do e-mail" aria-label="Prévia do e-mail de '+esc(a.nome)+'">'+IC.prev+'</button></td></tr>';
  }).join("");
  return '<div class="fe-sec">'+cab("areas","Para quem vai o aviso de cada área","A caixa marcada inclui a área no próximo envio manual. O e-mail cadastrado aqui vale também para o relatório de hora extra.")+
    '<div class="fe-legenda"><span class="fe-st ENVIADO">Enviado</span> já recebeu nesta semana <span class="fe-st PENDENTE">Pendente</span> ainda vai receber <span class="fe-st SEM_EMAIL">Sem e-mail</span> não recebe até cadastrar</div>'+
    (p.areas.length?'<div class="fe-tab-w"><table class="fe-tab"><thead><tr><th><span class="fe-vh">Incluir</span></th><th>Área</th><th>Como chamar ("Olá, …")</th><th>E-mail do supervisor</th><th>Faltas na semana</th><th>Situação</th><th><span class="fe-vh">Ações</span></th></tr></thead><tbody>'+linhas+'</tbody></table></div>'
      :'<p class="fe-mut">Nenhuma área nas planilhas recentes.</p>')+'</div>';
}

function secCopias(p){
  if(FE.copias){
    const l=FE.copias.map(function(c,i){
      return '<div class="fe-linha"><input class="fe-in" style="flex:0 1 200px" data-fe-campo="copias.'+i+'.nome" maxlength="60" placeholder="Nome" value="'+esc(c.nome)+'">'+
        '<input class="fe-in l" type="email" data-fe-campo="copias.'+i+'.email" maxlength="120" placeholder="email@gruposervcamp.com.br" value="'+esc(c.email)+'">'+
        '<button class="fe-b sm" data-fe="rm-copia" data-i="'+i+'" aria-label="Remover">Remover</button></div>';
    }).join("");
    return '<div class="fe-sec">'+cab("dest","Quem vai em cópia","Nome e e-mail de cada pessoa. Elas recebem uma cópia de todos os avisos dos supervisores.")+l+
      '<div class="fe-linha"><button class="fe-b sm" data-fe="add-copia">+ Adicionar</button><span style="flex:1"></span><button class="fe-b sm" data-fe="cancelar-copias">Cancelar</button><button class="fe-b sm fe-pri" data-fe="salvar-copias"'+(FE.ocupado?" disabled":"")+'>Salvar cópias</button></div></div>';
  }
  const chips=p.copias.map(c=>'<label class="fe-chip"><input type="checkbox" data-fe="cc" data-email="'+esc(c.email)+'"'+(FE.cc.has(c.email)?" checked":"")+'> <b>'+esc(c.nome)+'</b> <span class="fe-mut">'+esc(c.email)+'</span></label>').join("");
  return '<div class="fe-sec">'+cab("dest","Quem vai em cópia","Recebem uma cópia do aviso de cada supervisor. No envio automático vai a lista inteira; no envio manual você pode desmarcar alguém.",'<button class="fe-b sm" data-fe="editar-copias">'+IC.edit+'Editar lista</button>')+
    (p.copias.length?'<div class="fe-chips">'+chips+'</div><p class="fe-mut" style="margin:8px 0 0">Desmarque para tirar alguém da cópia neste envio. O automático sempre usa a lista inteira.</p>'
      :'<p class="fe-mut">Ninguém em cópia ainda. Clique em "Editar lista" para incluir.</p>')+'</div>';
}


/* Resumo semanal das medidas disciplinares para a coordenação: um e-mail só, com o que foi gerado no
   painel e ainda não está no SAR2G, por supervisor. Sai junto com o aviso das áreas (automático). */
function secResumo(p){
  const r=p.resumo||{ligado:false,para:[]},ed=FE.rs;
  let h='<div class="fe-sec">'+cab("hist","Resumo semanal para a coordenação","Um e-mail só, com as medidas que os supervisores geraram no painel e ainda não estão no SAR2G. Sai junto com o aviso automático.");
  if(ed){
    h+=ed.map(function(c,i){
      return '<div class="fe-linha"><input class="fe-in" style="flex:0 1 200px" data-fe-campo="rs.'+i+'.nome" maxlength="60" placeholder="Nome" value="'+esc(c.nome)+'">'+
        '<input class="fe-in l" type="email" data-fe-campo="rs.'+i+'.email" maxlength="120" placeholder="email@gruposervcamp.com.br" value="'+esc(c.email)+'">'+
        '<button class="fe-b sm" data-fe="rs-rm" data-i="'+i+'">Remover</button></div>';
    }).join("");
    return h+'<div class="fe-linha"><button class="fe-b sm" data-fe="rs-add">+ Adicionar</button><span style="flex:1"></span><button class="fe-b sm" data-fe="rs-cancelar">Cancelar</button><button class="fe-b sm fe-pri" data-fe="rs-salvar"'+(FE.ocupado?" disabled":"")+'>Salvar</button></div></div>';
  }
  const quem=r.para.length?r.para.map(c=>'<b>'+esc(c.nome)+'</b> <span class="fe-mut">'+esc(c.email)+'</span>').join(" · "):'<span class="fe-mut">Ninguém cadastrado.</span>';
  const st=r.enviado?'<span class="fe-st ENVIADO">Enviado</span> <span class="fe-mut">'+esc(quando(r.enviado.em))+' · '+(r.enviado.origem==="auto"?"automático":"manual")+' · '+r.enviado.qtd+' pendente(s)</span>'
    :r.falha?'<span class="fe-st FALHOU">Falhou</span> <span class="fe-mut" title="'+esc(r.falha.erro)+'">'+esc(quando(r.falha.em))+'</span>'
    :'<span class="fe-st PENDENTE">Não enviado nesta semana</span>';
  h+='<div class="fe-linha" style="margin-top:0"><span>Para: '+quem+'</span><span style="flex:1"></span><button class="fe-b sm" data-fe="rs-editar">'+(r.para.length?"Editar":"Cadastrar")+'</button></div>'+
    '<div class="fe-linha"><label class="fe-sw"><input type="checkbox" data-fe="rs-ligado"'+(r.ligado?" checked":"")+(r.para.length?"":" disabled")+'> '+(r.ligado?"Ligado: sai junto com o aviso automático":"Desligado")+'</label></div>'+
    '<div class="fe-linha"><span>Semana de '+esc(dma(p.semana.inicio))+' a '+esc(dma(p.semana.fim))+': '+st+'</span></div>';
  if(FE.rsConf)h+='<div class="fe-conf"><b>Enviar o resumo desta semana agora?</b><p class="fe-mut" style="margin:6px 0 0">Para: '+esc(r.para.map(c=>c.nome).join(", "))+'. Se já foi enviado nesta semana, não sai de novo.</p>'+
    '<div class="fe-linha"><button class="fe-b fe-pri" data-fe="rs-confirmar"'+(FE.ocupado?" disabled":"")+'>'+(FE.ocupado?"Enviando…":"Enviar agora")+'</button><button class="fe-b" data-fe="rs-voltar"'+(FE.ocupado?" disabled":"")+'>Voltar</button></div></div>';
  else h+='<div class="fe-linha"><button class="fe-b" data-fe="rs-previa">Ver prévia</button><button class="fe-b" data-fe="rs-teste"'+(FE.ocupado||!p.configurado?" disabled":"")+'>Enviar teste para mim</button>'+
    '<button class="fe-b fe-pri" data-fe="rs-enviar"'+(r.para.length&&p.configurado&&!r.enviado?"":" disabled")+'>Enviar o resumo da semana</button></div>';
  return h+'</div>';
}
async function previaResumo(){
  janela("fePrevia","Prévia do resumo","Nada é enviado",'<p class="fe-mut">Montando o e-mail…</p>',true);
  try{
    const r=await api("previa_resumo");
    janela("fePrevia","Prévia do resumo",r.assunto,'<p class="fe-mut" style="margin:0">Para: '+esc(r.para||"(ninguém cadastrado)")+'</p><iframe class="fe-previa" title="Prévia do resumo" sandbox="" referrerpolicy="no-referrer"></iframe>',true);
    const f=document.querySelector("#fePrevia iframe");if(f)f.srcdoc=r.html;
  }catch(e){janela("fePrevia","Prévia do resumo","",'<div class="fe-msg er">'+esc(e.message)+'</div>',true);}
}


function secHistorico(p){
  if(!p.historico||!p.historico.length)return '<div class="fe-vazio"><b>Nenhum envio ainda</b><span>Quando o primeiro aviso ou teste sair, ele aparece aqui.</span></div>';
  const l=p.historico.map(e=>'<tr><td>'+esc(quando(e.em))+'</td><td>'+(e.tipo==="TESTE"?"Teste":"Oficial · "+(e.origem==="auto"?"automático":"manual"))+'</td><td>'+esc(e.area)+'</td><td>'+(e.semana?esc(dma(e.semana))+(e.ate?" a "+esc(dma(e.ate)):""):"—")+'</td><td>'+e.qtd+'</td><td>'+(e.ok?'<span class="fe-st ENVIADO">ok</span>':'<span class="fe-st FALHOU">falhou</span>')+'</td></tr>').join("");
  return '<div class="fe-sec">'+cab("hist","Últimos 30 envios","Do mais recente para o mais antigo. \"Falhou\" quer dizer que o servidor de e-mail não confirmou: o automático tenta de novo na hora seguinte.")+'<div class="fe-tab-w"><table class="fe-tab"><thead><tr><th>Quando</th><th>Tipo</th><th>Área</th><th>Período</th><th>Faltas</th><th></th></tr></thead><tbody>'+l+'</tbody></table></div></div>';
}

/* ── prévia ──────────────────────────────────────────────────────────── */
async function previa(area,de,ate,teste){
  janela("fePrevia","Prévia do e-mail","Nada é enviado",'<p class="fe-mut">Montando o e-mail…</p>',true);
  try{
    const qs="&area="+encodeURIComponent(area)+(de?"&de="+encodeURIComponent(de):"")+(ate?"&ate="+encodeURIComponent(ate):"")+(teste?"&teste=1":"");
    const r=await api("previa","GET",null,qs);
    janela("fePrevia","Prévia do e-mail",r.assunto,
      '<p class="fe-mut" style="margin:0">Para: '+esc(r.para||"(área sem e-mail)")+(r.cc&&r.cc.length?" · Cópia: "+esc(r.cc.join(", ")):"")+'</p>'+
      '<iframe class="fe-previa" title="Prévia do e-mail" sandbox="" referrerpolicy="no-referrer"></iframe>',true);
    const f=document.querySelector("#fePrevia iframe");
    if(f)f.srcdoc=r.html;
  }catch(e){janela("fePrevia","Prévia do e-mail","",'<div class="fe-msg er">'+esc(e.message)+'</div>',true);}
}

/* ── ações ───────────────────────────────────────────────────────────── */
async function acao(fn,okTexto,manter){
  FE.ocupado=true;render();
  try{const r=await fn();msg("ok",typeof okTexto==="function"?okTexto(r):okTexto);FE.ocupado=false;await carregar(manter!==false);}
  catch(e){FE.ocupado=false;msg("er",e.message);render();}
}
function resumoEnvio(r){
  const p=[];
  p.push(r.enviados+" e-mail(s) enviado(s)");
  if(r.semFaltas)p.push(r.semFaltas+" sem faltas no período");
  if(r.jaEnviados)p.push(r.jaEnviados+" já tinha(m) sido enviado(s)");
  if(r.emAndamento)p.push(r.emAndamento+" em andamento por outro envio");
  if(r.falhas)p.push(r.falhas+" falha(s): tente de novo em instantes");
  if(r.semEmail&&r.semEmail.length)p.push("sem e-mail: "+r.semEmail.join(", "));
  return p.join(" · ")+".";
}
function clique(e){
  const b=e.target.closest("[data-fe]");
  if(!b||b.tagName==="INPUT")return;
  const q=b.getAttribute("data-fe"),area=b.getAttribute("data-area");
  const p=FE.p;
  if(q==="fechar"){fechar(b.getAttribute("data-id"));return;}
  if(!p)return;
  if(q==="toast-x"){FE.msg=null;const el=document.querySelector("#feJanela .fe-toast");if(el)el.remove();return;}
  if(q==="aba"){FE.aba=b.getAttribute("data-aba");FE.msg=null;FE.animar=true;render();const m=document.querySelector("#feJanela .fe-main");if(m)m.scrollTop=0;return;}
  if(q==="ag-dia"){(FE.ag||(FE.ag={})).dia=Number(b.getAttribute("data-dia"));render();return;}
  if(q==="ag-hora"){const g=FE.ag||(FE.ag={});g.hora=Number(b.getAttribute("data-hora"));g.minuto=Number(b.getAttribute("data-minuto")||0);render();return;}
  if(q==="ag-min"){const g=FE.ag||(FE.ag={}),h1=p.agenda.horas;let v=g.hora*60+(g.minuto||0)+Number(b.getAttribute("data-d"));v=Math.max(h1[0]*60,Math.min(h1[1]*60+59,v));g.hora=Math.floor(v/60);g.minuto=v%60;render();return;}
  if(q==="ag-descartar"){FE.ag={dia:p.agenda.dia,hora:p.agenda.hora,minuto:p.agenda.minuto||0};render();return;}
  if(q==="ag-salvar"){const a=FE.ag;acao(()=>api("agenda","POST",{dia:a.dia,hora:a.hora,minuto:a.minuto||0}),()=>"Agendamento salvo: "+DIAS[a.dia].toLowerCase()+" às "+horaTxt(a.hora,a.minuto)+".",true);return;}
  if(q.startsWith("env-")){envClique(q,b);return;}
  if(q==="editar-area"){const a=p.areas.find(x=>x.area===area);if(a){FE.edit={area:a.area,email:a.email||"",saudacao:a.saudacao||""};render();}return;}
  if(q==="cancelar-area"){FE.edit=null;render();return;}
  if(q==="salvar-area"){const ed=FE.edit;acao(()=>api("area","POST",{area:ed.area,email:ed.email,saudacao:ed.saudacao}),"Área atualizada.",true).then(()=>{if(!FE.msg||FE.msg.tipo==="ok")FE.edit=null;render();});return;}
  if(q==="previa"){previa(area);return;}
  if(q==="ass-remover"){acao(()=>api("assinatura","POST",{imagem:null}),"Assinatura removida: o e-mail termina no cartão.",true);return;}
  if(q==="editar-conta"){const c=p.conta;FE.conta={email:c&&c.origem==="painel"?c.email:"",senha:"",host:c&&c.origem==="painel"?c.host:"email-ssl.com.br",port:c&&c.origem==="painel"?c.port:465};render();return;}
  if(q==="cancelar-conta"){FE.conta=null;render();return;}
  if(q==="salvar-conta"){
    const f=FE.conta;
    acao(()=>api("conta","POST",{email:f.email,senha:f.senha,host:f.host,port:Number(f.port)}),r=>"Conta conferida e salva: o aviso sai por "+r.conta.email+".",true)
      .then(()=>{if(FE.msg&&FE.msg.tipo==="ok"){FE.conta=null;render();}});
    return;
  }
  if(q==="editar-copias"){FE.copias=p.copias.map(c=>({nome:c.nome,email:c.email}));if(!FE.copias.length)FE.copias.push({nome:"",email:""});render();return;}
  if(q==="add-copia"){FE.copias.push({nome:"",email:""});render();return;}
  if(q==="rm-copia"){FE.copias.splice(Number(b.getAttribute("data-i")),1);render();return;}
  if(q==="cancelar-copias"){FE.copias=null;render();return;}
  if(q==="salvar-copias"){const l=FE.copias.filter(c=>String(c.email||"").trim());acao(()=>api("copias","POST",{copias:l}),"Lista de cópias salva.",false).then(()=>{if(FE.msg&&FE.msg.tipo==="ok"){FE.copias=null;render();}});return;}
  if(q==="rs-editar"){FE.rs=(p.resumo&&p.resumo.para||[]).map(c=>({nome:c.nome,email:c.email}));if(!FE.rs.length)FE.rs.push({nome:"",email:""});render();return;}
  if(q==="rs-add"){FE.rs.push({nome:"",email:""});render();return;}
  if(q==="rs-rm"){FE.rs.splice(Number(b.getAttribute("data-i")),1);render();return;}
  if(q==="rs-cancelar"){FE.rs=null;render();return;}
  if(q==="rs-salvar"){const l=FE.rs.filter(c=>String(c.email||"").trim());acao(()=>api("resumo","POST",{para:l,ligado:l.length?undefined:false}),"Quem recebe o resumo foi salvo.",true).then(()=>{if(FE.msg&&FE.msg.tipo==="ok"){FE.rs=null;render();}});return;}
  if(q==="rs-previa"){previaResumo();return;}
  if(q==="rs-teste"){acao(()=>api("resumo_teste","POST",{para:["@eu"]}),r=>"Teste do resumo enviado para você ("+r.pendentes+" medida(s) pendente(s) no SAR2G).",true);return;}
  if(q==="rs-enviar"){FE.rsConf=true;FE.msg=null;render();return;}
  if(q==="rs-voltar"){FE.rsConf=false;render();return;}
  if(q==="rs-confirmar"){acao(()=>api("resumo_enviar","POST",{confirmar:true}),r=>r.situacao==="JA_ENVIADO"?"O resumo desta semana já tinha sido enviado.":r.situacao==="EM_ANDAMENTO"?"Outro envio do resumo está em andamento.":"Resumo enviado ("+r.pendentes+" medida(s) pendente(s) no SAR2G).",true).then(()=>{FE.rsConf=false;render();});return;}
}
function envClique(q,b){
  const p=FE.p,e=FE.env;if(!e)return;
  if(q==="env-modo"){e.modo=b.getAttribute("data-modo");e.conf=false;FE.msg=null;render();return;}
  if(q==="env-todas"){e.areas=new Set(p.areas.filter(a=>envPode(e,a)).map(a=>a.area));e.conf=false;render();return;}
  if(q==="env-comfaltas"){e.areas=new Set(p.areas.filter(a=>envPode(e,a)&&a.faltas>0).map(a=>a.area));e.conf=false;render();return;}
  if(q==="env-nenhuma"){e.areas=new Set();e.conf=false;render();return;}
  if(q==="env-voltar"){e.conf=false;render();return;}
  if(q==="env-enviar"){e.conf=true;FE.msg=null;render();return;}
  if(q==="env-previa"){
    const sel=envSel(p,e),area=e.prev&&sel.some(a=>a.area===e.prev)?e.prev:(sel[0]&&sel[0].area);
    if(!area)return;
    if(e.modo==="oficial")previa(area);else previa(area,e.de,e.ate,true);
    return;
  }
  if(q==="env-confirmar"){
    const sel=envSel(p,e).map(a=>a.area);
    if(!sel.length)return;
    if(e.modo==="oficial"){
      acao(()=>api("enviar","POST",{areas:sel,copias:[...FE.cc],confirmar:true}),resumoEnvio,false).then(()=>{e.conf=false;render();});
      return;
    }
    const para=[];
    if(e.eu)para.push("@eu");
    e.cc.forEach(m=>para.push(m));
    String(e.outro||"").split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean).forEach(x=>para.push(x));
    acao(()=>api("teste_areas","POST",{de:e.de,ate:e.ate,para:para,areas:sel}),r=>r.enviados+" e-mail(s) de teste enviado(s), um por área"+(r.falhas?" · "+r.falhas+" falharam: tente de novo":"")+" · "+r.comFaltas+" com faltas no período."+(r.recusados&&r.recusados.length?" ATENÇÃO: o servidor recusou "+r.recusados.join(", ")+" (esses não receberam).":""),true).then(()=>{e.conf=false;render();});
  }
}
function envMudou(q,el){
  const e=FE.env;if(!e)return;
  if(q==="env-area"){const a=el.getAttribute("data-area");if(el.checked)e.areas.add(a);else e.areas.delete(a);}
  else if(q==="env-eu")e.eu=el.checked;
  else if(q==="env-cc"){const m=el.getAttribute("data-email");if(el.checked)e.cc.add(m);else e.cc.delete(m);}
  e.conf=false;render();
}
function mudou(e){
  const el=e.target,q=el.getAttribute("data-fe");
  if(q==="ag-relogio"){const m=/^(\d{2}):(\d{2})/.exec(el.value||""),h1=FE.p.agenda.horas;if(!m)return;let v=Number(m[1])*60+Number(m[2]);v=Math.max(h1[0]*60,Math.min(h1[1]*60+59,v));(FE.ag||(FE.ag={})).hora=Math.floor(v/60);FE.ag.minuto=v%60;render();return;}
  if(q==="ass-arquivo"){enviarAssinatura(el.files&&el.files[0]);return;}
  if(q==="rs-ligado"){const v=el.checked;acao(()=>api("resumo","POST",{ligado:v}),v?"Resumo da coordenação ligado: sai junto com o aviso automático.":"Resumo da coordenação desligado.",true);return;}
  if(q==="auto"){const v=el.checked,a=FE.p&&FE.p.agenda;acao(()=>api("auto","POST",{ligado:v}),v?"Envio automático ligado"+(a?": "+DIAS[a.dia].toLowerCase()+" às "+horaTxt(a.hora,a.minuto)+".":"."):"Envio automático desligado.",true);return;}
  if(q&&q.startsWith("env-")){envMudou(q,el);return;}
  if(q==="sel"){const a=el.getAttribute("data-area");if(el.checked)FE.sel.add(a);else FE.sel.delete(a);FE.env=null;render();return;}
  if(q==="cc"){const m=el.getAttribute("data-email");if(el.checked)FE.cc.add(m);else FE.cc.delete(m);if(FE.env)FE.env.conf=false;render();return;}
}
// Campos de texto: guarda no estado sem redesenhar (o cursor não pula).
function digitou(e){
  const c=e.target.getAttribute("data-fe-campo");
  if(!c)return;
  const v=e.target.value,p=c.split(".");
  if(p[0]==="edit"&&FE.edit)FE.edit[p[1]]=v;
  else if(p[0]==="env"&&FE.env){FE.env[p[1]]=v;if(p[1]!=="prev")FE.env.conf=false;}
  else if(p[0]==="conta"&&FE.conta)FE.conta[p[1]]=v;
  else if(p[0]==="copias"&&FE.copias&&FE.copias[Number(p[1])])FE.copias[Number(p[1])][p[2]]=v;
  else if(p[0]==="rs"&&FE.rs&&FE.rs[Number(p[1])])FE.rs[Number(p[1])][p[2]]=v;
}
})();
