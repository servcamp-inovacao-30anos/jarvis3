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
const FE={conta:null,p:null,sel:new Set(),cc:new Set(),edit:null,copias:null,confirmar:false,msg:null,ocupado:false,t:null,aba:"geral",ag:null,ta:null,taConf:false};
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
  FE.msg=null;FE.confirmar=false;FE.edit=null;FE.copias=null;FE.p=null;FE.rs=null;FE.rsConf=false;FE.aba="geral";FE.ag=null;FE.ta=null;FE.taConf=false;
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
    const prim=FE.p.areas.find(a=>a.email)||FE.p.areas[0];
    FE.t={area:prim?prim.area:"",de:FE.p.semana.inicio,ate:FE.p.semana.fim,eu:true,sup:false,cc:new Set(),outro:""};
    // teste de todas as áreas: já vem marcado quem acompanha pela coordenação (Jussilene), se estiver na lista de cópias
    FE.ta={de:FE.p.semana.inicio,ate:FE.p.semana.fim,eu:false,cc:new Set(FE.p.copias.filter(c=>/jussilene/i.test(c.nome+" "+c.email)).map(c=>c.email)),outro:""};
    FE.ag={dia:FE.p.agenda.dia,hora:FE.p.agenda.hora};
  }
  render();
}
function msg(tipo,t){FE.msg={tipo:tipo,t:t};}

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
const ABAS=[
  {k:"geral",rot:"Visão geral",ic:"geral",tit:"Visão geral",desc:"O que vai acontecer, o que já saiu e se está tudo pronto para o próximo envio."},
  {k:"agenda",rot:"Agendamento",ic:"agenda",tit:"Agendamento do envio automático",desc:"Escolha o dia da semana e a hora em que o aviso sai sozinho. Se alguma área falhar, o sistema tenta de novo a cada hora, no mesmo dia."},
  {k:"areas",rot:"Áreas e supervisores",ic:"areas",tit:"Áreas e supervisores",desc:"Quem recebe o aviso de cada área, como o supervisor é chamado no e-mail e a situação do envio desta semana."},
  {k:"dest",rot:"Destinatários",ic:"dest",tit:"Cópias e coordenação",desc:"Quem acompanha em cópia o aviso de cada supervisor e quem recebe o resumo semanal das medidas."},
  {k:"envio",rot:"Envio e testes",ic:"envio",tit:"Envio oficial e testes",desc:"Envie a semana agora, ou mande um teste com o conteúdo real para conferir o que cada supervisor recebe."},
  {k:"conta",rot:"Conta e assinatura",ic:"conta",tit:"Conta de envio e assinatura",desc:"A conta que envia os e-mails e a imagem de assinatura que fecha cada aviso."},
  {k:"hist",rot:"Histórico",ic:"hist",tit:"Últimos envios",desc:"Tudo o que saiu, oficial e teste, com o resultado de cada envio."}
];
const horaTxt=h=>String(h).padStart(2,"0")+":00";
// dias entre duas datas ISO
const difDias=(a,b)=>Math.round((Date.parse(b+"T12:00:00Z")-Date.parse(a+"T12:00:00Z"))/864e5);
const dmCurto=d=>{const s=String(d||"");return s.slice(8,10)+"/"+s.slice(5,7);};
const diaDe=d=>new Date(d+"T12:00:00Z").getUTCDay();
// próximo envio de uma escolha (dia, hora): hoje se ainda não chegou a hora, senão o próximo dia marcado
function proximo(p,ag){
  const horaAgora=new Date(Date.now()-3*3600000).getUTCHours();
  let n=(ag.dia-diaDe(p.hoje)+7)%7;if(n===0&&horaAgora>=ag.hora)n=7;
  const d=new Date(p.hoje+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);
  return{dia:d.toISOString().slice(0,10),hora:ag.hora,em:n};
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
  const nav=ABAS.map(a=>'<button type="button" class="fe-nv'+(a.k===aba.k?" on":"")+'" data-fe="aba" data-aba="'+a.k+'"'+(a.k===aba.k?' aria-current="page"':'')+'>'+IC[a.ic]+'<span>'+esc(a.rot)+'</span>'+badge(a.k)+'</button>').join("");
  const ag=p.agenda;
  const rail='<aside class="fe-rail" aria-label="Seções">'+
    '<div class="fe-brand"><div class="fe-marca">'+IC.marca+'</div><div><b>Aviso semanal</b><span>Faltas injustificadas por área</span></div></div>'+
    '<div class="fe-semana">'+IC.cal+'<div><small>Semana do aviso</small><b>'+esc(dmCurto(sem.inicio))+' a '+esc(dmCurto(sem.fim))+'</b></div></div>'+
    '<nav class="fe-nav">'+nav+'</nav>'+
    '<div class="fe-rail-foot"><small>Envio automático</small><label class="fe-sw"><span>'+(p.auto?'Ligado · '+DIAS_C[ag.dia]+' '+horaTxt(ag.hora):'Desligado')+'</span><input type="checkbox" data-fe="auto"'+(p.auto?" checked":"")+' aria-label="Envio automático"></label></div>'+
  '</aside>';
  let corpo='';
  if(FE.msg)corpo+='<div class="fe-msg '+FE.msg.tipo+'" role="status">'+esc(FE.msg.t)+'</div>';
  if(aba.k==="geral")corpo+=secGeral(p);
  else if(aba.k==="agenda")corpo+=secAgenda(p);
  else if(aba.k==="areas")corpo+=secAreas(p);
  else if(aba.k==="dest")corpo+=secCopias(p)+secResumo(p);
  else if(aba.k==="envio")corpo+=secEnvio(p)+secTesteAreas(p)+secTeste(p);
  else if(aba.k==="conta")corpo+=secConta(p)+secAssinatura(p);
  else corpo+=secHistorico(p);
  const pg='<div class="fe-pg"><header class="fe-top"><div><small>'+esc(aba.rot)+'</small><h2>'+esc(aba.tit)+'</h2><p>'+esc(aba.desc)+'</p></div><button type="button" class="fe-x" aria-label="Fechar" data-fe="fechar" data-id="feJanela">✕</button></header><div class="fe-main">'+corpo+'</div></div>';
  janela("feJanela","Aviso semanal por e-mail","Faltas injustificadas por área · só a sua conta envia",rail+pg,false,true);
}

