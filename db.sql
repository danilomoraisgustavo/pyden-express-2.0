-- =========================================================
-- EXTENSÕES NECESSÁRIAS
-- =========================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- =========================================================
-- 1. ZONEAMENTOS E RELAÇÕES
-- =========================================================
CREATE TABLE IF NOT EXISTS zoneamentos (
  id   SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  lote VARCHAR(255),
  geom GEOMETRY(Polygon, 4326) NOT NULL
);

CREATE TABLE pontos (
  id                SERIAL PRIMARY KEY,
  nome_ponto        VARCHAR(255) NOT NULL,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  area              VARCHAR(50),
  logradouro        VARCHAR(255),
  numero            VARCHAR(50),
  complemento       VARCHAR(255),
  ponto_referencia  VARCHAR(255),
  bairro            VARCHAR(255),
  cep               VARCHAR(20),
  geom              GEOMETRY(Point, 4326),
  status            VARCHAR(10) DEFAULT 'inativo'
                       CHECK (lower(status) IN ('ativo','inativo'))
);

-- tabela de ligação 1‑para‑1 (caso cada aluno só possa ter um ponto de parada)
CREATE TABLE IF NOT EXISTS alunos_pontos (
    aluno_id  INT  PRIMARY KEY REFERENCES alunos_ativos(id) ON DELETE CASCADE,
    ponto_id  INT  NOT NULL     REFERENCES pontos(id)       ON DELETE RESTRICT,
    data_vinculado TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pontos_zoneamentos (
  id            SERIAL PRIMARY KEY,
  ponto_id      INT NOT NULL REFERENCES pontos(id) ON DELETE CASCADE,
  zoneamento_id INT NOT NULL REFERENCES zoneamentos(id) ON DELETE CASCADE
);

-- =========================================================
-- 2. ESCOLAS
-- =========================================================
CREATE TABLE IF NOT EXISTS escolas (
  id               SERIAL PRIMARY KEY,
  nome             VARCHAR(255) NOT NULL,
  codigo_inep      VARCHAR(50),
  latitude         DOUBLE PRECISION,
  longitude        DOUBLE PRECISION,
  area             VARCHAR(50),
  logradouro       VARCHAR(255),
  numero           VARCHAR(50),
  complemento      VARCHAR(255),
  ponto_referencia VARCHAR(255),
  bairro           VARCHAR(255),
  cep              VARCHAR(20),
  regime           VARCHAR(255),
  nivel            VARCHAR(255),
  horario          VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS escolas_zoneamentos (
  id            SERIAL PRIMARY KEY,
  escola_id     INT NOT NULL REFERENCES escolas(id)      ON DELETE CASCADE,
  zoneamento_id INT NOT NULL REFERENCES zoneamentos(id)  ON DELETE CASCADE
);

-- =========================================================
-- 3. FORNECEDORES, FROTA E RELAÇÕES
-- =========================================================
CREATE TABLE IF NOT EXISTS fornecedores (
  id              SERIAL PRIMARY KEY,
  nome_fornecedor VARCHAR(255) NOT NULL,
  tipo_contrato   VARCHAR(100),
  cnpj            VARCHAR(50),
  contato         VARCHAR(100),
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  logradouro      VARCHAR(255),
  numero          VARCHAR(50),
  complemento     VARCHAR(255),
  bairro          VARCHAR(255),
  cep             VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS frota (
  id               SERIAL PRIMARY KEY,
  nome_veiculo     VARCHAR(255) NOT NULL,
  cor_veiculo      VARCHAR(100),
  placa            VARCHAR(20)  NOT NULL,
  tipo_veiculo     VARCHAR(100),
  capacidade       INT,
  latitude_garagem DOUBLE PRECISION,
  longitude_garagem DOUBLE PRECISION,
  fornecedor_id    INT REFERENCES fornecedores(id) ON DELETE SET NULL,
  documentacao     VARCHAR(255),
  licenca          VARCHAR(255),
  ano              INT,
  marca            VARCHAR(100),
  modelo           VARCHAR(100),
  tipo_combustivel VARCHAR(50),
  data_aquisicao   DATE,
  adaptado         BOOLEAN DEFAULT FALSE,
  elevador         BOOLEAN DEFAULT FALSE,
  ar_condicionado  BOOLEAN DEFAULT FALSE,
  gps              BOOLEAN DEFAULT FALSE,
  cinto_seguranca  BOOLEAN DEFAULT FALSE
);

-- veículo × motorista
CREATE TABLE IF NOT EXISTS frota_motoristas (
  id           SERIAL PRIMARY KEY,
  frota_id     INT NOT NULL REFERENCES frota(id)      ON DELETE CASCADE,
  motorista_id INT NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE
);

-- veículo × rota
CREATE TABLE IF NOT EXISTS frota_rotas (
  frota_id INT NOT NULL REFERENCES frota(id)          ON DELETE CASCADE,
  rota_id  INT NOT NULL REFERENCES rotas_simples(id)  ON DELETE CASCADE,
  PRIMARY KEY (frota_id, rota_id)
); -- :contentReference[oaicite:0]{index=0}&#8203;:contentReference[oaicite:1]{index=1}

-- fornecedor × rota
CREATE TABLE IF NOT EXISTS fornecedores_rotas (
  rota_id       INT NOT NULL REFERENCES rotas_simples(id) ON DELETE CASCADE,
  fornecedor_id INT NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
  PRIMARY KEY (rota_id, fornecedor_id)
); -- :contentReference[oaicite:2]{index=2}&#8203;:contentReference[oaicite:3]{index=3}

-- =========================================================
-- 4. MONITORES, MOTORISTAS, CHECKLISTS
-- =========================================================
CREATE TABLE IF NOT EXISTS monitores (
  id                SERIAL PRIMARY KEY,
  nome_monitor      VARCHAR(255) NOT NULL,
  cpf               VARCHAR(50)  NOT NULL,
  fornecedor_id     INT NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
  telefone          VARCHAR(50),
  email             VARCHAR(100),
  endereco          VARCHAR(255),
  data_admissao     DATE,
  documento_pessoal VARCHAR(255),
  certificado_curso VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS motoristas (
  id                                 SERIAL PRIMARY KEY,
  nome_motorista                     VARCHAR(255) NOT NULL,
  cpf                                VARCHAR(50)  NOT NULL,
  rg                                 VARCHAR(50),
  data_nascimento                    DATE,
  telefone                           VARCHAR(50),
  email                              VARCHAR(100),
  endereco                           VARCHAR(255),
  cidade                             VARCHAR(100),
  estado                             VARCHAR(100),
  cep                                VARCHAR(20),
  numero_cnh                         VARCHAR(50),
  categoria_cnh                      VARCHAR(10),
  validade_cnh                       DATE,
  fornecedor_id                      INT REFERENCES fornecedores(id) ON DELETE SET NULL,
  cnh_pdf                            VARCHAR(255),
  cert_transporte_escolar            VARCHAR(255),
  cert_transporte_passageiros        VARCHAR(255),
  data_validade_transporte_escolar   DATE,
  data_validade_transporte_passageiros DATE,
  senha                              VARCHAR(255)
);

-- monitor × rota
CREATE TABLE IF NOT EXISTS monitores_rotas (
  id         SERIAL PRIMARY KEY,
  monitor_id INT NOT NULL REFERENCES monitores(id)     ON DELETE CASCADE,
  rota_id    INT NOT NULL REFERENCES rotas_simples(id) ON DELETE CASCADE
);

-- motorista × rota
CREATE TABLE IF NOT EXISTS motoristas_rotas (
  id           SERIAL PRIMARY KEY,
  motorista_id INT NOT NULL REFERENCES motoristas(id)  ON DELETE CASCADE,
  rota_id      INT NOT NULL REFERENCES rotas_simples(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checklists_onibus (
  id                 SERIAL PRIMARY KEY,
  motorista_id       INT NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
  frota_id           INT NOT NULL REFERENCES frota(id)      ON DELETE CASCADE,
  data_checklist     DATE NOT NULL,
  horario_saida      TIME,
  horario_retorno    TIME,
  quilometragem_final INT,
  cnh_valida BOOLEAN DEFAULT FALSE,
  crlv_atualizado BOOLEAN DEFAULT FALSE,
  aut_cert_escolar BOOLEAN DEFAULT FALSE,
  pneus_calibragem BOOLEAN DEFAULT FALSE,
  pneus_estado BOOLEAN DEFAULT FALSE,
  pneu_estepe BOOLEAN DEFAULT FALSE,
  fluido_oleo_motor BOOLEAN DEFAULT FALSE,
  fluido_freio BOOLEAN DEFAULT FALSE,
  fluido_radiador BOOLEAN DEFAULT FALSE,
  fluido_parabrisa BOOLEAN DEFAULT FALSE,
  freio_pe BOOLEAN DEFAULT FALSE,
  freio_mao BOOLEAN DEFAULT FALSE,
  farois BOOLEAN DEFAULT FALSE,
  lanternas BOOLEAN DEFAULT FALSE,
  setas BOOLEAN DEFAULT FALSE,
  luz_freio BOOLEAN DEFAULT FALSE,
  luz_re BOOLEAN DEFAULT FALSE,
  iluminacao_interna BOOLEAN DEFAULT FALSE,
  extintor BOOLEAN DEFAULT FALSE,
  cintos BOOLEAN DEFAULT FALSE,
  martelo_emergencia BOOLEAN DEFAULT FALSE,
  kit_primeiros_socorros BOOLEAN DEFAULT FALSE,
  lataria_pintura BOOLEAN DEFAULT FALSE,
  vidros_limpos BOOLEAN DEFAULT FALSE,
  retrovisores_ok BOOLEAN DEFAULT FALSE,
  limpador_para_brisa BOOLEAN DEFAULT FALSE,
  sinalizacao_externa BOOLEAN DEFAULT FALSE,
  interior_limpo BOOLEAN DEFAULT FALSE,
  combustivel_suficiente BOOLEAN DEFAULT FALSE,
  triangulo_sinalizacao BOOLEAN DEFAULT FALSE,
  macaco_chave_roda BOOLEAN DEFAULT FALSE,
  material_limpeza BOOLEAN DEFAULT FALSE,
  acessibilidade BOOLEAN DEFAULT FALSE,
  obs_saida TEXT,
  combustivel_verificar BOOLEAN DEFAULT FALSE,
  abastecimento BOOLEAN DEFAULT FALSE,
  pneus_desgaste BOOLEAN DEFAULT FALSE,
  lataria_avarias BOOLEAN DEFAULT FALSE,
  interior_limpeza_retorno BOOLEAN DEFAULT FALSE,
  extintor_retorno BOOLEAN DEFAULT FALSE,
  cintos_retorno BOOLEAN DEFAULT FALSE,
  kit_primeiros_socorros_retorno BOOLEAN DEFAULT FALSE,
  equip_obrigatorio_retorno BOOLEAN DEFAULT FALSE,
  equip_acessorio_retorno BOOLEAN DEFAULT FALSE,
  problemas_mecanicos BOOLEAN DEFAULT FALSE,
  incidentes BOOLEAN DEFAULT FALSE,
  problema_portas_janelas BOOLEAN DEFAULT FALSE,
  manutencao_preventiva BOOLEAN DEFAULT FALSE,
  pronto_prox_dia BOOLEAN DEFAULT FALSE,
  obs_retorno TEXT
);

-- =========================================================
-- 5. ROTAS
-- =========================================================
CREATE TABLE IF NOT EXISTS rotas_simples (
  id            SERIAL PRIMARY KEY,
  identificador VARCHAR(20)  NOT NULL,
  descricao     VARCHAR(255),
  partida_lat   DOUBLE PRECISION NOT NULL,
  partida_lng   DOUBLE PRECISION NOT NULL,
  chegada_lat   DOUBLE PRECISION,
  chegada_lng   DOUBLE PRECISION,
  area_zona     VARCHAR(50),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS rotas_pontos (
  id       SERIAL PRIMARY KEY,
  rota_id  INT NOT NULL REFERENCES rotas_simples(id) ON DELETE CASCADE,
  ponto_id INT NOT NULL REFERENCES pontos(id)        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rotas_escolas (
  id        SERIAL PRIMARY KEY,
  rota_id   INT NOT NULL REFERENCES rotas_simples(id) ON DELETE CASCADE,
  escola_id INT NOT NULL REFERENCES escolas(id)       ON DELETE CASCADE
);

-- =========================================================
-- 6. RELATÓRIOS
-- =========================================================
CREATE TABLE IF NOT EXISTS relatorios_ocorrencias (
  id            SERIAL PRIMARY KEY,
  tipo_relatorio VARCHAR(100) NOT NULL,
  rota_id        VARCHAR(255),
  data_ocorrido  DATE,
  corpo          TEXT,
  caminho_anexo  TEXT,
  fornecedor_id  INT REFERENCES fornecedores(id) ON DELETE SET NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
); -- :contentReference[oaicite:4]{index=4}&#8203;:contentReference[oaicite:5]{index=5}

CREATE TABLE IF NOT EXISTS relatorios_gerais (
  id            SERIAL PRIMARY KEY,
  tipo_relatorio VARCHAR(100) NOT NULL,
  data_relatorio DATE         NOT NULL,
  corpo          TEXT,
  caminho_anexo  TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
); -- :contentReference[oaicite:6]{index=6}&#8203;:contentReference[oaicite:7]{index=7}

-- =========================================================
-- 7. USUÁRIOS, SESSÕES E PERMISSÕES
-- =========================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id                       SERIAL PRIMARY KEY,
  nome_completo            VARCHAR(255) NOT NULL,
  cpf                      VARCHAR(14),
  cnpj                     VARCHAR(18),
  telefone                 VARCHAR(20) NOT NULL,
  email                    VARCHAR(100) NOT NULL,
  senha                    VARCHAR(255) NOT NULL,
  init                     BOOLEAN DEFAULT FALSE,
  permissoes               TEXT,
  rg                       VARCHAR(20),
  endereco                 VARCHAR(255),
  cidade                   VARCHAR(100),
  estado                   VARCHAR(100),
  cep                      VARCHAR(20),
  foto_perfil              VARCHAR(255),
  pergunta_seguranca       VARCHAR(255),
  autenticacao_dois_fatores VARCHAR(50),
  tema_preferido           VARCHAR(50),
  notificacoes_email       VARCHAR(50),
  linguagem_preferida      VARCHAR(10)
);

-- vínculo de usuário a fornecedor (1‑para‑1)
CREATE TABLE IF NOT EXISTS usuario_fornecedor (
  usuario_id    INT PRIMARY KEY REFERENCES usuarios(id)     ON DELETE CASCADE,
  fornecedor_id INT NOT NULL   REFERENCES fornecedores(id)  ON DELETE CASCADE
); -- :contentReference[oaicite:8]{index=8}&#8203;:contentReference[oaicite:9]{index=9}

-- sessões express‑session
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL PRIMARY KEY,
  sess   JSON    NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session(expire);

-- =========================================================
-- 8. NOTIFICAÇÕES
-- =========================================================
CREATE TABLE IF NOT EXISTS notificacoes (
  id          SERIAL PRIMARY KEY,
  user_id     INT REFERENCES usuarios(id) ON DELETE SET NULL,
  acao        VARCHAR(50),
  tabela      VARCHAR(50),
  registro_id INT,
  mensagem    TEXT,
  datahora    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_read     BOOLEAN DEFAULT FALSE
);

-- =========================================================
-- 9. DEMAIS TABELAS DE NEGÓCIO JÁ EXISTENTES
-- =========================================================
CREATE TABLE IF NOT EXISTS cocessao_rota (
  id                         SERIAL PRIMARY KEY,
  nome_responsavel           VARCHAR(200) NOT NULL,
  cpf_responsavel            VARCHAR(20)  NOT NULL,
  celular_responsavel        VARCHAR(20)  NOT NULL,
  id_matricula_aluno         VARCHAR(50)  NOT NULL,
  escola_id                  INT NOT NULL,
  cep                        VARCHAR(10)  NOT NULL,
  numero                     VARCHAR(20)  NOT NULL,
  endereco                   VARCHAR(255),
  zoneamento                 BOOLEAN NOT NULL,
  deficiencia                BOOLEAN NOT NULL,
  laudo_deficiencia_path     TEXT,
  comprovante_endereco_path  TEXT,
  latitude                   DOUBLE PRECISION,
  longitude                  DOUBLE PRECISION,
  observacoes                TEXT,
  criterio_direito           TEXT,
  status                     VARCHAR(50) NOT NULL DEFAULT 'pendente',
  created_at                 TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memorandos (
  id                SERIAL PRIMARY KEY,
  tipo_memorando    VARCHAR(100) NOT NULL,
  data_emissao      DATE NOT NULL,
  assunto           VARCHAR(250) NOT NULL,
  setor_origem      VARCHAR(150) NOT NULL,
  destino_transporte VARCHAR(150),
  data_transporte   DATE,
  quantidade_pessoas INT,
  funcionario_responsavel VARCHAR(150),
  valor_diaria      VARCHAR(50),
  motivo_diaria     VARCHAR(250),
  placa_veiculo     VARCHAR(50),
  descricao_problema VARCHAR(250),
  tipo_combustivel  VARCHAR(50),
  quantidade_litros INT,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alunos_ativos (
    id                          SERIAL PRIMARY KEY,
    -- NOVO CAMPO ..............................
    id_pessoa                   VARCHAR(50),

    id_matricula                INT,
    escola_id                   INT REFERENCES escolas(id),
    ano                         INT,
    modalidade                  VARCHAR(255),
    formato_letivo              VARCHAR(255),
    turma                       VARCHAR(255),
    pessoa_nome                 VARCHAR(255),
    cpf                         VARCHAR(50),
    transporte_escolar_poder_publico VARCHAR(255),
    cep                         VARCHAR(50),
    rua                         VARCHAR(255),
    bairro                      VARCHAR(255),
    numero_pessoa_endereco      VARCHAR(50),
    filiacao_1                  VARCHAR(255),
    numero_telefone             VARCHAR(50),
    filiacao_2                  VARCHAR(255),
    responsavel                 VARCHAR(255),
    deficiencia                 TEXT[],
    data_nascimento             DATE,
    longitude                   NUMERIC(9,6),
    latitude                    NUMERIC(9,6),

    --------------------------------------------------------
    -- Garantias de unicidade (ignoram valores nulos/vazios)
    --------------------------------------------------------
    CONSTRAINT uq_alunos_id_pessoa    UNIQUE (id_pessoa)
        DEFERRABLE INITIALLY IMMEDIATE,
    CONSTRAINT uq_alunos_id_matricula UNIQUE (id_matricula)
        DEFERRABLE INITIALLY IMMEDIATE,
    CONSTRAINT uq_alunos_cpf          UNIQUE (cpf)
        DEFERRABLE INITIALLY IMMEDIATE
);


CREATE TABLE IF NOT EXISTS alunos_ativos_estadual (
  id                       SERIAL PRIMARY KEY,
  id_matricula             VARCHAR(50),
  pessoa_nome              VARCHAR(255) NOT NULL,
  escola_id                INT REFERENCES escolas(id),
  turma                    VARCHAR(255),
  turno                    VARCHAR(255),
  cpf                      VARCHAR(50),
  cep                      VARCHAR(50),
  rua                      VARCHAR(255),
  bairro                   VARCHAR(255),
  numero_pessoa_endereco   VARCHAR(50),
  numero_telefone          VARCHAR(50),
  filiacao_1               VARCHAR(255),
  filiacao_2               VARCHAR(255),
  responsavel              VARCHAR(255),
  deficiencia              TEXT[],
  latitude                 NUMERIC(9,6),
  longitude                NUMERIC(9,6),
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alunos_rotas (
  aluno_id INT NOT NULL REFERENCES alunos_ativos(id) ON DELETE CASCADE,
  rota_id  INT NOT NULL REFERENCES rotas_simples(id) ON DELETE CASCADE,
  PRIMARY KEY (aluno_id, rota_id)
);


CREATE TABLE IF NOT EXISTS reavaliacoes (
  id                         SERIAL PRIMARY KEY,
  aluno_id                   INT NOT NULL,
  tipo_fluxo                 VARCHAR(50) NOT NULL,
  data_solicitacao           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  nome_aluno                 TEXT,
  cpf_aluno                  TEXT,
  responsavel_aluno          TEXT,
  latitude                   NUMERIC(9,6),
  longitude                  NUMERIC(9,6),
  calcadas_ausentes          BOOLEAN DEFAULT FALSE,
  pavimentacao_ausente       BOOLEAN DEFAULT FALSE,
  iluminacao_precaria        BOOLEAN DEFAULT FALSE,
  area_de_risco              BOOLEAN DEFAULT FALSE,
  animais_perigosos          BOOLEAN DEFAULT FALSE,
  status_reavaliacao         VARCHAR(50) DEFAULT 'PENDENTE'
);
CREATE INDEX IF NOT EXISTS idx_reavaliacoes_aluno_id ON reavaliacoes(aluno_id);



-- ==========================================
-- CONEXÃO COM O BANCO DE DADOS VIA PSQL
-- ==========================================

psql -h pyden-express-2-0.cjucwyoced9l.sa-east-1.rds.amazonaws.com \
     -p 5432 \
     -U postgres \
     -d pyden_express
