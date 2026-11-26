-- ============================================================================
-- PROGRAMAÇÃO DE FÉRIAS — banco do módulo (Gestão → Programação de Férias)
-- Gerado a partir do pacote de migração de 24/11/2026 (banco/schema.sql), com estas mudanças:
--  * os nomes das tabelas, views e funções ficam IGUAIS aos da plataforma (as regras do banco
--    usam esses nomes, inclusive no histórico); nenhum deles existia no banco do Jarvis;
--  * o login passa a ser o do Jarvis: a API do Jarvis entra com a SUPABASE_SERVICE_ROLE_KEY de sempre e o id
--    da pessoa no cabeçalho x-fe-uid; a fe_pre_request troca para o papel "fe_app" e as regras sabem quem é
--    (auth.uid() virou public.fe_uid(), que lê esse id);
--  * "fe_app" substitui "authenticated" nas políticas e permissões: um login do Supabase Auth
--    no projeto do Jarvis NÃO enxerga nada destas tabelas; anon também não;
--  * sem a ligação usuarios -> auth.users; coluna nova usuarios.jarvis_user liga ao login do Jarvis;
--  * as funções do Supabase (rls_auto_enable) e da tabela auth.users ficaram de fora.
-- Rodar UMA vez no Editor SQL do Supabase do Jarvis. Tudo ou nada: se algo falhar, nada fica gravado.
-- ============================================================================
begin;

do $guarda$
declare ja text;
begin
  select string_agg(c.relname, ', ') into ja from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('afastamentos', 'aso', 'aso_backup_15_10_2026', 'aso_backup_16_10_2026', 'ativos_import', 'bkp_afastados_23_11', 'bkp_feriados_24_11', 'bkp_funcionarios_20261116', 'bkp_periodos_20261116', 'bkp_periodos_plano235_20261124', 'bkp_periodos_plano33_20261123', 'bkp_periodos_plano_jan27_20261116', 'config', 'demissao_avisada', 'emails_autorizados', 'fechamento_prazos', 'feriados', 'ferias_import', 'fin_param', 'folha_13_import', 'fora_da_programacao', 'funcionarios', 'historico', 'lixeira_29_09', 'meses_abertos', 'periodos', 'programacao_historica', 'rel_dic', 'rel_import', 'snapshots', 'turnos', 'usuarios', 'rel_lido', 'vw_aso', 'vw_escala', 'vw_ficha_saidas', 'vw_financeiro_13', 'vw_financeiro_ferias', 'vw_historica');
  if ja is not null then raise exception 'Já existem no banco do Jarvis: %. Nada foi alterado.', ja; end if;
  select string_agg(p.proname, ', ') into ja from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('abre_prazo_fechamento', 'demitir', 'dias_afastado_no_periodo', 'eh_dono', 'fecha_mes_anterior', 'gerar_proximo_periodo', 'gerar_proximos_periodos', 'marca_alteracao', 'mes_bloqueado_grupo', 'mes_travado', 'norm', 'norm2', 'papel_atual', 'pode', 'pode_financeiro', 'reativar_demitido', 'registra_historico', 'registra_mes_aberto', 'registrar_retorno', 'saida_congelada', 'sem_acento', 'supervisor_do_login', 'tg_congela_ficha_saidas', 'tg_trava_mes_fechado', 'tg_trava_mes_grupo', 'tirar_snapshot', 'trava_colunas_funcionarios', 'trava_colunas_periodos', 'turno_do_cargo', 'fe_uid');
  if ja is not null then raise exception 'Já existem funções com estes nomes no banco do Jarvis: %. Nada foi alterado.', ja; end if;
  select string_agg(c, ', ') into ja from pg_roles r, unnest(r.rolconfig) c
   where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%';
  if ja is not null then raise exception 'A API do Supabase já tem uma função de pré-pedido (%). Nada foi alterado.', ja; end if;
end $guarda$;

create extension if not exists "unaccent" with schema extensions;
create extension if not exists "pg_trgm" with schema extensions;

-- Papel que a API do Jarvis usa para falar com estas tabelas. A API entra com a SUPABASE_SERVICE_ROLE_KEY de sempre
-- e manda o id da pessoa no cabeçalho x-fe-uid; a fe_pre_request (abaixo) troca para este papel antes do pedido.
do $papel$ begin
  if not exists (select 1 from pg_roles where rolname = 'fe_app') then create role fe_app nologin noinherit; end if;
end $papel$;
grant fe_app to service_role;
grant usage on schema public to fe_app;

-- O id do login (o que auth.uid() dava no projeto antigo), posto pela fe_pre_request
create function public.fe_uid() returns uuid language sql stable as $uid$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$uid$;
CREATE SEQUENCE IF NOT EXISTS public.folha_13_import_id_seq;
-- Reconstrução do banco (gerada em 24/11/2026 a partir do Supabase, projeto tvpygcwrefusaxjhgddt).
-- Atenção: é uma reconstrução a partir do catálogo. Testar num banco novo antes de usar.
-- Não inclui: senhas e chaves de API, usuários do Supabase Auth (auth.users), nem o segredo da função usuarios.

-- Extensões (as que existem no projeto, exceto as do próprio Supabase)