/* Visão geral: o próximo envio em destaque, os números da semana e o que falta para estar tudo pronto. */
function secGeral(p){
  const ag=p.agenda,pr=ag.proximo,n=difDias(p.hoje,pr.dia);
  const enviadas=p.areas.filter(a=>a.status==="ENVIADO").length,comEmail=p.areas.filter(a=>a.email).length;
  const pct=comEmail?Math.round(100*enviadas/comEmail):0;
  const faltas=p.areas.reduce((s,a)=>s+a.faltas,0),colab=p.areas.reduce((s,a)=>s+a.colaboradores,0);
  const ticket='<div class="fe-ticket"><span class="fe-eyebrow">Próximo envio automático</span>'+
    '<div class="fe-dia-nome">'+esc(DIAS[diaDe(pr.dia)])+'</div><span class="fe-hora">'+horaTxt(pr.hora)+'</span>'+
    '<div class="fe-data">'+esc(dma(pr.dia))+' · '+emTxt(n)+'</div>'+
    '<div class="fe-rod"><span class="fe-st '+(p.auto?"ENVIADO":"PENDENTE")+'">'+(p.auto?"Automático ligado":"Automático desligado")+'</span>'+
    '<button type="button" class="fe-b sm" data-fe="aba" data-aba="agenda">'+IC.agenda+'Mudar dia e hora</button></div>'+
    (p.auto?'':'<p class="fe-mut" style="margin:14px 0 0">Nada sai sozinho enquanto o automático estiver desligado. Ligue no canto esquerdo da janela.</p>')+'</div>';
  const kpis='<div class="fe-kpis">'+
    '<div class="fe-kpi lg"><span class="fe-eyebrow">Áreas enviadas nesta semana</span><b>'+enviadas+'<i> de '+comEmail+'</i></b><div class="fe-barra" role="img" aria-label="'+pct+'% das áreas enviadas"><i style="width:'+pct+'%"></i></div></div>'+
    '<div class="fe-kpi"><span class="fe-eyebrow">Faltas no aviso</span><b>'+faltas+'</b><span>'+colab+' colaborador(es)</span></div>'+
    '<div class="fe-kpi"><span class="fe-eyebrow">Sem e-mail</span><b>'+p.areas.filter(a=>!a.email).length+'</b><span>área(s) sem supervisor cadastrado</span></div>'+
  '</div>';
  const item=(ok,tit,det,acao)=>'<div class="fe-rd"><span class="fe-led '+(ok?"ok":"am")+'"></span><div><b>'+tit+'</b><span>'+det+'</span></div>'+(acao?'<button type="button" class="fe-b sm" data-fe="aba" data-aba="'+acao[0]+'">'+acao[1]+'</button>':'<span></span>')+'</div>';
  const semAssin=!p.assinatura;
  const pronto='<div class="fe-sec"><div class="fe-sec-h"><div><b>Está tudo pronto?</b><span class="fe-mut">O que precisa estar em ordem para o aviso sair certo.</span></div></div><div class="fe-pronto">'+
    item(p.configurado,"Conta de envio",p.configurado?"Enviando por "+esc(p.conta.email):"Nenhuma conta pronta: até cadastrar, nenhum e-mail sai.",p.configurado?null:["conta","Cadastrar"])+
    item(!p.areas.some(a=>!a.email),"E-mail dos supervisores",p.areas.some(a=>!a.email)?p.areas.filter(a=>!a.email).length+" área(s) sem e-mail: "+esc(p.areas.filter(a=>!a.email).map(a=>a.nome).join(", ")):"Todas as áreas têm e-mail cadastrado.",p.areas.some(a=>!a.email)?["areas","Cadastrar"]:null)+
    item(!!p.link,"Botão para o painel",p.link?"Os e-mails levam o botão \"Abrir no Painel ServCamp\" para "+esc(p.link):"Os e-mails saem sem o botão. Abra este painel pelo endereço oficial do sistema (https) para ele ser guardado.",null)+
    item(!p.semArea,"Faltas com área",p.semArea?p.semArea+" falta(s) da semana vieram sem área na planilha e não têm para quem ir.":"Todas as faltas da semana têm supervisor.",null)+
    item(!semAssin,"Assinatura",semAssin?"Sem imagem: o e-mail fecha com \"Atenciosamente, Servcamp\".":"Imagem cadastrada, entra abaixo do cartão.",semAssin?["conta","Enviar imagem"]:null)+
    item(p.copias.length>0,"Cópias",p.copias.length?p.copias.length+" pessoa(s) acompanham em cópia.":"Ninguém em cópia ainda.",p.copias.length?null:["dest","Incluir"])+
  '</div></div>';
  return '<div class="fe-hero">'+ticket+kpis+'</div>'+pronto;
}

