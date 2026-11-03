# Sessão salva no aparelho e comunicado semanal no painel

Fase 1 do plano de assinatura digital da medida disciplinar (a parte que não depende do jurídico).
O plano completo está em `plano-medida-disciplinar-assinatura-digital.md`; aqui fica o que já está no código.

## Sessão salva ("Manter conectado")

- No login há a caixa **Manter conectado neste aparelho**. No celular ela já vem marcada; no notebook, desmarcada
  (pode ser compartilhado).
- Marcada, o servidor emite uma sessão de **30 dias** (`m:1` no token) e a página guarda a cópia no `localStorage`
  (`assets/sessao/sessao.js`). Sem marcar, tudo segue como antes: 12 h, só até fechar o navegador.
- A cada abertura do painel (e a cada 6 h com a tela ligada, como a TV) a página pede `POST /api/users {action:"renew"}`
  e a sessão volta a valer 30 dias. O servidor só renova token de "manter conectado", e não renova conta bloqueada
  nem sessão encerrada.
- **Sair** (perfil) apaga a cópia e recarrega. **Sair de todos os aparelhos** (`action:"logout_all"`) grava o evento
  `SESSAO_REVOGADA` na `fm_auditoria`: toda sessão emitida antes dele deixa de valer em todas as rotas
  (`_auth.recusarSeBloqueado`), inclusive a renovação. A chave do Excel (escopo restrito) não é atingida.
- Trocar a senha, ou o administrador redefinir a senha de alguém, faz o mesmo encerramento. Na troca, o token novo
  devolvido continua valendo.
- Bloqueio em Configurações continua derrubando a sessão (agora também a de 30 dias, na próxima chamada).
- Limite conhecido: o token fica no `localStorage`, e o CSP do sistema aceita script inline (`unsafe-inline`), então um
  XSS leria o token. A defesa é o encerramento remoto acima e a validade curta de quem não marca a caixa.

## Comunicado semanal dentro do painel

- O botão do e-mail abre `/?pg=faltassup&aba=COMUNICADO`: um endereço só, sem nome, RE ou motivo. Quem manda é o login:
  o servidor confere a área de quem pede (mesma regra `MD.daArea` das medidas).
- No envio oficial de cada área, `api/_faltas_email.js` grava um evento `FALTAS_EMAIL_COMUNICADO` com o comunicado
  **como foi enviado** (colaboradores, datas, histórico do ano, atualizações). Fica separado do `FALTAS_EMAIL_ENVIADO`
  porque o painel do aviso lê esse registro inteiro a cada abertura. Se não gravar, o e-mail já enviado vale.
- Rotas (módulo `faltas`): `GET comunicados` (lista leve, só as últimas 8 semanas e a área de quem pede) e
  `GET comunicado&semana=&area=` (completo). Área de outra pessoa e comunicado inexistente respondem igual (404).
- Abrir registra `FALTAS_COMUNICADO_ABERTO` (uma vez por supervisor, semana e área; a coordenação olhando não conta).
  O painel do aviso mostra "Aberto no painel por … " ou "Ainda não aberto no painel" ao lado de cada área.
- Em cada colaborador, o **Gerar medida** abre a janela da medida (`mdAbrir`) no caso dele; ao lado aparece a situação
  de agora (em aberto, medida já aplicada, medidas já geradas).
- No celular a janela da medida mostra o documento em texto, numa coluna de 16 px; "Ver como fica impresso" volta à folha A4.

## Notificação no celular (`api/_push.js`, `sw.js`)

- O comunicado sai também por notificação, para os aparelhos do supervisor da área, sem nome de colaborador:
  "Comunicado semanal de faltas injustificadas · Semana de dd/mm a dd/mm. Toque para abrir." O toque abre a aba do comunicado.
- Canal independente do e-mail (registro `FALTAS_PUSH` por semana e área): falhar não segura o e-mail, e não se repete.
- **Lembrete**: no dia seguinte ao envio, a partir das 9h, uma vez, para quem não abriu o comunicado no painel (o cron das horas).
- Usa os mesmos eventos do módulo antigo (`AVISO_APARELHO`, `AVISO_VAPID`): as chaves de envio são as mesmas. Como o painel
  cancelava a inscrição ao abrir desde 23/10, cada supervisor precisa tocar uma vez em **Permitir**, na aba do comunicado.

## Assinatura no celular, PDF selado e via (`api/_assinatura.js`, `api/_via.js`, `assets/medida/assinatura.js`, `via.html`)

- Em "Medidas geradas" (e logo depois de gerar) há **Assinar no celular**: o supervisor assina (a assinatura do perfil, com um
  toque, ou desenhando), entrega o celular, o colaborador lê o documento inteiro, marca "Li e estou ciente" e assina com o dedo.
- Ou **recusa**: nome e documento das duas testemunhas (as duas linhas do modelo em papel) e observação opcional.
- O servidor monta o PDF (`pdf-lib`) com a página de evidências (hora do servidor, login de quem coletou, IP, aparelho, hash
  do texto lido), calcula o SHA-256 do arquivo final e grava tudo na `fm_auditoria` (`MEDIDA_COLETA` e `MEDIDA_ASSINADA`
  com `digital:true`). O texto do PDF é o mesmo do documento da tela: `test/assinatura.test.js` confere trecho por trecho.
- O número MD é o de hoje: sai ao gerar a medida (a assinatura vem depois, sobre uma medida já numerada).
- Sinal fraco: a coleta fica guardada no aparelho e é reenviada sozinha; a chave única (`idem`) impede segunda assinatura.
- PDF digital não é trocado nem removido por anexo em papel; medida com papel anexado não recebe assinatura digital.
- **Via**: QR na tela (15 minutos, sem senha), SMS para o celular cadastrado e marcado como enviável em `pt_contatos`
  (30 dias, pede o RE e os 4 últimos dígitos do celular, trava depois de 5 erros em 24 h) ou e-mail digitado na hora
  (30 dias, mesma confirmação). O código vai depois do `#` do endereço e só o hash dele é guardado. Cada abertura fica registrada.
- Sem `SMS_PROVIDER` o SMS avisa que está desligado e o QR continua funcionando.

## O que não é código

- A **validação do jurídico** (fase 0 do plano): assinatura simples com essa trilha, testemunhas no digital, termo de aceite,
  guarda e LGPD. O papel continua funcionando em paralelo até o piloto terminar.
- O **piloto** em celulares reais dos supervisores (Android) e o teste da página da via num iPhone.
- O **código de 6 dígitos por SMS** para o colaborador confirmar a assinatura, que o plano deixa para "se o jurídico pedir".
- `launch_handler` no manifesto é um extra: o Android e o Gmail decidem onde o link abre.
