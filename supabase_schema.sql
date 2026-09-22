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
  is_test             boolean not null default false,
  criado_em           timestamptz not null default now(),
  unique (re, data_jornada, is_test)
);

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

alter table public.pt_contatos     enable row level security;
alter table public.pt_competencias enable row level security;
alter table public.pt_ocorrencias  enable row level security;
alter table public.pt_mensagens    enable row level security;
alter table public.pt_sms_uso      enable row level security;
alter table public.pt_config       enable row level security;
alter table public.pt_auditoria    enable row level security;

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