/* Agendamento: dia da semana + régua de horas; só vale depois de salvar. */
function secAgenda(p){
  const a=FE.ag||(FE.ag={dia:p.agenda.dia,hora:p.agenda.hora}),salvo=p.agenda,mudou=a.dia!==salvo.dia||a.hora!==salvo.hora;
  const pr=proximo(p,a),n=pr.em;
  const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const dias=DIAS_C.map((c,i)=>{
    const prox=proximo(p,{dia:i,hora:a.hora}).dia; // a próxima vez que esse dia da semana acontece
    return '<button type="button" class="fe-dia'+(i===a.dia?" on":"")+'" data-fe="ag-dia" data-dia="'+i+'" aria-pressed="'+(i===a.dia)+'" title="'+esc(DIAS[i])+', próximo dia '+esc(dma(prox))+'"><small>'+c+'</small><b>'+prox.slice(8,10)+'</b><em>'+MES[Number(prox.slice(5,7))-1]+'</em></button>';
  }).join("");
  const h0=salvo.horas[0],h1=salvo.horas[1],horas=[];
  for(let h=h0;h<=h1;h++)horas.push('<button type="button" class="fe-hr'+(h===a.hora?" on":"")+'" data-fe="ag-hora" data-hora="'+h+'" aria-pressed="'+(h===a.hora)+'">'+String(h).padStart(2,"0")+'</button>');
  return '<div class="fe-sec"><div class="fe-sec-h"><div><b>Dia da semana</b><span class="fe-mut">O aviso sempre traz a semana anterior, de segunda a domingo.</span></div></div><div class="fe-dias" role="group" aria-label="Dia da semana">'+dias+'</div></div>'+
    '<div class="fe-sec"><div class="fe-sec-h"><div><b>Hora do envio</b><span class="fe-mut">Horário de Brasília, entre '+h0+'h e '+h1+'h. O sistema dispara de hora em hora, então o e-mail sai dentro da hora escolhida.</span></div></div><div class="fe-horas" role="group" aria-label="Hora">'+horas.join("")+'</div>'+
    '<div class="fe-leitura"><b>'+horaTxt(a.hora)+'</b><span>Próximo envio: <b style="font:650 .95rem var(--font);color:var(--tx)">'+esc(DIAS[diaDe(pr.dia)].toLowerCase())+', '+esc(dma(pr.dia))+'</b> · '+emTxt(n)+(p.auto?'':' · <span style="color:var(--am)">o automático está desligado</span>')+'</span></div>'+
    '<div class="fe-linha"><button type="button" class="fe-b fe-pri" data-fe="ag-salvar"'+(mudou&&!FE.ocupado?"":" disabled")+'>'+(FE.ocupado?"Salvando…":"Salvar agendamento")+'</button>'+
    (mudou?'<button type="button" class="fe-b" data-fe="ag-descartar">Descartar</button><span class="fe-mut">Alteração ainda não salva</span>':'<span class="fe-mut">Salvo: '+esc(DIAS[salvo.dia].toLowerCase())+' às '+horaTxt(salvo.hora)+'</span>')+'</div></div>'+
    '<div class="fe-sec"><div class="fe-sec-h"><div><b>Como o envio automático funciona</b></div></div><div class="fe-pronto">'+
      '<div class="fe-rd"><span class="fe-led ok"></span><div><b>Um e-mail por área</b><span>Só com as faltas injustificadas daquela área, abonos e afastamentos já descontados.</span></div><span></span></div>'+
      '<div class="fe-rd"><span class="fe-led ok"></span><div><b>Sem repetir</b><span>Área que já recebeu o aviso da semana não recebe de novo, mesmo que o sistema dispare outra vez.</span></div><span></span></div>'+
      '<div class="fe-rd"><span class="fe-led ok"></span><div><b>Tentativas seguintes</b><span>Se o servidor de e-mail falhar, a cada hora, no mesmo dia, o sistema envia só o que ficou para trás.</span></div><span></span></div>'+
    '</div></div>';
}