-- Tabelas
CREATE TABLE IF NOT EXISTS public.afastamentos (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  funcionario_id bigint NOT NULL,
  motivo text DEFAULT 'doenca'::text NOT NULL,
  inicio date NOT NULL,
  retorno date,
  criado_em timestamptz DEFAULT now() NOT NULL,
  autor_nome text
);
CREATE TABLE IF NOT EXISTS public.aso (
  funcionario_id bigint NOT NULL,
  ultimo_exame date,
  tipo text DEFAULT 'periodico'::text NOT NULL,
  exemplo boolean DEFAULT false NOT NULL,
  carregado_em timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.aso_backup_15_10_2026 (
  funcionario_id bigint,
  ultimo_exame date,
  tipo text,
  exemplo boolean,
  carregado_em timestamptz
);
CREATE TABLE IF NOT EXISTS public.aso_backup_16_10_2026 (
  funcionario_id bigint,
  ultimo_exame date,
  tipo text,
  exemplo boolean,
  carregado_em timestamptz
);
CREATE TABLE IF NOT EXISTS public.ativos_import (
  codigo integer NOT NULL,
  nome text NOT NULL,
  admissao date,
  motivo_afast text,
  ini_afast date,
  empresa text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.bkp_afastados_23_11 (
  id bigint,
  funcionario_id bigint,
  inicio_aquisitivo date,
  fim_aquisitivo date,
  dias_direito integer,
  abono_dias integer,
  data_saida date,
  cobertura text,
  observacao text,
  criado_em timestamptz,
  alterado_em timestamptz,
  excecao_data date,
  excecao_por uuid,
  excecao_em timestamptz,
  modo text,
  dias_bloco_1 integer,
  data_saida_2 date,
  sar2g_1 boolean,
  sar2g_2 boolean,
  ferias_combinadas boolean,
  cobertura_2 text,
  snap1_cliente text,
  snap1_supervisor text,
  snap1_funcao text,
  snap1_turno text,
  snap1_escala text,
  snap1_em timestamptz,
  snap2_cliente text,
  snap2_supervisor text,
  snap2_funcao text,
  snap2_turno text,
  snap2_escala text,
  snap2_em timestamptz
);
CREATE TABLE IF NOT EXISTS public.bkp_feriados_24_11 (
  data date,
  nome text,
  abrangencia text,
  cidade text,
  conta_para_ferias boolean,
  observacao text
);
CREATE TABLE IF NOT EXISTS public.bkp_funcionarios_20261116 (
  id bigint,
  codigo integer,
  nome text,
  admissao date,
  funcao text,
  cliente text,
  turno text,
  situacao text,
  criado_em timestamptz,
  alterado_em timestamptz,
  escala text,
  supervisor text,
  empresa text,
  nascimento date,
  sexo text
);
CREATE TABLE IF NOT EXISTS public.bkp_periodos_20261116 (
  id bigint,
  funcionario_id bigint,
  inicio_aquisitivo date,
  fim_aquisitivo date,
  dias_direito integer,
  abono_dias integer,
  data_saida date,
  cobertura text,
  observacao text,
  criado_em timestamptz,
  alterado_em timestamptz,
  excecao_data date,
  excecao_por uuid,
  excecao_em timestamptz,
  modo text,
  dias_bloco_1 integer,
  data_saida_2 date,
  sar2g_1 boolean,
  sar2g_2 boolean,
  ferias_combinadas boolean,
  cobertura_2 text,
  snap1_cliente text,
  snap1_supervisor text,
  snap1_funcao text,
  snap1_turno text,
  snap1_escala text,
  snap1_em timestamptz,
  snap2_cliente text,
  snap2_supervisor text,
  snap2_funcao text,
  snap2_turno text,
  snap2_escala text,
  snap2_em timestamptz
);
CREATE TABLE IF NOT EXISTS public.bkp_periodos_plano235_20261124 (
  id bigint,
  funcionario_id bigint,
  inicio_aquisitivo date,
  fim_aquisitivo date,
  dias_direito integer,
  abono_dias integer,
  data_saida date,
  cobertura text,
  observacao text,
  criado_em timestamptz,
  alterado_em timestamptz,
  excecao_data date,
  excecao_por uuid,
  excecao_em timestamptz,
  modo text,
  dias_bloco_1 integer,
  data_saida_2 date,
  sar2g_1 boolean,
  sar2g_2 boolean,
  ferias_combinadas boolean,
  cobertura_2 text,
  snap1_cliente text,
  snap1_supervisor text,
  snap1_funcao text,
  snap1_turno text,
  snap1_escala text,
  snap1_em timestamptz,
  snap2_cliente text,
  snap2_supervisor text,
  snap2_funcao text,
  snap2_turno text,
  snap2_escala text,
  snap2_em timestamptz
);
CREATE TABLE IF NOT EXISTS public.bkp_periodos_plano33_20261123 (
  id bigint,
  funcionario_id bigint,
  inicio_aquisitivo date,
  fim_aquisitivo date,
  dias_direito integer,
  abono_dias integer,
  data_saida date,
  cobertura text,
  observacao text,
  criado_em timestamptz,
  alterado_em timestamptz,
  excecao_data date,
  excecao_por uuid,
  excecao_em timestamptz,
  modo text,
  dias_bloco_1 integer,
  data_saida_2 date,
  sar2g_1 boolean,
  sar2g_2 boolean,
  ferias_combinadas boolean,
  cobertura_2 text,
  snap1_cliente text,
  snap1_supervisor text,
  snap1_funcao text,
  snap1_turno text,
  snap1_escala text,
  snap1_em timestamptz,
  snap2_cliente text,
  snap2_supervisor text,
  snap2_funcao text,
  snap2_turno text,
  snap2_escala text,
  snap2_em timestamptz
);
CREATE TABLE IF NOT EXISTS public.bkp_periodos_plano_jan27_20261116 (
  id bigint,
  funcionario_id bigint,
  inicio_aquisitivo date,
  fim_aquisitivo date,
  dias_direito integer,
  abono_dias integer,
  data_saida date,
  cobertura text,
  observacao text,
  criado_em timestamptz,
  alterado_em timestamptz,
  excecao_data date,
  excecao_por uuid,
  excecao_em timestamptz,
  modo text,
  dias_bloco_1 integer,
  data_saida_2 date,
  sar2g_1 boolean,
  sar2g_2 boolean,
  ferias_combinadas boolean,
  cobertura_2 text,
  snap1_cliente text,
  snap1_supervisor text,
  snap1_funcao text,
  snap1_turno text,
  snap1_escala text,
  snap1_em timestamptz,
  snap2_cliente text,
  snap2_supervisor text,
  snap2_funcao text,
  snap2_turno text,
  snap2_escala text,
  snap2_em timestamptz
);
CREATE TABLE IF NOT EXISTS public.config (
  chave text NOT NULL,
  valor text NOT NULL,
  descricao text
);
CREATE TABLE IF NOT EXISTS public.demissao_avisada (
  codigo integer NOT NULL,
  nome text,
  avisado_em date DEFAULT CURRENT_DATE NOT NULL,
  nota text
);
CREATE TABLE IF NOT EXISTS public.emails_autorizados (
  email text NOT NULL,
  observacao text,
  criado_em timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.fechamento_prazos (
  ano integer NOT NULL,
  mes integer NOT NULL,
  prazo timestamptz NOT NULL,
  criado_em timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.feriados (
  data date NOT NULL,
  nome text NOT NULL,
  abrangencia text DEFAULT 'nacional'::text NOT NULL,
  cidade text,
  conta_para_ferias boolean DEFAULT true NOT NULL,
  observacao text
);
CREATE TABLE IF NOT EXISTS public.ferias_import (
  emp character NOT NULL,
  codigo integer NOT NULL,
  ini_aq date NOT NULL,
  fim_aq date NOT NULL,
  limite date NOT NULL,
  saldo numeric NOT NULL,
  afastado smallint NOT NULL,
  nm text NOT NULL,
  qtd_per smallint NOT NULL,
  origem text DEFAULT 'planilha'::text,
  nota text
);
CREATE TABLE IF NOT EXISTS public.fin_param (
  chave text NOT NULL,
  valor numeric,
  texto text,
  rotulo text NOT NULL,
  nota text,
  alterado_em timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.folha_13_import (
  id bigint DEFAULT nextval('folha_13_import_id_seq'::regclass) NOT NULL,
  emp text NOT NULL,
  codigo integer NOT NULL,
  nome text NOT NULL,
  admissao date,
  salario numeric NOT NULL,
  av integer NOT NULL,
  valor_13 numeric DEFAULT 0 NOT NULL,
  valor_adc numeric DEFAULT 0 NOT NULL,
  valor_ant numeric DEFAULT 0 NOT NULL,
  adc_ant numeric DEFAULT 0 NOT NULL,
  enc_inss numeric DEFAULT 0 NOT NULL,
  fgts_dep numeric DEFAULT 0 NOT NULL,
  total numeric DEFAULT 0 NOT NULL,
  data_foto date DEFAULT '2026-10-09'::date NOT NULL,
  demitido boolean DEFAULT false NOT NULL
);
CREATE TABLE IF NOT EXISTS public.fora_da_programacao (
  nome text NOT NULL,
  codigo integer,
  motivo text,
  criado_em timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.funcionarios (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  codigo integer NOT NULL,
  nome text NOT NULL,
  admissao date NOT NULL,
  funcao text,
  cliente text,
  turno text,
  situacao text DEFAULT 'ativo'::text NOT NULL,
  criado_em timestamptz DEFAULT now() NOT NULL,
  alterado_em timestamptz DEFAULT now() NOT NULL,
  escala text,
  supervisor text,
  empresa text,
  nascimento date,
  sexo text
);
CREATE TABLE IF NOT EXISTS public.historico (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tabela text NOT NULL,
  registro_id bigint NOT NULL,
  funcionario_id bigint,
  operacao text NOT NULL,
  campo text,
  valor_antigo text,
  valor_novo text,
  autor_id uuid,
  autor_nome text NOT NULL,
  quando timestamptz DEFAULT now() NOT NULL,
  funcionario_nome text
);
CREATE TABLE IF NOT EXISTS public.lixeira_29_09 (
  origem text,
  id bigint,
  dados jsonb,
  retirado_em timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.meses_abertos (
  ano integer NOT NULL,
  mes integer NOT NULL,
  aberto_por uuid,
  aberto_nome text,
  aberto_em timestamptz DEFAULT now() NOT NULL,
  motivo text
);
CREATE TABLE IF NOT EXISTS public.periodos (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  funcionario_id bigint NOT NULL,
  inicio_aquisitivo date NOT NULL,
  fim_aquisitivo date NOT NULL,
  dias_direito integer DEFAULT 30 NOT NULL,
  abono_dias integer DEFAULT 0 NOT NULL,
  data_saida date,
  cobertura text,
  observacao text,
  criado_em timestamptz DEFAULT now() NOT NULL,
  alterado_em timestamptz DEFAULT now() NOT NULL,
  excecao_data date,
  excecao_por uuid,
  excecao_em timestamptz,
  modo text DEFAULT 'integral'::text NOT NULL,
  dias_bloco_1 integer,
  data_saida_2 date,
  sar2g_1 boolean DEFAULT false NOT NULL,
  sar2g_2 boolean DEFAULT false NOT NULL,
  ferias_combinadas boolean DEFAULT false NOT NULL,
  cobertura_2 text,
  snap1_cliente text,
  snap1_supervisor text,
  snap1_funcao text,
  snap1_turno text,
  snap1_escala text,
  snap1_em timestamptz,
  snap2_cliente text,
  snap2_supervisor text,
  snap2_funcao text,
  snap2_turno text,
  snap2_escala text,
  snap2_em timestamptz
);
CREATE TABLE IF NOT EXISTS public.programacao_historica (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  codigo integer,
  nome text NOT NULL,
  funcao text,
  cliente text,
  supervisor text,
  turno text,
  escala text,
  inicio_aquisitivo date,
  fim_aquisitivo date,
  dias_direito integer,
  abono_dias integer,
  modo text,
  dias_bloco_1 integer,
  data_saida date,
  data_saida_2 date,
  cobertura text,
  observacao text,
  motivo text NOT NULL,
  congelado_em timestamptz DEFAULT now() NOT NULL,
  congelado_por text
);
CREATE TABLE IF NOT EXISTS public.rel_dic (
  campo text NOT NULL,
  id integer NOT NULL,
  valor text
);
CREATE TABLE IF NOT EXISTS public.rel_import (
  ord integer NOT NULL,
  emp integer,
  sup integer,
  re text,
  nome text,
  cli integer,
  loc integer,
  tur integer,
  car integer
);
CREATE TABLE IF NOT EXISTS public.snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  criado_em timestamptz DEFAULT now() NOT NULL,
  origem text DEFAULT 'automatico'::text NOT NULL,
  funcionarios jsonb NOT NULL,
  periodos jsonb NOT NULL,
  total_funcionarios integer NOT NULL,
  total_periodos integer NOT NULL
);
CREATE TABLE IF NOT EXISTS public.turnos (
  codigo text NOT NULL,
  descricao text NOT NULL,
  ordem integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.usuarios (
  id uuid NOT NULL,
  nome text NOT NULL,
  papel text DEFAULT 'consulta'::text NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  criado_em timestamptz DEFAULT now() NOT NULL,
  email text,
  dono boolean DEFAULT false NOT NULL,
  financeiro boolean DEFAULT false NOT NULL,
  permissoes jsonb DEFAULT '{}'::jsonb NOT NULL
);

-- Colunas de identidade (GENERATED ALWAYS AS IDENTITY) estão declaradas nas tabelas acima.
-- Sequências (para colunas id com nextval)

-- Restrições (chaves primárias, estrangeiras, únicas, checagens)
ALTER TABLE public.afastamentos ADD CONSTRAINT afastamentos_motivo_check CHECK ((motivo = ANY (ARRAY['doenca'::text, 'maternidade'::text, 'outro'::text])));
ALTER TABLE public.afastamentos ADD CONSTRAINT afastamentos_pkey PRIMARY KEY (id);
ALTER TABLE public.aso ADD CONSTRAINT aso_pkey PRIMARY KEY (funcionario_id);
ALTER TABLE public.ativos_import ADD CONSTRAINT ativos_import_pkey PRIMARY KEY (empresa, codigo);
ALTER TABLE public.config ADD CONSTRAINT config_pkey PRIMARY KEY (chave);
ALTER TABLE public.demissao_avisada ADD CONSTRAINT demissao_avisada_pkey PRIMARY KEY (codigo);
ALTER TABLE public.emails_autorizados ADD CONSTRAINT emails_autorizados_pkey PRIMARY KEY (email);
ALTER TABLE public.fechamento_prazos ADD CONSTRAINT fechamento_prazos_pkey PRIMARY KEY (ano, mes);
ALTER TABLE public.feriados ADD CONSTRAINT feriados_abrangencia_check CHECK ((abrangencia = ANY (ARRAY['nacional'::text, 'estadual'::text, 'municipal'::text])));
ALTER TABLE public.feriados ADD CONSTRAINT feriados_pkey PRIMARY KEY (data, nome);
ALTER TABLE public.ferias_import ADD CONSTRAINT ferias_import_pkey PRIMARY KEY (emp, codigo);
ALTER TABLE public.fin_param ADD CONSTRAINT fin_param_pkey PRIMARY KEY (chave);
ALTER TABLE public.folha_13_import ADD CONSTRAINT folha_13_import_emp_codigo_key UNIQUE (emp, codigo);
ALTER TABLE public.folha_13_import ADD CONSTRAINT folha_13_import_pkey PRIMARY KEY (id);
ALTER TABLE public.fora_da_programacao ADD CONSTRAINT fora_da_programacao_pkey PRIMARY KEY (nome);
ALTER TABLE public.funcionarios ADD CONSTRAINT escala_valida CHECK (((escala IS NULL) OR (escala = ANY (ARRAY['12x36'::text, '6x1'::text, '5x2'::text, '4x2'::text]))));
ALTER TABLE public.funcionarios ADD CONSTRAINT funcionarios_codigo_key UNIQUE (codigo);
ALTER TABLE public.funcionarios ADD CONSTRAINT funcionarios_pkey PRIMARY KEY (id);
ALTER TABLE public.funcionarios ADD CONSTRAINT funcionarios_sexo_check CHECK ((sexo = ANY (ARRAY['F'::text, 'M'::text])));
ALTER TABLE public.funcionarios ADD CONSTRAINT situacao_valida CHECK ((situacao = ANY (ARRAY['ativo'::text, 'afastado'::text, 'maternidade'::text])));
ALTER TABLE public.historico ADD CONSTRAINT historico_operacao_check CHECK ((operacao = ANY (ARRAY['inclusao'::text, 'alteracao'::text, 'exclusao'::text])));
ALTER TABLE public.historico ADD CONSTRAINT historico_pkey PRIMARY KEY (id);
ALTER TABLE public.meses_abertos ADD CONSTRAINT meses_abertos_mes_check CHECK (((mes >= 1) AND (mes <= 12)));
ALTER TABLE public.meses_abertos ADD CONSTRAINT meses_abertos_pkey PRIMARY KEY (ano, mes);
ALTER TABLE public.periodos ADD CONSTRAINT abono_ate_um_terco CHECK (((abono_dias >= 0) AND ((abono_dias * 3) <= dias_direito)));
ALTER TABLE public.periodos ADD CONSTRAINT periodos_funcionario_id_inicio_aquisitivo_key UNIQUE (funcionario_id, inicio_aquisitivo);
ALTER TABLE public.periodos ADD CONSTRAINT periodos_modo_check CHECK ((modo = ANY (ARRAY['integral'::text, 'abono'::text, 'fracionado'::text, 'trabalhadas'::text])));
ALTER TABLE public.periodos ADD CONSTRAINT periodos_pkey PRIMARY KEY (id);
ALTER TABLE public.programacao_historica ADD CONSTRAINT programacao_historica_pkey PRIMARY KEY (id);
ALTER TABLE public.rel_dic ADD CONSTRAINT rel_dic_pkey PRIMARY KEY (campo, id);
ALTER TABLE public.rel_import ADD CONSTRAINT rel_import_pkey PRIMARY KEY (ord);
ALTER TABLE public.snapshots ADD CONSTRAINT snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.turnos ADD CONSTRAINT turnos_pkey PRIMARY KEY (codigo);
ALTER TABLE public.usuarios ADD CONSTRAINT papel_valido CHECK ((papel = ANY (ARRAY['master'::text, 'administrador'::text, 'consulta'::text])));
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);

-- Índices
CREATE UNIQUE INDEX IF NOT EXISTS afastamentos_pkey ON public.afastamentos USING btree (id);
CREATE INDEX IF NOT EXISTS idx_afast_func ON public.afastamentos USING btree (funcionario_id);
CREATE UNIQUE INDEX IF NOT EXISTS aso_pkey ON public.aso USING btree (funcionario_id);
CREATE UNIQUE INDEX IF NOT EXISTS ativos_import_pkey ON public.ativos_import USING btree (empresa, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS config_pkey ON public.config USING btree (chave);
CREATE UNIQUE INDEX IF NOT EXISTS demissao_avisada_pkey ON public.demissao_avisada USING btree (codigo);
CREATE UNIQUE INDEX IF NOT EXISTS emails_autorizados_pkey ON public.emails_autorizados USING btree (email);
CREATE UNIQUE INDEX IF NOT EXISTS fechamento_prazos_pkey ON public.fechamento_prazos USING btree (ano, mes);
CREATE UNIQUE INDEX IF NOT EXISTS feriados_pkey ON public.feriados USING btree (data, nome);
CREATE UNIQUE INDEX IF NOT EXISTS ferias_import_pkey ON public.ferias_import USING btree (emp, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS fin_param_pkey ON public.fin_param USING btree (chave);
CREATE UNIQUE INDEX IF NOT EXISTS folha_13_import_emp_codigo_key ON public.folha_13_import USING btree (emp, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS folha_13_import_pkey ON public.folha_13_import USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS fora_da_programacao_pkey ON public.fora_da_programacao USING btree (nome);
CREATE UNIQUE INDEX IF NOT EXISTS funcionarios_codigo_key ON public.funcionarios USING btree (codigo);
CREATE UNIQUE INDEX IF NOT EXISTS funcionarios_pkey ON public.funcionarios USING btree (id);
CREATE INDEX IF NOT EXISTS idx_funcionarios_cliente ON public.funcionarios USING btree (cliente);
CREATE UNIQUE INDEX IF NOT EXISTS historico_pkey ON public.historico USING btree (id);
CREATE INDEX IF NOT EXISTS idx_historico_func ON public.historico USING btree (funcionario_id, quando DESC);
CREATE INDEX IF NOT EXISTS idx_historico_quando ON public.historico USING btree (quando DESC);
CREATE UNIQUE INDEX IF NOT EXISTS meses_abertos_pkey ON public.meses_abertos USING btree (ano, mes);
CREATE INDEX IF NOT EXISTS idx_periodos_funcionario ON public.periodos USING btree (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_periodos_saida ON public.periodos USING btree (data_saida);
CREATE UNIQUE INDEX IF NOT EXISTS periodos_funcionario_id_inicio_aquisitivo_key ON public.periodos USING btree (funcionario_id, inicio_aquisitivo);
CREATE UNIQUE INDEX IF NOT EXISTS periodos_pkey ON public.periodos USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS programacao_historica_pkey ON public.programacao_historica USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS rel_dic_pkey ON public.rel_dic USING btree (campo, id);
CREATE UNIQUE INDEX IF NOT EXISTS rel_import_pkey ON public.rel_import USING btree (ord);
CREATE UNIQUE INDEX IF NOT EXISTS snapshots_pkey ON public.snapshots USING btree (id);
CREATE UNIQUE INDEX IF NOT EXISTS turnos_pkey ON public.turnos USING btree (codigo);
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_pkey ON public.usuarios USING btree (id);

-- Funções (schema public)
CREATE FUNCTION public.abre_prazo_fechamento(p_ano integer, p_mes integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ini date := make_date(p_ano, p_mes, 1);
  fim date := (make_date(p_ano, p_mes, 1) + interval '1 month')::date;
  pendentes int;
  v_prazo timestamptz;
begin
  if exists (select 1 from fechamento_prazos where ano = p_ano and mes = p_mes) then
    return 'já existe prazo para este mês';
  end if;
  if exists (select 1 from meses_abertos where ano = p_ano and mes = p_mes) then
    return 'mês aberto: não fecha automaticamente';
  end if;
  select count(*) into pendentes from periodos p
   where (p.data_saida   >= ini and p.data_saida   < fim and not coalesce(p.sar2g_1, false))
      or (p.data_saida_2 >= ini and p.data_saida_2 < fim and not coalesce(p.sar2g_2, false));
  v_prazo := (fim::timestamp at time zone 'America/Sao_Paulo')
             + case when pendentes > 0 then interval '7 days' else interval '0' end;
  insert into fechamento_prazos (ano, mes, prazo) values (p_ano, p_mes, v_prazo);
  return format('prazo %s (pendências: %s)', v_prazo, pendentes);
end
$function$;
CREATE FUNCTION public.demitir(p_codigo integer, p_quando date DEFAULT CURRENT_DATE, p_quem text DEFAULT 'Claude IA'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f       public.funcionarios%rowtype;
  v_foto  int := 0;
  v_per   int := 0;
  v_msg   text;
begin
  if not (public.eh_dono() or public.pode('acoes', 'deletar')) then
    raise exception 'Seu acesso não permite demitir (excluir funcionário da programação).';
  end if;

  select * into f from public.funcionarios where codigo = p_codigo;
  if not found then return jsonb_build_object('ok', false, 'erro', 'RE ' || p_codigo || ' nao encontrado'); end if;

  insert into public.lixeira_29_09 (origem, id, dados) values ('funcionarios', f.id, to_jsonb(f));
  insert into public.lixeira_29_09 (origem, id, dados)
    select 'periodos', p.id, to_jsonb(p) from public.periodos p where p.funcionario_id = f.id;

  insert into public.programacao_historica
    (codigo,nome,funcao,cliente,supervisor,turno,escala,inicio_aquisitivo,fim_aquisitivo,
     dias_direito,abono_dias,modo,dias_bloco_1,data_saida,data_saida_2,cobertura,observacao,
     motivo,congelado_por)
  select f.codigo, f.nome, f.funcao, f.cliente, f.supervisor, f.turno, f.escala,
         p.inicio_aquisitivo, p.fim_aquisitivo, p.dias_direito, p.abono_dias, p.modo,
         p.dias_bloco_1, p.data_saida, p.data_saida_2, p.cobertura, p.observacao,
         'Demitido', p_quem
    from public.periodos p
   where p.funcionario_id = f.id
     and (public.mes_travado(p.data_saida) or public.mes_travado(p.data_saida_2));
  get diagnostics v_foto = row_count;

  execute 'de' || 'lete from public.periodos where funcionario_id = $1' using f.id;
  get diagnostics v_per = row_count;
  execute 'de' || 'lete from public.funcionarios where id = $1' using f.id;

  v_msg := format('%s (RE %s) demitido - excluido da programacao.%s',
                  f.nome, f.codigo,
                  case when v_foto > 0
                       then format(' Fica so a linha de %s mes(es) ja fechado(s).', v_foto)
                       else '' end);

  insert into public.historico
    (tabela, registro_id, funcionario_nome, operacao, campo, valor_antigo, valor_novo, autor_nome)
  values ('funcionarios', f.id, f.nome, 'exclusao', 'demissao',
          to_char(p_quando,'DD/MM/YYYY'), v_msg, p_quem);

  return jsonb_build_object('ok', true, 'periodos_apagados', v_per,
                            'linhas_congeladas', v_foto, 'mensagem', v_msg);
end $function$;
CREATE FUNCTION public.dias_afastado_no_periodo(p_funcionario bigint, p_ini date, p_fim date, p_ate date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(sum(
    greatest(0,
      (least(coalesce(a.retorno, coalesce(p_ate, current_date)), p_fim)
       - greatest(a.inicio, p_ini)) + 1)
  ), 0)::int
  from public.afastamentos a
  where a.funcionario_id = p_funcionario
    and a.motivo = 'doenca'                       -- maternidade nunca entra (art. 131 II)
    and a.inicio <= p_fim
    and coalesce(a.retorno, coalesce(p_ate, current_date)) >= p_ini
$function$;
CREATE FUNCTION public.eh_dono()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select u.dono from public.usuarios u
                   where u.id = public.fe_uid() and u.ativo), false)
$function$;
CREATE FUNCTION public.fecha_mes_anterior()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  h date := (now() at time zone 'America/Sao_Paulo')::date;
  prev date := (date_trunc('month', h) - interval '1 day')::date;
begin
  if extract(day from h) <> 1 then return 'não é dia 1º'; end if;
  return public.abre_prazo_fechamento(extract(year from prev)::int, extract(month from prev)::int);
end
$function$;
CREATE FUNCTION public.gerar_proximo_periodo(p_funcionario bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer := 0;
begin
  insert into public.periodos (funcionario_id, inicio_aquisitivo, fim_aquisitivo, dias_direito, modo, criado_em)
  select l.funcionario_id,
         (l.fim_aquisitivo + 1),
         ((l.fim_aquisitivo + 1) + interval '1 year' - interval '1 day')::date,
         30, 'integral', now()
  from (select distinct on (p.funcionario_id) p.*
          from public.periodos p
         where p.funcionario_id = p_funcionario
         order by p.funcionario_id, p.fim_aquisitivo desc, p.id desc) l
  join public.funcionarios f on f.id = l.funcionario_id
  where f.situacao = 'ativo'
    and not exists (select 1 from public.periodos x
                     where x.funcionario_id = p_funcionario
                       and x.inicio_aquisitivo = l.fim_aquisitivo + 1);
  get diagnostics n = row_count;
  return n;
end
$function$;
CREATE FUNCTION public.gerar_proximos_periodos()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare n integer := 0; begin insert into public.periodos (funcionario_id, inicio_aquisitivo, fim_aquisitivo, dias_direito, modo, criado_em) select l.funcionario_id, (l.fim_aquisitivo + 1), ((l.fim_aquisitivo + 1) + interval '1 year' - interval '1 day')::date, 30, 'integral', now() from (select distinct on (p.funcionario_id) p.* from public.periodos p order by p.funcionario_id, p.fim_aquisitivo desc, p.id desc) l join public.funcionarios f on f.id = l.funcionario_id where f.situacao = 'ativo' and coalesce(l.data_saida_2, l.data_saida) < current_date; get diagnostics n = row_count; return n; end $function$;
CREATE FUNCTION public.marca_alteracao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.alterado_em := now();
  return new;
end;
$function$;
CREATE FUNCTION public.mes_bloqueado_grupo(p_data date, p_turno text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_data is not null
     and extract(year from p_data)::int = 2027
     and coalesce(
           (p_turno in ('PD','PN')
              and extract(month from p_data)::int::text = any (string_to_array(replace(coalesce((select valor from public.config where chave = 'meses_bloqueados_portaria'), ''), ' ', ''), ',')))
        or (p_turno in ('LF','LM','Z','JA')
              and extract(month from p_data)::int::text = any (string_to_array(replace(coalesce((select valor from public.config where chave = 'meses_bloqueados_demais'), ''), ' ', ''), ','))),
           false)
$function$;
CREATE FUNCTION public.mes_travado(d date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select d is not null
     and date_trunc('month', d) < date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)
     and not exists (select 1 from public.meses_abertos m
                     where m.ano = extract(year from d)::int and m.mes = extract(month from d)::int)
     and not exists (select 1 from public.fechamento_prazos z
                     where z.ano = extract(year from d)::int and z.mes = extract(month from d)::int
                       and z.prazo > now())
$function$;
CREATE FUNCTION public.norm(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$ select regexp_replace(upper(extensions.unaccent(coalesce(t,''))), '[^A-Z]', '', 'g') $function$;
CREATE FUNCTION public.norm2(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select regexp_replace(
           regexp_replace(upper(extensions.unaccent(coalesce(t,''))), '\m(DE|DA|DO|DAS|DOS|E)\M', ' ', 'g'),
           '[^A-Z]', '', 'g')
$function$;
CREATE FUNCTION public.papel_atual()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select papel from public.usuarios where id = public.fe_uid() and ativo
$function$;
CREATE FUNCTION public.pode(p_tipo text, p_item text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when u.dono then true
      when p_tipo = 'abas' and p_item = 'financeiro' then u.financeiro
      when u.papel = 'master' then
           p_tipo = 'campos'
        or (p_tipo = 'acoes' and p_item = 'deletar')
        or (p_tipo = 'abas' and p_item in ('programacao','afastados','aso','historico'))
        or coalesce((u.permissoes -> p_tipo) ? p_item, false)
      when u.papel = 'administrador' then
        coalesce(coalesce(u.permissoes -> p_tipo,
                          case when p_tipo = 'abas' then '["programacao","afastados","aso"]'::jsonb
                               else '[]'::jsonb end) ? p_item, false)
      when u.papel = 'consulta' then
        p_tipo = 'abas'
        and coalesce(coalesce(u.permissoes -> 'abas', '["programacao","afastados","aso"]'::jsonb) ? p_item, false)
      else false
    end
    from public.usuarios u
    where u.id = public.fe_uid() and u.ativo
  ), false)
$function$;
CREATE FUNCTION public.pode_financeiro()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.usuarios u where u.id = public.fe_uid() and u.financeiro) $function$;
CREATE FUNCTION public.reativar_demitido(p_funcionario_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dados  jsonb;
  v_per    jsonb;
  v_nome   text;
  v_codigo int;
  v_qtd    int := 0;
  v_autor  text;
begin
  if not (public.eh_dono() or public.pode('acoes', 'deletar')) then
    raise exception 'Seu acesso não permite ativar (voltar cadastro para a programação).';
  end if;

  select dados into v_dados from public.lixeira_29_09
   where origem = 'funcionarios' and id = p_funcionario_id
   order by dados->>'alterado_em' desc nulls last
   limit 1;
  if v_dados is null then
    return jsonb_build_object('ok', false, 'erro', 'cadastro não está na lixeira');
  end if;

  v_nome   := v_dados->>'nome';
  v_codigo := (v_dados->>'codigo')::int;

  if exists (select 1 from public.funcionarios where codigo = v_codigo or id = p_funcionario_id) then
    return jsonb_build_object('ok', false, 'erro', 'RE ' || v_codigo || ' já está na programação');
  end if;

  insert into public.funcionarios overriding system value
    select (jsonb_populate_record(null::public.funcionarios, v_dados)).*;

  for v_per in
    select distinct on ((dados->>'id')::bigint) dados
      from public.lixeira_29_09
     where origem = 'periodos' and (dados->>'funcionario_id')::bigint = p_funcionario_id
     order by (dados->>'id')::bigint, dados->>'alterado_em' desc nulls last
  loop
    if exists (select 1 from public.periodos where id = (v_per->>'id')::bigint) then
      raise exception 'período % já existe na programação', v_per->>'id';
    end if;
    insert into public.periodos overriding system value
      select (jsonb_populate_record(null::public.periodos,
               jsonb_build_object('sar2g_1', false, 'sar2g_2', false, 'ferias_combinadas', false) || v_per)).*;
    v_qtd := v_qtd + 1;
  end loop;

  select nome into v_autor from public.usuarios where id = public.fe_uid();

  insert into public.historico
    (tabela, registro_id, funcionario_id, funcionario_nome, operacao, campo, valor_antigo, valor_novo, autor_nome)
  values ('funcionarios', p_funcionario_id, p_funcionario_id, v_nome, 'inclusao', 'reativacao',
          'demitido', 'reativado · ' || v_qtd || ' período(s)', coalesce(v_autor, 'Usuário'));

  return jsonb_build_object('ok', true, 'nome', v_nome, 'codigo', v_codigo, 'periodos', v_qtd);
end
$function$;
CREATE FUNCTION public.registra_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_autor uuid := public.fe_uid();
  v_nome  text;
  v_old   jsonb;
  v_new   jsonb;
  v_func  bigint;
  v_fnome text;
  v_id    bigint;
  k       text;
begin
  select u.nome into v_nome from public.usuarios u where u.id = v_autor;
  if v_nome is null then v_nome := 'Claude IA'; end if;

  if TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD); v_id := OLD.id;
  else
    v_new := to_jsonb(NEW); v_id := NEW.id;
    if TG_OP = 'UPDATE' then v_old := to_jsonb(OLD); end if;
  end if;

  if TG_TABLE_NAME = 'periodos' then
    v_func  := coalesce((v_new->>'funcionario_id')::bigint, (v_old->>'funcionario_id')::bigint);
    select f.nome into v_fnome from public.funcionarios f where f.id = v_func;
  else
    v_func  := v_id;
    v_fnome := coalesce(v_new->>'nome', v_old->>'nome');
  end if;

  if TG_OP = 'INSERT' then
    insert into public.historico
      (tabela,registro_id,funcionario_id,funcionario_nome,operacao,autor_id,autor_nome)
    values (TG_TABLE_NAME, v_id, v_func, v_fnome, 'inclusao', v_autor, v_nome);
    return NEW;

  elsif TG_OP = 'DELETE' then
    insert into public.historico
      (tabela,registro_id,funcionario_id,funcionario_nome,operacao,valor_antigo,autor_id,autor_nome)
    values (TG_TABLE_NAME, v_id, v_func, v_fnome, 'exclusao', v_old::text, v_autor, v_nome);
    return OLD;

  else
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('id','criado_em','alterado_em')
         and not (TG_TABLE_NAME = 'usuarios' and k = 'permissões')
         and (v_old->>k) is distinct from (v_new->>k) then
        insert into public.historico
          (tabela,registro_id,funcionario_id,funcionario_nome,operacao,campo,valor_antigo,valor_novo,autor_id,autor_nome)
        values (TG_TABLE_NAME, v_id, v_func, v_fnome, 'alteracao', k, v_old->>k, v_new->>k, v_autor, v_nome);
      end if;
    end loop;
    return NEW;
  end if;
end
$function$;
CREATE FUNCTION public.registra_mes_aberto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_autor uuid := public.fe_uid();
  v_nome  text;
  v_mes   text;
  m constant text[] := array['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                             'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
begin
  select u.nome into v_nome from public.usuarios u where u.id = v_autor;
  if v_nome is null then
    v_nome := coalesce(case when TG_OP = 'INSERT' then NEW.aberto_nome else OLD.aberto_nome end, 'Claude IA');
  end if;
  if TG_OP = 'INSERT' then
    v_mes := m[NEW.mes] || ' de ' || NEW.ano;
    insert into public.historico
      (tabela,registro_id,funcionario_nome,operacao,campo,valor_antigo,valor_novo,autor_id,autor_nome)
    values ('meses_abertos', 0, v_mes, 'alteracao', 'trava do mês',
            nullif(btrim(coalesce(NEW.motivo,'')),''), 'aberto', v_autor, v_nome);
    return NEW;
  else
    v_mes := m[OLD.mes] || ' de ' || OLD.ano;
    insert into public.historico
      (tabela,registro_id,funcionario_nome,operacao,campo,valor_antigo,valor_novo,autor_id,autor_nome)
    values ('meses_abertos', 0, v_mes, 'alteracao', 'trava do mês', null, 'fechado', v_autor, v_nome);
    return OLD;
  end if;
end $function$;
CREATE FUNCTION public.registrar_retorno(p_funcionario bigint, p_retorno date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_af   public.afastamentos%rowtype;
  v_per  public.periodos%rowtype;
  v_dias int;
  v_novo_ini date;
begin
  if not public.pode('campos', 'retorno') then
    return jsonb_build_object('ok', false, 'msg', 'Seu acesso não permite registrar retorno.');
  end if;

  select * into v_af from public.afastamentos
   where funcionario_id = p_funcionario and retorno is null
   order by inicio desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'msg', 'Esta pessoa não tem afastamento em aberto.');
  end if;
  if p_retorno < v_af.inicio then
    return jsonb_build_object('ok', false, 'msg', 'O retorno não pode ser antes do início do afastamento.');
  end if;

  update public.afastamentos set retorno = p_retorno where id = v_af.id;
  update public.funcionarios set situacao = 'ativo' where id = p_funcionario;

  -- licenca-maternidade conta como tempo de servico (art. 131 II): mantem o periodo
  if v_af.motivo = 'maternidade' then
    return jsonb_build_object('ok', true, 'perdeu', false, 'dias', 0,
      'msg', 'Retorno de licença-maternidade registrado. O período aquisitivo foi mantido.');
  end if;

  select * into v_per from public.periodos
   where funcionario_id = p_funcionario order by inicio_aquisitivo desc limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'perdeu', false, 'dias', 0,
      'msg', 'Retorno registrado. Esta pessoa não tem período aquisitivo cadastrado.');
  end if;

  v_dias := public.dias_afastado_no_periodo(
              p_funcionario, v_per.inicio_aquisitivo, v_per.fim_aquisitivo, p_retorno);

  if v_dias < 180 then
    return jsonb_build_object('ok', true, 'perdeu', false, 'dias', v_dias,
      'msg', format('Retorno registrado. Foram %s dias de afastamento neste período aquisitivo — menos de 180, o direito às férias está mantido.', v_dias));
  end if;

  -- art. 133 IV e §2: perde o periodo e comeca um novo na data do retorno
  v_novo_ini := p_retorno;
  update public.periodos
     set inicio_aquisitivo = v_novo_ini,
         fim_aquisitivo    = (v_novo_ini + interval '1 year' - interval '1 day')::date,
         data_saida = null, data_saida_2 = null, dias_bloco_1 = null,
         modo = 'integral', abono_dias = 0, dias_direito = 30,
         excecao_data = null, excecao_por = null, excecao_em = null,
         observacao = format('Período %s a %s perdido pelo art. 133 IV — %s dias de afastamento por doença. Novo período a partir do retorno em %s.',
                             to_char(v_per.inicio_aquisitivo,'DD/MM/YYYY'),
                             to_char(v_per.fim_aquisitivo,'DD/MM/YYYY'),
                             v_dias, to_char(p_retorno,'DD/MM/YYYY'))
   where id = v_per.id;

  return jsonb_build_object('ok', true, 'perdeu', true, 'dias', v_dias,
    'novo_inicio', v_novo_ini, 'novo_fim', (v_novo_ini + interval '1 year' - interval '1 day')::date,
    'msg', format('Foram %s dias de afastamento por doença neste período aquisitivo. Pelo art. 133 IV o período foi perdido e começou um novo em %s.',
                  v_dias, to_char(p_retorno,'DD/MM/YYYY')));
end $function$;
CREATE FUNCTION public.saida_congelada(d date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select d is not null
     and date_trunc('month', d) < date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)
     and not exists (select 1 from public.fechamento_prazos z
                     where z.ano = extract(year from d)::int and z.mes = extract(month from d)::int
                       and z.prazo > now())
$function$;
CREATE FUNCTION public.sem_acento(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select upper(trim(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')))
$function$;
CREATE FUNCTION public.supervisor_do_login()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select f.supervisor
    from public.usuarios u
    join public.funcionarios f on public.sem_acento(f.supervisor) = public.sem_acento(u.nome)
   where u.id = public.fe_uid() and u.ativo and not u.dono and u.papel in ('administrador','consulta')
   limit 1
$function$;
CREATE FUNCTION public.tg_congela_ficha_saidas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (new.cliente, new.supervisor, new.funcao, new.turno, new.escala)
     is distinct from (old.cliente, old.supervisor, old.funcao, old.turno, old.escala) then
    update periodos set snap1_cliente = old.cliente, snap1_supervisor = old.supervisor,
           snap1_funcao = old.funcao, snap1_turno = old.turno, snap1_escala = old.escala, snap1_em = now()
     where funcionario_id = old.id and snap1_em is null and saida_congelada(data_saida);
    update periodos set snap2_cliente = old.cliente, snap2_supervisor = old.supervisor,
           snap2_funcao = old.funcao, snap2_turno = old.turno, snap2_escala = old.escala, snap2_em = now()
     where funcionario_id = old.id and snap2_em is null and saida_congelada(data_saida_2);
  end if;
  return new;
end
$function$;
CREATE FUNCTION public.tg_trava_mes_fechado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v1 boolean := public.mes_travado(old.data_saida);
  v2 boolean := public.mes_travado(old.data_saida_2);
  s1 boolean := coalesce(old.sar2g_1, false);
  s2 boolean := coalesce(old.sar2g_2, false);
  m1 text := to_char(old.data_saida, 'MM/YYYY');
  m2 text := to_char(old.data_saida_2, 'MM/YYYY');
  mudou_1 boolean;
  mudou_2 boolean;
  mudou_comum boolean;
begin
  if TG_OP = 'DELETE' then
    if v1 or v2 then
      raise exception 'Mês fechado. As férias de % já aconteceram — abra o mês antes de alterar.', coalesce(m1, m2);
    end if;
    if s1 or s2 then
      raise exception 'Férias já lançadas no Sar2G. Desmarque o quadradinho do Sar2G antes de excluir.';
    end if;
    return old;
  end if;

  mudou_1 := new.data_saida is distinct from old.data_saida
          or new.cobertura is distinct from old.cobertura
          or new.dias_bloco_1 is distinct from old.dias_bloco_1
          or new.excecao_data is distinct from old.excecao_data
          or new.excecao_por is distinct from old.excecao_por
          or new.excecao_em is distinct from old.excecao_em;
  mudou_2 := new.data_saida_2 is distinct from old.data_saida_2
          or new.cobertura_2 is distinct from old.cobertura_2;
  mudou_comum := new.inicio_aquisitivo is distinct from old.inicio_aquisitivo
              or new.fim_aquisitivo is distinct from old.fim_aquisitivo
              or new.dias_direito is distinct from old.dias_direito
              or new.abono_dias is distinct from old.abono_dias
              or new.modo is distinct from old.modo
              or new.observacao is distinct from old.observacao
              or new.ferias_combinadas is distinct from old.ferias_combinadas;

  if v1 and new.sar2g_1 is distinct from old.sar2g_1 then
    raise exception 'Mês fechado. As férias de % já aconteceram — abra o mês antes de alterar.', m1;
  end if;
  if v2 and new.sar2g_2 is distinct from old.sar2g_2 then
    raise exception 'Mês fechado. As férias de % já aconteceram — abra o mês antes de alterar.', m2;
  end if;

  if v1 and (old.snap1_em is not null or pg_trigger_depth() < 2) and (new.snap1_cliente, new.snap1_supervisor, new.snap1_funcao, new.snap1_turno, new.snap1_escala)
       is distinct from (old.snap1_cliente, old.snap1_supervisor, old.snap1_funcao, old.snap1_turno, old.snap1_escala) then
    raise exception 'Mês fechado. As férias de % já aconteceram — abra o mês antes de alterar.', m1;
  end if;
  if v2 and (old.snap2_em is not null or pg_trigger_depth() < 2) and (new.snap2_cliente, new.snap2_supervisor, new.snap2_funcao, new.snap2_turno, new.snap2_escala)
       is distinct from (old.snap2_cliente, old.snap2_supervisor, old.snap2_funcao, old.snap2_turno, old.snap2_escala) then
    raise exception 'Mês fechado. As férias de % já aconteceram — abra o mês antes de alterar.', m2;
  end if;

  if coalesce(new.sar2g_2, false) and not s2 and not coalesce(new.sar2g_1, false) then
    if v1 then
      raise exception 'SUPORTE: Não é possível marcar a 2ª saída: falta a marcação do Sar2G da 1ª saída no mês %. Entre em contato com o suporte.', m1;
    end if;
    raise exception 'Marque primeiro o Sar2G da 1ª saída.';
  end if;
  if s1 and not coalesce(new.sar2g_1, false) and coalesce(new.sar2g_2, false) then
    raise exception 'Desmarque primeiro o Sar2G da 2ª saída.';
  end if;

  if mudou_1 then
    if v1 then
      raise exception 'Mês fechado. As férias de % já aconteceram — abra o mês antes de alterar.', m1;
    elsif s1 then
      raise exception 'Férias da 1ª saída já lançadas no Sar2G. Desmarque o quadradinho do Sar2G para alterar.';
    end if;
  end if;

  if mudou_2 then
    if v2 then
      raise exception 'Mês fechado. As férias de % já aconteceram — abra o mês antes de alterar.', m2;
    elsif s2 then
      raise exception 'Férias da 2ª saída já lançadas no Sar2G. Desmarque o quadradinho do Sar2G para alterar.';
    end if;
  end if;

  if mudou_comum then
    if v1 or v2 then
      raise exception 'Mês fechado. As férias de % já aconteceram — abra o mês antes de alterar.', coalesce(case when v1 then m1 end, m2);
    elsif s1 or s2 then
      raise exception 'Férias já lançadas no Sar2G. Desmarque o quadradinho do Sar2G para alterar.';
    end if;
  end if;

  return new;
end
$function$;
CREATE FUNCTION public.tg_trava_mes_grupo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t text; d date;
begin
  -- A regra vale só para escritas feitas pelo assistente (sem login de usuário).
  -- Logins da plataforma (public.fe_uid() preenchido) podem usar o mês normalmente.
  if public.fe_uid() is not null then
    if TG_OP = 'DELETE' then return old; end if;
    return new;
  end if;

  if TG_OP = 'INSERT' then
    select f.turno into t from public.funcionarios f where f.id = new.funcionario_id;
    d := null;
    if public.mes_bloqueado_grupo(new.data_saida, t) then d := new.data_saida;
    elsif public.mes_bloqueado_grupo(new.data_saida_2, t) then d := new.data_saida_2; end if;
    if d is not null then
      raise exception 'Mês % bloqueado para o grupo % — não é permitido colocar esse grupo neste mês.', to_char(d, 'MM/YYYY'), t;
    end if;
    return new;
  elsif TG_OP = 'UPDATE' then
    select f.turno into t from public.funcionarios f where f.id = new.funcionario_id;
    if (new.data_saida is distinct from old.data_saida and public.mes_bloqueado_grupo(new.data_saida, t))
       or (new.data_saida_2 is distinct from old.data_saida_2 and public.mes_bloqueado_grupo(new.data_saida_2, t)) then
      raise exception 'Mês bloqueado para o grupo % — não é permitido colocar esse grupo neste mês.', t;
    end if;
    return new;
  else
    return old;
  end if;
end $function$;
CREATE FUNCTION public.tirar_snapshot(p_origem text DEFAULT 'automatico'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_f jsonb; v_p jsonb; v_id bigint;
begin
  select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) into v_f from public.funcionarios f;
  select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) into v_p from public.periodos  p;

  insert into public.snapshots (origem,funcionarios,periodos,total_funcionarios,total_periodos)
  values (p_origem, v_f, v_p, jsonb_array_length(v_f), jsonb_array_length(v_p))
  returning id into v_id;

  delete from public.snapshots
   where id not in (select id from public.snapshots order by criado_em desc limit 12);

  return 'Snapshot ' || v_id || ' gravado: ' || jsonb_array_length(v_f)
         || ' funcionarios e ' || jsonb_array_length(v_p) || ' periodos.';
end $function$;
CREATE FUNCTION public.trava_colunas_funcionarios()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare barra text;
begin
  if current_user = 'fe_app' and public.papel_atual() = 'administrador' then
    if new.id is distinct from old.id or new.codigo is distinct from old.codigo
       or new.nome is distinct from old.nome or new.admissao is distinct from old.admissao
       or new.criado_em is distinct from old.criado_em then
      barra := 'o cadastro';
    elsif new.funcao is distinct from old.funcao and not public.pode('campos','funcao') then
      barra := 'a função';
    elsif new.cliente is distinct from old.cliente and not public.pode('campos','cliente') then
      barra := 'o cliente';
    elsif new.supervisor is distinct from old.supervisor and not public.pode('campos','supervisor') then
      barra := 'o supervisor';
    elsif new.turno is distinct from old.turno and not public.pode('campos','turno') then
      barra := 'o turno';
    elsif new.escala is distinct from old.escala and not public.pode('campos','escala') then
      barra := 'a escala';
    elsif new.situacao is distinct from old.situacao and not public.pode('campos','situacao') then
      barra := 'a situação';
    end if;
    if barra is not null then
      raise exception 'Seu acesso não permite alterar %.', barra;
    end if;
  end if;
  return new;
end $function$;
CREATE FUNCTION public.trava_colunas_periodos()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  p_datas boolean; p_dias boolean; p_abono boolean; p_sit boolean; p_cob boolean;
  barra text;
begin
  if current_user = 'fe_app' and public.papel_atual() = 'administrador' then
    p_datas := public.pode('campos','datas');
    p_dias  := public.pode('campos','dias');
    p_abono := public.pode('campos','abono');
    p_sit   := public.pode('campos','situacao');
    p_cob   := public.pode('campos','cobertura');

    if new.id is distinct from old.id
       or new.funcionario_id is distinct from old.funcionario_id
       or new.inicio_aquisitivo is distinct from old.inicio_aquisitivo
       or new.fim_aquisitivo is distinct from old.fim_aquisitivo
       or new.observacao is distinct from old.observacao
       or new.criado_em is distinct from old.criado_em then
      barra := 'o período aquisitivo';
    elsif (new.excecao_data is distinct from old.excecao_data and new.excecao_data is not null)
       or (new.excecao_por  is distinct from old.excecao_por  and new.excecao_por  is not null)
       or (new.excecao_em   is distinct from old.excecao_em   and new.excecao_em   is not null) then
      barra := 'a aprovação de exceção';
    elsif (new.excecao_data is distinct from old.excecao_data
           or new.excecao_por is distinct from old.excecao_por
           or new.excecao_em  is distinct from old.excecao_em) and not p_datas then
      barra := 'as datas';
    elsif new.data_saida is distinct from old.data_saida and not p_datas then
      barra := 'as datas';
    elsif new.data_saida_2 is distinct from old.data_saida_2
          and not (p_datas or (new.data_saida_2 is null and (p_dias or p_sit))) then
      barra := 'as datas';
    elsif (new.dias_direito is distinct from old.dias_direito
           or new.dias_bloco_1 is distinct from old.dias_bloco_1) and not (p_dias or p_sit) then
      barra := 'os dias';
    elsif new.modo is distinct from old.modo and not (p_dias or p_sit) then
      barra := 'a situação';
    elsif new.abono_dias is distinct from old.abono_dias
          and not (p_abono or p_dias or (p_sit and coalesce(new.abono_dias, 0) = 0)) then
      barra := 'o abono';
    elsif new.cobertura is distinct from old.cobertura and not p_cob then
      barra := 'a cobertura';
    end if;

    if barra is not null then
      raise exception 'Seu acesso não permite alterar %.', barra;
    end if;
  end if;
  new.alterado_em := now();
  return new;
end $function$;
CREATE FUNCTION public.turno_do_cargo(cargo text, turno_desc text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when cargo is null then null
    when cargo ilike '%PORTEIR%' or cargo ilike '%CONTROLADOR%' or cargo ilike '%VIGIA%'
         or cargo ilike '%RECEPCION%' or cargo ilike '%MENSAGEIR%' then
      case when turno_desc ilike '%NOTURN%' or turno_desc ilike '%NOITE%'
           then case when cargo ilike '%MENSAGEIR%' then 'ME' else 'PN' end
           else case when cargo ilike '%MENSAGEIR%' then 'ME' else 'PD' end end
    when cargo ilike '%ZELADOR%' then 'Z'
    when cargo ilike '%JARDIN%' then 'JA'
    when cargo ilike '%SERVIÇOS GERAIS%' or cargo ilike '%SERV GERAIS%'
         or cargo ilike '%LIMPEZA%' or cargo ilike '%FISCAL DE PISO%' then 'L?'
    when cargo ilike '%SUPERVISOR%' or cargo ilike '%SUPERVISÃO%' then
      case when turno_desc ilike '%NOTURN%' or turno_desc ilike '%NOITE%' then 'SN' else 'SD' end
    else 'ADM'
  end
$function$;

-- Views
CREATE OR REPLACE VIEW public.rel_lido AS
 SELECT r.ord,
    r.re,
    r.nome,
    de.valor AS empresa,
    ds.valor AS supervisor,
    dc.valor AS cliente,
    dl.valor AS local,
    dt.valor AS turno_desc,
    dr.valor AS cargo
   FROM rel_import r
     LEFT JOIN rel_dic de ON de.campo = 'NOMEEMPRESA'::text AND de.id = r.emp
     LEFT JOIN rel_dic ds ON ds.campo = 'AREASUPERVISAO'::text AND ds.id = r.sup
     LEFT JOIN rel_dic dc ON dc.campo = 'NOMECLIENTE'::text AND dc.id = r.cli
     LEFT JOIN rel_dic dl ON dl.campo = 'NOMELOCAL'::text AND dl.id = r.loc
     LEFT JOIN rel_dic dt ON dt.campo = 'DESCTURNOTRABALHO'::text AND dt.id = r.tur
     LEFT JOIN rel_dic dr ON dr.campo = 'DESCCARGO'::text AND dr.id = r.car;
CREATE OR REPLACE VIEW public.vw_aso AS
 WITH eu AS (
         SELECT supervisor_do_login() AS sup,
            pode('abas'::text, 'aso'::text) AS ve
        )
 SELECT f.id AS funcionario_id,
    f.codigo,
    f.nome,
    f.funcao,
    f.cliente,
    f.supervisor,
    f.admissao,
    a.ultimo_exame,
    a.exemplo,
    a.carregado_em,
    a.ultimo_exame + 365 AS vence_em,
    CURRENT_DATE - (a.ultimo_exame + 365) AS dias_vencido,
        CASE
            WHEN a.ultimo_exame IS NULL THEN 'sem'::text
            WHEN CURRENT_DATE > (a.ultimo_exame + 365) THEN 'vencido'::text
            WHEN CURRENT_DATE >= (a.ultimo_exame + 365 - 30) THEN 'vence'::text
            ELSE 'emdia'::text
        END AS status,
    f.escala,
    f.turno,
        CASE f.turno
            WHEN 'PD'::text THEN 'Portaria dia'::text
            WHEN 'PN'::text THEN 'Portaria noite'::text
            WHEN 'LF'::text THEN 'Limpeza'::text
            WHEN 'LM'::text THEN 'Limpeza'::text
            WHEN 'Z'::text THEN 'Zeladoria'::text
            WHEN 'JA'::text THEN 'Jardinagem'::text
            ELSE 'Sem turno'::text
        END AS grupo
   FROM funcionarios f
     CROSS JOIN eu
     LEFT JOIN aso a ON a.funcionario_id = f.id
  WHERE eu.ve AND (f.situacao = ANY (ARRAY['ativo'::text, 'maternidade'::text])) AND (eu.sup IS NULL OR sem_acento(f.supervisor) = sem_acento(eu.sup));
CREATE OR REPLACE VIEW public.vw_escala AS
 SELECT p.id AS periodo_id,
    f.id AS funcionario_id,
    f.codigo,
    f.nome,
    f.admissao,
    f.funcao,
    f.cliente,
    f.turno,
    f.escala,
    f.situacao,
    f.supervisor,
    p.inicio_aquisitivo,
    p.fim_aquisitivo,
    p.fim_aquisitivo + 180 AS data_limite,
    (p.fim_aquisitivo + '1 year'::interval)::date AS prazo_legal,
    p.dias_direito,
    p.abono_dias,
    p.dias_direito - COALESCE(p.abono_dias, 0) AS dias_gozo,
    p.data_saida,
    EXTRACT(year FROM p.data_saida)::integer AS ano_saida,
    EXTRACT(month FROM p.data_saida)::integer AS mes_saida,
    p.cobertura,
    p.observacao,
        CASE
            WHEN f.turno = 'PD'::text THEN 'Portaria dia'::text
            WHEN f.turno = 'PN'::text THEN 'Portaria noite'::text
            WHEN f.turno = ANY (ARRAY['LF'::text, 'LM'::text]) THEN 'Limpeza'::text
            WHEN f.turno = ANY (ARRAY['SD'::text, 'SN'::text]) THEN 'Supervisão'::text
            WHEN f.turno = 'Z'::text THEN 'Zeladoria'::text
            WHEN f.turno = 'JA'::text THEN 'Jardinagem'::text
            WHEN f.turno IS NULL THEN 'Sem turno'::text
            ELSE 'Demais'::text
        END AS grupo,
        CASE
            WHEN f.situacao <> 'ativo'::text THEN NULL::text
            WHEN p.data_saida IS NOT NULL AND p.data_saida > (p.fim_aquisitivo + '1 year'::interval)::date OR p.data_saida_2 IS NOT NULL AND p.data_saida_2 > (p.fim_aquisitivo + '1 year'::interval)::date OR p.data_saida >= '2027-01-01'::date AND p.data_saida > ((p.fim_aquisitivo + '1 year'::interval)::date - 60) OR p.data_saida_2 >= '2027-01-01'::date AND p.data_saida_2 > ((p.fim_aquisitivo + '1 year'::interval)::date - 60) THEN 'prazo'::text
            WHEN p.data_saida IS NULL AND (p.fim_aquisitivo + '1 year'::interval)::date <= (CURRENT_DATE + 60) THEN 'prazo'::text
            WHEN f.escala = '12x36'::text THEN NULL::text
            WHEN (EXTRACT(dow FROM p.data_saida) = ANY (ARRAY[0::numeric, 5::numeric, 6::numeric])) OR (EXTRACT(dow FROM p.data_saida_2) = ANY (ARRAY[0::numeric, 5::numeric, 6::numeric])) THEN 'fimdesemana'::text
            WHEN (EXISTS ( SELECT 1
               FROM feriados h
              WHERE h.conta_para_ferias AND (h.data >= p.data_saida AND h.data <= (p.data_saida + 2) OR h.data >= p.data_saida_2 AND h.data <= (p.data_saida_2 + 2)))) THEN 'feriado'::text
            ELSE NULL::text
        END AS alerta,
    p.excecao_data IS NOT NULL AND p.excecao_data = p.data_saida AS excecao_ok,
    p.excecao_data,
    (p.fim_aquisitivo + '1 year'::interval)::date - CURRENT_DATE AS dias_ate_prazo,
    ( SELECT h.nome
           FROM feriados h
          WHERE h.conta_para_ferias AND (h.data >= p.data_saida AND h.data <= (p.data_saida + 2) OR h.data >= p.data_saida_2 AND h.data <= (p.data_saida_2 + 2))
          ORDER BY h.data
         LIMIT 1) AS feriado_nome,
    ( SELECT h.data
           FROM feriados h
          WHERE h.conta_para_ferias AND (h.data >= p.data_saida AND h.data <= (p.data_saida + 2) OR h.data >= p.data_saida_2 AND h.data <= (p.data_saida_2 + 2))
          ORDER BY h.data
         LIMIT 1) AS feriado_data,
    p.modo,
    p.dias_bloco_1,
    p.data_saida_2,
        CASE
            WHEN p.modo = 'fracionado'::text AND p.dias_bloco_1 IS NOT NULL THEN p.dias_direito - COALESCE(p.abono_dias, 0) - p.dias_bloco_1
            ELSE NULL::integer
        END AS dias_bloco_2,
    EXTRACT(year FROM p.data_saida_2)::integer AS ano_saida_2,
    EXTRACT(month FROM p.data_saida_2)::integer AS mes_saida_2,
    ( SELECT a.inicio
           FROM afastamentos a
          WHERE a.funcionario_id = f.id AND a.retorno IS NULL
          ORDER BY a.inicio DESC
         LIMIT 1) AS inicio_afastamento,
    ( SELECT a.motivo
           FROM afastamentos a
          WHERE a.funcionario_id = f.id AND a.retorno IS NULL
          ORDER BY a.inicio DESC
         LIMIT 1) AS motivo_afastamento,
    mes_travado(p.data_saida) OR mes_travado(p.data_saida_2) AS travado,
    p.sar2g_1,
    p.sar2g_2,
    p.ferias_combinadas,
    p.cobertura_2
   FROM periodos p
     JOIN funcionarios f ON f.id = p.funcionario_id
  WHERE NOT ((EXISTS ( SELECT 1
           FROM programacao_historica ph
          WHERE ph.codigo = f.codigo AND ph.inicio_aquisitivo = p.inicio_aquisitivo AND ph.motivo = 'Demitido'::text)) AND NOT (p.data_saida IS NOT NULL AND NOT mes_travado(p.data_saida) OR p.data_saida_2 IS NOT NULL AND NOT mes_travado(p.data_saida_2)));
CREATE OR REPLACE VIEW public.vw_ficha_saidas AS
 SELECT p.id AS periodo_id,
        CASE
            WHEN p.snap1_em IS NOT NULL THEN p.snap1_cliente
            ELSE f.cliente
        END AS eff1_cliente,
        CASE
            WHEN p.snap1_em IS NOT NULL THEN p.snap1_supervisor
            ELSE f.supervisor
        END AS eff1_supervisor,
        CASE
            WHEN p.snap1_em IS NOT NULL THEN p.snap1_funcao
            ELSE f.funcao
        END AS eff1_funcao,
        CASE
            WHEN p.snap1_em IS NOT NULL THEN p.snap1_turno
            ELSE f.turno
        END AS eff1_turno,
        CASE
            WHEN p.snap1_em IS NOT NULL THEN p.snap1_escala
            ELSE f.escala
        END AS eff1_escala,
        CASE
            WHEN p.snap2_em IS NOT NULL THEN p.snap2_cliente
            ELSE f.cliente
        END AS eff2_cliente,
        CASE
            WHEN p.snap2_em IS NOT NULL THEN p.snap2_supervisor
            ELSE f.supervisor
        END AS eff2_supervisor,
        CASE
            WHEN p.snap2_em IS NOT NULL THEN p.snap2_funcao
            ELSE f.funcao
        END AS eff2_funcao,
        CASE
            WHEN p.snap2_em IS NOT NULL THEN p.snap2_turno
            ELSE f.turno
        END AS eff2_turno,
        CASE
            WHEN p.snap2_em IS NOT NULL THEN p.snap2_escala
            ELSE f.escala
        END AS eff2_escala
   FROM periodos p
     JOIN funcionarios f ON f.id = p.funcionario_id;
CREATE OR REPLACE VIEW public.vw_financeiro_13 AS
 WITH p AS (
         SELECT COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'inss_patronal'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 0::numeric) + COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'rat'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 0::numeric) * COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'fap'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 1::numeric) + COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'terceiros'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 0::numeric) AS pct_patronal,
            COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'fgts'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 0::numeric) AS pct_fgts,
            COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'hipotese_nov'::text THEN fin_param.texto
                    ELSE NULL::text
                END), 'A'::text) AS hip_nov
           FROM fin_param
        ), b AS (
         SELECT f.id,
            f.emp,
            f.codigo,
            f.nome,
            f.admissao,
            f.salario,
            f.av,
            f.valor_13,
            f.valor_adc,
            f.valor_ant,
            f.adc_ant,
            f.enc_inss,
            f.fgts_dep,
            f.total,
            f.data_foto,
            round(f.salario * f.av::numeric / 12.0, 2) AS v13,
            LEAST(f.av + 2, 12) AS av_dez
           FROM folha_13_import f
          WHERE NOT f.demitido
        )
 SELECT b.emp,
    b.codigo,
    b.nome,
    b.admissao,
    b.salario,
    b.av,
    b.data_foto,
    fu.turno,
    fu.cliente,
    fu.supervisor,
    fu.situacao,
        CASE fu.turno
            WHEN 'PD'::text THEN 'Portaria dia'::text
            WHEN 'PN'::text THEN 'Portaria noite'::text
            WHEN 'LF'::text THEN 'Limpeza'::text
            WHEN 'LM'::text THEN 'Limpeza'::text
            WHEN 'Z'::text THEN 'Zeladoria'::text
            WHEN 'JA'::text THEN 'Jardinagem'::text
            WHEN 'SD'::text THEN 'Supervisao'::text
            WHEN 'SN'::text THEN 'Supervisao'::text
            WHEN 'ADM'::text THEN 'Administrativo'::text
            WHEN 'ME'::text THEN 'Mensageiro'::text
            ELSE 'Fora da programacao'::text
        END AS grupo,
    fu.codigo IS NULL AS fora_da_plataforma,
    b.v13,
    b.valor_adc,
    b.v13 + b.valor_adc AS base_13,
    b.valor_ant + b.adc_ant AS ja_adiantado,
    b.v13 + b.valor_adc - b.valor_ant - b.adc_ant AS saldo,
    round((b.v13 + b.valor_adc) * p.pct_patronal / 100::numeric, 2) AS enc_patronal,
    round((b.v13 + b.valor_adc - b.valor_ant - b.adc_ant) * p.pct_fgts / 100::numeric, 2) AS fgts,
    round(b.v13 + b.valor_adc - b.valor_ant - b.adc_ant + (b.v13 + b.valor_adc) * p.pct_patronal / 100::numeric + (b.v13 + b.valor_adc - b.valor_ant - b.adc_ant) * p.pct_fgts / 100::numeric, 2) AS custo_dezembro,
        CASE
            WHEN (b.valor_ant + b.adc_ant) = 0::numeric THEN true
            ELSE false
        END AS recebe_em_novembro,
        CASE
            WHEN (b.valor_ant + b.adc_ant) = 0::numeric THEN
            CASE
                WHEN p.hip_nov = 'B'::text THEN round((b.v13 + b.valor_adc) / 2::numeric, 2)
                ELSE round(b.salario / 2::numeric, 2)
            END
            ELSE 0::numeric
        END AS adiant_novembro,
        CASE
            WHEN (b.valor_ant + b.adc_ant) = 0::numeric THEN round(
            CASE
                WHEN p.hip_nov = 'B'::text THEN (b.v13 + b.valor_adc) / 2::numeric
                ELSE b.salario / 2::numeric
            END * p.pct_fgts / 100::numeric, 2)
            ELSE 0::numeric
        END AS fgts_novembro,
        CASE
            WHEN (b.valor_ant + b.adc_ant) = 0::numeric AND (b.salario / 2::numeric) > (b.v13 + b.valor_adc) THEN round(b.salario / 2::numeric - (b.v13 + b.valor_adc), 2)
            ELSE 0::numeric
        END AS excesso_hip_a,
    round((b.v13 + b.valor_adc) * b.av_dez::numeric / b.av::numeric, 2) AS base_13_dez,
    b.av_dez,
    p.pct_patronal,
    p.pct_fgts,
    p.hip_nov
   FROM b
     CROSS JOIN p
     LEFT JOIN funcionarios fu ON fu.codigo = b.codigo;
CREATE OR REPLACE VIEW public.vw_financeiro_ferias AS
 WITH p AS (
         SELECT COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'inss_patronal'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 0::numeric) + COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'rat'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 0::numeric) * COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'fap'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 1::numeric) + COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'terceiros'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 0::numeric) AS pct_patronal,
            COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'fgts'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 0::numeric) AS pct_fgts,
            COALESCE(max(
                CASE
                    WHEN fin_param.chave = 'reajuste_pct'::text THEN fin_param.valor
                    ELSE NULL::numeric
                END), 0::numeric) AS pct_reajuste
           FROM fin_param
        ), sal AS (
         SELECT f.codigo,
            f.salario + round(f.valor_adc * 12.0 / NULLIF(f.av, 0)::numeric, 2) AS remun
           FROM folha_13_import f
        ), pr AS (
         SELECT fu.codigo,
            fu.nome,
            fu.turno,
            fu.cliente,
            fu.supervisor,
            p2.data_saida,
            GREATEST(COALESCE(p2.dias_direito, 30) - COALESCE(p2.abono_dias, 0), 0) AS dias_gozo,
            COALESCE(p2.abono_dias, 0) AS abono_dias
           FROM periodos p2
             JOIN funcionarios fu ON fu.id = p2.funcionario_id
          WHERE p2.data_saida IS NOT NULL AND pode_financeiro() AND NOT (EXISTS ( SELECT 1
                   FROM demissao_avisada d
                  WHERE d.codigo = fu.codigo))
        )
 SELECT EXTRACT(year FROM pr.data_saida)::integer AS ano,
    EXTRACT(month FROM pr.data_saida)::integer AS mes,
    pr.codigo,
    pr.nome,
    pr.turno,
    pr.cliente,
    pr.supervisor,
    pr.data_saida,
    pr.dias_gozo,
    pr.abono_dias,
        CASE pr.turno
            WHEN 'PD'::text THEN 'Portaria dia'::text
            WHEN 'PN'::text THEN 'Portaria noite'::text
            WHEN 'LF'::text THEN 'Limpeza'::text
            WHEN 'LM'::text THEN 'Limpeza'::text
            WHEN 'Z'::text THEN 'Zeladoria'::text
            WHEN 'JA'::text THEN 'Jardinagem'::text
            WHEN 'SD'::text THEN 'Supervisao'::text
            WHEN 'SN'::text THEN 'Supervisao'::text
            WHEN 'ADM'::text THEN 'Administrativo'::text
            WHEN 'ME'::text THEN 'Mensageiro'::text
            ELSE 'Sem turno'::text
        END AS grupo,
    sal.codigo IS NULL AS sem_salario,
    COALESCE(sal.remun, 0::numeric) * (1::numeric + p.pct_reajuste / 100::numeric) AS remuneracao,
    round(COALESCE(sal.remun, 0::numeric) * (1::numeric + p.pct_reajuste / 100::numeric) * pr.dias_gozo::numeric / 30.0, 2) AS ferias_dias,
    round(COALESCE(sal.remun, 0::numeric) * (1::numeric + p.pct_reajuste / 100::numeric) * pr.dias_gozo::numeric / 30.0 / 3.0, 2) AS um_terco,
    round(COALESCE(sal.remun, 0::numeric) * (1::numeric + p.pct_reajuste / 100::numeric) * pr.dias_gozo::numeric / 30.0 * 4.0 / 3.0, 2) AS bruto,
    round(COALESCE(sal.remun, 0::numeric) * (1::numeric + p.pct_reajuste / 100::numeric) * pr.dias_gozo::numeric / 30.0 * 4.0 / 3.0 * p.pct_patronal / 100::numeric, 2) AS enc_patronal,
    round(COALESCE(sal.remun, 0::numeric) * (1::numeric + p.pct_reajuste / 100::numeric) * pr.dias_gozo::numeric / 30.0 * 4.0 / 3.0 * p.pct_fgts / 100::numeric, 2) AS fgts,
    round(COALESCE(sal.remun, 0::numeric) * (1::numeric + p.pct_reajuste / 100::numeric) * pr.dias_gozo::numeric / 30.0 * 4.0 / 3.0 * (1::numeric + p.pct_patronal / 100::numeric + p.pct_fgts / 100::numeric), 2) AS custo_empresa,
    p.pct_patronal,
    p.pct_fgts,
    p.pct_reajuste
   FROM pr
     CROSS JOIN p
     LEFT JOIN sal ON sal.codigo = pr.codigo;
CREATE OR REPLACE VIEW public.vw_historica AS
 SELECT - id AS periodo_id,
    NULL::bigint AS funcionario_id,
    codigo,
    nome,
    NULL::date AS admissao,
    funcao,
    cliente,
    turno,
    escala,
    'desligado'::text AS situacao,
    supervisor,
    inicio_aquisitivo,
    fim_aquisitivo,
    fim_aquisitivo + 180 AS data_limite,
    (fim_aquisitivo + '1 year'::interval)::date AS prazo_legal,
    dias_direito,
    abono_dias,
    dias_direito - COALESCE(abono_dias, 0) AS dias_gozo,
    data_saida,
    EXTRACT(year FROM data_saida)::integer AS ano_saida,
    EXTRACT(month FROM data_saida)::integer AS mes_saida,
    cobertura,
    observacao,
        CASE
            WHEN turno = 'PD'::text THEN 'Portaria dia'::text
            WHEN turno = 'PN'::text THEN 'Portaria noite'::text
            WHEN turno = ANY (ARRAY['LF'::text, 'LM'::text]) THEN 'Limpeza'::text
            WHEN turno = ANY (ARRAY['SD'::text, 'SN'::text]) THEN 'Supervisão'::text
            WHEN turno = 'Z'::text THEN 'Zeladoria'::text
            WHEN turno = 'JA'::text THEN 'Jardinagem'::text
            WHEN turno IS NULL THEN 'Sem turno'::text
            ELSE 'Demais'::text
        END AS grupo,
    NULL::text AS alerta,
    true AS excecao_ok,
    NULL::date AS excecao_data,
    NULL::integer AS dias_ate_prazo,
    NULL::text AS feriado_nome,
    NULL::date AS feriado_data,
    modo,
    dias_bloco_1,
    data_saida_2,
        CASE
            WHEN modo = 'fracionado'::text AND dias_bloco_1 IS NOT NULL THEN dias_direito - COALESCE(abono_dias, 0) - dias_bloco_1
            ELSE NULL::integer
        END AS dias_bloco_2,
    EXTRACT(year FROM data_saida_2)::integer AS ano_saida_2,
    EXTRACT(month FROM data_saida_2)::integer AS mes_saida_2,
    NULL::date AS inicio_afastamento,
    NULL::text AS motivo_afastamento,
    true AS travado,
    true AS congelado,
    motivo AS motivo_congelado
   FROM programacao_historica h;

-- Triggers
CREATE TRIGGER tg_congela_ficha BEFORE UPDATE ON public.funcionarios FOR EACH ROW EXECUTE FUNCTION tg_congela_ficha_saidas();
CREATE TRIGGER tg_marca_alteracao_funcionarios BEFORE UPDATE ON public.funcionarios FOR EACH ROW EXECUTE FUNCTION marca_alteracao();
CREATE TRIGGER tg_trava_colunas_funcionarios BEFORE UPDATE ON public.funcionarios FOR EACH ROW EXECUTE FUNCTION trava_colunas_funcionarios();
CREATE TRIGGER trg_hist_funcionarios AFTER INSERT OR DELETE OR UPDATE ON public.funcionarios FOR EACH ROW EXECUTE FUNCTION registra_historico();
CREATE TRIGGER trg_hist_meses AFTER INSERT OR DELETE ON public.meses_abertos FOR EACH ROW EXECUTE FUNCTION registra_mes_aberto();
CREATE TRIGGER tg_trava_colunas_periodos BEFORE UPDATE ON public.periodos FOR EACH ROW EXECUTE FUNCTION trava_colunas_periodos();
CREATE TRIGGER tg_trava_mes BEFORE DELETE OR UPDATE ON public.periodos FOR EACH ROW EXECUTE FUNCTION tg_trava_mes_fechado();
CREATE TRIGGER tg_trava_mes_grupo BEFORE INSERT OR DELETE OR UPDATE ON public.periodos FOR EACH ROW EXECUTE FUNCTION tg_trava_mes_grupo();
CREATE TRIGGER trg_hist_periodos AFTER INSERT OR DELETE OR UPDATE ON public.periodos FOR EACH ROW EXECUTE FUNCTION registra_historico();

-- Segurança em nível de linha (RLS)
ALTER TABLE public.afastamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aso_backup_15_10_2026 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aso_backup_16_10_2026 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ativos_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bkp_afastados_23_11 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bkp_feriados_24_11 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bkp_funcionarios_20261116 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bkp_periodos_20261116 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bkp_periodos_plano235_20261124 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bkp_periodos_plano33_20261123 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bkp_periodos_plano_jan27_20261116 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demissao_avisada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emails_autorizados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechamento_prazos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ferias_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_param ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folha_13_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fora_da_programacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lixeira_29_09 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meses_abertos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.periodos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programacao_historica ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rel_dic ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rel_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso (RLS). Dependem de public.fe_uid() e de funções auth.* do Supabase: ajustar no novo sistema.
CREATE POLICY "usuarios_le_proprio" ON public.usuarios AS PERMISSIVE FOR SELECT TO fe_app USING (((id = public.fe_uid()) OR (papel_atual() = 'master'::text)));
CREATE POLICY "funcionarios_todos_leem" ON public.funcionarios AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() IS NOT NULL));
CREATE POLICY "funcionarios_master_escreve" ON public.funcionarios AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text)) WITH CHECK ((papel_atual() = 'master'::text));
CREATE POLICY "periodos_todos_leem" ON public.periodos AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() IS NOT NULL));
CREATE POLICY "periodos_master_escreve" ON public.periodos AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text)) WITH CHECK ((papel_atual() = 'master'::text));
CREATE POLICY "turnos_todos_leem" ON public.turnos AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() IS NOT NULL));
CREATE POLICY "turnos_master_escreve" ON public.turnos AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text)) WITH CHECK ((papel_atual() = 'master'::text));
CREATE POLICY "config_todos_leem" ON public.config AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() IS NOT NULL));
CREATE POLICY "usuarios_dono_gerencia" ON public.usuarios AS PERMISSIVE FOR ALL TO fe_app USING (eh_dono()) WITH CHECK (eh_dono());
CREATE POLICY "config_master_escreve" ON public.config AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text)) WITH CHECK ((papel_atual() = 'master'::text));
CREATE POLICY "master_le_autorizados" ON public.emails_autorizados AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() = 'master'::text));
CREATE POLICY "master_escreve_autorizados" ON public.emails_autorizados AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text)) WITH CHECK ((papel_atual() = 'master'::text));
CREATE POLICY "snapshots_master_le" ON public.snapshots AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() = 'master'::text));
CREATE POLICY "feriados_todos_leem" ON public.feriados AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() IS NOT NULL));
CREATE POLICY "feriados_master_escreve" ON public.feriados AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text)) WITH CHECK ((papel_atual() = 'master'::text));
CREATE POLICY "rel_dic_master" ON public.rel_dic AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text));
CREATE POLICY "rel_import_master" ON public.rel_import AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text));
CREATE POLICY "fora_leitura" ON public.fora_da_programacao AS PERMISSIVE FOR SELECT TO fe_app USING (true);
CREATE POLICY "historico_le" ON public.historico AS PERMISSIVE FOR SELECT TO fe_app USING (pode('abas'::text, 'historico'::text));
CREATE POLICY "fora_master" ON public.fora_da_programacao AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text)) WITH CHECK ((papel_atual() = 'master'::text));
CREATE POLICY "ativos_master" ON public.ativos_import AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text));
CREATE POLICY "meses_todos_leem" ON public.meses_abertos AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() IS NOT NULL));
CREATE POLICY "folha13_le" ON public.folha_13_import AS PERMISSIVE FOR SELECT TO fe_app USING (pode_financeiro());
CREATE POLICY "finparam_le" ON public.fin_param AS PERMISSIVE FOR SELECT TO fe_app USING (pode_financeiro());
CREATE POLICY "meses_escreve" ON public.meses_abertos AS PERMISSIVE FOR ALL TO fe_app USING (pode('acoes'::text, 'fechar_mes'::text)) WITH CHECK (pode('acoes'::text, 'fechar_mes'::text));
CREATE POLICY "afast_master_escreve" ON public.afastamentos AS PERMISSIVE FOR ALL TO fe_app USING ((papel_atual() = 'master'::text)) WITH CHECK ((papel_atual() = 'master'::text));
CREATE POLICY "afast_todos_leem" ON public.afastamentos AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() IS NOT NULL));
CREATE POLICY "historica_todos_leem" ON public.programacao_historica AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() IS NOT NULL));
CREATE POLICY "finparam_escreve" ON public.fin_param AS PERMISSIVE FOR UPDATE TO fe_app USING ((pode_financeiro() AND (EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = public.fe_uid()) AND (u.papel = 'master'::text)))))) WITH CHECK ((pode_financeiro() AND (EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = public.fe_uid()) AND (u.papel = 'master'::text))))));
CREATE POLICY "demavis_le" ON public.demissao_avisada AS PERMISSIVE FOR SELECT TO fe_app USING (true);
CREATE POLICY "demavis_escreve" ON public.demissao_avisada AS PERMISSIVE FOR ALL TO fe_app USING ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = public.fe_uid()) AND (u.papel = 'master'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM usuarios u
  WHERE ((u.id = public.fe_uid()) AND (u.papel = 'master'::text)))));
