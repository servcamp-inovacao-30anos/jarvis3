# Faltas injustificadas: como a apuração funciona

Registro da investigação de 26/10/2026: afastados, pessoas com atestado já lançado e demitidos apareciam como falta injustificada na tela de Faltas x Medidas e no aviso semanal por e-mail.

O problema estava na apuração (o que o módulo de faltas guarda como "I"). O módulo de e-mail não foi alterado: ele só lê as faltas com código `I`, então herdou o erro e agora herda a correção.

Princípio: demitido, abono, afastamento e férias **só servem para validar o que é falta injustificada**. Nenhum deles vira cobrança, contador ou marca de alerta; o painel cobra só o que é injustificada.

## Causa

A Ficha de Presença do SAR2G marca `I` em toda falta, e o JARVIS guardava esse `I` sem conferir nada. Os buracos que faziam o `I` ficar:

1. **Demitidos.** A falta de quem saiu da empresa nunca é revista: a pessoa não está mais na planilha, então nenhuma planilha nova volta a falar dela (na planilha de 23/10: cerca de 695 faltas de 90 pessoas fora da lista de ativos).
2. **Atestado e abono lançados como ocorrência.** O SAR2G só troca o `I` por `A`/`J`/`L` na Ficha quando a ocorrência é *concluída*. Enquanto está em elaboração, sem fase ou enviada pelo app (23% dos atestados), a Ficha continua com `I`. A aba DISCIPLINA traz essas ocorrências com período, mas o parser só aproveitava advertência e suspensão.
3. **Dados parciais.** A aba DISCIPLINA da planilha diária mostra só uma janela de tempo. Uma ocorrência que sai dela deixava de dar baixa.
4. **Afastamento (INSS, doença, acidente, licença).** O dia de afastamento chega na Ficha sem situação, e o afastamento lançado depois (retroativo) não alcançava as faltas dos dias anteriores.
5. **Atestados em sequência.** Quem fica semanas fora com atestados seguidos (e acaba no INSS) tem dias "no meio" sem atestado lançado. A Ficha marca `I` neles, mas a pessoa nunca voltou a trabalhar.
6. **Falta antiga.** Cada planilha só revia as datas que trazia. Um `I` de um dia que já saiu da planilha nunca era corrigido.

## Correção

Tudo antes de gravar em `fm_faltas` (`api/_faltas.js`, regras em `api/_faltas_regras.js`):

| Situação da falta `I` | Código gravado | Cobrada? |
|---|---|---|
| Pessoa registrada como demitida ou fora da lista de ativos da planilha (RE e primeiro nome) | `D` demitido | não |
| Atestado, justificativa, abono legal ou treinamento lançado no SAR2G (qualquer fase, menos cancelada) cobrindo o dia | `A` / `J` / `L` | não |
| Afastamento, doença ou licença lançado no SAR2G cobrindo o dia | `AF` | não |
| Dia entre dois atestados/afastamentos da pessoa, sem nenhum dia trabalhado na Ficha, com no máximo 15 dias de lacuna | `AF` | não |
| Qualquer outra | `I` | **sim** |