/* Teste de todas as áreas: um e-mail por área, com o conteúdo real, só para quem for escolhido. */
function secTesteAreas(p){
  const t=FE.ta||(FE.ta={de:p.semana.inicio,ate:p.semana.fim,eu:false,cc:new Set(),outro:""});
  const com=p.areas.length,destinos=[];
  if(t.eu)destinos.push(p.conta&&p.conta.email||"a conta de envio");
  p.copias.filter(c=>t.cc.has(c.email)).forEach(c=>destinos.push(c.nome));
  String(t.outro||"").split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean).forEach(x=>destinos.push(x));
  const chips='<label class="fe-chip"><input type="checkbox" data-fe="ta-eu"'+(t.eu?" checked":"")+'> <b>Eu</b> <span class="fe-mut">'+esc(p.conta&&p.conta.email||"a conta de envio")+'</span></label>'+
    p.copias.map(c=>'<label class="fe-chip"><input type="checkbox" data-fe="ta-cc" data-email="'+esc(c.email)+'"'+(t.cc.has(c.email)?" checked":"")+'> <b>'+esc(c.nome)+'</b> <span class="fe-mut">'+esc(c.email)+'</span></label>').join("");
  let h='<div class="fe-sec"><div class="fe-sec-h"><div><b>Teste de todas as áreas</b><span class="fe-mut">Manda para quem você escolher o mesmo e-mail que cada supervisor recebe, um por área ('+com+' no total). Nenhum supervisor é avisado e nada conta como envio oficial.</span></div></div>'+
    '<p class="fe-eyebrow" style="margin:0 0 10px">Para quem vai</p><div class="fe-chips">'+chips+'</div>'+
    '<div class="fe-linha"><input class="fe-in l" type="text" inputmode="email" autocomplete="off" data-fe-campo="ta.outro" placeholder="Outros e-mails (opcional; separe por vírgula)" value="'+esc(t.outro)+'"></div>'+
    '<div class="fe-grade" style="margin-top:14px;max-width:460px"><div><label for="feTaDe">De</label><input id="feTaDe" class="fe-in" type="date" data-fe-campo="ta.de" value="'+esc(t.de)+'"></div><div><label for="feTaAte">Até</label><input id="feTaAte" class="fe-in" type="date" data-fe-campo="ta.ate" value="'+esc(t.ate)+'"></div></div>';
  if(FE.taConf&&destinos.length){
    h+='<div class="fe-conf"><b>Enviar '+com+' e-mail(s) de teste?</b><p class="fe-mut" style="margin:6px 0 0">Para: '+destinos.map(esc).join(", ")+'. Período de '+esc(dma(t.de))+' a '+esc(dma(t.ate))+'.</p>'+
      '<div class="fe-linha"><button class="fe-b fe-pri" data-fe="ta-confirmar"'+(FE.ocupado?" disabled":"")+'>'+(FE.ocupado?"Enviando…":"Enviar agora")+'</button><button class="fe-b" data-fe="ta-voltar"'+(FE.ocupado?" disabled":"")+'>Voltar</button></div></div>';
  }else{
    h+='<div class="fe-linha"><button class="fe-b fe-pri" data-fe="ta-enviar"'+(destinos.length&&p.configurado&&com&&!FE.ocupado?"":" disabled")+'>'+IC.enviar+'Enviar o teste das '+com+' áreas</button>'+
      (destinos.length?'<span class="fe-mut">Vai para '+destinos.length+' destinatário(s)</span>':'<span class="fe-mut">Escolha ao menos um destinatário</span>')+'</div>';
  }
  return h+'</div>';
}