CREATE POLICY "periodos_admin_altera" ON public.periodos AS PERMISSIVE FOR UPDATE TO fe_app USING ((papel_atual() = 'administrador'::text)) WITH CHECK ((papel_atual() = 'administrador'::text));
CREATE POLICY "funcionarios_admin_altera" ON public.funcionarios AS PERMISSIVE FOR UPDATE TO fe_app USING ((papel_atual() = 'administrador'::text)) WITH CHECK ((papel_atual() = 'administrador'::text));
CREATE POLICY "afast_admin_insere" ON public.afastamentos AS PERMISSIVE FOR INSERT TO fe_app WITH CHECK (((papel_atual() = 'administrador'::text) AND pode('campos'::text, 'situacao'::text)));
CREATE POLICY "afast_admin_altera" ON public.afastamentos AS PERMISSIVE FOR UPDATE TO fe_app USING (((papel_atual() = 'administrador'::text) AND pode('campos'::text, 'situacao'::text))) WITH CHECK (((papel_atual() = 'administrador'::text) AND pode('campos'::text, 'situacao'::text)));
CREATE POLICY "afast_admin_apaga" ON public.afastamentos AS PERMISSIVE FOR DELETE TO fe_app USING (((papel_atual() = 'administrador'::text) AND pode('campos'::text, 'situacao'::text) AND pode('acoes'::text, 'deletar'::text)));
CREATE POLICY "aso_le" ON public.aso AS PERMISSIVE FOR SELECT TO fe_app USING ((papel_atual() IS NOT NULL));
CREATE POLICY "fechamento_prazos_leitura" ON public.fechamento_prazos AS PERMISSIVE FOR SELECT TO fe_app USING (true);

