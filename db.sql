--------------------------------------------------------------------------------
-- TABELA: zoneamentos
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zoneamentos (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  lote VARCHAR(255),
  geom GEOMETRY(Polygon, 4326) NOT NULL
);

--------------------------------------------------------------------------------
-- TABELA: escolas
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escolas (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  codigo_inep VARCHAR(50),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  area VARCHAR(50),
  logradouro VARCHAR(255),
  numero VARCHAR(50),
  complemento VARCHAR(255),
  ponto_referencia VARCHAR(255),
  bairro VARCHAR(255),
  cep VARCHAR(20),
  regime VARCHAR(255),
  nivel VARCHAR(255),
  horario VARCHAR(255)
);

--------------------------------------------------------------------------------
-- RELAÇÃO: escolas_zoneamentos
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escolas_zoneamentos (
  id SERIAL PRIMARY KEY,
  escola_id INT NOT NULL,
  zoneamento_id INT NOT NULL,
  FOREIGN KEY (escola_id) REFERENCES escolas(id) ON DELETE CASCADE,
  FOREIGN KEY (zoneamento_id) REFERENCES zoneamentos(id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- TABELA: fornecedores
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fornecedores (
  id SERIAL PRIMARY KEY,
  nome_fornecedor VARCHAR(255) NOT NULL,
  tipo_contrato VARCHAR(100),
  cnpj VARCHAR(50),
  contato VARCHAR(100),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  logradouro VARCHAR(255),
  numero VARCHAR(50),
  complemento VARCHAR(255),
  bairro VARCHAR(255),
  cep VARCHAR(20)
);

--------------------------------------------------------------------------------
-- TABELA: frota
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS frota (
  id SERIAL PRIMARY KEY,
  nome_veiculo VARCHAR(255) NOT NULL,
  placa VARCHAR(20) NOT NULL,
  tipo_veiculo VARCHAR(100),
  capacidade INT,
  latitude_garagem DOUBLE PRECISION,
  longitude_garagem DOUBLE PRECISION,
  fornecedor_id INT,
  documentacao VARCHAR(255),
  licenca VARCHAR(255),
  ano INT,
  marca VARCHAR(100),
  modelo VARCHAR(100),
  tipo_combustivel VARCHAR(50),
  data_aquisicao DATE,
  adaptado BOOLEAN DEFAULT FALSE,
  elevador BOOLEAN DEFAULT FALSE,
  ar_condicionado BOOLEAN DEFAULT FALSE,
  gps BOOLEAN DEFAULT FALSE,
  cinto_seguranca BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL
);

--------------------------------------------------------------------------------
-- TABELA: monitores
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitores (
  id SERIAL PRIMARY KEY,
  nome_monitor VARCHAR(255) NOT NULL,
  cpf VARCHAR(50) NOT NULL,
  fornecedor_id INT NOT NULL,
  telefone VARCHAR(50),
  email VARCHAR(100),
  endereco VARCHAR(255),
  data_admissao DATE,
  documento_pessoal VARCHAR(255),
  certificado_curso VARCHAR(255),
  FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- TABELA: motoristas
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS motoristas (
  id SERIAL PRIMARY KEY,
  nome_motorista VARCHAR(255) NOT NULL,
  cpf VARCHAR(50) NOT NULL,
  rg VARCHAR(50),
  data_nascimento DATE,
  telefone VARCHAR(50),
  email VARCHAR(100),
  endereco VARCHAR(255),
  cidade VARCHAR(100),
  estado VARCHAR(100),
  cep VARCHAR(20),
  numero_cnh VARCHAR(50),
  categoria_cnh VARCHAR(10),
  validade_cnh DATE,
  fornecedor_id INT,
  cnh_pdf VARCHAR(255),
  cert_transporte_escolar VARCHAR(255),
  cert_transporte_passageiros VARCHAR(255),
  data_validade_transporte_escolar DATE,
  data_validade_transporte_passageiros DATE,
  senha VARCHAR(255),
  FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL
);

--------------------------------------------------------------------------------
-- TABELA: pontos
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pontos (
  id SERIAL PRIMARY KEY,
  nome_ponto VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  area VARCHAR(50),
  logradouro VARCHAR(255),
  numero VARCHAR(50),
  complemento VARCHAR(255),
  ponto_referencia VARCHAR(255),
  bairro VARCHAR(255),
  cep VARCHAR(20)
);

--------------------------------------------------------------------------------
-- RELAÇÃO: pontos_zoneamentos
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pontos_zoneamentos (
  id SERIAL PRIMARY KEY,
  ponto_id INT NOT NULL,
  zoneamento_id INT NOT NULL,
  FOREIGN KEY (ponto_id) REFERENCES pontos(id) ON DELETE CASCADE,
  FOREIGN KEY (zoneamento_id) REFERENCES zoneamentos(id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- TABELA: rotas_simples
--------------------------------------------------------------------------------
CREATE TABLE rotas_simples (
    id SERIAL PRIMARY KEY,
    identificador VARCHAR(20) NOT NULL,
    descricao VARCHAR(255),
    partida_lat DOUBLE PRECISION NOT NULL,
    partida_lng DOUBLE PRECISION NOT NULL,
    chegada_lat DOUBLE PRECISION,
    chegada_lng DOUBLE PRECISION,
    area_zona VARCHAR(50),         -- <- ADICIONE ESTA LINHA
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--------------------------------------------------------------------------------
-- RELAÇÃO: rotas_pontos
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rotas_pontos (
  id SERIAL PRIMARY KEY,
  rota_id INT NOT NULL,
  ponto_id INT NOT NULL,
  FOREIGN KEY (rota_id) REFERENCES rotas_simples(id) ON DELETE CASCADE,
  FOREIGN KEY (ponto_id) REFERENCES pontos(id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- RELAÇÃO: rotas_escolas
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rotas_escolas (
  id SERIAL PRIMARY KEY,
  rota_id INT NOT NULL,
  escola_id INT NOT NULL,
  FOREIGN KEY (rota_id) REFERENCES rotas_simples(id) ON DELETE CASCADE,
  FOREIGN KEY (escola_id) REFERENCES escolas(id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- RELAÇÃO: motoristas_rotas
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS motoristas_rotas (
  id SERIAL PRIMARY KEY,
  motorista_id INT NOT NULL,
  rota_id INT NOT NULL,
  FOREIGN KEY (motorista_id) REFERENCES motoristas(id) ON DELETE CASCADE,
  FOREIGN KEY (rota_id) REFERENCES rotas_simples(id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- RELAÇÃO: frota_motoristas
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS frota_motoristas (
  id SERIAL PRIMARY KEY,
  frota_id INT NOT NULL,
  motorista_id INT NOT NULL,
  FOREIGN KEY (frota_id) REFERENCES frota(id) ON DELETE CASCADE,
  FOREIGN KEY (motorista_id) REFERENCES motoristas(id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- TABELA: checklists_onibus
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklists_onibus (
  id SERIAL PRIMARY KEY,
  motorista_id INT NOT NULL,
  CONSTRAINT fk_motorista
    FOREIGN KEY (motorista_id)
    REFERENCES motoristas(id)
    ON DELETE CASCADE,
  frota_id INT NOT NULL,
  CONSTRAINT fk_frota
    FOREIGN KEY (frota_id)
    REFERENCES frota(id)
    ON DELETE CASCADE,
  data_checklist DATE NOT NULL,
  horario_saida TIME,
  horario_retorno TIME,
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

--------------------------------------------------------------------------------
-- RELAÇÃO: monitores_rotas
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitores_rotas (
  id SERIAL PRIMARY KEY,
  monitor_id INT NOT NULL,
  rota_id INT NOT NULL,
  FOREIGN KEY (monitor_id) REFERENCES monitores(id) ON DELETE CASCADE,
  FOREIGN KEY (rota_id) REFERENCES rotas_simples(id) ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- TABELA: cocessao_rota
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cocessao_rota (
  id SERIAL PRIMARY KEY,
  nome_responsavel VARCHAR(200) NOT NULL,
  cpf_responsavel VARCHAR(20) NOT NULL,
  celular_responsavel VARCHAR(20) NOT NULL,
  id_matricula_aluno VARCHAR(50) NOT NULL,
  escola_id INT NOT NULL,
  cep VARCHAR(10) NOT NULL,
  numero VARCHAR(20) NOT NULL,
  endereco VARCHAR(255),
  zoneamento BOOLEAN NOT NULL,
  deficiencia BOOLEAN NOT NULL,
  laudo_deficiencia_path TEXT,
  comprovante_endereco_path TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  observacoes TEXT,
  criterio_direito TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS memorandos (
  id SERIAL PRIMARY KEY,
  tipo_memorando VARCHAR(100) NOT NULL,
  data_emissao DATE NOT NULL,
  assunto VARCHAR(250) NOT NULL,
  setor_origem VARCHAR(150) NOT NULL,
  destino_transporte VARCHAR(150),
  data_transporte DATE,
  quantidade_pessoas INT,
  funcionario_responsavel VARCHAR(150),
  valor_diaria VARCHAR(50),
  motivo_diaria VARCHAR(250),
  placa_veiculo VARCHAR(50),
  descricao_problema VARCHAR(250),
  tipo_combustivel VARCHAR(50),
  quantidade_litros INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS alunos_ativos (
  id SERIAL PRIMARY KEY,
  id_matricula INTEGER,
  escola_id INTEGER REFERENCES escolas(id),
  ano INTEGER,
  modalidade VARCHAR(255),
  formato_letivo VARCHAR(255),
  turma VARCHAR(255),
  pessoa_nome VARCHAR(255),
  cpf VARCHAR(50),
  transporte_escolar_poder_publico VARCHAR(255),
  cep VARCHAR(50),
  bairro VARCHAR(255),
  filiacao_1 VARCHAR(255),
  numero_telefone VARCHAR(50),
  filiacao_2 VARCHAR(255),
  responsavel VARCHAR(255),
  deficiencia TEXT[]
);


-- ==========================================
-- CRIAÇÃO DA TABELA "usuarios"
-- ==========================================
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome_completo VARCHAR(255) NOT NULL,
    cpf VARCHAR(14),                   -- Ex: 000.000.000-00
    cnpj VARCHAR(18),                  -- Ex: 00.000.000/0000-00
    telefone VARCHAR(20) NOT NULL,
    email VARCHAR(100) NOT NULL,
    senha VARCHAR(255) NOT NULL,
    init BOOLEAN DEFAULT FALSE,        -- Indica se o usuário está ativo/liberado
    permissoes TEXT,                   -- Lista de permissões em formato de texto (JSON ou CSV)
    rg VARCHAR(20),                    -- Documento adicional (RG, etc.)
    endereco VARCHAR(255),
    cidade VARCHAR(100),
    estado VARCHAR(100),
    cep VARCHAR(20),
    foto_perfil VARCHAR(255),         -- Caminho ou URL da foto do perfil
    pergunta_seguranca VARCHAR(255),
    autenticacao_dois_fatores VARCHAR(50),  -- Ex: "off", "sms", "email", "app"
    tema_preferido VARCHAR(50),       -- Ex: "claro" ou "escuro"
    notificacoes_email VARCHAR(50),    -- Ex: "todas", "media", "importantes", "nenhuma"
    linguagem_preferida VARCHAR(10)    -- Ex: "pt-br", "en", "es"
);


-- (Opcional) criar índice único para não permitir emails duplicados:
-- CREATE UNIQUE INDEX

CREATE TABLE IF NOT EXISTS session (
  sid varchar NOT NULL COLLATE "default",
  sess json NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
);
CREATE INDEX ON session (expire);


CREATE TABLE IF NOT EXISTS notificacoes (
    id SERIAL PRIMARY KEY,
    user_id INT,                 -- Quem realizou a ação (FK p/ usuarios.id)
    acao VARCHAR(50),            -- Ex: "CREATE", "DELETE", "UPDATE"
    tabela VARCHAR(50),          -- Ex: "zoneamentos", "escolas", etc.
    registro_id INT,             -- ID do registro afetado
    mensagem TEXT,               -- Texto descritivo do que ocorreu
    datahora TIMESTAMP DEFAULT NOW(),
    is_read BOOLEAN DEFAULT FALSE
);





-- ==========================================
-- CONEXÃO COM O BANCO DE DADOS VIA PSQL
-- ==========================================

psql -h pyden-express-2-0.cjucwyoced9l.sa-east-1.rds.amazonaws.com \
     -p 5432 \
     -U postgres \
     -d pyden_express
