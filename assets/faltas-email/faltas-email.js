/* Aviso semanal de faltas injustificadas por e-mail — o painel do envio.
   Fica fora do index.html porque ele já está no limite de tamanho (test/auth_exigencia).
   O servidor é o api/_faltas_email.js (/api/rh?modulo=faltasemail). Aqui:
   • botão "Aviso por e-mail" na tela Faltas x Medidas e no menu do perfil (só a conta do Raphael);
   • e-mail do supervisor e nome da saudação de cada área, e quem vai em cópia;
   • a conta de e-mail que envia (a senha vai para o servidor e não volta mais para a tela);
   • liga/desliga o envio automático (segundas, 14h);
   • a imagem da assinatura, que vai no corpo do e-mail abaixo do cartão;
   • envio oficial da semana anterior, escolhendo áreas e cópias;
   • envio de teste de qualquer período, para quem ele escolher na hora, e a prévia do e-mail.
   Esconder o botão é só conveniência: quem barra os outros é o servidor. */
(function(){
"use strict";
// Mesma conta do servidor (api/_faltas_email.js RESPONSAVEL; test/faltas_email.test.js confere).
const FE_RESPONSAVEL="raphaelvictor";
const FE={conta:null,p:null,sel:new Set(),cc:new Set(),edit:null,copias:null,confirmar:false,msg:null,ocupado:false,t:null};

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
function janela(id,titulo,sub,html,estreito){
  let ov=document.getElementById(id);
  const novo=!ov;
  if(novo){ov=document.createElement("div");ov.id=id;ov.className="fe-ov";}
  const caixa=ov.querySelector(".fe-box"),rolagem=caixa?caixa.scrollTop:0; // redesenhar não pode jogar a tela para o topo
  ov.innerHTML='<div class="fe-box'+(estreito?" fe-estreito":"")+'" role="dialog" aria-modal="true" aria-label="'+esc(titulo)+'">'+
    '<div class="fe-h"><div><b>'+esc(titulo)+'</b>'+(sub?'<span>'+esc(sub)+'</span>':'')+'</div><button type="button" class="fe-x" aria-label="Fechar" data-fe="fechar" data-id="'+id+'">✕</button></div>'+
    '<div class="fe-c">'+html+'</div></div>';
  if(novo){
    ov.addEventListener("click",function(e){if(e.target===ov){fechar(id);return;}clique(e);});
    ov.addEventListener("change",mudou);
    ov.addEventListener("input",digitou);
    document.body.appendChild(ov);
  }
  if(rolagem)ov.querySelector(".fe-box").scrollTop=rolagem;
  return ov;
}
function fechar(id){const o=document.getElementById(id);if(o)o.remove();}
window.feFechar=fechar;

window.feAbrir=async function(){
  if(uk()!==FE_RESPONSAVEL)return;
  FE.msg=null;FE.confirmar=false;FE.edit=null;FE.copias=null;FE.p=null;FE.rs=null;FE.rsConf=false;
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
  }
  render();
}
function msg(tipo,t){FE.msg={tipo:tipo,t:t};}

/* ── tela ────────────────────────────────────────────────────────────── */
function render(){
  const p=FE.p;
  if(!p){janela("feJanela","Aviso semanal por e-mail","Faltas injustificadas por área",FE.msg?'<div class="fe-msg er">'+esc(FE.msg.t)+'</div>':'<p class="fe-mut">Carregando…</p>');return;}
  const sem=p.semana;
  let h='';
  if(!p.configurado)h+='<div class="fe-alerta"><b>Nenhuma conta de envio pronta.</b> Cadastre o e-mail e a senha em "Conta de envio". Até lá nenhum e-mail sai.</div>';
  if(p.semArea)h+='<div class="fe-alerta">'+p.semArea+' falta(s) da semana vieram sem área na planilha e não têm para quem ir.</div>';
  if(!p.link)h+='<div class="fe-alerta">Os e-mails ainda saem <b>sem o botão "Abrir no Painel ServCamp"</b>: abra este painel pelo endereço oficial do sistema (https) para ele ser guardado.</div>';
  h+='<div class="fe-topo" style="margin-top:6px">'+
    '<div class="fe-card"><small>Semana do aviso</small><b>'+esc(dma(sem.inicio))+' a '+esc(dma(sem.fim))+'</b><span class="fe-sub">segunda a domingo · vale para o envio oficial</span></div>'+
    '<div class="fe-card"><small>Envio automático</small><label class="fe-sw"><input type="checkbox" data-fe="auto"'+(p.auto?" checked":"")+'> '+(p.auto?"Ligado":"Desligado")+'</label><span class="fe-sub">segundas às 14h (novas tentativas às 16h e 18h)</span></div>'+
    '<div class="fe-card"><small>Áreas enviadas nesta semana</small><b>'+p.areas.filter(a=>a.status==="ENVIADO").length+' de '+p.areas.filter(a=>a.email).length+'</b><span class="fe-sub">'+p.areas.filter(a=>!a.email).length+' área(s) sem e-mail</span></div>'+
  '</div>';
  h+=secConta(p)+secAssinatura(p);
  if(FE.msg)h+='<div class="fe-msg '+FE.msg.tipo+'">'+esc(FE.msg.t)+'</div>';
  h+=secAreas(p)+secCopias(p)+secEnvio(p)+secResumo(p)+secTeste(p)+secHistorico(p);
  janela("feJanela","Aviso semanal por e-mail","Faltas injustificadas por área · só a sua conta envia",h);
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
      '<td><b>'+esc(a.nome)+'</b></td>'+
      '<td>'+esc(a.saudacao||a.nome)+(a.saudacao?'':'<span class="fe-sub">nome da área</span>')+'</td>'+
      '<td>'+(a.email?esc(a.email):'<span class="fe-mut">—</span>')+'</td>'+
      '<td>'+a.faltas+(a.faltas?'<span class="fe-sub">'+a.colaboradores+' colaborador(es)</span>':'')+'</td>'+
      '<td>'+st+'</td>'+
      '<td style="white-space:nowrap"><button class="fe-b sm" data-fe="editar-area" data-area="'+esc(a.area)+'">'+(a.email?"Editar":"Cadastrar e-mail")+'</button> <button class="fe-b sm" data-fe="previa" data-area="'+esc(a.area)+'">Prévia</button></td></tr>';
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
    '<div class="fe-linha"><label class="fe-sw"><input type="checkbox" data-fe="rs-ligado"'+(r.ligado?" checked":"")+(r.para.length?"":" disabled")+'> '+(r.ligado?"Ligado: sai com o aviso automático das segundas":"Desligado")+'</label></div>'+
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
  if(!p.historico||!p.historico.length)return "";
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
  if(q==="rs-ligado"){const v=el.checked;acao(()=>api("resumo","POST",{ligado:v}),v?"Resumo da coordenação ligado: sai com o aviso automático das segundas.":"Resumo da coordenação desligado.",true);return;}
  if(q==="auto"){const v=el.checked;acao(()=>api("auto","POST",{ligado:v}),v?"Envio automático ligado: segundas às 14h.":"Envio automático desligado.",true);return;}
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
  else if(p[0]==="conta"&&FE.conta)FE.conta[p[1]]=v;
  else if(p[0]==="copias"&&FE.copias&&FE.copias[Number(p[1])])FE.copias[Number(p[1])][p[2]]=v;
  else if(p[0]==="rs"&&FE.rs&&FE.rs[Number(p[1])])FE.rs[Number(p[1])][p[2]]=v;
}
})();