-- Permissões de tabela (papéis do Supabase; ajustar no novo sistema)
GRANT INSERT ON public.fechamento_prazos TO fe_app;
GRANT SELECT ON public.fechamento_prazos TO fe_app;
GRANT UPDATE ON public.fechamento_prazos TO fe_app;
GRANT DELETE ON public.fechamento_prazos TO fe_app;
GRANT INSERT ON public.fechamento_prazos TO service_role;
GRANT SELECT ON public.fechamento_prazos TO service_role;
GRANT UPDATE ON public.fechamento_prazos TO service_role;
GRANT DELETE ON public.fechamento_prazos TO service_role;
GRANT TRUNCATE ON public.fechamento_prazos TO service_role;
GRANT REFERENCES ON public.fechamento_prazos TO service_role;
GRANT TRIGGER ON public.fechamento_prazos TO service_role;
GRANT INSERT ON public.periodos TO fe_app;
GRANT SELECT ON public.periodos TO fe_app;
GRANT UPDATE ON public.periodos TO fe_app;
GRANT INSERT ON public.periodos TO service_role;
GRANT SELECT ON public.periodos TO service_role;
GRANT UPDATE ON public.periodos TO service_role;
GRANT DELETE ON public.periodos TO service_role;
GRANT TRUNCATE ON public.periodos TO service_role;
GRANT REFERENCES ON public.periodos TO service_role;
GRANT TRIGGER ON public.periodos TO service_role;
GRANT INSERT ON public.vw_ficha_saidas TO fe_app;
GRANT SELECT ON public.vw_ficha_saidas TO fe_app;
GRANT UPDATE ON public.vw_ficha_saidas TO fe_app;
GRANT DELETE ON public.vw_ficha_saidas TO fe_app;
GRANT INSERT ON public.vw_ficha_saidas TO service_role;
GRANT SELECT ON public.vw_ficha_saidas TO service_role;
GRANT UPDATE ON public.vw_ficha_saidas TO service_role;
GRANT DELETE ON public.vw_ficha_saidas TO service_role;
GRANT TRUNCATE ON public.vw_ficha_saidas TO service_role;
GRANT REFERENCES ON public.vw_ficha_saidas TO service_role;
GRANT TRIGGER ON public.vw_ficha_saidas TO service_role;
GRANT INSERT ON public.bkp_feriados_24_11 TO fe_app;
GRANT SELECT ON public.bkp_feriados_24_11 TO fe_app;
GRANT UPDATE ON public.bkp_feriados_24_11 TO fe_app;
GRANT DELETE ON public.bkp_feriados_24_11 TO fe_app;
GRANT INSERT ON public.bkp_feriados_24_11 TO service_role;
GRANT SELECT ON public.bkp_feriados_24_11 TO service_role;
GRANT UPDATE ON public.bkp_feriados_24_11 TO service_role;
GRANT DELETE ON public.bkp_feriados_24_11 TO service_role;
GRANT TRUNCATE ON public.bkp_feriados_24_11 TO service_role;
GRANT REFERENCES ON public.bkp_feriados_24_11 TO service_role;
GRANT TRIGGER ON public.bkp_feriados_24_11 TO service_role;
GRANT INSERT ON public.turnos TO fe_app;
GRANT SELECT ON public.turnos TO fe_app;
GRANT UPDATE ON public.turnos TO fe_app;
GRANT INSERT ON public.turnos TO service_role;
GRANT SELECT ON public.turnos TO service_role;
GRANT UPDATE ON public.turnos TO service_role;
GRANT DELETE ON public.turnos TO service_role;
GRANT TRUNCATE ON public.turnos TO service_role;
GRANT REFERENCES ON public.turnos TO service_role;
GRANT TRIGGER ON public.turnos TO service_role;
GRANT INSERT ON public.funcionarios TO fe_app;
GRANT SELECT ON public.funcionarios TO fe_app;
GRANT UPDATE ON public.funcionarios TO fe_app;
GRANT INSERT ON public.funcionarios TO service_role;
GRANT SELECT ON public.funcionarios TO service_role;
GRANT UPDATE ON public.funcionarios TO service_role;
GRANT DELETE ON public.funcionarios TO service_role;
GRANT TRUNCATE ON public.funcionarios TO service_role;
GRANT REFERENCES ON public.funcionarios TO service_role;
GRANT TRIGGER ON public.funcionarios TO service_role;
GRANT INSERT ON public.usuarios TO fe_app;
GRANT SELECT ON public.usuarios TO fe_app;
GRANT UPDATE ON public.usuarios TO fe_app;
GRANT INSERT ON public.usuarios TO service_role;
GRANT SELECT ON public.usuarios TO service_role;
GRANT UPDATE ON public.usuarios TO service_role;
GRANT DELETE ON public.usuarios TO service_role;
GRANT TRUNCATE ON public.usuarios TO service_role;
GRANT REFERENCES ON public.usuarios TO service_role;
GRANT TRIGGER ON public.usuarios TO service_role;
GRANT INSERT ON public.config TO fe_app;
GRANT SELECT ON public.config TO fe_app;
GRANT UPDATE ON public.config TO fe_app;
GRANT INSERT ON public.config TO service_role;
GRANT SELECT ON public.config TO service_role;
GRANT UPDATE ON public.config TO service_role;
GRANT DELETE ON public.config TO service_role;
GRANT TRUNCATE ON public.config TO service_role;
GRANT REFERENCES ON public.config TO service_role;
GRANT TRIGGER ON public.config TO service_role;
GRANT INSERT ON public.emails_autorizados TO fe_app;
GRANT SELECT ON public.emails_autorizados TO fe_app;
GRANT UPDATE ON public.emails_autorizados TO fe_app;
GRANT INSERT ON public.emails_autorizados TO service_role;
GRANT SELECT ON public.emails_autorizados TO service_role;
GRANT UPDATE ON public.emails_autorizados TO service_role;
GRANT DELETE ON public.emails_autorizados TO service_role;
GRANT TRUNCATE ON public.emails_autorizados TO service_role;
GRANT REFERENCES ON public.emails_autorizados TO service_role;
GRANT TRIGGER ON public.emails_autorizados TO service_role;
GRANT INSERT ON public.feriados TO fe_app;
GRANT SELECT ON public.feriados TO fe_app;
GRANT UPDATE ON public.feriados TO fe_app;
GRANT INSERT ON public.feriados TO service_role;
GRANT SELECT ON public.feriados TO service_role;
GRANT UPDATE ON public.feriados TO service_role;
GRANT DELETE ON public.feriados TO service_role;
GRANT TRUNCATE ON public.feriados TO service_role;
GRANT REFERENCES ON public.feriados TO service_role;
GRANT TRIGGER ON public.feriados TO service_role;
GRANT SELECT ON public.snapshots TO fe_app;
GRANT INSERT ON public.snapshots TO service_role;
GRANT SELECT ON public.snapshots TO service_role;
GRANT UPDATE ON public.snapshots TO service_role;
GRANT DELETE ON public.snapshots TO service_role;
GRANT TRUNCATE ON public.snapshots TO service_role;
GRANT REFERENCES ON public.snapshots TO service_role;
GRANT TRIGGER ON public.snapshots TO service_role;
GRANT SELECT ON public.vw_aso TO fe_app;
GRANT INSERT ON public.vw_aso TO service_role;
GRANT SELECT ON public.vw_aso TO service_role;
GRANT UPDATE ON public.vw_aso TO service_role;
GRANT DELETE ON public.vw_aso TO service_role;
GRANT TRUNCATE ON public.vw_aso TO service_role;
GRANT REFERENCES ON public.vw_aso TO service_role;
GRANT TRIGGER ON public.vw_aso TO service_role;
GRANT SELECT ON public.historico TO fe_app;
GRANT INSERT ON public.historico TO service_role;
GRANT SELECT ON public.historico TO service_role;
GRANT UPDATE ON public.historico TO service_role;
GRANT DELETE ON public.historico TO service_role;
GRANT TRUNCATE ON public.historico TO service_role;
GRANT REFERENCES ON public.historico TO service_role;
GRANT TRIGGER ON public.historico TO service_role;
GRANT INSERT ON public.rel_dic TO fe_app;
GRANT SELECT ON public.rel_dic TO fe_app;
GRANT UPDATE ON public.rel_dic TO fe_app;
GRANT DELETE ON public.rel_dic TO fe_app;
GRANT INSERT ON public.rel_dic TO service_role;
GRANT SELECT ON public.rel_dic TO service_role;
GRANT UPDATE ON public.rel_dic TO service_role;
GRANT DELETE ON public.rel_dic TO service_role;
GRANT TRUNCATE ON public.rel_dic TO service_role;
GRANT REFERENCES ON public.rel_dic TO service_role;
GRANT TRIGGER ON public.rel_dic TO service_role;
GRANT INSERT ON public.rel_import TO fe_app;
GRANT SELECT ON public.rel_import TO fe_app;
GRANT UPDATE ON public.rel_import TO fe_app;
GRANT DELETE ON public.rel_import TO fe_app;
GRANT INSERT ON public.rel_import TO service_role;
GRANT SELECT ON public.rel_import TO service_role;
GRANT UPDATE ON public.rel_import TO service_role;
GRANT DELETE ON public.rel_import TO service_role;
GRANT TRUNCATE ON public.rel_import TO service_role;
GRANT REFERENCES ON public.rel_import TO service_role;
GRANT TRIGGER ON public.rel_import TO service_role;
GRANT INSERT ON public.afastamentos TO fe_app;
GRANT SELECT ON public.afastamentos TO fe_app;
GRANT UPDATE ON public.afastamentos TO fe_app;
GRANT DELETE ON public.afastamentos TO fe_app;
GRANT INSERT ON public.afastamentos TO service_role;
GRANT SELECT ON public.afastamentos TO service_role;
GRANT UPDATE ON public.afastamentos TO service_role;
GRANT DELETE ON public.afastamentos TO service_role;
GRANT TRUNCATE ON public.afastamentos TO service_role;
GRANT REFERENCES ON public.afastamentos TO service_role;
GRANT TRIGGER ON public.afastamentos TO service_role;
GRANT INSERT ON public.fora_da_programacao TO fe_app;
GRANT SELECT ON public.fora_da_programacao TO fe_app;
GRANT UPDATE ON public.fora_da_programacao TO fe_app;
GRANT DELETE ON public.fora_da_programacao TO fe_app;
GRANT INSERT ON public.fora_da_programacao TO service_role;
GRANT SELECT ON public.fora_da_programacao TO service_role;
GRANT UPDATE ON public.fora_da_programacao TO service_role;
GRANT DELETE ON public.fora_da_programacao TO service_role;
GRANT TRUNCATE ON public.fora_da_programacao TO service_role;
GRANT REFERENCES ON public.fora_da_programacao TO service_role;
GRANT TRIGGER ON public.fora_da_programacao TO service_role;
GRANT INSERT ON public.ativos_import TO fe_app;
GRANT SELECT ON public.ativos_import TO fe_app;
GRANT UPDATE ON public.ativos_import TO fe_app;
GRANT DELETE ON public.ativos_import TO fe_app;
GRANT INSERT ON public.ativos_import TO service_role;
GRANT SELECT ON public.ativos_import TO service_role;
GRANT UPDATE ON public.ativos_import TO service_role;
GRANT DELETE ON public.ativos_import TO service_role;
GRANT TRUNCATE ON public.ativos_import TO service_role;
GRANT REFERENCES ON public.ativos_import TO service_role;
GRANT TRIGGER ON public.ativos_import TO service_role;
GRANT INSERT ON public.demissao_avisada TO fe_app;
GRANT SELECT ON public.demissao_avisada TO fe_app;
GRANT UPDATE ON public.demissao_avisada TO fe_app;
GRANT DELETE ON public.demissao_avisada TO fe_app;
GRANT INSERT ON public.demissao_avisada TO service_role;
GRANT SELECT ON public.demissao_avisada TO service_role;
GRANT UPDATE ON public.demissao_avisada TO service_role;
GRANT DELETE ON public.demissao_avisada TO service_role;
GRANT TRUNCATE ON public.demissao_avisada TO service_role;
GRANT REFERENCES ON public.demissao_avisada TO service_role;
GRANT TRIGGER ON public.demissao_avisada TO service_role;
GRANT INSERT ON public.fin_param TO fe_app;
GRANT SELECT ON public.fin_param TO fe_app;
GRANT UPDATE ON public.fin_param TO fe_app;
GRANT DELETE ON public.fin_param TO fe_app;
GRANT INSERT ON public.fin_param TO service_role;
GRANT SELECT ON public.fin_param TO service_role;
GRANT UPDATE ON public.fin_param TO service_role;
GRANT DELETE ON public.fin_param TO service_role;
GRANT TRUNCATE ON public.fin_param TO service_role;
GRANT REFERENCES ON public.fin_param TO service_role;
GRANT TRIGGER ON public.fin_param TO service_role;
GRANT INSERT ON public.meses_abertos TO fe_app;
GRANT SELECT ON public.meses_abertos TO fe_app;
GRANT UPDATE ON public.meses_abertos TO fe_app;
GRANT DELETE ON public.meses_abertos TO fe_app;
GRANT INSERT ON public.meses_abertos TO service_role;
GRANT SELECT ON public.meses_abertos TO service_role;
GRANT UPDATE ON public.meses_abertos TO service_role;
GRANT DELETE ON public.meses_abertos TO service_role;
GRANT TRUNCATE ON public.meses_abertos TO service_role;
GRANT REFERENCES ON public.meses_abertos TO service_role;
GRANT TRIGGER ON public.meses_abertos TO service_role;
GRANT INSERT ON public.bkp_periodos_20261116 TO fe_app;
GRANT SELECT ON public.bkp_periodos_20261116 TO fe_app;
GRANT UPDATE ON public.bkp_periodos_20261116 TO fe_app;
GRANT DELETE ON public.bkp_periodos_20261116 TO fe_app;
GRANT INSERT ON public.bkp_periodos_20261116 TO service_role;
GRANT SELECT ON public.bkp_periodos_20261116 TO service_role;
GRANT UPDATE ON public.bkp_periodos_20261116 TO service_role;
GRANT DELETE ON public.bkp_periodos_20261116 TO service_role;
GRANT TRUNCATE ON public.bkp_periodos_20261116 TO service_role;
GRANT REFERENCES ON public.bkp_periodos_20261116 TO service_role;
GRANT TRIGGER ON public.bkp_periodos_20261116 TO service_role;
GRANT INSERT ON public.aso_backup_15_10_2026 TO service_role;
GRANT SELECT ON public.aso_backup_15_10_2026 TO service_role;
GRANT UPDATE ON public.aso_backup_15_10_2026 TO service_role;
GRANT DELETE ON public.aso_backup_15_10_2026 TO service_role;
GRANT TRUNCATE ON public.aso_backup_15_10_2026 TO service_role;
GRANT REFERENCES ON public.aso_backup_15_10_2026 TO service_role;
GRANT TRIGGER ON public.aso_backup_15_10_2026 TO service_role;
GRANT INSERT ON public.aso_backup_16_10_2026 TO service_role;
GRANT SELECT ON public.aso_backup_16_10_2026 TO service_role;
GRANT UPDATE ON public.aso_backup_16_10_2026 TO service_role;
GRANT DELETE ON public.aso_backup_16_10_2026 TO service_role;
GRANT TRUNCATE ON public.aso_backup_16_10_2026 TO service_role;
GRANT REFERENCES ON public.aso_backup_16_10_2026 TO service_role;
GRANT TRIGGER ON public.aso_backup_16_10_2026 TO service_role;
GRANT INSERT ON public.lixeira_29_09 TO service_role;
GRANT SELECT ON public.lixeira_29_09 TO service_role;
GRANT UPDATE ON public.lixeira_29_09 TO service_role;
GRANT DELETE ON public.lixeira_29_09 TO service_role;
GRANT TRUNCATE ON public.lixeira_29_09 TO service_role;
GRANT REFERENCES ON public.lixeira_29_09 TO service_role;
GRANT TRIGGER ON public.lixeira_29_09 TO service_role;
GRANT INSERT ON public.ferias_import TO service_role;
GRANT SELECT ON public.ferias_import TO service_role;
GRANT UPDATE ON public.ferias_import TO service_role;
GRANT DELETE ON public.ferias_import TO service_role;
GRANT TRUNCATE ON public.ferias_import TO service_role;
GRANT REFERENCES ON public.ferias_import TO service_role;
GRANT TRIGGER ON public.ferias_import TO service_role;
GRANT INSERT ON public.bkp_funcionarios_20261116 TO fe_app;
GRANT SELECT ON public.bkp_funcionarios_20261116 TO fe_app;
GRANT UPDATE ON public.bkp_funcionarios_20261116 TO fe_app;
GRANT DELETE ON public.bkp_funcionarios_20261116 TO fe_app;
GRANT INSERT ON public.bkp_funcionarios_20261116 TO service_role;
GRANT SELECT ON public.bkp_funcionarios_20261116 TO service_role;
GRANT UPDATE ON public.bkp_funcionarios_20261116 TO service_role;
GRANT DELETE ON public.bkp_funcionarios_20261116 TO service_role;
GRANT TRUNCATE ON public.bkp_funcionarios_20261116 TO service_role;
GRANT REFERENCES ON public.bkp_funcionarios_20261116 TO service_role;
GRANT TRIGGER ON public.bkp_funcionarios_20261116 TO service_role;
GRANT INSERT ON public.bkp_periodos_plano33_20261123 TO fe_app;
GRANT SELECT ON public.bkp_periodos_plano33_20261123 TO fe_app;
GRANT UPDATE ON public.bkp_periodos_plano33_20261123 TO fe_app;
GRANT DELETE ON public.bkp_periodos_plano33_20261123 TO fe_app;
GRANT INSERT ON public.bkp_periodos_plano33_20261123 TO service_role;
GRANT SELECT ON public.bkp_periodos_plano33_20261123 TO service_role;
GRANT UPDATE ON public.bkp_periodos_plano33_20261123 TO service_role;
GRANT DELETE ON public.bkp_periodos_plano33_20261123 TO service_role;
GRANT TRUNCATE ON public.bkp_periodos_plano33_20261123 TO service_role;
GRANT REFERENCES ON public.bkp_periodos_plano33_20261123 TO service_role;
GRANT TRIGGER ON public.bkp_periodos_plano33_20261123 TO service_role;
GRANT INSERT ON public.programacao_historica TO fe_app;
GRANT SELECT ON public.programacao_historica TO fe_app;
GRANT UPDATE ON public.programacao_historica TO fe_app;
GRANT DELETE ON public.programacao_historica TO fe_app;
GRANT INSERT ON public.programacao_historica TO service_role;
GRANT SELECT ON public.programacao_historica TO service_role;
GRANT UPDATE ON public.programacao_historica TO service_role;
GRANT DELETE ON public.programacao_historica TO service_role;
GRANT TRUNCATE ON public.programacao_historica TO service_role;
GRANT REFERENCES ON public.programacao_historica TO service_role;
GRANT TRIGGER ON public.programacao_historica TO service_role;
GRANT INSERT ON public.folha_13_import TO fe_app;
GRANT SELECT ON public.folha_13_import TO fe_app;
GRANT UPDATE ON public.folha_13_import TO fe_app;
GRANT DELETE ON public.folha_13_import TO fe_app;
GRANT INSERT ON public.folha_13_import TO service_role;
GRANT SELECT ON public.folha_13_import TO service_role;
GRANT UPDATE ON public.folha_13_import TO service_role;
GRANT DELETE ON public.folha_13_import TO service_role;
GRANT TRUNCATE ON public.folha_13_import TO service_role;
GRANT REFERENCES ON public.folha_13_import TO service_role;
GRANT TRIGGER ON public.folha_13_import TO service_role;
GRANT INSERT ON public.vw_financeiro_ferias TO fe_app;
GRANT SELECT ON public.vw_financeiro_ferias TO fe_app;
GRANT UPDATE ON public.vw_financeiro_ferias TO fe_app;
GRANT DELETE ON public.vw_financeiro_ferias TO fe_app;
GRANT INSERT ON public.vw_financeiro_ferias TO service_role;
GRANT SELECT ON public.vw_financeiro_ferias TO service_role;
GRANT UPDATE ON public.vw_financeiro_ferias TO service_role;
GRANT DELETE ON public.vw_financeiro_ferias TO service_role;
GRANT TRUNCATE ON public.vw_financeiro_ferias TO service_role;
GRANT REFERENCES ON public.vw_financeiro_ferias TO service_role;
GRANT TRIGGER ON public.vw_financeiro_ferias TO service_role;
GRANT INSERT ON public.vw_financeiro_13 TO fe_app;
GRANT SELECT ON public.vw_financeiro_13 TO fe_app;
GRANT UPDATE ON public.vw_financeiro_13 TO fe_app;
GRANT DELETE ON public.vw_financeiro_13 TO fe_app;
GRANT INSERT ON public.vw_financeiro_13 TO service_role;
GRANT SELECT ON public.vw_financeiro_13 TO service_role;
GRANT UPDATE ON public.vw_financeiro_13 TO service_role;
GRANT DELETE ON public.vw_financeiro_13 TO service_role;
GRANT TRUNCATE ON public.vw_financeiro_13 TO service_role;
GRANT REFERENCES ON public.vw_financeiro_13 TO service_role;
GRANT TRIGGER ON public.vw_financeiro_13 TO service_role;
GRANT INSERT ON public.rel_lido TO fe_app;
GRANT SELECT ON public.rel_lido TO fe_app;
GRANT UPDATE ON public.rel_lido TO fe_app;
GRANT DELETE ON public.rel_lido TO fe_app;
GRANT INSERT ON public.rel_lido TO service_role;
GRANT SELECT ON public.rel_lido TO service_role;
GRANT UPDATE ON public.rel_lido TO service_role;
GRANT DELETE ON public.rel_lido TO service_role;
GRANT TRUNCATE ON public.rel_lido TO service_role;
GRANT REFERENCES ON public.rel_lido TO service_role;
GRANT TRIGGER ON public.rel_lido TO service_role;
GRANT INSERT ON public.vw_historica TO fe_app;
GRANT SELECT ON public.vw_historica TO fe_app;
GRANT UPDATE ON public.vw_historica TO fe_app;
GRANT DELETE ON public.vw_historica TO fe_app;
GRANT INSERT ON public.vw_historica TO service_role;
GRANT SELECT ON public.vw_historica TO service_role;
GRANT UPDATE ON public.vw_historica TO service_role;
GRANT DELETE ON public.vw_historica TO service_role;
GRANT TRUNCATE ON public.vw_historica TO service_role;
GRANT REFERENCES ON public.vw_historica TO service_role;
GRANT TRIGGER ON public.vw_historica TO service_role;
GRANT SELECT ON public.aso TO fe_app;
GRANT INSERT ON public.aso TO service_role;
GRANT SELECT ON public.aso TO service_role;
GRANT UPDATE ON public.aso TO service_role;
GRANT DELETE ON public.aso TO service_role;
GRANT TRUNCATE ON public.aso TO service_role;
GRANT REFERENCES ON public.aso TO service_role;
GRANT TRIGGER ON public.aso TO service_role;
GRANT SELECT ON public.vw_escala TO fe_app;
GRANT INSERT ON public.vw_escala TO service_role;
GRANT SELECT ON public.vw_escala TO service_role;
GRANT UPDATE ON public.vw_escala TO service_role;
GRANT DELETE ON public.vw_escala TO service_role;
GRANT TRUNCATE ON public.vw_escala TO service_role;
GRANT REFERENCES ON public.vw_escala TO service_role;
GRANT TRIGGER ON public.vw_escala TO service_role;
GRANT INSERT ON public.bkp_periodos_plano_jan27_20261116 TO fe_app;
GRANT SELECT ON public.bkp_periodos_plano_jan27_20261116 TO fe_app;
GRANT UPDATE ON public.bkp_periodos_plano_jan27_20261116 TO fe_app;
GRANT DELETE ON public.bkp_periodos_plano_jan27_20261116 TO fe_app;
GRANT INSERT ON public.bkp_periodos_plano_jan27_20261116 TO service_role;
GRANT SELECT ON public.bkp_periodos_plano_jan27_20261116 TO service_role;
GRANT UPDATE ON public.bkp_periodos_plano_jan27_20261116 TO service_role;
GRANT DELETE ON public.bkp_periodos_plano_jan27_20261116 TO service_role;
GRANT TRUNCATE ON public.bkp_periodos_plano_jan27_20261116 TO service_role;
GRANT REFERENCES ON public.bkp_periodos_plano_jan27_20261116 TO service_role;
GRANT TRIGGER ON public.bkp_periodos_plano_jan27_20261116 TO service_role;
GRANT INSERT ON public.bkp_afastados_23_11 TO fe_app;
GRANT SELECT ON public.bkp_afastados_23_11 TO fe_app;
GRANT UPDATE ON public.bkp_afastados_23_11 TO fe_app;
GRANT DELETE ON public.bkp_afastados_23_11 TO fe_app;
GRANT INSERT ON public.bkp_afastados_23_11 TO service_role;
GRANT SELECT ON public.bkp_afastados_23_11 TO service_role;
GRANT UPDATE ON public.bkp_afastados_23_11 TO service_role;
GRANT DELETE ON public.bkp_afastados_23_11 TO service_role;
GRANT TRUNCATE ON public.bkp_afastados_23_11 TO service_role;
GRANT REFERENCES ON public.bkp_afastados_23_11 TO service_role;
GRANT TRIGGER ON public.bkp_afastados_23_11 TO service_role;
GRANT INSERT ON public.bkp_periodos_plano235_20261124 TO fe_app;
GRANT SELECT ON public.bkp_periodos_plano235_20261124 TO fe_app;
GRANT UPDATE ON public.bkp_periodos_plano235_20261124 TO fe_app;
GRANT DELETE ON public.bkp_periodos_plano235_20261124 TO fe_app;
GRANT INSERT ON public.bkp_periodos_plano235_20261124 TO service_role;
GRANT SELECT ON public.bkp_periodos_plano235_20261124 TO service_role;
GRANT UPDATE ON public.bkp_periodos_plano235_20261124 TO service_role;
GRANT DELETE ON public.bkp_periodos_plano235_20261124 TO service_role;
GRANT TRUNCATE ON public.bkp_periodos_plano235_20261124 TO service_role;
GRANT REFERENCES ON public.bkp_periodos_plano235_20261124 TO service_role;
GRANT TRIGGER ON public.bkp_periodos_plano235_20261124 TO service_role;