- **Ocorrências guardadas.** Tudo o que a aba DISCIPLINA traz a cada planilha fica guardado (atestado, abono, justificativa, declaração de horas, afastamento, licença, com período e fase) e soma com o que já estava. Só se grava o que é novo ou mudou. Uma ocorrência cancelada no SAR2G deixa de cobrar na planilha seguinte. Fica no log de registros que o módulo já usa (`fm_auditoria`, ação `OCORRENCIA_SAR2G`): **não há tabela nova no banco**.
- **Relatório completo.** O botão "Enviar histórico" aceita o relatório de ocorrências do SAR2G e também guarda os atestados e afastamentos dele; ao enviar, as faltas `I` já guardadas que eles cobrem dão baixa na hora (mesmo relatório que já alimentava o histórico de medidas, sem passo novo).
- A conferência vale para todas as pessoas e para **todas as faltas `I` já guardadas**, não só as da planilha do dia. Cada troca fica em `fm_auditoria` (`FALTA_REAPURADA`, com o código antes, o depois e o motivo).
- Só `I` é mexido. O que o SAR2G já abonou fica como veio.
- **Declaração de qualquer tamanho tira a falta de injustificada.** Atraso abonado ou justificado, saída antecipada e declaração de horas cobrem só parte do dia, mas quem apresentou a declaração não está em falta injustificada naquele dia: a falta `I` do dia vira `A`/`J`. Só o que o SAR2G marca como INJUSTIFICADO fica de fora. Essas declarações de parte do dia não ligam dois atestados (não contam como ausência contínua).
- **Base de demitidos.** Quem a planilha dá como fora dos ativos é conferido a cada envio. Quem o RH registra à mão (botão "Marcar como demitido" no detalhe do caso, só aprovadores) entra na hora e nunca mais é cobrado, mesmo que a planilha ainda o mostre como ativo. O registro (RE + primeiro nome, o RE se repete entre as empresas do grupo) fica em `fm_auditoria` (`DEMITIDO_REGISTRADO` / `DEMITIDO_DESFEITO`). Demitidos **não aparecem no painel**.
- A lista de ativos só vale se vier com pelo menos 100 pessoas (a real tem ~550). Aba cortada não transforma ninguém em demitido.
- Afastamento sem data de fim (o SAR2G grava o fim um dia antes do início enquanto está aberto) vale até a Ficha mostrar a pessoa trabalhando depois do início. Não depende da situação da pessoa na planilha: um afastamento lançado hoje conta mesmo com a pessoa ainda como ATIVO.
- Na tela, as faltas cobertas por afastamento aparecem junto das abonadas (aba Resolvidas), como "Afastamento". Férias e INSS não viram marca nem categoria nos casos: quem tem falta injustificada antes de entrar em férias ou INSS aparece como caso normal.
- Quem está em **aviso prévio trabalhado** continua contando, com a marca "Em aviso prévio" no card.
- RE igual com primeiro nome diferente é outra pessoa.

O que **não** muda: falta de quem está ativo e sem atestado ou afastamento que cubra o dia continua sendo injustificada. A Karolyne (RE 129) é um exemplo: os atestados dela terminam em 04/10 e nenhuma ocorrência cobre 06/09, 24/09, 06/10, 08/10, 10/10 e 12/10, então essas seis continuam injustificadas.

## Para usar

1. Não há nada a criar no Supabase: as ocorrências e os demitidos usam o log de registros que já existe (`fm_auditoria`).
2. Publicar. Enviar o relatório de ocorrências do SAR2G em "Enviar histórico" (uma vez, para trazer o passado) e depois a planilha diária como sempre. A resposta de `/api/import` traz `faltas_medidas.reapuradas`: quantas faltas mudaram de código.
3. Conferir: `fm_auditoria` com `acao = 'FALTA_REAPURADA'` lista cada falta revisada.
4. Registrar um demitido que a planilha ainda não tirou: botão "Marcar como demitido". Para desfazer: `POST /api/rh?modulo=faltas&t=demitido` com `{ re, nome, remover: true }` (as faltas voltam a `I`).

## Limites conhecidos

- Demitido é "não está na lista de ativos da planilha" ou registrado à mão. Quem sai da lista por outro motivo (cadastro errado, transferência) também sai da cobrança. Na revisão de 23/10: RE 4693 está fora dos ativos mas teve presença em 18/10; RE 3862 (desligamento no RH em 10/08, ativa na planilha) e RE 4651 (aviso prévio, desligamento em 05/10) continuam cobradas. Mateus Correa (RE 489) aparece como aviso prévio na planilha de 23/10 e precisa ser registrado à mão.
- A baixa depende de o atestado ou afastamento existir como ocorrência no SAR2G (na aba DISCIPLINA ou no relatório). Um afastamento lançado depois do último relatório só entra com a próxima planilha ou um novo relatório.
- **Férias não são ocorrência.** O SAR2G não gera falta nos dias de férias e o JARVIS só sabe que a pessoa está de férias hoje, não as datas. Uma falta `I` num dia em que a pessoa já estava de férias não é identificada.
- A regra de lacuna entre atestados (15 dias, sem dia trabalhado) é uma decisão de negócio: o limite é `MAX_LACUNA_AFASTAMENTO` em `api/_faltas_regras.js`.
