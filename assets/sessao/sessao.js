/* Sessão salva no aparelho ("Manter conectado").
   Fica fora do index.html porque ele está no limite de tamanho (test/auth_exigencia).
   Carrega no <head>, antes do script principal: a restauração precisa acontecer antes de a página
   ler a sessão. O prazo e a renovação são do servidor (api/users.js: authenticate com manter, renew):
   aqui só se guarda o que ele emitiu.

   Como funciona
   • Quem marca "Manter conectado" recebe do servidor um token de 30 dias, marcado com m:1.
     A cópia da sessão vai para o localStorage; a de 12 h continua só no sessionStorage.
   • Ao abrir a página (ou o app instalado) a cópia volta para o sessionStorage e a sessão é renovada
     por mais 30 dias. Uma tela deixada ligada (a TV) renova a cada 6 h.
   • Sair apaga a cópia. "Sair de todos os aparelhos" pede ao servidor para invalidar tudo o que ele
     emitiu até agora; bloqueio e troca de senha fazem o mesmo.
   • Quem manda continua sendo o servidor: token vencido, bloqueado ou encerrado volta ao login. */
(function(){
"use strict";
var CH="jarvisSessao",RENOVA_MS=6*3600000;

function ler(k){try{return window.localStorage.getItem(k);}catch(e){return null;}}
function gravar(k,v){try{window.localStorage.setItem(k,v);return true;}catch(e){return false;}}
function tirar(k){try{window.localStorage.removeItem(k);}catch(e){}}

// O token é "corpo.assinatura"; o corpo (base64url) é um JSON público: dá para ler o prazo e a marca m sem a chave.
function corpoDoToken(t){
  try{
    var b=String(t||"").split(".")[0].replace(/-/g,"+").replace(/_/g,"/");
    while(b.length%4)b+="=";
    var bin=atob(b),bytes=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }catch(e){return null;}
}
function salvaValida(){
  var s=null;try{s=JSON.parse(ler(CH)||"null");}catch(e){}
  if(!s||s.v!==1||!s.k||s.k.logged!=="1"||!s.k.authToken||!(s.exp>Date.now()))return null;
  return s;
}
// Guarda no aparelho só o que a página precisa para reabrir logada: o token e os dados do perfil.
function salvar(renovadaEm){
  var tok=null;try{tok=sessionStorage.getItem("authToken");}catch(e){}
  var p=corpoDoToken(tok);
  if(!p||!p.m||!(p.exp>Date.now())){tirar(CH);return false;} // sessão comum de 12 h não fica no aparelho
  var k={};
  try{
    for(var i=0;i<sessionStorage.length;i++){
      var n=sessionStorage.key(i);
      if(n==="logged"||n==="authToken"||n.indexOf("user")===0)k[n]=sessionStorage.getItem(n);
    }
  }catch(e){return false;}
  return gravar(CH,JSON.stringify({v:1,exp:p.exp,em:renovadaEm||Date.now(),k:k}));
}
function apagar(){tirar(CH);}

// 1) restaura antes de qualquer outro script da página ler a sessão
(function restaurar(){
  var logado=null;try{logado=sessionStorage.getItem("logged");}catch(e){}
  if(logado==="1")return;
  var s=salvaValida();
  if(!s){if(ler(CH))apagar();return;}
  try{Object.keys(s.k).forEach(function(n){sessionStorage.setItem(n,s.k[n]);});}catch(e){}
})();

function sessaoSalva(){var t=null;try{t=sessionStorage.getItem("authToken");}catch(e){}var p=corpoDoToken(t);return !!(p&&p.m);}

// 2) renovação: o servidor confere bloqueio e encerramento e devolve a sessão por mais 30 dias
var renovando=false;
function renovar(forcar){
  if(renovando||!sessaoSalva())return;
  var s=salvaValida();
  if(!forcar&&s&&Date.now()-(s.em||0)<RENOVA_MS)return;
  var tok=sessionStorage.getItem("authToken");
  renovando=true;
  fetch("/api/users",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+tok},body:JSON.stringify({action:"renew"})})
    .then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {status:r.status,j:j};});})
    .then(function(x){
      if(x.status===200&&x.j&&x.j.token){sessionStorage.setItem("authToken",x.j.token);salvar();return;}
      // 401 = vencida, bloqueada ou encerrada em outro aparelho: volta ao login. Outro erro (sem sinal, servidor fora): tenta depois.
      if(x.status===401&&typeof window._sessaoExpirou==="function")window._sessaoExpirou(x.j&&x.j.bloqueado?"Seu acesso foi bloqueado pelo administrador.":(x.j&&x.j.encerrada?"Sua sessão foi encerrada. Entre de novo.":""));
    })
    .catch(function(){})
    .then(function(){renovando=false;});
}

window.sessaoManter=sessaoSalva;
window.sessaoAtualizar=function(){salvar();};

// 3) sair
function sair(){
  apagar();
  var manter=null;try{manter=sessionStorage.getItem("introVisto");sessionStorage.clear();if(manter)sessionStorage.setItem("introVisto",manter);}catch(e){}
  location.reload(); // recarrega: nada da sessão anterior fica na memória da página
}
window.sessaoSair=sair;
window.sessaoSairDeTodos=function(){
  if(!window.confirm("Sair de todos os aparelhos?\n\nVocê precisará entrar de novo em cada um deles, inclusive neste."))return;
  fetch("/api/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"logout_all"})})
    .then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok&&j&&j.ok,j:j};});})
    .then(function(x){
      if(x.ok){sair();return;}
      var m=(x.j&&x.j.error)||"Não consegui encerrar as sessões agora. Tente de novo.";
      if(typeof window.hqToast==="function")window.hqToast("⚠️ "+m);else window.alert(m);
    })
    .catch(function(){window.alert("Sem conexão. Tente de novo quando houver sinal.");});
};

// 4) ligações com o script principal (as funções dele só existem depois que a página termina de carregar)
function ligar(){
  var caixa=document.getElementById("loginManter");
  // no celular o padrão é ficar conectado; no notebook, que pode ser compartilhado, o padrão é desligado
  if(caixa&&window.matchMedia&&window.matchMedia("(pointer:coarse)").matches)caixa.checked=true;
  if(typeof window._abrirSessao==="function"){
    var a0=window._abrirSessao;
    window._abrirSessao=function(){var r=a0.apply(this,arguments);salvar();return r;};
  }
  if(typeof window._sessaoExpirou==="function"){
    var e0=window._sessaoExpirou;
    window._sessaoExpirou=function(){apagar();return e0.apply(this,arguments);};
  }
  renovar();
  setInterval(function(){renovar(true);},RENOVA_MS);
  // saiu em outra aba: esta também sai (a cópia some do aparelho)
  window.addEventListener("storage",function(ev){
    if(ev.key===CH&&!ev.newValue&&sessaoSalva()&&!salvaValida()){
      try{sessionStorage.removeItem("authToken");sessionStorage.removeItem("logged");}catch(e){}
      location.reload();
    }
  });
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ligar);else ligar();
})();
