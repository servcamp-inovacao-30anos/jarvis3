/* "Esqueci minha senha" (tela de login) e o cadastro do e-mail/celular de recuperação
   (perfil e Configurações). Fora do index.html porque ele está no limite de tamanho.
   Quem confere tudo é o servidor (api/users.js: recovery_options, recovery_send,
   recovery_reset, set_recovery). O código só vai para o contato cadastrado antes. */
(function(){
"use strict";
var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});};
var norm=function(s){return typeof window._normUser==="function"?window._normUser(s):String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");};

function api(corpo){
  return fetch("/api/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(corpo)})
    .then(function(r){return r.json().catch(function(){return {};}).then(function(j){j=j||{};j._status=r.status;j._ok=r.ok&&j.ok!==false;return j;});})
    .catch(function(){return {_status:0,_ok:false,error:"Sem conexão. Confira a internet e tente de novo."};});
}
function caixa(html){
  fechar();
  var d=document.createElement("div");
  d.id="rcFundo";d.className="rc-fundo";
  d.setAttribute("role","dialog");d.setAttribute("aria-modal","true");
  d.innerHTML='<div class="rc-caixa">'+html+'</div>';
  document.body.appendChild(d);
  var f=d.querySelector("input,button.rc-op,button.rc-b");if(f)setTimeout(function(){try{f.focus();}catch(e){}},30);
  return d;
}
function fechar(){var d=document.getElementById("rcFundo");if(d)d.remove();if(R.timer){clearInterval(R.timer);R.timer=null;}}
function $(id){return document.getElementById(id);}
function erro(msg,ok){var e=$("rcErr");if(e){e.textContent=msg||"";e.className="rc-err"+(ok?" rc-ok":"");}}
function ocupado(id,sim,txt){var b=$(id);if(!b)return;if(sim){b.dataset.lbl=b.textContent;b.textContent=txt;b.disabled=true;}else{b.textContent=b.dataset.lbl||b.textContent;b.disabled=false;}}

// ── Esqueci minha senha ─────────────────────────────────────────────────────
var R={u:"",op:null,canal:null,destino:"",timer:null,ate:0};

function passoUsuario(){
  var pre=($("loginUser")||{}).value||"";
  caixa('<div class="rc-ic">🔑</div><div class="rc-t">Esqueci minha senha</div>'+
    '<div class="rc-s">Você recebe um código no seu e-mail ou celular e cria uma senha nova.</div>'+
    '<form id="rcForm"><label class="rc-l" for="rcUser">Seu usuário</label>'+
    '<input class="rc-i" id="rcUser" autocomplete="username" placeholder="O mesmo que você usa para entrar" value="'+esc(pre)+'">'+
    '<div class="rc-err" id="rcErr"></div>'+
    '<button type="submit" class="rc-b" id="rcBtn">Continuar</button></form>'+
    '<button type="button" class="rc-b2" id="rcVoltar">Voltar ao login</button>');
  $("rcVoltar").onclick=fechar;
  $("rcForm").onsubmit=function(e){
    e.preventDefault();
    var u=norm($("rcUser").value);
    if(!u){erro("Digite o seu usuário.");return false;}
    ocupado("rcBtn",true,"Procurando...");
    api({action:"recovery_options",userKey:u}).then(function(j){
      ocupado("rcBtn",false);
      if(!j._ok){erro(j.error||"Não deu para continuar agora. Tente de novo.");return;}
      R.u=u;R.op={email:j.email,celular:j.celular};
      passoCanal();
    });
    return false;
  };
}

function passoCanal(){
  var o=R.op||{};
  if(!o.email&&!o.celular){
    caixa('<div class="rc-ic">📭</div><div class="rc-t">Sem e-mail nem celular cadastrado</div>'+
      '<div class="rc-aviso">Esta conta ainda não tem para onde mandar o código. Peça ao administrador para <b>redefinir a sua senha</b> em Configurações.<br><br>Depois de entrar, cadastre o seu e-mail e celular em <b>📱 E-mail e celular para recuperar a senha</b>, no seu perfil, para resolver sozinho da próxima vez.</div>'+
      '<button type="button" class="rc-b" id="rcVoltar">Voltar ao login</button>'+
      '<button type="button" class="rc-b2" id="rcOutro">Tentar outro usuário</button>');
    $("rcVoltar").onclick=fechar;$("rcOutro").onclick=passoUsuario;
    return;
  }
  caixa('<div class="rc-ic">📨</div><div class="rc-t">Para onde mandamos o código?</div>'+
    '<div class="rc-s">Escolha uma das formas cadastradas na sua conta.</div>'+
    (o.email?'<button type="button" class="rc-op" data-canal="email"><span class="rc-op-ic">✉️</span><span><b>Por e-mail</b><span>'+esc(o.email)+'</span></span></button>':'')+
    (o.celular?'<button type="button" class="rc-op" data-canal="sms"><span class="rc-op-ic">💬</span><span><b>Por SMS</b><span>'+esc(o.celular)+'</span></span></button>':'')+
    '<div class="rc-err" id="rcErr"></div>'+
    '<button type="button" class="rc-b2" id="rcVoltar">Voltar</button>');
  $("rcVoltar").onclick=passoUsuario;
  Array.prototype.forEach.call(document.querySelectorAll("#rcFundo .rc-op"),function(b){
    b.onclick=function(){enviar(b.dataset.canal,b);};
  });
}

function enviar(canal,botao){
  if(botao){botao.disabled=true;botao.style.opacity=".6";}
  erro("Enviando o código...",true);
  api({action:"recovery_send",userKey:R.u,canal:canal}).then(function(j){
    if(botao){botao.disabled=false;botao.style.opacity="";}
    if(!j._ok){
      // já tinha pedido há pouco: o código anterior continua valendo
      if(j._status===429&&j.espera&&R.canal===canal){passoCodigo(j.espera);erro(j.error);return;}
      erro(j.error||"Não consegui enviar o código agora. Tente de novo.");return;
    }
    R.canal=canal;R.destino=j.destino||"";
    passoCodigo(j.intervalo_s||60);
  });
}

function passoCodigo(espera){
  var porSms=R.canal==="sms";
  caixa('<div class="rc-ic">'+(porSms?"💬":"✉️")+'</div><div class="rc-t">Digite o código</div>'+
    '<div class="rc-s">Mandamos um código de 6 números '+(porSms?"por SMS para":"para o e-mail")+' <b>'+esc(R.destino)+'</b>. Ele vale 15 minutos.'+(porSms?"":" Se não aparecer, olhe também no spam.")+'</div>'+
    '<form id="rcForm" autocomplete="off">'+
    '<label class="rc-l" for="rcCod">Código</label>'+
    '<input class="rc-i rc-cod" id="rcCod" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">'+
    '<label class="rc-l" for="rcP1">Nova senha</label>'+
    '<input class="rc-i" id="rcP1" type="password" autocomplete="new-password" placeholder="Mínimo de 6 caracteres">'+
    '<label class="rc-l" for="rcP2">Repita a nova senha</label>'+
    '<input class="rc-i" id="rcP2" type="password" autocomplete="new-password" placeholder="Igual à de cima">'+
    '<div class="rc-err" id="rcErr"></div>'+
    '<button type="submit" class="rc-b" id="rcBtn">Salvar e entrar</button></form>'+
    '<div class="rc-links"><button type="button" id="rcReenviar" disabled>Reenviar código</button><button type="button" id="rcOutra">'+(R.op&&R.op.email&&R.op.celular?"Mandar de outra forma":"Voltar")+'</button></div>');
  $("rcCod").oninput=function(){this.value=this.value.replace(/\D/g,"").slice(0,6);};
  $("rcOutra").onclick=passoCanal;
  $("rcReenviar").onclick=function(){enviar(R.canal,null);};
  contagem(espera||60);
  $("rcForm").onsubmit=function(e){
    e.preventDefault();
    var c=$("rcCod").value.replace(/\D/g,""),p1=$("rcP1").value,p2=$("rcP2").value;
    if(c.length!==6){erro("O código tem 6 números.");return false;}
    if(p1.length<6){erro("A senha deve ter ao menos 6 caracteres.");return false;}
    if(p1!==p2){erro("As duas senhas não estão iguais.");return false;}
    ocupado("rcBtn",true,"Salvando...");
    var manter=!!($("loginManter")||{}).checked;
    api({action:"recovery_reset",userKey:R.u,codigo:c,newPassword:p1,manter:manter}).then(function(j){
      if(!j._ok){
        ocupado("rcBtn",false);
        erro(j.error||"Não deu para salvar agora. Tente de novo.");
        if(j._status===401||j._status===429){$("rcCod").value="";$("rcCod").focus();}
        return;
      }
      var u=R.u;fechar();
      if(typeof window._entrarCom==="function")window._entrarCom(u,j);
      if(typeof window.hqToast==="function")setTimeout(function(){window.hqToast("🔑 Senha nova criada");},600);
    });
    return false;
  };
}

function contagem(seg){
  if(R.timer)clearInterval(R.timer);
  R.ate=Date.now()+seg*1000;
  var tick=function(){
    var b=$("rcReenviar");if(!b){clearInterval(R.timer);R.timer=null;return;}
    var f=Math.ceil((R.ate-Date.now())/1000);
    if(f>0){b.disabled=true;b.textContent="Reenviar em "+f+" s";}
    else{b.disabled=false;b.textContent="Reenviar código";clearInterval(R.timer);R.timer=null;}
  };
  tick();R.timer=setInterval(tick,1000);
}

window.recAbrir=function(){R={u:"",op:null,canal:null,destino:"",timer:null,ate:0};passoUsuario();};

// ── Cadastro do contato de recuperação ──────────────────────────────────────
// k = a própria pessoa (perfil, pede a senha atual) ou outra (administrador, em Configurações).
window.recContato=function(k){
  var eu=(function(){try{return sessionStorage.getItem("userKey");}catch(e){return null;}})();
  var admin=(function(){try{return sessionStorage.getItem("userAdmin")==="1";}catch(e){return false;}})();
  k=k||eu;if(!k)return;
  var proprio=k===eu,pedeSenha=proprio&&!admin;
  var nome=(window.USERS&&window.USERS[k]&&window.USERS[k].nome)||(typeof USERS!=="undefined"&&USERS[k]&&USERS[k].nome)||k;
  var montar=function(email,cel){
    caixa('<div class="rc-ic">📱</div><div class="rc-t">'+(proprio?"Recuperar a senha":"Recuperação de senha")+'</div>'+
      '<div class="rc-s">'+(proprio?"Se você esquecer a senha, o código para criar uma nova chega aqui. Cadastre pelo menos um.":"Para onde vai o código quando <b>"+esc(nome)+"</b> esquecer a senha. Cadastre pelo menos um.")+'</div>'+
      '<form id="rcForm" autocomplete="off">'+
      '<label class="rc-l" for="rcEmail">E-mail</label>'+
      '<input class="rc-i" id="rcEmail" type="email" inputmode="email" placeholder="nome@exemplo.com.br" value="'+esc(email)+'">'+
      '<label class="rc-l" for="rcCel">Celular (recebe SMS)</label>'+
      '<input class="rc-i" id="rcCel" type="tel" inputmode="tel" placeholder="(19) 99999-1234" value="'+esc(cel)+'">'+
      (pedeSenha?'<label class="rc-l" for="rcAtual">Sua senha atual</label><input class="rc-i" id="rcAtual" type="password" autocomplete="current-password" placeholder="Para confirmar que é você">':'')+
      '<div class="rc-err" id="rcErr"></div>'+
      '<button type="submit" class="rc-b" id="rcBtn">Salvar</button></form>'+
      '<button type="button" class="rc-b2" id="rcVoltar">Cancelar</button>');
    $("rcVoltar").onclick=fechar;
    $("rcForm").onsubmit=function(e){
      e.preventDefault();
      var corpo={action:"set_recovery",userKey:k,email:$("rcEmail").value.trim(),celular:$("rcCel").value.trim()};
      if(pedeSenha){corpo.currentPassword=$("rcAtual").value;if(!corpo.currentPassword){erro("Digite a sua senha atual para confirmar.");return false;}}
      if(!corpo.email&&!corpo.celular&&!confirm("Deixar sem e-mail e sem celular? Aí só o administrador consegue redefinir a senha."))return false;
      ocupado("rcBtn",true,"Salvando...");
      api(corpo).then(function(j){
        ocupado("rcBtn",false);
        if(!j._ok){erro(j.error||"Não deu para salvar agora.");return;}
        fechar();
        if(typeof window.hqToast==="function")window.hqToast("📱 Contato de recuperação salvo");
        if(!proprio&&typeof window.cfgLoad==="function")window.cfgLoad();
      });
      return false;
    };
  };
  if(proprio){
    caixa('<div class="rc-s">Carregando...</div>');
    fetch("/api/users?recuperacao=1").then(function(r){return r.ok?r.json():{};}).catch(function(){return {};})
      .then(function(j){montar(j.email||"",j.celular||"");});
  }else{
    var a=(typeof CFG_AUDIT!=="undefined"&&CFG_AUDIT[k])||{};
    montar(a.rec_email||"",a.rec_celular||"");
  }
};
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&$("rcFundo"))fechar();});
})();