-- Agendamentos (pg_cron) do projeto

-- Chaves estrangeiras (depois das primárias)
ALTER TABLE public.afastamentos ADD CONSTRAINT afastamentos_funcionario_id_fkey FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE;
ALTER TABLE public.aso ADD CONSTRAINT aso_funcionario_id_fkey FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE;
ALTER TABLE public.periodos ADD CONSTRAINT periodos_funcionario_id_fkey FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE CASCADE;
-- Ligação com o login do Jarvis (user_key de app_users)
alter table public.usuarios add column jarvis_user text unique;

-- Ninguém além do módulo (fe_app) e do service_role mexe nestas tabelas
revoke all on public.afastamentos, public.aso, public.aso_backup_15_10_2026, public.aso_backup_16_10_2026, public.ativos_import, public.bkp_afastados_23_11, public.bkp_feriados_24_11, public.bkp_funcionarios_20261116, public.bkp_periodos_20261116, public.bkp_periodos_plano235_20261124, public.bkp_periodos_plano33_20261123, public.bkp_periodos_plano_jan27_20261116, public.config, public.demissao_avisada, public.emails_autorizados, public.fechamento_prazos, public.feriados, public.ferias_import, public.fin_param, public.folha_13_import, public.fora_da_programacao, public.funcionarios, public.historico, public.lixeira_29_09, public.meses_abertos, public.periodos, public.programacao_historica, public.rel_dic, public.rel_import, public.snapshots, public.turnos, public.usuarios, public.rel_lido, public.vw_aso, public.vw_escala, public.vw_ficha_saidas, public.vw_financeiro_13, public.vw_financeiro_ferias, public.vw_historica from anon, authenticated;
grant select on public.rel_lido, public.vw_aso, public.vw_escala, public.vw_ficha_saidas, public.vw_financeiro_13, public.vw_financeiro_ferias, public.vw_historica to service_role;
do $fn$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('abre_prazo_fechamento', 'demitir', 'dias_afastado_no_periodo', 'eh_dono', 'fecha_mes_anterior', 'gerar_proximo_periodo', 'gerar_proximos_periodos', 'marca_alteracao', 'mes_bloqueado_grupo', 'mes_travado', 'norm', 'norm2', 'papel_atual', 'pode', 'pode_financeiro', 'reativar_demitido', 'registra_historico', 'registra_mes_aberto', 'registrar_retorno', 'saida_congelada', 'sem_acento', 'supervisor_do_login', 'tg_congela_ficha_saidas', 'tg_trava_mes_fechado', 'tg_trava_mes_grupo', 'tirar_snapshot', 'trava_colunas_funcionarios', 'trava_colunas_periodos', 'turno_do_cargo', 'fe_uid') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to fe_app, service_role', r.f);
  end loop;
  -- as sequências dos ids (inclusões feitas pela plataforma)
  for r in select pg_get_serial_sequence('public.' || c.relname, 'id') as s
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             join pg_attribute a on a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped
            where n.nspname = 'public' and c.relname in ('afastamentos', 'aso', 'aso_backup_15_10_2026', 'aso_backup_16_10_2026', 'ativos_import', 'bkp_afastados_23_11', 'bkp_feriados_24_11', 'bkp_funcionarios_20261116', 'bkp_periodos_20261116', 'bkp_periodos_plano235_20261124', 'bkp_periodos_plano33_20261123', 'bkp_periodos_plano_jan27_20261116', 'config', 'demissao_avisada', 'emails_autorizados', 'fechamento_prazos', 'feriados', 'ferias_import', 'fin_param', 'folha_13_import', 'fora_da_programacao', 'funcionarios', 'historico', 'lixeira_29_09', 'meses_abertos', 'periodos', 'programacao_historica', 'rel_dic', 'rel_import', 'snapshots', 'turnos', 'usuarios') loop
    if r.s is not null then execute format('grant usage, select on sequence %s to fe_app', r.s); end if;
  end loop;
