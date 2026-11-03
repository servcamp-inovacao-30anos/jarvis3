/* Página pública da via do documento da medida (via.html). O código do link vem depois do "#": não vai para o log do
   servidor nem para o Referer. QR vale 15 minutos e abre direto; SMS e e-mail pedem o RE e os 4 últimos dígitos do
   celular cadastrado. O servidor é o api/_via.js (?modulo=via). */
(function(){
"use strict";
var codigo=String(location.hash||"").replace(/^#/,"").trim();
var $=function(id){return document.getElementById(id);};
var tipo=null,ocupado=false;
function msg(t,erro){var e=$("viaTxt");e.textContent=t;e.className="via-txt"+(erro?" er":"");}
function api(corpo){
  return fetch("/api/rh?modulo=via"+(corpo?"":"&c="+encodeURIComponent(codigo)),corpo?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(corpo)}:{})
    .then(function(r){return r.json().catch(function(){return {};}).then(function(j){j.status=r.status;return j;});});
}
var iPhone=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
function arquivo(b64){var bin=atob(b64),a=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return new Blob([a],{type:"application/pdf"});}
function baixar(j){
  var url=URL.createObjectURL(arquivo(j.base64));
  var ab=$("viaAbrir");ab.href=url;ab.hidden=false;
  $("viaHash").textContent="Código de verificação do arquivo (SHA-256): "+j.sha256;$("viaHash").hidden=false;
  $("viaForm").hidden=true;$("viaBt").hidden=true;
  $("viaTit").textContent="Documento pronto";
  msg("Pronto. Se o download não começou sozinho, toque em “Abrir o documento”.",false);
  if(iPhone){$("viaIos").hidden=false;window.location.href=url;return;} // o iPhone abre o PDF na tela
  var a=document.createElement("a");a.href=url;a.download=j.nome||"documento.pdf";document.body.appendChild(a);a.click();a.remove();
}
function pedir(){
  if(ocupado)return;
  var corpo={c:codigo};
  if(tipo==="LINK"){
    corpo.re=$("viaRe").value.trim();corpo.ult4=$("viaUlt4").value.replace(/\D/g,"");
    if(!corpo.re||corpo.ult4.length!==4){msg("Preencha o seu RE e os 4 últimos dígitos do celular.",true);return;}
  }
  ocupado=true;$("viaBt").disabled=true;$("viaBt").textContent="Abrindo…";msg("Abrindo o documento…",false);
  api(corpo).then(function(j){
    if(j.ok&&j.base64){baixar(j);return;}
    msg(j.status===403?"O RE ou os dígitos não conferem. Confira e tente de novo.":(j.error||"Não foi possível abrir agora. Tente de novo."),true);
    if(j.status===410||j.status===429)$("viaBt").hidden=true,$("viaForm").hidden=true;
  }).catch(function(){msg("Sem conexão. Tente de novo quando houver sinal.",true);})
    .then(function(){ocupado=false;$("viaBt").disabled=false;$("viaBt").textContent="Baixar meu documento";});
}
$("viaBt").addEventListener("click",pedir);
$("viaForm").addEventListener("submit",function(e){e.preventDefault();pedir();});
if(!codigo){msg("Este link está incompleto. Abra o endereço completo que você recebeu.",true);}
else api(null).then(function(j){
  if(!j.ok){msg(j.error||"Este link não vale mais. Peça um novo ao seu supervisor.",true);return;}
  tipo=j.tipo;
  if(tipo==="LINK"){msg("Para abrir o seu documento, confirme quem é você.",false);$("viaForm").hidden=false;}
  else msg("Seu documento está pronto.",false);
  $("viaBt").hidden=false;
}).catch(function(){msg("Sem conexão. Tente de novo quando houver sinal.",true);});
})();
