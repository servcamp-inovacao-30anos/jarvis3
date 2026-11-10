# Feedback de Faltas (SAC) — regras e instalação

Decidido com o Raphael em 05/11/2026; tela e fluxo refeitos em 10/11/2026. Código: `api/ligacoes.js`, regras em `api/_lig_regras.js`, WhatsApp em `api/_lig_whatsapp.js` + `wa-sac/`.

## Regra principal: falta com feedback não gera alarme na cobrança

| Situação da falta | Onde aparece |
|---|---|
| Injustificada, **sem** feedback registrado | Painel de cobrança (Faltas x Medidas), como sempre |
| Pessoa com feedback registrado **e baixado** pela coordenação | Só no perfil dela, no *Acompanhamento de 30 dias* (código `T` em `fm_faltas`) |
| Abonada, justificada, licença (A/J/L) | Lista própria "Abonadas e justificadas", sem cobrança |
| Afastado (AF) ou desligado (D) | Fora da fila de contato |

- A baixa cobre as faltas injustificadas de **30 dias antes a 30 dias depois** da data do contato (`JANELA_DIAS` em `_lig_regras.js`). Falta dentro dessa janela vira `T` mesmo quando chega numa planilha futura; depois dos 30 dias volta a ser cobrada.
- Falta injustificada depois do contato "quebra" o acompanhamento: o alerta é só no perfil. Atestado/abono depois do contato não quebra.
- **Só o Raphael, a Jussilene e o João** (`MD.ehCoordenacao`) dão ou desfazem a baixa, excluem contato, conectam o WhatsApp e editam a mensagem padrão. Os demais com a permissão `lig` registram o contato; a falta continua na cobrança até a baixa ("aguardando baixa da coordenação").
- Desfazer a baixa, excluir o contato ou marcar o acordo como descumprido devolve as faltas à cobrança (`T` → `I`).
- Atestado, afastamento e demissão valem mais que a baixa: a falta vira A/J/L, AF ou D.
- Sem tabela nova: tudo é evento na `fm_auditoria` (entidade `lig_contato`): `FEEDBACK_BAIXA`, `FEEDBACK_BAIXA_DESFEITA`, `LIG_ACORDO`, `LIG_CONTATO_EDITADO`, `LIG_CONTATO_EXCLUIDO` (guarda o contato inteiro), `LIG_ZAP_ENVIO`, `LIG_ZAP_MODELO`.
- Se o log estiver fora do ar, a planilha continua e as faltas `T` continuam `T` (não volta alarme em massa).

## Como o SAC trabalha (10/11/2026): modelo receptivo

O SAC **não liga**. Quem faltou sem justificar recebe um WhatsApp do número do SAC pedindo que ligue. Quem ligar, o SAC registra a conversa. Quem não ligar fica como "não respondeu". A tela tem quatro situações, e cada pessoa está em uma só (a conta é do servidor, em `api/_lig_painel.js`, rota `GET ?acao=painel`):

| Situação | Quem entra | Sai quando |
|---|---|---|
| Enviar mensagem | Faltou sem justificar e ainda não recebeu o WhatsApp do SAC (ou faltou de novo depois da última mensagem) | O SAC envia a mensagem |
| Aguardando ligação | A mensagem foi enviada e a pessoa ainda não ligou. Dentro do prazo mostra "Aguardando ligação"; passado o prazo, "Não ligou" | Ela liga (conversa registrada), ou faltar de novo |
| Com a coordenação | 2 tentativas sem retorno: a coordenação conversa com a pessoa | A coordenação registra a conversa |
| Em acompanhamento | Ligou e a conversa foi registrada, há até 30 dias | Passam os 30 dias, ou desligamento |

- **Prazo da mensagem:** a pessoa tem até o fim do dia seguinte ao envio (`PRAZO_RESPOSTA_DIAS`). Passou, vira tentativa sem retorno.
- **Tentativa:** mensagem enviada que venceu sem a pessoa ligar, ou "Não consegui falar" registrado à mão. A segunda só conta se a pessoa **faltou de novo** depois da primeira: duas mensagens para a mesma falta contam uma tentativa só. Duas tentativas levam à coordenação ("Com a coordenação"). Mensagem que falhou no envio não conta.
- **Conversa registrada zera tudo.** O registro tem só duas escolhas: "Falei com a pessoa" (motivo, o que disse, combinado com prazo, retirar da cobrança) e "Não consegui falar" (observação). Contato antigo, sem resultado, continua valendo como conversa; nada do histórico é migrado.
- **Telefone:** vem da base de contatos do ponto (`pt_contatos`, só os enviáveis), pelo RE. Se não houver, o campo fica editável.
- **A tela só pede dois resultados**, mas o servidor continua aceitando os 10 antigos (`RESULTADOS` em `_lig_regras.js`); a tela nova grava `SEM_RESPOSTA` com `proxima:"NENHUMA"` (sem atividade, sem data). As abas Atividades, Acordos e Sem posicionamento saíram da tela; a rota `?acao=sem_retorno` e os eventos `LIG_ATIVIDADE` seguem no servidor, sem uso na tela.
- **Abonadas** não pedem mensagem e não têm lista: aparecem em âmbar na faixa de dias do panorama da pessoa.

## Acompanhamento de 30 dias: análise, não barra de progresso