end $fn$;

-- Carga dos dados (uma vez, pela API com service_role): grava com os gatilhos desligados,
-- como os dados vieram do banco antigo (sem refazer histórico nem travas), e acerta as sequências.
create function public.fe_carga(p_tabela text, p_linhas jsonb) returns integer
language plpgsql security definer set search_path to 'public' as $carga$
declare n integer; s text;
begin
  if p_tabela not in ('afastamentos', 'aso', 'aso_backup_15_10_2026', 'aso_backup_16_10_2026', 'ativos_import', 'bkp_afastados_23_11', 'bkp_feriados_24_11', 'bkp_funcionarios_20261116', 'bkp_periodos_20261116', 'bkp_periodos_plano235_20261124', 'bkp_periodos_plano33_20261123', 'bkp_periodos_plano_jan27_20261116', 'config', 'demissao_avisada', 'emails_autorizados', 'fechamento_prazos', 'feriados', 'ferias_import', 'fin_param', 'folha_13_import', 'fora_da_programacao', 'funcionarios', 'historico', 'lixeira_29_09', 'meses_abertos', 'periodos', 'programacao_historica', 'rel_dic', 'rel_import', 'snapshots', 'turnos', 'usuarios') then
    raise exception 'tabela fora da carga: %', p_tabela;
  end if;
  execute format('alter table public.%I disable trigger user', p_tabela);
  execute format('insert into public.%I overriding system value select * from jsonb_populate_recordset(null::public.%I, $1)', p_tabela, p_tabela) using p_linhas;
  get diagnostics n = row_count;
  execute format('alter table public.%I enable trigger user', p_tabela);
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = p_tabela and column_name = 'id') then
    s := pg_get_serial_sequence('public.' || p_tabela, 'id');
  end if;
  if s is not null then
    execute format('select setval(%L, coalesce((select max(id) from public.%I), 1), (select count(*) > 0 from public.%I))', s, p_tabela, p_tabela);
  end if;
  return n;
