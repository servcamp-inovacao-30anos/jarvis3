-- ============================================================================
-- dashboard_snapshots
-- Cole este script no SQL Editor do Supabase (Project > SQL Editor > New query)
-- e clique em "Run". Pode ser executado mais de uma vez sem erro (idempotente).
-- ============================================================================

create table if not exists public.dashboard_snapshots (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  source_filename  text,
  row_count        integer,
  data             jsonb not null
);

-- Acelera "pegar a importação mais recente" (ORDER BY created_at DESC LIMIT 1)
create index if not exists dashboard_snapshots_created_at_idx
  on public.dashboard_snapshots (created_at desc);

-- Row Level Security fica ATIVADO e SEM POLICIES de propósito.
-- Toda leitura/escrita acontece através das funções serverless da Vercel
-- (api/import.js e api/latest.js), que usam a SERVICE_ROLE KEY — essa chave
-- ignora RLS por definição. Sem nenhuma policy para "anon"/"authenticated",
-- ninguém consegue ler ou escrever nesta tabela direto do navegador, mesmo
-- que descubra a URL do projeto Supabase.
alter table public.dashboard_snapshots enable row level security;

-- ============================================================================
-- Monitoramento de marcações de ponto (orientação por SMS)
-- Mesmo regime das demais: RLS ligado e SEM policies — só a função serverless,
-- com a SERVICE_ROLE KEY, lê e escreve. Pode ser executado mais de uma vez.
-- ============================================================================

-- pt_contatos: RE -> telefone. NADA além de identidade e contato.
create table if not exists public.pt_contatos (
  re                bigint primary key,
  nome_cadastro     text,
  nome_norm         text,
  telefone_original text,
  telefone_e164     text,
  tipo_telefone     text,     -- CELULAR | CELULAR_CORRIGIDO | FIXO | SEM_TELEFONE | INVALIDO
  enviavel          boolean not null default false,
  origem            text,
  data_base         date,
  atualizado_em     timestamptz not null default now()
);

-- pt_competencias: do dia 26 ao dia 25 do mês seguinte
create table if not exists public.pt_competencias (
  id          bigint generated always as identity primary key,
  data_inicio date not null,
  data_fim    date not null,
  parcial     boolean not null default false,
  data_corte  date,               -- virada de chave, quando parcial
  status      text not null default 'ABERTA',
  criado_em   timestamptz not null default now(),
  fechado_em  timestamptz,
  unique (data_inicio, data_fim)
);

