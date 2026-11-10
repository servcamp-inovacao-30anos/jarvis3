# Feedback de Faltas — versão 3 (pedido do Raphael, 10/11/2026)

Especificação fechada depois das perguntas. Referências: as 4 imagens enviadas
(cabeçalho, tela vazia, panorama, cards do monitoramento).

## Regras visuais

- Nenhuma barra ou borda colorida (cards, abas, diálogos, títulos). A cor vem do
  fundo levemente tingido, como nos cards da imagem 4.
- Sem emoji. Mesma paleta azul-marinho do Grupo ServCamp.

## 1. Cabeçalho (imagem 1)

- Faixa azul-marinho: ícone, título "Feedback de Faltas" e
  "Grupo ServCamp · Hoje · dd/mm/aaaa".
- Barra de filtros única, que vale para o módulo inteiro:
  - **Período:** Hoje, Semana, Mês ou um período escolhido.
  - **Turno:** Todos, Diurno, Noturno.
  - **Área:** os supervisores.
- **Números do topo** (todos mostram o total e separam
  "X sem justificativa · Y abonadas/atestado"):
  - faltas de hoje;
  - faltas na folha atual (26 a 25);
  - faltas no período filtrado;
  - média de minutos por feedback.
- **Histórico geral:** busca por nome ou RE de qualquer colaborador da planilha,
  mesmo quem nunca recebeu feedback. Abre o panorama da pessoa.
- **Ações sempre visíveis:** "Enviar WhatsApp" (com o estado da conexão) e
  "Registrar feedback".

## 2. Abas (menu único)

1. **Fila do SAC:** Enviar mensagem · Aguardando ligação · Com a coordenação.
   - Cada card tem "Enviar WhatsApp" e "Registrar feedback".
   - Envio em lote continua.
2. **Monitoramento 30 dias:** os filtros Todos · Piorou · Igual a antes ·
   Em observação · Melhorou (com contagem) ficam aqui dentro.
3. **Desempenho:** ver a seção 5.
4. **Histórico:** todos os contatos registrados.

## 3. Tela sem resultado (imagem 2)

- Ilustração própria em SVG: documento, gráfico e lupa, em tons de azul.
- Texto: "Acompanhe o comportamento de faltas de forma clara e organizada." e
  "Use os filtros acima para refinar sua busca."

## 4. Cards do monitoramento (imagem 4)

- Horizontais, vários por linha, fundo tingido pelo resultado:
  - vermelho para Piorou;
  - âmbar para Igual;
  - azul para Em observação;
  - verde para Melhorou.
- Conteúdo:
  - iniciais, nome, RE · posto;
  - o resultado em pílula com ícone;
  - "2 faltas em 30 dias (02/10 a 01/11)" ao lado de
    "4 faltas em 9 dias (02/11 a 10/11)", com o número de depois em vermelho
    quando piorou;
  - ícone de tendência e seta para abrir o panorama.

## 5. Panorama lateral (imagem 3)

- Cabeçalho com a **foto enviada pelo Raphael**, que aguarda o arquivo original.
- Avatar, nome, RE · posto · supervisor e o resultado.
- Três cartões: Antes do contato · Depois do contato · Acompanhamento.
- Evolução das faltas (duas barras e a variação em %), com o link "Ver detalhes".
- Calendário de faltas, mês a mês, com a legenda ao lado.
- Linha do tempo (30 dias antes · contato do SAC · até hoje), com o link
  "Ver histórico".
- Rodapé com Enviar WhatsApp, Registrar feedback e Fechar.

## 6. Aba Desempenho

- **Chave de mês:** "Folha (26 a 25)" ou "Mês do calendário".
- **Mês inicial:** escolhido pelo usuário. A comparação vai até o mês atual.

Blocos:

1. **Pessoas com feedback.** Soma das faltas delas no mês inicial x no mês
   atual, em %. Também mostra a curva mês a mês e a % de pessoas que melhoraram.
2. **Empresa toda.** Total de faltas de todos os colaboradores mês a mês, em %
   do mês inicial ao atual. Mostra sem justificativa e abonadas.
3. **Motivos.** A % de cada motivo sobre o total de faltas tratadas.
4. **Média de minutos por feedback,** mês a mês.
5. **Individual.** Uma tabela por colaborador com:
   - faltas no mês inicial x no mês atual;
   - a % de variação;
   - o resultado.

   A tabela pode ser ordenada, e clicar numa linha abre o panorama. O panorama
   também mostra essa métrica da pessoa.

## 7. Registro do feedback

- Continua com duas escolhas: "Falei com a pessoa" e "Não consegui falar".
- Novo campo **Duração (min)**, digitado. Obrigatório quando houve conversa.
- **Motivos novos:** qualquer pessoa do SAC cria um motivo no próprio registro,
  e ele passa a aparecer para todos.
  - A coordenação (Raphael, Jussilene, João) pode renomear ou desativar.
  - Precisa de uma tabela nova no Supabase, que só é criada com autorização.

## 8. Validação antes de entregar

- Comparar a prévia com cada imagem, lado a lado: cabeçalho, tela vazia,
  cards e panorama.
- Conferir que Enviar WhatsApp e Registrar feedback aparecem em todas as abas e
  no panorama.
- Conferir que não sobrou nenhuma borda colorida.
- Testes automáticos do módulo passando.

## Como ficou (implementado em 10/11/2026)

- **Arquivos:**
  - `api/_lig_indicadores.js`: números e motivos.
  - Rotas novas em `api/ligacoes.js`: `?acao=indicadores`, `colaborador`, `motivos` e `motivo`.
  - Tela em `assets/ligacoes/` e testes em `test/ligacoes_*.test.js`.
- **Barra global do sistema:** nesta página, a barra de filtros global e o título do topo ficam escondidos, como já
  acontece nos relatórios da coordenação e da diretoria. O módulo tem cabeçalho e filtros próprios, sem nada duplicado.
- **O que cada filtro afeta:**
  - Turno e área: tudo.
  - Período: os números do topo e a aba Histórico.
  - A fila e o monitoramento mostram sempre o trabalho atual, para nada pendente sumir por causa do período.
- **Registro:** na conversa, o motivo e a duração em minutos são obrigatórios. O motivo obrigatório é o que faz a
  % por motivo fechar em 100%.
- **Motivos novos:** são guardados como eventos `LIG_MOTIVO` na `fm_auditoria`. Não precisou de tabela nova.
- **Porcentagens do Desempenho:** calculadas sobre as faltas sem justificativa; as abonadas aparecem ao lado. O mês
  em andamento é marcado como parcial.
- **Foto do panorama:** a faixa fica em azul-marinho até chegar o arquivo da foto.
