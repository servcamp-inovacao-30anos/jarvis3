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

## O que ainda não está feito

- **Notificação no celular** e o **lembrete no dia seguinte** para quem não abriu: dependem de reativar o código de
  push removido em 23/10 (`bc46269`, `712b9ed`, dependência `web-push`) e de testar em aparelhos reais.
- **Fases 2 a 5** (assinatura no celular, PDF selado, via por QR e SMS, recusa): só depois da validação do jurídico
  (fase 0). Aqui entram o número MD reservado na assinatura (hoje `numerar()` calcula, não grava) e o `pdf-lib`.
- `launch_handler` no manifesto é um extra: o Android e o Gmail decidem onde o link abre. Conferir no piloto.