create table if not exists public.pt_ocorrencias (
  id                 bigint generated always as identity primary key,
  re                 bigint,
  nome               text not null,
  competencia_id     bigint references public.pt_competencias(id),
  data_jornada       date not null,
  tipo               text not null,      -- EARLY_ENTRY | LATE_EXIT (LATE_ENTRY/EARLY_EXIT: fase 2)
  horario_previsto   text,
  horario_marcado    text,
  diferenca_minutos  integer not null,   -- sempre em minutos inteiros
  posto              text,
  cliente            text,
  supervisor         text,
  origem             text,               -- SAR2G_PLANILHA
  chave_dedup        text not null unique,
  status             text not null default 'DETECTADA',
  reconciliacao      text,               -- NOME_NAO_ENCONTRADO | NOME_AMBIGUO | null
  is_test            boolean not null default false,
  dado_original      jsonb,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
create index if not exists pt_ocorrencias_re_idx   on public.pt_ocorrencias (re, data_jornada desc);
create index if not exists pt_ocorrencias_comp_idx on public.pt_ocorrencias (competencia_id);

-- Uma mensagem por colaborador por dia. Ocorrência sem RE (pendente de
-- reconciliação) não gera mensagem: em UNIQUE, NULL não colide com NULL, e a
-- trava abaixo deixaria de valer justamente para esses casos.
create table if not exists public.pt_mensagens (
  id                  bigint generated always as identity primary key,
  re                  bigint,
  data_jornada        date not null,
  ocorrencia_ids      bigint[] not null,
  telefone_e164       text,
  template_id         text,
  texto_gerado        text,
  texto_final         text,
  segmentos           integer,
  status              text not null default 'AGUARDANDO_VALIDACAO',
  motivo_bloqueio     text,
  aprovado_por        text,
  aprovado_em         timestamptz,
  editado_por         text,
  editado_em          timestamptz,
  enviado_em          timestamptz,
  provider            text,
  provider_message_id text,
  erro_codigo         text,
  erro_mensagem       text,
  rejeitado_por       text,
  rejeitado_em        timestamptz,
  motivo_rejeicao     text,
  is_test             boolean not null default false,
  criado_em           timestamptz not null default now(),
  unique (re, data_jornada, is_test)
);
-- Para quem já rodou uma versão anterior deste bloco (sem estas colunas).
alter table public.pt_mensagens add column if not exists rejeitado_por   text;
alter table public.pt_mensagens add column if not exists rejeitado_em    timestamptz;
alter table public.pt_mensagens add column if not exists motivo_rejeicao text;

create table if not exists public.pt_sms_uso (
  id             bigint generated always as identity primary key,
  dia            date not null unique,
  mes_referencia text not null,
  segmentos_dia  integer not null default 0,
  segmentos_mes  integer not null default 0,
  provider       text,
  atualizado_em  timestamptz not null default now()
);

create table if not exists public.pt_config (
  chave         text primary key,
  valor         text,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.pt_auditoria (
  id          bigint generated always as identity primary key,
  ator        text,
  acao        text not null,
  entidade    text,
  entidade_id bigint,
  antes       jsonb,
  depois      jsonb,
  criado_em   timestamptz not null default now()
);

-- Cota de SMS, em segmentos. A reserva é feita numa transação só, com a linha do
-- dia travada: dois envios ao mesmo tempo não conseguem passar juntos do limite.
-- Se o provedor recusar o SMS, a reserva é devolvida.
create or replace function public.pt_reservar_segmentos(p_dia date, p_segmentos integer, p_limite_dia integer, p_limite_mes integer)
returns boolean language plpgsql set search_path = public as $$
declare
  v_ref text := to_char(p_dia, 'YYYY-MM');
  v_dia integer;
  v_mes integer;
begin
  insert into pt_sms_uso (dia, mes_referencia) values (p_dia, v_ref) on conflict (dia) do nothing;
  select segmentos_dia into v_dia from pt_sms_uso where dia = p_dia for update;
  select coalesce(sum(segmentos_dia), 0) into v_mes from pt_sms_uso where mes_referencia = v_ref;
  if v_dia + p_segmentos > p_limite_dia or v_mes + p_segmentos > p_limite_mes then
    return false;
  end if;
  update pt_sms_uso
     set segmentos_dia = segmentos_dia + p_segmentos, segmentos_mes = v_mes + p_segmentos, atualizado_em = now()
   where dia = p_dia;
  return true;
end $$;

create or replace function public.pt_devolver_segmentos(p_dia date, p_segmentos integer)
returns void language sql set search_path = public as $$
  update pt_sms_uso
     set segmentos_dia = greatest(0, segmentos_dia - p_segmentos), segmentos_mes = greatest(0, segmentos_mes - p_segmentos), atualizado_em = now()
   where dia = p_dia;
$$;

-- Por padrão o Postgres deixa qualquer papel executar função: aqui só a chave de
-- serviço (usada pelas funções da Vercel) pode.
revoke all on function public.pt_reservar_segmentos(date, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.pt_devolver_segmentos(date, integer) from public, anon, authenticated;
grant execute on function public.pt_reservar_segmentos(date, integer, integer, integer) to service_role;
grant execute on function public.pt_devolver_segmentos(date, integer) to service_role;

alter table public.pt_contatos     enable row level security;
alter table public.pt_competencias enable row level security;
alter table public.pt_ocorrencias  enable row level security;
alter table public.pt_mensagens    enable row level security;
alter table public.pt_sms_uso      enable row level security;
alter table public.pt_config       enable row level security;
alter table public.pt_auditoria    enable row level security;

-- Permissões explícitas: só a chave de serviço lê e escreve. Assim o bloco não
-- depende da opção do Supabase que libera (ou não) tabelas novas para a API, e
-- anon/authenticated ficam sem acesso mesmo se alguém desligar o RLS.
revoke all on public.pt_contatos, public.pt_competencias, public.pt_ocorrencias, public.pt_mensagens,
  public.pt_sms_uso, public.pt_config, public.pt_auditoria from anon, authenticated;
grant select, insert, update, delete on public.pt_contatos, public.pt_competencias, public.pt_ocorrencias,
  public.pt_mensagens, public.pt_sms_uso, public.pt_config, public.pt_auditoria to service_role;

-- Sementes. "on conflict do nothing": rodar de novo não desfaz um ajuste feito
-- depois. data_virada fica vazia de propósito — enquanto estiver vazia, nenhuma
-- ocorrência é criada (nada retroativo).
insert into public.pt_config (chave, valor) values
  ('tolerancia_minutos', '5'),
  ('data_virada',        null),
  ('sms_limite_dia',     '50'),
  ('sms_limite_mes',     '300'),
  ('alerta_pct',         '80'),
  ('critico_pct',        '90')
on conflict (chave) do nothing;

-- Modelos de mensagem: sem acento, sem falar de custo, hora extra, pagamento ou
-- desconto. Editáveis pela tela (Configurar); o texto aqui é só o ponto de partida.
insert into public.pt_config (chave, valor) values
  ('modelo_entrada_antecipada', E'SERVCAMP | ORIENTACAO DE PONTO\nOla, {{nome}}. Em {{data}} sua entrada foi as {{horario_marcado}}, {{minutos}} min antes do previsto ({{horario_previsto}}). Oriente-se a marcar no horario. RE {{re}}.'),
  ('modelo_saida_apos_horario', E'SERVCAMP | ORIENTACAO DE PONTO\nOla, {{nome}}. Em {{data}} sua saida foi as {{horario_marcado}}, {{minutos}} min apos o previsto ({{horario_previsto}}). Oriente-se a marcar no horario. RE {{re}}.'),
  ('modelo_ambas_no_mesmo_dia', E'SERVCAMP | ORIENTACAO DE PONTO\nOla, {{nome}}. Em {{data}} sua entrada foi as {{entrada_marcada}} e a saida as {{saida_marcada}}, fora do previsto ({{entrada_prevista}} as {{saida_prevista}}). Oriente-se a marcar no horario. RE {{re}}.')
on conflict (chave) do nothing;