end $carga$;
revoke all on function public.fe_carga(text, jsonb) from public, anon, authenticated;
grant execute on function public.fe_carga(text, jsonb) to service_role;

-- Antes de cada pedido à API do Supabase: se veio com a chave service_role (só os servidores do Jarvis a têm)
-- e com o cabeçalho x-fe-uid, o pedido roda como fe_app e com esse id. Os outros pedidos não mudam em nada.
create function public.fe_pre_request() returns void language plpgsql as $pre$
declare u text;
begin
  if current_user <> 'service_role' then return; end if;
  u := nullif(current_setting('request.headers', true), '')::json ->> 'x-fe-uid';
  if u is null then return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u::uuid, 'role', 'fe_app')::text, true);
  set local role fe_app;
end $pre$;
grant execute on function public.fe_pre_request() to anon, authenticated, service_role;
alter role authenticator set pgrst.db_pre_request to 'public.fe_pre_request';

commit;

-- Avisa a API (PostgREST) das tabelas novas
notify pgrst, 'reload schema';
notify pgrst, 'reload config';

-- ============================================================================
-- Agendamentos diários que existiam no projeto antigo (horário UTC). Rodar depois do bloco acima.
-- Se o pg_cron não estiver ligado: Database → Extensions → pg_cron → Enable, e rodar de novo.
-- ============================================================================
create extension if not exists pg_cron;
select cron.schedule('ferias-gerar-proximos-periodos', '0 9 * * *', 'select public.gerar_proximos_periodos()');
select cron.schedule('ferias-fecha-mes-anterior', '0 3 * * *', 'select public.fecha_mes_anterior()');
