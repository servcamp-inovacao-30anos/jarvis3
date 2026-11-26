-- ============================================================================
-- PROGRAMAÇÃO DE FÉRIAS — parte 2 (rodar depois do docs/ferias-banco.sql e da carga dos dados)
--  * Demissões a confirmar: a tela da plataforma (pílula "Demissões a confirmar", botão Confirmar)
--    lia a tabela demissoes_pendentes e chamava confirmar_demissao(), que nunca existiram no banco
--    antigo — para a dona aparecia um erro vermelho a cada carregamento. Aqui nascem as duas, com a
--    regra combinada com a Joyce (regra-ausente-no-relatorio-de-ativos.md / regra-demissao.md):
--    quem some do relatório de ativos entra na fila; só sai da programação quando a dona (ou quem tem
--    "deletar") confirma; a confirmação roda o mesmo demitir() de sempre, com a data do dia.
--  * Some a fe_carga, que só servia para a carga inicial.
-- Tudo ou nada: se algo falhar, nada fica gravado.
-- ============================================================================
begin;

do $guarda$ begin
  if to_regclass('public.periodos') is null then
    raise exception 'Rode antes o docs/ferias-banco.sql (a parte 1).';
  end if;
  if to_regclass('public.demissoes_pendentes') is not null then
    raise exception 'A parte 2 já foi rodada (demissoes_pendentes existe). Nada foi alterado.';
  end if;
end $guarda$;

-- Fila: quem é colocado aqui (pela comparação com o relatório de ativos) espera a confirmação
create table public.demissoes_pendentes (
  codigo integer primary key,
  nome text not null,
  empresa text,
  status text not null default 'pendente' check (status in ('pendente', 'confirmada', 'descartada')),
  motivo text,
  criado_em timestamptz not null default now(),
  confirmado_em timestamptz,
  confirmado_por text
);
alter table public.demissoes_pendentes enable row level security;
revoke all on public.demissoes_pendentes from anon, authenticated;
grant select on public.demissoes_pendentes to fe_app;
grant select, insert, update, delete on public.demissoes_pendentes to service_role;
-- vê a fila quem pode demitir (a mesma regra da tela e do demitir())
create policy "demissoes_pendentes_le" on public.demissoes_pendentes as permissive for select to fe_app
  using (public.eh_dono() or public.pode('acoes', 'deletar'));

-- Confirmar: roda o demitir() com a data do dia e o nome de quem está logado, e tira da fila
create function public.confirmar_demissao(p_codigo integer, p_quem text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $conf$
declare v_quem text; r jsonb;
begin
  if not (public.eh_dono() or public.pode('acoes', 'deletar')) then
    raise exception 'Seu acesso não permite demitir (excluir funcionário da programação).';
  end if;
  if not exists (select 1 from public.demissoes_pendentes where codigo = p_codigo and status = 'pendente') then
    return jsonb_build_object('ok', false, 'erro', 'RE ' || p_codigo || ' não está na lista de demissões a confirmar');
  end if;
  -- o nome vem do login, não da página
  v_quem := coalesce((select nome from public.usuarios where id = public.fe_uid()), p_quem, 'Usuário');
  if exists (select 1 from public.funcionarios where codigo = p_codigo) then
    r := public.demitir(p_codigo, current_date, v_quem);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  else
    r := jsonb_build_object('ok', true, 'mensagem', 'RE ' || p_codigo || ' já não estava na programação.');
  end if;
  update public.demissoes_pendentes
     set status = 'confirmada', confirmado_em = now(), confirmado_por = v_quem
   where codigo = p_codigo;
  return r;
end $conf$;
revoke all on function public.confirmar_demissao(integer, text) from public, anon, authenticated;
grant execute on function public.confirmar_demissao(integer, text) to fe_app, service_role;

drop function if exists public.fe_carga(text, jsonb);

commit;

notify pgrst, 'reload schema';

-- Agendamentos diários do projeto antigo (horário UTC). Se o SQL da parte 1 já os criou, aqui só são regravados.
-- Se der erro só aqui embaixo: Database → Extensions → pg_cron → Enable, e rodar de novo só este trecho.
create extension if not exists pg_cron;
select cron.schedule('ferias-gerar-proximos-periodos', '0 9 * * *', 'select public.gerar_proximos_periodos()');
select cron.schedule('ferias-fecha-mes-anterior', '0 3 * * *', 'select public.fecha_mes_anterior()');
-- o resultado que aparece embaixo do editor: os dois agendamentos ligados
select jobname, schedule, active from cron.job where jobname like 'ferias-%' order by jobname;