Cada pessoa é um card: nome, dia X de 30, **veredito**, calendário de 30 dias, com a data (dd/mm) em cada dia e as faltas coloridas, faltas nos 30 dias antes x depois do contato e quem falou com ela. Clicar abre o **panorama** (painel lateral): frase de conclusão, antes x depois, calendário de 60 dias com o contato no meio, o combinado e a linha do tempo (faltas, mensagens, conversas, baixa e medidas). Só falta injustificada (`I`) ou já tratada (`T`) pesa na conta; abonada, afastamento e desligamento não.

| Veredito | Regra |
|---|---|
| Em observação | Nenhuma falta depois do contato e menos de 7 dias: cedo para concluir |
| Melhorou | Nenhuma falta depois, ou menos faltas depois do que antes |
| Igual a antes | Mesmo número de faltas antes e depois: a conversa não fez diferença |
| Piorou | Mais faltas depois do que antes |

A regra mora em um lugar só (`veredito` em `_lig_painel.js`) e é testada. "Falta a baixa da coordenação" aparece quando há conversa, falta pendente na janela e ninguém deu a baixa.

## Acordo com prazo (conferência automática)

O contato aceita "prazo do acordo". Quando a planilha sobe, o sistema confere sozinho: a falta combinada virou abonada (A, J ou L, com atestado no sistema) → **cumpriu**; o prazo passou e a falta segue sem justificativa → **não cumpriu**; senão **em aberto**. Aparece de forma discreta: um selo no card e uma linha no panorama, sem alarme. A coordenação também pode marcar "cumprido" ou "não cumpriu" à mão, e a marcação manual vale mais. **Não cumpriu** manual (só coordenação) desfaz a baixa; a conferência automática só sinaliza, nunca mexe na cobrança.

## Segurança do módulo (o que mudou)

Antes: qualquer usuário logado lia/editava/apagava tudo; o telefone ia sem escape para dentro de um `onclick` (XSS armazenado); `criado_por` vinha do navegador; DELETE apagava sem rastro.
Agora: permissão `lig` conferida no servidor (lista fixa em `_lig_regras.js`, conferida contra o `USERS` do `index.html` por teste; usuários criados na tela usam `app_users.perms.lig`); validação de todos os campos; autoria pelo token; edição e exclusão auditadas; botões da tela usam só índices, nunca dado do banco.

## WhatsApp do SAC (Baileys, sem Evolution)

Como no VocalTask: o Baileys roda **no PC do SAC**, sem chave e sem domínio. A tela do Jarvis fala direto com ele (127.0.0.1:3939); a API do sistema só confere telefone e limites (`zap_autorizar`) e registra o resultado (`zap_registrar`).

Uso:
1. No PC do SAC, abrir **wa-sac/Iniciar WhatsApp SAC.bat**. Na primeira vez ele instala e pergunta o endereço do sistema (ex.: o endereço que aparece no navegador); só essa página pode usar o serviço. Deixar a janela aberta.
2. No Jarvis: Feedback de Faltas → Visão geral → **Conectar pelo QR code** → no celular do SAC: WhatsApp → Aparelhos conectados → Conectar um aparelho. A sessão fica salva; nas próximas vezes não precisa ler de novo.
3. O envio só funciona a partir desse PC (o navegador precisa alcançar o programa).

Segurança: o serviço escuta só em 127.0.0.1, confere o cabeçalho Host e recusa qualquer página que não seja a do sistema (outro site aberto no PC não consegue mandar mensagem). A CSP do `vercel.json` libera `connect-src` para http://127.0.0.1:3939.

Limites no envio: 3 mensagens por pessoa por dia, 1 minuto entre mensagens para a mesma pessoa, até 15 por vez no envio em massa, fila única com intervalo no serviço. O modo "nuvem" (com `WA_API_KEY`) continua existindo no `wa-sac`, mas o Jarvis não usa mais.

Não foi testado com o WhatsApp real pareado (precisa de um número). O primeiro teste deve ser com o seu próprio número.

## Vocabulário da tela (10/11/2026)

Uma palavra para cada coisa, em todas as telas, sem expressões que exigem interpretação:

- **Situações:** Enviar mensagem · Aguardando ligação · Com a coordenação · Em acompanhamento.
- **Veredito:** Melhorou · Igual a antes · Piorou · Em observação (a explicação aparece acima da lista).
- **Tempo:** "Contato há 9 dias" e "acompanhamento até 01/12". Não existe mais "dia 9 de 30".
- **Combinado:** cumprido · pendente · não cumprido.

## Envio em lote e resumo para a coordenação

- **Lote:** na aba Enviar mensagem cada card tem uma caixa de seleção. Vai até 15 pessoas por vez (o WhatsApp bloqueia número que dispara em massa). A tela manda uma mensagem por vez, cada uma pelo mesmo caminho do envio individual, então valem os mesmos limites (3 por pessoa por dia, 1 minuto entre mensagens para a mesma pessoa) e a fila do `wa-sac/` espaça os envios. Quem não tem celular válido fica de fora e é avisado; se o WhatsApp cair no meio, o lote para. A mensagem usa o texto padrão, editável antes de enviar, com `{nome}` e `{data}` preenchidos para cada pessoa.
- **Resumo:** no panorama (e no card de quem está com a coordenação) o botão gera um texto simples para copiar: faltas antes e depois, mensagens do SAC, contatos registrados, combinado e medidas. Nada é guardado.
- **Listas grandes:** os cards aparecem de 24 em 24 ("Mostrar mais"); a busca por nome ou RE enxerga todos.