function secConta(p){
  const c=p.conta,f=FE.conta;
  let h='<div class="fe-sec"><div class="fe-sec-h"><b>Conta de envio</b><span class="fe-mut">Quando o supervisor clicar em Responder, a resposta volta para esta conta com as cópias junto.</span></div>';
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
  return '<div class="fe-sec"><div class="fe-sec-h"><b>Assinatura do e-mail</b><span class="fe-mut">Vai no corpo do e-mail, abaixo do cartão, depois de "Atenciosamente,"</span></div>'+
    (a?'<img src="'+esc(a.src)+'" alt="Assinatura atual" style="display:block;max-width:100%;height:auto;border:1px solid var(--fe-ln);border-radius:8px">'+
      '<p class="fe-mut" style="margin:6px 0 0">'+a.largura+' × '+a.altura+' px · '+kb(a.bytes)+(a.em?' · enviada em '+esc(quando(a.em)):'')+'</p>'
      :'<p class="fe-mut" style="margin:0">Nenhuma assinatura cadastrada: o e-mail fecha com "Atenciosamente, Servcamp".</p>')+
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
  return '<div class="fe-sec"><div class="fe-sec-h"><b>Áreas e supervisores</b><span class="fe-mut">O e-mail vale também para o relatório de hora extra.</span></div>'+
    (p.areas.length?'<div class="fe-tab-w"><table class="fe-tab"><thead><tr><th></th><th>Área</th><th>Saudação ("Olá, …")</th><th>E-mail do supervisor</th><th>Faltas na semana</th><th>Situação</th><th></th></tr></thead><tbody>'+linhas+'</tbody></table></div>'
      :'<p class="fe-mut">Nenhuma área nas planilhas recentes.</p>')+'</div>';
}

function secCopias(p){
  if(FE.copias){
    const l=FE.copias.map(function(c,i){
      return '<div class="fe-linha"><input class="fe-in" style="flex:0 1 200px" data-fe-campo="copias.'+i+'.nome" maxlength="60" placeholder="Nome" value="'+esc(c.nome)+'">'+
        '<input class="fe-in l" type="email" data-fe-campo="copias.'+i+'.email" maxlength="120" placeholder="email@gruposervcamp.com.br" value="'+esc(c.email)+'">'+
        '<button class="fe-b sm" data-fe="rm-copia" data-i="'+i+'" aria-label="Remover">Remover</button></div>';
    }).join("");
    return '<div class="fe-sec"><div class="fe-sec-h"><b>Quem vai em cópia</b></div>'+l+
      '<div class="fe-linha"><button class="fe-b sm" data-fe="add-copia">+ Adicionar</button><span style="flex:1"></span><button class="fe-b sm" data-fe="cancelar-copias">Cancelar</button><button class="fe-b sm fe-pri" data-fe="salvar-copias"'+(FE.ocupado?" disabled":"")+'>Salvar cópias</button></div></div>';
  }
  const chips=p.copias.map(c=>'<label class="fe-chip"><input type="checkbox" data-fe="cc" data-email="'+esc(c.email)+'"'+(FE.cc.has(c.email)?" checked":"")+'> <b>'+esc(c.nome)+'</b> <span class="fe-mut">'+esc(c.email)+'</span></label>').join("");
  return '<div class="fe-sec"><div class="fe-sec-h"><b>Quem vai em cópia</b><button class="fe-b sm" data-fe="editar-copias">Editar lista</button></div>'+
    (p.copias.length?'<div class="fe-chips">'+chips+'</div><p class="fe-mut" style="margin:8px 0 0">Desmarque para tirar alguém da cópia neste envio. O automático sempre usa a lista inteira.</p>'
      :'<p class="fe-mut">Ninguém em cópia ainda. Clique em "Editar lista" para incluir.</p>')+'</div>';
}

function secEnvio(p){
  const areas=p.areas.filter(a=>FE.sel.has(a.area));
  const cc=p.copias.filter(c=>FE.cc.has(c.email));
  let h='<div class="fe-sec"><div class="fe-sec-h"><b>Envio oficial · semana de '+esc(dma(p.semana.inicio))+' a '+esc(dma(p.semana.fim))+'</b></div>'+
    '<p class="fe-mut" style="margin:0">Um e-mail por área, só com as faltas daquela área. Área que já recebeu o aviso desta semana não recebe de novo.</p>';
  if(FE.confirmar&&areas.length){
    h+='<div class="fe-conf"><b>Confirma o envio?</b><ul>'+areas.map(a=>'<li>'+esc(a.nome)+' → '+esc(a.email)+' · '+a.faltas+' falta(s)</li>').join("")+'</ul>'+
      '<p class="fe-mut" style="margin:8px 0 0">Em cópia: '+(cc.length?cc.map(c=>esc(c.nome)).join(", "):"ninguém")+'</p>'+
      '<div class="fe-linha"><button class="fe-b fe-pri" data-fe="confirmar-envio"'+(FE.ocupado?" disabled":"")+'>'+(FE.ocupado?"Enviando…":"Enviar agora")+'</button><button class="fe-b" data-fe="voltar-envio"'+(FE.ocupado?" disabled":"")+'>Voltar</button></div></div>';
  }else{
    h+='<div class="fe-linha"><button class="fe-b fe-pri" data-fe="enviar"'+(areas.length&&p.configurado?"":" disabled")+'>Enviar para '+areas.length+' área(s)</button>'+
      '<span class="fe-mut">'+(cc.length?"Em cópia: "+cc.map(c=>esc(c.nome)).join(", "):"Sem cópia")+'</span></div>';
  }
  return h+'</div>';
}

/* Resumo semanal das medidas disciplinares para a coordenação: um e-mail só, com o que foi gerado no
   painel e ainda não está no SAR2G, por supervisor. Sai junto com o aviso das áreas (automático). */
function secResumo(p){
  const r=p.resumo||{ligado:false,para:[]},ed=FE.rs;
  let h='<div class="fe-sec"><div class="fe-sec-h"><b>Resumo semanal para a coordenação</b><span class="fe-mut">Medidas geradas no painel × SAR2G, por supervisor. Sai junto com o aviso das áreas.</span></div>';
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

function secTeste(p){
  const t=FE.t||{};
  const a=p.areas.find(x=>x.area===t.area);
  const ops=p.areas.map(x=>'<option value="'+esc(x.area)+'"'+(x.area===t.area?" selected":"")+'>'+esc(x.nome)+'</option>').join("");
  const ccs=p.copias.map(c=>'<label class="fe-chip"><input type="checkbox" data-fe="t-cc" data-email="'+esc(c.email)+'"'+(t.cc&&t.cc.has(c.email)?" checked":"")+'> '+esc(c.nome)+'</label>').join("");
  return '<div class="fe-sec"><div class="fe-sec-h"><b>Envio de teste</b><span class="fe-mut">Qualquer período de até 31 dias. Não conta como envio oficial.</span></div>'+
    '<div class="fe-grade">'+
      '<div><label for="feTArea">Área</label><select id="feTArea" class="fe-in" data-fe-campo="t.area">'+ops+'</select></div>'+
      '<div><label for="feTDe">De</label><input id="feTDe" class="fe-in" type="date" data-fe-campo="t.de" value="'+esc(t.de)+'"></div>'+
      '<div><label for="feTAte">Até</label><input id="feTAte" class="fe-in" type="date" data-fe-campo="t.ate" value="'+esc(t.ate)+'"></div>'+
    '</div>'+
    '<p class="fe-mut" style="margin:12px 0 6px">Para quem vai o teste:</p>'+
    '<div class="fe-chips">'+
      '<label class="fe-chip"><input type="checkbox" data-fe="t-eu"'+(t.eu?" checked":"")+'> <b>Eu</b> <span class="fe-mut">('+esc(p.conta&&p.conta.email||"a conta de envio")+')</span></label>'+
      '<label class="fe-chip"><input type="checkbox" data-fe="t-sup"'+(t.sup?" checked":"")+(a&&a.email?"":" disabled")+'> <b>Supervisor da área</b> <span class="fe-mut">'+esc(a&&a.email?a.email:"sem e-mail")+'</span></label>'+
      ccs+
    '</div>'+
    '<div class="fe-linha"><input class="fe-in l" type="text" inputmode="email" autocomplete="off" data-fe-campo="t.outro" placeholder="Outros e-mails, de qualquer domínio (opcional; separe por vírgula)" value="'+esc(t.outro)+'"></div>'+
    '<div class="fe-linha"><button class="fe-b" data-fe="previa-teste">Ver prévia</button><button class="fe-b fe-pri" data-fe="enviar-teste"'+(FE.ocupado||!p.configurado?" disabled":"")+'>'+(FE.ocupado?"Enviando…":"Enviar teste")+'</button></div></div>';
}

function secHistorico(p){
  if(!p.historico||!p.historico.length)return '<div class="fe-vazio"><b>Nenhum envio ainda</b><span>Quando o primeiro aviso ou teste sair, ele aparece aqui.</span></div>';
  const l=p.historico.map(e=>'<tr><td>'+esc(quando(e.em))+'</td><td>'+(e.tipo==="TESTE"?"Teste":"Oficial · "+(e.origem==="auto"?"automático":"manual"))+'</td><td>'+esc(e.area)+'</td><td>'+(e.semana?esc(dma(e.semana))+(e.ate?" a "+esc(dma(e.ate)):""):"—")+'</td><td>'+e.qtd+'</td><td>'+(e.ok?'<span class="fe-st ENVIADO">ok</span>':'<span class="fe-st FALHOU">falhou</span>')+'</td></tr>').join("");
  return '<div class="fe-sec"><div class="fe-sec-h"><b>Últimos envios</b></div><div class="fe-tab-w"><table class="fe-tab"><thead><tr><th>Quando</th><th>Tipo</th><th>Área</th><th>Período</th><th>Faltas</th><th></th></tr></thead><tbody>'+l+'</tbody></table></div></div>';
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
  if(q==="aba"){FE.aba=b.getAttribute("data-aba");FE.msg=null;render();const m=document.querySelector("#feJanela .fe-main");if(m)m.scrollTop=0;return;}
  if(q==="ag-dia"){(FE.ag||(FE.ag={})).dia=Number(b.getAttribute("data-dia"));render();return;}
  if(q==="ag-hora"){(FE.ag||(FE.ag={})).hora=Number(b.getAttribute("data-hora"));render();return;}
  if(q==="ag-descartar"){FE.ag={dia:p.agenda.dia,hora:p.agenda.hora};render();return;}
  if(q==="ag-salvar"){const a=FE.ag;acao(()=>api("agenda","POST",{dia:a.dia,hora:a.hora}),()=>"Agendamento salvo: "+DIAS[a.dia].toLowerCase()+" às "+horaTxt(a.hora)+".",true);return;}
  if(q==="ta-enviar"){FE.taConf=true;FE.msg=null;render();return;}
  if(q==="ta-voltar"){FE.taConf=false;render();return;}
  if(q==="ta-confirmar"){
    const t=FE.ta,para=[];
    if(t.eu)para.push("@eu");
    t.cc.forEach(e=>para.push(e));
    String(t.outro||"").split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean).forEach(x=>para.push(x));
    acao(()=>api("teste_areas","POST",{de:t.de,ate:t.ate,para:para}),r=>r.enviados+" e-mail(s) de teste enviado(s), um por área"+(r.falhas?" · "+r.falhas+" falharam: tente de novo":"")+" · "+r.comFaltas+" com faltas no período.",true).then(()=>{FE.taConf=false;render();});
    return;
  }
  if(q==="editar-area"){const a=p.areas.find(x=>x.area===area);if(a){FE.edit={area:a.area,email:a.email||"",saudacao:a.saudacao||""};render();}return;}
  if(q==="cancelar-area"){FE.edit=null;render();return;}
  if(q==="salvar-area"){const ed=FE.edit;acao(()=>api("area","POST",{area:ed.area,email:ed.email,saudacao:ed.saudacao}),"Área atualizada.",true).then(()=>{if(!FE.msg||FE.msg.tipo==="ok")FE.edit=null;render();});return;}
  if(q==="previa"){previa(area);return;}
  if(q==="ass-remover"){acao(()=>api("assinatura","POST",{imagem:null}),"Assinatura removida: o e-mail fecha com Atenciosamente, Servcamp.",true);return;}
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
  if(q==="enviar"){FE.confirmar=true;FE.msg=null;render();return;}
  if(q==="voltar-envio"){FE.confirmar=false;render();return;}
  if(q==="confirmar-envio"){
    const corpo={areas:[...FE.sel],copias:[...FE.cc],confirmar:true};
    acao(()=>api("enviar","POST",corpo),resumoEnvio,false).then(()=>{FE.confirmar=false;render();});
    return;
  }
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
  if(q==="previa-teste"){const t=FE.t;previa(t.area,t.de,t.ate,true);return;}
  if(q==="enviar-teste"){
    const t=FE.t,para=[];
    if(t.eu)para.push("@eu");
    if(t.sup)para.push("@supervisor");
    t.cc.forEach(e=>para.push(e));
    String(t.outro||"").split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean).forEach(x=>para.push(x));
    if(!para.length){msg("er","Escolha ao menos um destinatário para o teste.");render();return;}
    acao(()=>api("teste","POST",{area:t.area,de:t.de,ate:t.ate,para:para}),r=>"Teste enviado para "+r.para+" destinatário(s), com "+r.faltas+" falta(s) no período.",true);
    return;
  }
}
function mudou(e){
  const el=e.target,q=el.getAttribute("data-fe");
  if(q==="ass-arquivo"){enviarAssinatura(el.files&&el.files[0]);return;}
  if(q==="rs-ligado"){const v=el.checked;acao(()=>api("resumo","POST",{ligado:v}),v?"Resumo da coordenação ligado: sai junto com o aviso automático.":"Resumo da coordenação desligado.",true);return;}
  if(q==="auto"){const v=el.checked,a=FE.p&&FE.p.agenda;acao(()=>api("auto","POST",{ligado:v}),v?"Envio automático ligado"+(a?": "+DIAS[a.dia].toLowerCase()+" às "+horaTxt(a.hora)+".":"."):"Envio automático desligado.",true);return;}
  if(q==="ta-eu"){FE.ta.eu=el.checked;FE.taConf=false;render();return;}
  if(q==="ta-cc"){const m=el.getAttribute("data-email");if(el.checked)FE.ta.cc.add(m);else FE.ta.cc.delete(m);FE.taConf=false;render();return;}
  if(q==="sel"){const a=el.getAttribute("data-area");if(el.checked)FE.sel.add(a);else FE.sel.delete(a);FE.confirmar=false;render();return;}
  if(q==="cc"){const m=el.getAttribute("data-email");if(el.checked)FE.cc.add(m);else FE.cc.delete(m);render();return;}
  if(q==="t-eu"){FE.t.eu=el.checked;return;}
  if(q==="t-sup"){FE.t.sup=el.checked;return;}
  if(q==="t-cc"){const m=el.getAttribute("data-email");if(el.checked)FE.t.cc.add(m);else FE.t.cc.delete(m);return;}
  if(el.getAttribute("data-fe-campo")==="t.area"){digitou(e);FE.t.sup=false;render();}
}
// Campos de texto: guarda no estado sem redesenhar (o cursor não pula).
function digitou(e){
  const c=e.target.getAttribute("data-fe-campo");
  if(!c)return;
  const v=e.target.value,p=c.split(".");
  if(p[0]==="edit"&&FE.edit)FE.edit[p[1]]=v;
  else if(p[0]==="t"&&FE.t)FE.t[p[1]]=v;
  else if(p[0]==="ta"&&FE.ta)FE.ta[p[1]]=v;
  else if(p[0]==="conta"&&FE.conta)FE.conta[p[1]]=v;
  else if(p[0]==="copias"&&FE.copias&&FE.copias[Number(p[1])])FE.copias[Number(p[1])][p[2]]=v;
  else if(p[0]==="rs"&&FE.rs&&FE.rs[Number(p[1])])FE.rs[Number(p[1])][p[2]]=v;
}
})();
