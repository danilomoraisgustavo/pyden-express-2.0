// ====================================================================================
// SERVER.JS
// ====================================================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const multer = require('multer');
const fs = require('fs');
const { DOMParser } = require('xmldom');
const tj = require('@mapbox/togeojson');
const JSZip = require('jszip');
const { Parser } = require('xml2js');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const { Document, Paragraph, Packer, TextRun } = require('docx');
const PDFDocument = require('pdfkit');


const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --------------------------------------------------------------------------------
// CONFIGURAÇÃO DO BANCO DE DADOS
// --------------------------------------------------------------------------------
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'pyden_express',
    password: 'DeD-140619',
    port: 5430,
});

app.use(cors({ origin: '*' }));

// --------------------------------------------------------------------------------
// CONFIGURAÇÃO DE UPLOAD
// --------------------------------------------------------------------------------
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const memorandoUpload = multer();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ dest: 'uploads/' });
const uploadFrota = multer({ storage: storage });
const uploadMonitores = multer({ storage: storage });

// --------------------------------------------------------------------------------
// ROTA PRINCIPAL
// --------------------------------------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/pages/transporte-escolar/dashboard-escolar.html'));
});

// --------------------------------------------------------------------------------
// FUNÇÕES UTILITÁRIAS PARA CONVERSÃO DE ARQUIVOS (KMZ -> KML, etc.)
// --------------------------------------------------------------------------------
async function kmzToKml(filePath) {
    const data = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(data);
    const kmlFile = Object.keys(zip.files).find((fileName) => fileName.endsWith('.kml'));
    if (!kmlFile) throw new Error('KMZ inválido: não contém arquivo KML.');
    const kmlData = await zip.files[kmlFile].async('string');
    return kmlData;
}

async function convertToGeoJSON(filePath, originalname) {
    const extension = path.extname(originalname).toLowerCase();
    if (extension === '.geojson' || extension === '.json') {
        const data = fs.readFileSync(filePath, 'utf8');
        const geojson = JSON.parse(data);
        return geojson;
    }
    if (extension === '.kml') {
        const kmlData = fs.readFileSync(filePath, 'utf8');
        const dom = new DOMParser().parseFromString(kmlData, 'text/xml');
        const geojson = tj.kml(dom);
        return geojson;
    }
    if (extension === '.kmz') {
        const kmlData = await kmzToKml(filePath);
        const dom = new DOMParser().parseFromString(kmlData, 'text/xml');
        const geojson = tj.kml(dom);
        return geojson;
    }
    if (extension === '.gpx') {
        const gpxData = fs.readFileSync(filePath, 'utf8');
        const dom = new DOMParser().parseFromString(gpxData, 'text/xml');
        const geojson = tj.gpx(dom);
        return geojson;
    }
    throw new Error('Formato de arquivo não suportado.');
}

// ====================================================================================
//                              ZONEAMENTOS
// ====================================================================================

app.post('/api/zoneamento/cadastrar', async (req, res) => {
    try {
        const nome = req.body.nome_zoneamento;
        const geojsonStr = req.body.geojson;

        if (!nome || !geojsonStr) {
            return res.status(400).json({ success: false, message: 'Nome do zoneamento ou GeoJSON não fornecidos.' });
        }

        let geojson;
        try {
            geojson = JSON.parse(geojsonStr);
        } catch (err) {
            return res.status(400).json({ success: false, message: 'GeoJSON inválido.' });
        }

        if (!geojson.type || geojson.type !== 'Feature' || !geojson.geometry || geojson.geometry.type !== 'Polygon') {
            return res.status(400).json({ success: false, message: 'GeoJSON não é um polígono válido.' });
        }

        const insertQuery = `
            INSERT INTO zoneamentos (nome, geom)
            VALUES($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))
            RETURNING id;
        `;
        const values = [nome, JSON.stringify(geojson.geometry)];
        const result = await pool.query(insertQuery, values);

        if (result.rows.length > 0) {
            res.json({ success: true, message: 'Zoneamento cadastrado com sucesso!', id: result.rows[0].id });
        } else {
            res.status(500).json({ success: false, message: 'Erro ao cadastrar zoneamento.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/api/zoneamentos', async (req, res) => {
    try {
        const query = `
            SELECT
                id,
                nome,
                ST_AsGeoJSON(geom) as geojson
            FROM zoneamentos;
        `;
        const result = await pool.query(query);
        const zoneamentos = result.rows.map((row) => ({
            id: row.id,
            nome: row.nome,
            geojson: JSON.parse(row.geojson)
        }));
        res.json(zoneamentos);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.delete('/api/zoneamento/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteQuery = 'DELETE FROM zoneamentos WHERE id = $1';
        const result = await pool.query(deleteQuery, [id]);

        if (result.rowCount > 0) {
            res.json({ success: true, message: 'Zoneamento excluído com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Zoneamento não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.post('/api/zoneamento/importar', upload.single('file'), async (req, res) => {
    try {
        const filePath = req.file.path;
        const originalName = req.file.originalname;
        const geojson = await convertToGeoJSON(filePath, originalName);
        const features = geojson.features || [];

        for (const feature of features) {
            const props = feature.properties || {};
            const geometry = feature.geometry;
            const nome = props.nome || props.bairros || 'Sem nome';
            const lote = props.lote || 'Sem número';
            if (!geometry) continue;

            const insertQuery = `
                INSERT INTO zoneamentos (nome, lote, geom)
                VALUES ($1, $2, ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($3)), 4326))
                RETURNING id;
            `;
            const values = [nome, lote, JSON.stringify(geometry)];
            await pool.query(insertQuery, values);
        }
        fs.unlinkSync(filePath);
        res.json({ success: true, message: 'Importação concluída com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

// ====================================================================================
//                              ESCOLAS
// ====================================================================================

app.post('/api/escolas/cadastrar', async (req, res) => {
    try {
        const {
            latitude,
            longitude,
            area,
            logradouro,
            numero,
            complemento,
            pontoReferencia,
            bairro,
            cep,
            nomeEscola,
            codigoINEP
        } = req.body;

        const regime = req.body['regime[]'] || [];
        const nivel = req.body['nivel[]'] || [];
        const horario = req.body['horario[]'] || [];
        const zoneamentosSelecionados = JSON.parse(req.body.zoneamentosSelecionados || '[]');

        const insertEscolaQuery = `
            INSERT INTO escolas (
                nome, codigo_inep, latitude, longitude, area, logradouro, numero, complemento, ponto_referencia, bairro, cep, regime, nivel, horario
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
            )
            RETURNING id;
        `;
        const values = [
            nomeEscola,
            codigoINEP || null,
            latitude ? parseFloat(latitude) : null,
            longitude ? parseFloat(longitude) : null,
            area,
            logradouro || null,
            numero || null,
            complemento || null,
            pontoReferencia || null,
            bairro || null,
            cep || null,
            regime.join(','),
            nivel.join(','),
            horario.join(',')
        ];
        const result = await pool.query(insertEscolaQuery, values);
        if (result.rows.length === 0) {
            return res.status(500).json({ success: false, message: 'Erro ao cadastrar escola.' });
        }
        const escolaId = result.rows[0].id;

        if (zoneamentosSelecionados.length > 0) {
            const insertZonaEscolaQuery = `
                INSERT INTO escolas_zoneamentos (escola_id, zoneamento_id)
                VALUES ($1, $2);
            `;
            for (const zid of zoneamentosSelecionados) {
                await pool.query(insertZonaEscolaQuery, [escolaId, zid]);
            }
        }
        res.json({ success: true, message: 'Escola cadastrada com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/api/escolas', async (req, res) => {
    try {
        const query = `
            SELECT e.id, e.nome, e.codigo_inep, e.latitude, e.longitude, e.area,
                e.logradouro, e.numero, e.complemento, e.ponto_referencia,
                e.bairro, e.cep, e.regime, e.nivel, e.horario,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', z.id,
                            'nome', z.nome
                        )
                    ) FILTER (WHERE z.id IS NOT NULL),
                    '[]'
                ) AS zoneamentos
            FROM escolas e
            LEFT JOIN escolas_zoneamentos ez ON ez.escola_id = e.id
            LEFT JOIN zoneamentos z ON z.id = ez.zoneamento_id
            GROUP BY e.id
            ORDER BY e.id;
        `;
        const result = await pool.query(query);
        const escolas = result.rows.map((row) => ({
            id: row.id,
            nome: row.nome,
            codigo_inep: row.codigo_inep,
            latitude: row.latitude,
            longitude: row.longitude,
            area: row.area,
            logradouro: row.logradouro,
            numero: row.numero,
            complemento: row.complemento,
            ponto_referencia: row.ponto_referencia,
            bairro: row.bairro,
            cep: row.cep,
            regime: (row.regime || '').split(',').filter((r) => r),
            nivel: (row.nivel || '').split(',').filter((n) => n),
            horario: (row.horario || '').split(',').filter((h) => h),
            zoneamentos: row.zoneamentos
        }));
        res.json(escolas);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

// ====================================================================================
//                              FORNECEDORES
// ====================================================================================

app.post('/api/fornecedores/cadastrar', async (req, res) => {
    try {
        const {
            nome_fornecedor,
            tipo_contrato,
            cnpj,
            contato,
            latitude,
            longitude,
            logradouro,
            numero,
            complemento,
            bairro,
            cep
        } = req.body;

        if (!nome_fornecedor || !tipo_contrato || !cnpj || !contato) {
            return res.status(400).json({ success: false, message: 'Campos obrigatórios não fornecidos.' });
        }

        const insertQuery = `
            INSERT INTO fornecedores (
                nome_fornecedor, tipo_contrato, cnpj, contato, latitude, longitude, logradouro, numero, complemento, bairro, cep
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
            )
            RETURNING id;
        `;
        const values = [
            nome_fornecedor,
            tipo_contrato,
            cnpj,
            contato,
            latitude ? parseFloat(latitude) : null,
            longitude ? parseFloat(longitude) : null,
            logradouro || null,
            numero || null,
            complemento || null,
            bairro || null,
            cep || null
        ];
        const result = await pool.query(insertQuery, values);
        if (result.rows.length === 0) {
            return res.status(500).json({ success: false, message: 'Erro ao cadastrar fornecedor.' });
        }
        res.json({ success: true, message: 'Fornecedor cadastrado com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/api/fornecedores', async (req, res) => {
    try {
        const query = `
            SELECT
                id,
                nome_fornecedor,
                tipo_contrato,
                cnpj,
                contato,
                latitude,
                longitude,
                logradouro,
                numero,
                complemento,
                bairro,
                cep
            FROM fornecedores
            ORDER BY id;
        `;
        const result = await pool.query(query);
        const fornecedores = result.rows.map((row) => ({
            id: row.id,
            nome_fornecedor: row.nome_fornecedor,
            tipo_contrato: row.tipo_contrato,
            cnpj: row.cnpj,
            contato: row.contato,
            latitude: row.latitude,
            longitude: row.longitude,
            logradouro: row.logradouro,
            numero: row.numero,
            complemento: row.complemento,
            bairro: row.bairro,
            cep: row.cep
        }));
        res.json(fornecedores);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.delete('/api/fornecedores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteQuery = 'DELETE FROM fornecedores WHERE id = $1';
        const result = await pool.query(deleteQuery, [id]);

        if (result.rowCount > 0) {
            res.json({ success: true, message: 'Fornecedor excluído com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Fornecedor não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

// ====================================================================================
//                              FROTA
// ====================================================================================

app.get('/api/frota', async (req, res) => {
    try {
        const query = `
            SELECT
                f.id,
                f.nome_veiculo,
                f.placa,
                f.tipo_veiculo,
                f.capacidade,
                f.latitude_garagem,
                f.longitude_garagem,
                f.fornecedor_id,
                f.documentacao,
                f.licenca,
                fr.nome_fornecedor AS fornecedor_nome,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', m.id,
                            'nome_motorista', m.nome_motorista,
                            'cpf', m.cpf
                        )
                    ) FILTER (WHERE m.id IS NOT NULL),
                    '[]'
                ) AS motoristas
            FROM frota f
            LEFT JOIN fornecedores fr ON fr.id = f.fornecedor_id
            LEFT JOIN frota_motoristas fm ON fm.frota_id = f.id
            LEFT JOIN motoristas m ON m.id = fm.motorista_id
            GROUP BY f.id, fr.nome_fornecedor
            ORDER BY f.id;
        `;
        const result = await pool.query(query);
        const frotaCompleta = result.rows.map((row) => ({
            id: row.id,
            nome_veiculo: row.nome_veiculo,
            placa: row.placa,
            tipo_veiculo: row.tipo_veiculo,
            capacidade: row.capacidade,
            latitude_garagem: row.latitude_garagem,
            longitude_garagem: row.longitude_garagem,
            fornecedor_id: row.fornecedor_id,
            documentacao: row.documentacao,
            licenca: row.licenca,
            fornecedor_nome: row.fornecedor_nome,
            motoristas: row.motoristas || []
        }));
        res.json(frotaCompleta);
    } catch (error) {
        console.error('Erro ao listar frota:', error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.post(
    '/api/frota/cadastrar',
    uploadFrota.fields([
        { name: 'documentacao', maxCount: 1 },
        { name: 'licenca', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const {
                nome_veiculo,
                placa,
                tipo_veiculo,
                capacidade,
                fornecedor_id,
                latitude_garagem,
                longitude_garagem,
                ano,
                marca,
                modelo,
                tipo_combustivel,
                data_aquisicao,
                adaptado,
                elevador,
                ar_condicionado,
                gps,
                cinto_seguranca
            } = req.body;

            let motoristasAssociados = [];
            if (req.body.motoristasAssociados) {
                motoristasAssociados = JSON.parse(req.body.motoristasAssociados);
            }

            if (!nome_veiculo || !placa || !tipo_veiculo || !capacidade || !fornecedor_id) {
                return res.status(400).json({ success: false, message: 'Campos obrigatórios não fornecidos.' });
            }

            let documentacaoPath = null;
            let licencaPath = null;
            if (req.files['documentacao'] && req.files['documentacao'].length > 0) {
                documentacaoPath = 'uploads/' + req.files['documentacao'][0].filename;
            }
            if (req.files['licenca'] && req.files['licenca'].length > 0) {
                licencaPath = 'uploads/' + req.files['licenca'][0].filename;
            }

            const insertQuery = `
                INSERT INTO frota (
                    nome_veiculo, placa, tipo_veiculo, capacidade, latitude_garagem, longitude_garagem, fornecedor_id,
                    documentacao, licenca, ano, marca, modelo, tipo_combustivel, data_aquisicao,
                    adaptado, elevador, ar_condicionado, gps, cinto_seguranca
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    $8, $9, $10, $11, $12, $13, $14,
                    $15, $16, $17, $18, $19
                )
                RETURNING id;
            `;
            const values = [
                nome_veiculo,
                placa,
                tipo_veiculo,
                parseInt(capacidade, 10),
                latitude_garagem ? parseFloat(latitude_garagem) : null,
                longitude_garagem ? parseFloat(longitude_garagem) : null,
                parseInt(fornecedor_id, 10),
                documentacaoPath,
                licencaPath,
                ano ? parseInt(ano, 10) : null,
                marca || null,
                modelo || null,
                tipo_combustivel || null,
                data_aquisicao || null,
                adaptado === 'Sim',
                elevador === 'Sim',
                ar_condicionado === 'Sim',
                gps === 'Sim',
                cinto_seguranca === 'Sim'
            ];
            const result = await pool.query(insertQuery, values);
            if (result.rows.length === 0) {
                return res.status(500).json({ success: false, message: 'Erro ao cadastrar veículo.' });
            }

            const frotaId = result.rows[0].id;
            if (Array.isArray(motoristasAssociados) && motoristasAssociados.length > 0) {
                for (const motoristaId of motoristasAssociados) {
                    const relQuery = `
                        INSERT INTO frota_motoristas (frota_id, motorista_id)
                        VALUES ($1, $2);
                    `;
                    await pool.query(relQuery, [frotaId, motoristaId]);
                }
            }
            return res.json({ success: true, message: 'Veículo cadastrado com sucesso!' });
        } catch (error) {
            console.error('Erro no /api/frota/cadastrar:', error);
            return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
        }
    }
);

app.delete('/api/frota/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteQuery = 'DELETE FROM frota WHERE id = $1';
        const result = await pool.query(deleteQuery, [id]);
        if (result.rowCount > 0) {
            res.json({ success: true, message: 'Veículo excluído com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Veículo não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

// ====================================================================================
//                              MONITORES
// ====================================================================================

app.post(
    '/api/monitores/cadastrar',
    uploadMonitores.fields([
        { name: 'documento_pessoal', maxCount: 1 },
        { name: 'certificado_curso', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const { nome_monitor, cpf, fornecedor_id, telefone, email, endereco, data_admissao } = req.body;
            if (!nome_monitor || !cpf || !fornecedor_id) {
                return res.status(400).json({ success: false, message: 'Campos obrigatórios não fornecidos.' });
            }

            let documentoPessoalPath = null;
            let certificadoCursoPath = null;

            if (req.files['documento_pessoal'] && req.files['documento_pessoal'].length > 0) {
                documentoPessoalPath = 'uploads/' + req.files['documento_pessoal'][0].filename;
            } else {
                return res.status(400).json({ success: false, message: 'Documento pessoal é obrigatório.' });
            }

            if (req.files['certificado_curso'] && req.files['certificado_curso'].length > 0) {
                certificadoCursoPath = 'uploads/' + req.files['certificado_curso'][0].filename;
            }

            const fornecedorResult = await pool.query('SELECT nome_fornecedor FROM fornecedores WHERE id = $1', [
                fornecedor_id
            ]);
            let fornecedorNome =
                fornecedorResult.rows.length > 0 ? fornecedorResult.rows[0].nome_fornecedor : null;

            if (fornecedorNome && fornecedorNome !== 'FUNDO MUNICIPAL DE EDUCAÇÃO DE CANAA DOS CARAJAS') {
                if (!certificadoCursoPath) {
                    return res
                        .status(400)
                        .json({ success: false, message: 'Certificado do curso é obrigatório para monitores de outros fornecedores.' });
                }
            }

            const insertQuery = `
                INSERT INTO monitores (
                    nome_monitor, cpf, fornecedor_id, telefone, email, endereco, data_admissao, documento_pessoal, certificado_curso
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9
                )
                RETURNING id;
            `;
            const values = [
                nome_monitor,
                cpf,
                parseInt(fornecedor_id, 10),
                telefone || null,
                email || null,
                endereco || null,
                data_admissao || null,
                documentoPessoalPath,
                certificadoCursoPath
            ];
            const result = await pool.query(insertQuery, values);
            if (result.rows.length === 0) {
                return res.status(500).json({ success: false, message: 'Erro ao cadastrar monitor.' });
            }
            res.json({ success: true, message: 'Monitor cadastrado com sucesso!' });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
        }
    }
);

app.get('/api/monitores', async (req, res) => {
    try {
        const query = `
            SELECT m.id, m.nome_monitor, m.cpf, m.fornecedor_id, m.telefone, m.email, m.endereco, m.data_admissao,
                m.documento_pessoal, m.certificado_curso,
                fr.nome_fornecedor as fornecedor_nome
            FROM monitores m
            LEFT JOIN fornecedores fr ON fr.id = m.fornecedor_id
            ORDER BY m.id;
        `;
        const result = await pool.query(query);
        const monitores = result.rows.map((row) => ({
            id: row.id,
            nome_monitor: row.nome_monitor,
            cpf: row.cpf,
            fornecedor_id: row.fornecedor_id,
            telefone: row.telefone,
            email: row.email,
            endereco: row.endereco,
            data_admissao: row.data_admissao,
            documento_pessoal: row.documento_pessoal,
            certificado_curso: row.certificado_curso,
            fornecedor_nome: row.fornecedor_nome
        }));
        res.json(monitores);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.delete('/api/monitores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteQuery = 'DELETE FROM monitores WHERE id = $1';
        const result = await pool.query(deleteQuery, [id]);
        if (result.rowCount > 0) {
            res.json({ success: true, message: 'Monitor excluído com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Monitor não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

// ====================================================================================
//                              MOTORISTAS
// ====================================================================================

app.get('/api/motoristas', async (req, res) => {
    try {
        const query = `
            SELECT m.id,
                m.nome_motorista,
                m.cpf,
                m.rg,
                m.data_nascimento,
                m.telefone,
                m.email,
                m.endereco,
                m.cidade,
                m.estado,
                m.cep,
                m.numero_cnh,
                m.categoria_cnh,
                m.validade_cnh,
                m.fornecedor_id,
                m.cnh_pdf,
                m.cert_transporte_escolar,
                m.cert_transporte_passageiros,
                m.data_validade_transporte_escolar,
                m.data_validade_transporte_passageiros,
                fr.nome_fornecedor
            FROM motoristas m
            LEFT JOIN fornecedores fr ON fr.id = m.fornecedor_id
            ORDER BY m.id;
        `;
        const result = await pool.query(query);
        const hoje = new Date();
        const trintaDiasDepois = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000);

        const motoristas = result.rows.map((row) => {
            let statusEscolar = 'OK';
            let statusPassageiros = 'OK';

            if (row.data_validade_transporte_escolar) {
                const validadeEscolar = new Date(row.data_validade_transporte_escolar);
                if (validadeEscolar < hoje) {
                    statusEscolar = 'Vencido';
                } else if (validadeEscolar < trintaDiasDepois) {
                    statusEscolar = 'Próximo do vencimento';
                }
            }

            if (row.data_validade_transporte_passageiros) {
                const validadePassageiros = new Date(row.data_validade_transporte_passageiros);
                if (validadePassageiros < hoje) {
                    statusPassageiros = 'Vencido';
                } else if (validadePassageiros < trintaDiasDepois) {
                    statusPassageiros = 'Próximo do vencimento';
                }
            }

            return {
                id: row.id,
                nome_motorista: row.nome_motorista,
                cpf: row.cpf,
                rg: row.rg,
                data_nascimento: row.data_nascimento,
                telefone: row.telefone,
                email: row.email,
                endereco: row.endereco,
                cidade: row.cidade,
                estado: row.estado,
                cep: row.cep,
                numero_cnh: row.numero_cnh,
                categoria_cnh: row.categoria_cnh,
                validade_cnh: row.validade_cnh,
                fornecedor_id: row.fornecedor_id,
                cnh_pdf: row.cnh_pdf,
                cert_transporte_escolar: row.cert_transporte_escolar,
                cert_transporte_passageiros: row.cert_transporte_passageiros,
                data_validade_transporte_escolar: row.data_validade_transporte_escolar,
                data_validade_transporte_passageiros: row.data_validade_transporte_passageiros,
                fornecedor_nome: row.nome_fornecedor,
                status_cert_escolar: statusEscolar,
                status_cert_passageiros: statusPassageiros
            };
        });
        res.json(motoristas);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.post(
    '/api/motoristas/cadastrar',
    uploadFrota.fields([
        { name: 'cnh_pdf', maxCount: 1 },
        { name: 'cert_transporte_escolar', maxCount: 1 },
        { name: 'cert_transporte_passageiros', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const {
                nome_motorista,
                cpf,
                rg,
                data_nascimento,
                telefone,
                email,
                endereco,
                cidade,
                estado,
                cep,
                numero_cnh,
                categoria_cnh,
                validade_cnh,
                fornecedor_id,
                data_validade_transporte_escolar,
                data_validade_transporte_passageiros
            } = req.body;

            if (!nome_motorista || !cpf || !numero_cnh || !categoria_cnh || !validade_cnh || !fornecedor_id) {
                return res.status(400).json({ success: false, message: 'Campos obrigatórios não fornecidos.' });
            }

            let cnhPdfPath = null;
            let certTransporteEscolarPath = null;
            let certTransportePassageirosPath = null;

            if (req.files['cnh_pdf'] && req.files['cnh_pdf'].length > 0) {
                cnhPdfPath = 'uploads/' + req.files['cnh_pdf'][0].filename;
            } else {
                return res.status(400).json({ success: false, message: 'CNH é obrigatória.' });
            }
            if (req.files['cert_transporte_escolar'] && req.files['cert_transporte_escolar'].length > 0) {
                certTransporteEscolarPath = 'uploads/' + req.files['cert_transporte_escolar'][0].filename;
            }
            if (req.files['cert_transporte_passageiros'] && req.files['cert_transporte_passageiros'].length > 0) {
                certTransportePassageirosPath = 'uploads/' + req.files['cert_transporte_passageiros'][0].filename;
            }

            const fornecedorResult = await pool.query('SELECT nome_fornecedor FROM fornecedores WHERE id = $1', [
                fornecedor_id
            ]);
            let fornecedorNome =
                fornecedorResult.rows.length > 0 ? fornecedorResult.rows[0].nome_fornecedor : null;

            if (fornecedorNome && fornecedorNome !== 'FUNDO MUNICIPAL DE EDUCAÇÃO DE CANAA DOS CARAJAS') {
                if (!certTransporteEscolarPath) {
                    return res
                        .status(400)
                        .json({ success: false, message: 'Certificado de transporte escolar é obrigatório para este fornecedor.' });
                }
                if (!certTransportePassageirosPath) {
                    return res
                        .status(400)
                        .json({ success: false, message: 'Certificado de transporte de passageiros é obrigatório para este fornecedor.' });
                }
            }

            const insertQuery = `
                INSERT INTO motoristas (
                    nome_motorista, cpf, rg, data_nascimento, telefone, email, endereco, cidade, estado, cep,
                    numero_cnh, categoria_cnh, validade_cnh, fornecedor_id,
                    cnh_pdf, cert_transporte_escolar, cert_transporte_passageiros, data_validade_transporte_escolar, data_validade_transporte_passageiros
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14,
                    $15, $16, $17, $18, $19
                )
                RETURNING id;
            `;
            const values = [
                nome_motorista,
                cpf,
                rg || null,
                data_nascimento || null,
                telefone || null,
                email || null,
                endereco || null,
                cidade || null,
                estado || null,
                cep || null,
                numero_cnh,
                categoria_cnh,
                validade_cnh,
                parseInt(fornecedor_id, 10),
                cnhPdfPath,
                certTransporteEscolarPath,
                certTransportePassageirosPath,
                data_validade_transporte_escolar || null,
                data_validade_transporte_passageiros || null
            ];
            const result = await pool.query(insertQuery, values);
            if (result.rows.length === 0) {
                return res.status(500).json({ success: false, message: 'Erro ao cadastrar motorista.' });
            }
            res.json({ success: true, message: 'Motorista cadastrado com sucesso!' });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
        }
    }
);

app.get('/api/motoristas/download/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const query = `
            SELECT cnh_pdf, cert_transporte_escolar, cert_transporte_passageiros
            FROM motoristas
            WHERE id = $1;
        `;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Motorista não encontrado.' });
        }
        const motorista = result.rows[0];
        let filePath = null;

        switch (type) {
            case 'cnh':
                filePath = motorista.cnh_pdf;
                break;
            case 'escolar':
                filePath = motorista.cert_transporte_escolar;
                break;
            case 'passageiros':
                filePath = motorista.cert_transporte_passageiros;
                break;
            default:
                return res.status(400).json({ success: false, message: 'Tipo de documento inválido.' });
        }

        if (!filePath) {
            return res
                .status(404)
                .json({ success: false, message: 'Documento não encontrado para este motorista.' });
        }

        const absolutePath = path.join(__dirname, filePath);
        if (!fs.existsSync(absolutePath)) {
            return res
                .status(404)
                .json({ success: false, message: 'Arquivo não encontrado no servidor.' });
        }
        res.download(absolutePath);
    } catch (error) {
        res
            .status(500)
            .json({ success: false, message: 'Erro interno do servidor ao tentar baixar o arquivo.' });
    }
});

app.get('/api/motoristas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const numericId = parseInt(id, 10);
        if (isNaN(numericId)) {
            return res.status(400).json({ success: false, message: 'ID inválido' });
        }
        const query = `SELECT * FROM motoristas WHERE id = $1`;
        const result = await pool.query(query, [numericId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Motorista não encontrado' });
        }
        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao buscar motorista:', error);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
});

// ====================================================================================
//                              LOGIN / CHECK CPF / DEFINIR SENHA
// ====================================================================================

app.post('/api/motoristas/login', async (req, res) => {
    try {
        const { cpf, senha } = req.body;
        if (!cpf) {
            return res.status(400).json({ success: false, message: 'CPF é obrigatório' });
        }

        const queryMotorista = 'SELECT id, senha FROM motoristas WHERE cpf = $1 LIMIT 1';
        const result = await pool.query(queryMotorista, [cpf]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Motorista não encontrado' });
        }

        const motorista = result.rows[0];
        if (!motorista.senha) {
            return res.status(200).json({
                success: false,
                needsPassword: true,
                message: 'Senha não cadastrada'
            });
        }

        if (!senha) {
            return res.status(400).json({
                success: false,
                message: 'Informe a senha'
            });
        }

        if (motorista.senha !== senha) {
            return res.status(401).json({ success: false, message: 'Senha incorreta' });
        }

        return res.status(200).json({
            success: true,
            message: 'Login realizado com sucesso',
            motoristaId: motorista.id
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
});

app.post('/api/motoristas/definir-senha', async (req, res) => {
    try {
        const { cpf, novaSenha } = req.body;
        if (!cpf || !novaSenha) {
            return res.status(400).json({ success: false, message: 'CPF e novaSenha são obrigatórios' });
        }
        const queryMotorista = 'SELECT id FROM motoristas WHERE cpf = $1 LIMIT 1';
        const result = await pool.query(queryMotorista, [cpf]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Motorista não encontrado' });
        }
        const updateQuery = 'UPDATE motoristas SET senha = $1 WHERE cpf = $2';
        await pool.query(updateQuery, [novaSenha, cpf]);

        return res.status(200).json({
            success: true,
            message: 'Senha definida com sucesso'
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
});

app.post('/api/motoristas/check-cpf', async (req, res) => {
    try {
        const { cpf } = req.body;
        if (!cpf) {
            return res.status(400).json({ success: false, message: 'CPF é obrigatório' });
        }
        const queryMotorista = 'SELECT id, senha FROM motoristas WHERE cpf = $1 LIMIT 1';
        const result = await pool.query(queryMotorista, [cpf]);
        if (result.rows.length === 0) {
            return res.json({ found: false, hasPassword: false });
        }
        const { senha } = result.rows[0];
        return res.json({
            found: true,
            hasPassword: !!senha
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
});

// ====================================================================================
//                              PONTOS DE PARADA
// ====================================================================================

app.post('/api/pontos/cadastrar', async (req, res) => {
    try {
        const {
            latitudePonto,
            longitudePonto,
            area,
            nomePonto,
            logradouroPonto,
            numeroPonto,
            complementoPonto,
            pontoReferenciaPonto,
            bairroPonto,
            cepPonto
        } = req.body;

        const zoneamentosPonto = JSON.parse(req.body.zoneamentosPonto || '[]');

        const insertPontoQuery = `
            INSERT INTO pontos (
                nome_ponto, latitude, longitude, area, logradouro, numero, complemento, ponto_referencia, bairro, cep
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            )
            RETURNING id;
        `;
        const values = [
            nomePonto,
            latitudePonto ? parseFloat(latitudePonto) : null,
            longitudePonto ? parseFloat(longitudePonto) : null,
            area,
            logradouroPonto || null,
            numeroPonto || null,
            complementoPonto || null,
            pontoReferenciaPonto || null,
            bairroPonto || null,
            cepPonto || null
        ];
        const result = await pool.query(insertPontoQuery, values);
        if (result.rows.length === 0) {
            return res.status(500).json({ success: false, message: 'Erro ao cadastrar ponto.' });
        }
        const pontoId = result.rows[0].id;

        if (zoneamentosPonto.length > 0) {
            const insertZonaPontoQuery = `
                INSERT INTO pontos_zoneamentos (ponto_id, zoneamento_id)
                VALUES ($1, $2);
            `;
            for (const zid of zoneamentosPonto) {
                await pool.query(insertZonaPontoQuery, [pontoId, zid]);
            }
        }
        res.json({ success: true, message: 'Ponto de parada cadastrado com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/api/pontos', async (req, res) => {
    try {
        const query = `
            SELECT p.id, p.nome_ponto, p.latitude, p.longitude, p.area,
                p.logradouro, p.numero, p.complemento, p.ponto_referencia,
                p.bairro, p.cep,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', z.id,
                            'nome', z.nome
                        )
                    ) FILTER (WHERE z.id IS NOT NULL),
                    '[]'
                ) AS zoneamentos
            FROM pontos p
            LEFT JOIN pontos_zoneamentos pz ON pz.ponto_id = p.id
            LEFT JOIN zoneamentos z ON z.id = pz.zoneamento_id
            GROUP BY p.id
            ORDER BY p.id;
        `;
        const result = await pool.query(query);
        const pontos = result.rows.map((row) => ({
            id: row.id,
            nome_ponto: row.nome_ponto,
            latitude: row.latitude,
            longitude: row.longitude,
            area: row.area,
            logradouro: row.logradouro,
            numero: row.numero,
            complemento: row.complemento,
            ponto_referencia: row.ponto_referencia,
            bairro: row.bairro,
            cep: row.cep,
            zoneamentos: row.zoneamentos
        }));
        res.json(pontos);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.delete('/api/pontos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteQuery = 'DELETE FROM pontos WHERE id = $1';
        const result = await pool.query(deleteQuery, [id]);
        if (result.rowCount > 0) {
            res.json({ success: true, message: 'Ponto excluído com sucesso!' });
        } else {
            res.status(404).json({ success: false, message: 'Ponto não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

// ====================================================================================
//                              ROTAS SIMPLES
// ====================================================================================

app.post('/api/rotas/cadastrar-simples', async (req, res) => {
    try {
        const {
            identificador,
            descricao,
            partidaLat,
            partidaLng,
            chegadaLat,
            chegadaLng,
            pontosParada,
            escolas,
            areaZona
        } = req.body;

        if (!identificador || !descricao || partidaLat == null || partidaLng == null || !areaZona) {
            return res.status(400).json({ success: false, message: 'Dados incompletos.' });
        }

        const insertRotaQuery = `
            INSERT INTO rotas_simples
            (identificador, descricao, partida_lat, partida_lng, chegada_lat, chegada_lng, area_zona)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id;
        `;
        const rotaValues = [
            identificador,
            descricao,
            partidaLat,
            partidaLng,
            chegadaLat,
            chegadaLng,
            areaZona
        ];
        const rotaResult = await pool.query(insertRotaQuery, rotaValues);
        if (rotaResult.rows.length === 0) {
            return res.status(500).json({ success: false, message: 'Falha ao cadastrar rota.' });
        }
        const rotaId = rotaResult.rows[0].id;

        if (pontosParada && Array.isArray(pontosParada)) {
            const insertPontoQuery = `
                INSERT INTO rotas_pontos (rota_id, ponto_id)
                VALUES ($1, $2);
            `;
            for (const pId of pontosParada) {
                await pool.query(insertPontoQuery, [rotaId, pId]);
            }
        }

        if (escolas && Array.isArray(escolas)) {
            const insertEscolaQuery = `
                INSERT INTO rotas_escolas (rota_id, escola_id)
                VALUES ($1, $2);
            `;
            for (const eId of escolas) {
                await pool.query(insertEscolaQuery, [rotaId, eId]);
            }
        }
        res.json({ success: true, message: 'Rota cadastrada com sucesso!', id: rotaId });
    } catch (error) {
        console.error('Erro ao cadastrar rota simples:', error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/api/estatisticas-transporte', async (req, res) => {
    try {
        // Vamos gerar arrays para cada mês do ano
        const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        // Arrays que irão conter a contagem de rotas
        const totalRotasPorMes = new Array(12).fill(0);
        const rotasUrbanaPorMes = new Array(12).fill(0);
        const rotasRuralPorMes = new Array(12).fill(0);

        const query = `
          SELECT
            EXTRACT(MONTH FROM created_at)::int AS mes,
            area_zona,
            COUNT(*) AS total
          FROM rotas_simples
          GROUP BY 1, area_zona
          ORDER BY 1;
        `;

        const { rows } = await pool.query(query);

        // Preenche os valores em cada array
        rows.forEach((item) => {
            const mesIndex = item.mes - 1;
            const zona = item.area_zona;
            const qtd = parseInt(item.total, 10);

            totalRotasPorMes[mesIndex] += qtd;
            if (zona === 'URBANA') {
                rotasUrbanaPorMes[mesIndex] = qtd;
            } else if (zona === 'RURAL') {
                rotasRuralPorMes[mesIndex] = qtd;
            }
        });

        return res.json({
            periodo: meses,
            totalRotas: totalRotasPorMes,
            rotasUrbana: rotasUrbanaPorMes,
            rotasRural: rotasRuralPorMes,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.get('/api/rotas_simples', async (req, res) => {
    try {
        const query = `
            SELECT 
                id,
                identificador,
                descricao,
                partida_lat AS "partidaLat",
                partida_lng AS "partidaLng",
                chegada_lat AS "chegadaLat",
                chegada_lng AS "chegadaLng"
            FROM rotas_simples
            ORDER BY id;
        `;
        const result = await pool.query(query);
        return res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar rotas:', error);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/api/rotas_simples/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const rotaQuery = `
            SELECT 
                id,
                partida_lat AS "partidaLat",
                partida_lng AS "partidaLng",
                chegada_lat AS "chegadaLat",
                chegada_lng AS "chegadaLng"
            FROM rotas_simples
            WHERE id = $1
            LIMIT 1;
        `;
        const rotaResult = await pool.query(rotaQuery, [id]);
        if (rotaResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Rota não encontrada.' });
        }
        const rota = rotaResult.rows[0];

        const pontosParadaQuery = `
            SELECT p.id, p.nome_ponto, p.latitude, p.longitude
            FROM rotas_pontos rp
            JOIN pontos p ON p.id = rp.ponto_id
            WHERE rp.rota_id = $1;
        `;
        const pontosResult = await pool.query(pontosParadaQuery, [id]);

        const escolasQuery = `
            SELECT e.id, e.nome, e.latitude, e.longitude
            FROM rotas_escolas re
            JOIN escolas e ON e.id = re.escola_id
            WHERE re.rota_id = $1;
        `;
        const escolasResult = await pool.query(escolasQuery, [id]);

        const detalhesRota = {
            partidaLat: rota.partidaLat,
            partidaLng: rota.partidaLng,
            chegadaLat: rota.chegadaLat,
            chegadaLng: rota.chegadaLng,
            pontosParada: pontosResult.rows.map((r) => ({
                id: r.id,
                nome_ponto: r.nome_ponto,
                latitude: r.latitude,
                longitude: r.longitude
            })),
            escolas: escolasResult.rows.map((r) => ({
                id: r.id,
                nome: r.nome,
                latitude: r.latitude,
                longitude: r.longitude
            }))
        };
        res.json(detalhesRota);
    } catch (error) {
        console.error('Erro ao buscar detalhes da rota:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao buscar detalhes da rota.' });
    }
});

// ====================================================================================
//                              RELACIONAMENTOS: MOTORISTAS / MONITORES -> ROTAS
// ====================================================================================

app.post('/api/motoristas/atribuir-rota', async (req, res) => {
    try {
        const { motorista_id, rota_id } = req.body;
        if (!motorista_id || !rota_id) {
            return res.status(400).json({
                success: false,
                message: 'Parâmetros motorista_id e rota_id são obrigatórios.'
            });
        }
        const insertQuery = `
            INSERT INTO motoristas_rotas (motorista_id, rota_id)
            VALUES ($1, $2)
            RETURNING id;
        `;
        const result = await pool.query(insertQuery, [motorista_id, rota_id]);
        if (result.rowCount > 0) {
            return res.json({
                success: true,
                message: 'Rota atribuída com sucesso!'
            });
        } else {
            return res.status(500).json({
                success: false,
                message: 'Não foi possível atribuir a rota.'
            });
        }
    } catch (error) {
        console.error('Erro ao atribuir rota:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro interno do servidor ao atribuir rota.'
        });
    }
});

app.post('/api/monitores/atribuir-rota', async (req, res) => {
    const { monitor_id, rota_id } = req.body;
    try {
        await pool.query(
            'INSERT INTO monitores_rotas (monitor_id, rota_id) VALUES ($1, $2)',
            [monitor_id, rota_id]
        );
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// ====================================================================================
//                              ROTA DE MOTORISTAS -> PONTOS/ESCOLAS
// ====================================================================================

app.get('/api/motoristas/rota', async (req, res) => {
    try {
        const { motoristaId } = req.query;
        if (!motoristaId) {
            return res.status(400).json({ success: false, message: 'motoristaId é obrigatório' });
        }
        const rotaIdQuery = `
            SELECT rota_id
            FROM motoristas_rotas
            WHERE motorista_id = $1
            LIMIT 1;
        `;
        const rotaIdResult = await pool.query(rotaIdQuery, [motoristaId]);
        if (rotaIdResult.rows.length === 0) {
            return res.json({ success: true, message: 'Nenhuma rota encontrada', pontos: [] });
        }
        const rotaId = rotaIdResult.rows[0].rota_id;

        const rotaDadosQuery = `
            SELECT
                partida_lat,
                partida_lng,
                chegada_lat,
                chegada_lng
            FROM rotas_simples
            WHERE id = $1
            LIMIT 1;
        `;
        const rotaDadosRes = await pool.query(rotaDadosQuery, [rotaId]);
        if (rotaDadosRes.rows.length === 0) {
            return res.json({ success: true, message: 'Rota não encontrada', pontos: [] });
        }
        const rd = rotaDadosRes.rows[0];

        const pontosQuery = `
            SELECT p.latitude, p.longitude
            FROM rotas_pontos rp
            JOIN pontos p ON p.id = rp.ponto_id
            WHERE rp.rota_id = $1
            ORDER BY rp.id;
        `;
        const pontosRes = await pool.query(pontosQuery, [rotaId]);
        const pontosParada = pontosRes.rows.map((row) => ({
            lat: row.latitude ? parseFloat(row.latitude) : 0,
            lng: row.longitude ? parseFloat(row.longitude) : 0,
        }));

        const escolasQuery = `
            SELECT e.latitude, e.longitude
            FROM rotas_escolas re
            JOIN escolas e ON e.id = re.escola_id
            WHERE re.rota_id = $1
            ORDER BY re.id;
        `;
        const escolasRes = await pool.query(escolasQuery, [rotaId]);
        const escolasPontos = escolasRes.rows.map((row) => ({
            lat: row.latitude ? parseFloat(row.latitude) : 0,
            lng: row.longitude ? parseFloat(row.longitude) : 0,
        }));

        const listaPontos = [];
        if (rd.partida_lat != null && rd.partida_lng != null) {
            listaPontos.push({
                lat: parseFloat(rd.partida_lat),
                lng: parseFloat(rd.partida_lng),
            });
        }
        listaPontos.push(...pontosParada);
        listaPontos.push(...escolasPontos);
        if (rd.chegada_lat != null && rd.chegada_lng != null) {
            listaPontos.push({
                lat: parseFloat(rd.chegada_lat),
                lng: parseFloat(rd.chegada_lng),
            });
        }
        return res.json({
            success: true,
            message: 'Rota carregada com sucesso',
            pontos: listaPontos,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: 'Erro interno ao buscar rota' });
    }
});

// ====================================================================================
//                              OUTRAS INFORMAÇÕES (DASHBOARD, ESCOLA COORDENADAS, ETC.)
// ====================================================================================

app.get('/api/dashboard', async (req, res) => {
    try {
        // Exemplos de SELECT que você já tem
        const alunosAtivos = await pool.query('SELECT COUNT(*)::int as count FROM alunos WHERE ativo = TRUE');
        const rotasAtivas = await pool.query('SELECT COUNT(*)::int as count FROM rotas WHERE ativa = TRUE');
        const viagensAgendadas = await pool.query('SELECT COUNT(*)::int as count FROM viagens WHERE agendada = TRUE');

        // EXEMPLOS DE NOVAS CONSULTAS:
        // (A) Contar Zoneamentos
        const zoneamentosCount = await pool.query('SELECT COUNT(*)::int as count FROM zoneamentos');

        // (B) Contar Monitores
        const monitoresCount = await pool.query('SELECT COUNT(*)::int as count FROM monitores');

        // (C) Contar Motoristas
        const motoristasCount = await pool.query('SELECT COUNT(*)::int as count FROM motoristas');

        // (D) Contar Fornecedores
        const fornecedoresCount = await pool.query('SELECT COUNT(*)::int as count FROM fornecedores');

        // Exemplo de dados fixos
        const quilometragemEstimada = 12345;
        const alunosAtivosPercent = '+5% desde a última semana';
        const rotasAtivasPercent = '+3% desde a última semana';
        const quilometragemEstimadaPercent = '+2% desde a última semana';
        const viagensAgendadasPercent = '+4% desde a última semana';
        const receitaDiaria = '4.578,58';
        const veiculosOperacao = 17;
        const veiculosOperacaoPercent = 5;

        const geolocalizacao = [
            { flag: 'br.png', nome: 'Brasil', valor: 640, percentual: 11.63 },
            { flag: 'pt.png', nome: 'Portugal', valor: 120, percentual: 2.16 },
        ];
        const novosAlunos = [
            { nome: 'Jimmy Denis', curso: 'Estudante de Matemática', imagem: '../../assets/img/jm_denis.jpg' },
        ];
        const quilometragem = [
            { veiculo: 'Ônibus 01', atual: 15000, estimada: 20000, status: 'OK', status_classe: 'success' },
        ];

        res.json({
            alunos_ativos: alunosAtivos.rows[0]?.count || 0,
            alunos_ativos_percent: alunosAtivosPercent,

            rotas_ativas: rotasAtivas.rows[0]?.count || 0,
            rotas_ativas_percent: rotasAtivasPercent,

            quilometragem_estimada: quilometragemEstimada,
            quilometragem_estimada_percent: quilometragemEstimadaPercent,

            viagens_agendadas: viagensAgendadas.rows[0]?.count || 0,
            viagens_agendadas_percent: viagensAgendadasPercent,

            receita_diaria: receitaDiaria,
            veiculos_operacao: veiculosOperacao,
            veiculos_operacao_percent: veiculosOperacaoPercent,

            zoneamentos_total: zoneamentosCount.rows[0]?.count || 0,
            zoneamentos_total_percent: '+2% desde a última semana',

            monitores_total: monitoresCount.rows[0]?.count || 0,
            monitores_total_percent: '+1% desde a última semana',

            motoristas_total: motoristasCount.rows[0]?.count || 0,
            motoristas_total_percent: '+3% desde a última semana',

            fornecedores_total: fornecedoresCount.rows[0]?.count || 0,
            fornecedores_total_percent: '+4% desde a última semana',

            geolocalizacao,
            novos_alunos: novosAlunos,
            quilometragem
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/api/escola-coordenadas', async (req, res) => {
    const escolaId = req.query.escola_id;
    if (!escolaId) {
        return res.status(400).json({ error: 'escola_id não fornecido' });
    }
    try {
        const result = await pool.query('SELECT latitude, longitude FROM escolas WHERE id = $1', [escolaId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Escola não encontrada' });
        }
        const { latitude, longitude } = result.rows[0];
        if (latitude == null || longitude == null) {
            return res.status(404).json({ error: 'Coordenadas não encontradas para esta escola' });
        }
        res.json({ latitude: parseFloat(latitude), longitude: parseFloat(longitude) });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ====================================================================================
//                              DOWNLOAD DE ROTAS (KML, KMZ, GPX)
// ====================================================================================

app.get('/api/download-rotas-todas', async (req, res) => {
    try {
        const { format } = req.query;
        if (!format || !['kml', 'kmz', 'gpx'].includes(format.toLowerCase())) {
            return res.status(400).send('Formato inválido. Use kml, kmz ou gpx.');
        }

        const rotasQuery = `
            SELECT 
                rs.id,
                rs.identificador,
                rs.descricao,
                rs.partida_lat,
                rs.partida_lng,
                rs.chegada_lat,
                rs.chegada_lng,
                COALESCE(json_agg(
                    json_build_object(
                        'id', p.id,
                        'latitude', p.latitude,
                        'longitude', p.longitude
                    )
                ) FILTER (WHERE p.id IS NOT NULL), '[]') as pontos,
                COALESCE(json_agg(
                    json_build_object(
                        'id', e.id,
                        'latitude', e.latitude,
                        'longitude', e.longitude
                    )
                ) FILTER (WHERE e.id IS NOT NULL), '[]') as escolas
            FROM rotas_simples rs
            LEFT JOIN rotas_pontos rp ON rp.rota_id = rs.id
            LEFT JOIN pontos p ON p.id = rp.ponto_id
            LEFT JOIN rotas_escolas re ON re.rota_id = rs.id
            LEFT JOIN escolas e ON e.id = re.escola_id
            GROUP BY rs.id
            ORDER BY rs.id;
        `;
        const result = await pool.query(rotasQuery);
        if (result.rows.length === 0) {
            return res.status(404).send('Nenhuma rota encontrada.');
        }

        let features = [];
        result.rows.forEach((r) => {
            const coords = [];
            if (r.partida_lat != null && r.partida_lng != null) {
                coords.push([parseFloat(r.partida_lng), parseFloat(r.partida_lat)]);
            }
            const pontos = r.pontos || [];
            pontos.forEach((pt) => {
                if (pt.latitude != null && pt.longitude != null) {
                    coords.push([parseFloat(pt.longitude), parseFloat(pt.latitude)]);
                }
            });
            const escolas = r.escolas || [];
            escolas.forEach((es) => {
                if (es.latitude != null && es.longitude != null) {
                    coords.push([parseFloat(es.longitude), parseFloat(es.latitude)]);
                }
            });
            if (r.chegada_lat != null && r.chegada_lng != null) {
                coords.push([parseFloat(r.chegada_lng), parseFloat(r.chegada_lat)]);
            }
            if (coords.length < 2) {
                return;
            }
            features.push({
                type: 'Feature',
                properties: {
                    id: r.id,
                    identificador: r.identificador,
                    descricao: r.descricao
                },
                geometry: {
                    type: 'LineString',
                    coordinates: coords
                }
            });
        });

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        const lowerFmt = format.toLowerCase();

        if (lowerFmt === 'kml') {
            const kmlStr = geojsonToKml(geojson);
            res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
            res.setHeader('Content-Disposition', 'attachment; filename="todas_rotas.kml"');
            return res.send(kmlStr);
        }

        if (lowerFmt === 'kmz') {
            const kmlStr = geojsonToKml(geojson);
            res.setHeader('Content-Type', 'application/vnd.google-earth.kmz');
            res.setHeader('Content-Disposition', 'attachment; filename="todas_rotas.kmz"');
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.on('error', (err) => {
                throw err;
            });
            res.on('close', () => { });
            archive.pipe(res);
            archive.append(kmlStr, { name: 'doc.kml' });
            archive.finalize();
            return;
        }

        if (lowerFmt === 'gpx') {
            const gpxStr = geojsonToGpx(geojson);
            res.setHeader('Content-Type', 'application/gpx+xml');
            res.setHeader('Content-Disposition', 'attachment; filename="todas_rotas.gpx"');
            return res.send(gpxStr);
        }
        return res.status(400).send('Formato inválido');
    } catch (error) {
        console.error('Erro ao gerar download de todas as rotas:', error);
        res.status(500).send('Erro ao gerar download de todas as rotas.');
    }
});

app.get('/api/download-rota/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { format } = req.query;
        if (!format || !['kml', 'kmz', 'gpx'].includes(format.toLowerCase())) {
            return res.status(400).send('Formato inválido. Use kml, kmz ou gpx.');
        }

        const rotaQuery = `
            SELECT 
                rs.id,
                rs.identificador,
                rs.descricao,
                rs.partida_lat,
                rs.partida_lng,
                rs.chegada_lat,
                rs.chegada_lng,
                COALESCE(json_agg(
                    json_build_object(
                        'id', p.id,
                        'latitude', p.latitude,
                        'longitude', p.longitude
                    )
                ) FILTER (WHERE p.id IS NOT NULL), '[]') as pontos,
                COALESCE(json_agg(
                    json_build_object(
                        'id', e.id,
                        'latitude', e.latitude,
                        'longitude', e.longitude
                    )
                ) FILTER (WHERE e.id IS NOT NULL), '[]') as escolas
            FROM rotas_simples rs
            LEFT JOIN rotas_pontos rp ON rp.rota_id = rs.id
            LEFT JOIN pontos p ON p.id = rp.ponto_id
            LEFT JOIN rotas_escolas re ON re.rota_id = rs.id
            LEFT JOIN escolas e ON e.id = re.escola_id
            WHERE rs.id = $1
            GROUP BY rs.id
            LIMIT 1;
        `;
        const result = await pool.query(rotaQuery, [id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Rota não encontrada.');
        }

        const r = result.rows[0];
        const coords = [];
        if (r.partida_lat != null && r.partida_lng != null) {
            coords.push([parseFloat(r.partida_lng), parseFloat(r.partida_lat)]);
        }
        const pontos = r.pontos || [];
        pontos.forEach((pt) => {
            if (pt.latitude != null && pt.longitude != null) {
                coords.push([parseFloat(pt.longitude), parseFloat(pt.latitude)]);
            }
        });
        const escolas = r.escolas || [];
        escolas.forEach((es) => {
            if (es.latitude != null && es.longitude != null) {
                coords.push([parseFloat(es.longitude), parseFloat(es.latitude)]);
            }
        });
        if (r.chegada_lat != null && r.chegada_lng != null) {
            coords.push([parseFloat(r.chegada_lng), parseFloat(r.chegada_lat)]);
        }

        if (coords.length < 2) {
            return res.status(400).send('Esta rota não possui pontos suficientes.');
        }

        const feature = {
            type: 'Feature',
            properties: {
                id: r.id,
                identificador: r.identificador,
                descricao: r.descricao
            },
            geometry: {
                type: 'LineString',
                coordinates: coords
            }
        };
        const geojson = {
            type: 'FeatureCollection',
            features: [feature]
        };
        const lowerFmt = format.toLowerCase();

        if (lowerFmt === 'kml') {
            const kmlStr = geojsonToKml(geojson);
            res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
            res.setHeader('Content-Disposition', `attachment; filename="rota_${r.id}.kml"`);
            return res.send(kmlStr);
        } else if (lowerFmt === 'kmz') {
            const kmlStr = geojsonToKml(geojson);
            res.setHeader('Content-Type', 'application/vnd.google-earth.kmz');
            res.setHeader('Content-Disposition', `attachment; filename="rota_${r.id}.kmz"`);
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.on('error', (err) => {
                throw err;
            });
            res.on('close', () => { });
            archive.pipe(res);
            archive.append(kmlStr, { name: 'doc.kml' });
            archive.finalize();
            return;
        } else if (lowerFmt === 'gpx') {
            const gpxStr = geojsonToGpx(geojson);
            res.setHeader('Content-Type', 'application/gpx+xml');
            res.setHeader('Content-Disposition', `attachment; filename="rota_${r.id}.gpx"`);
            return res.send(gpxStr);
        } else {
            return res.status(400).send('Formato inválido.');
        }
    } catch (error) {
        console.error('Erro ao gerar download da rota específica:', error);
        res.status(500).send('Erro interno ao gerar download da rota específica.');
    }
});

function geojsonToKml(geojson) {
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>`;
    geojson.features.forEach((f, idx) => {
        const coords = f.geometry.coordinates.map((c) => c[0] + ',' + c[1]).join(' ');
        kml += `
    <Placemark>
        <name>Rota ${f.properties.identificador || idx}</name>
        <description>${f.properties.descricao || ''}</description>
        <LineString>
            <coordinates>${coords}</coordinates>
        </LineString>
    </Placemark>`;
    });
    kml += '\n</Document>\n</kml>';
    return kml;
}

function geojsonToGpx(geojson) {
    let gpx = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
    <gpx version="1.1" creator="MyServer">
    `;
    geojson.features.forEach((f, idx) => {
        gpx += `<trk><name>Rota ${f.properties.identificador || idx}</name><trkseg>`;
        f.geometry.coordinates.forEach((c) => {
            gpx += `<trkpt lat="${c[1]}" lon="${c[0]}"></trkpt>`;
        });
        gpx += `</trkseg></trk>\n`;
    });
    gpx += '</gpx>';
    return gpx;
}

// ====================================================================================
//                              ROTAS SIMPLES DETALHADAS
// ====================================================================================

app.get('/api/rotas-simples-detalhes', async (req, res) => {
    try {
        const query = `
            WITH re AS (
                SELECT 
                    r.id AS rota_id,
                    r.identificador,
                    r.descricao,
                    r.area_zona,
                    
                    array_agg(DISTINCT p.id) FILTER (WHERE p.id IS NOT NULL) AS pontos_ids,
                    array_agg(DISTINCT p.nome_ponto) FILTER (WHERE p.id IS NOT NULL) AS pontos_nomes,
                    
                    array_agg(DISTINCT z.id) FILTER (WHERE z.id IS NOT NULL) AS zoneamentos_ids,
                    array_agg(DISTINCT z.nome) FILTER (WHERE z.id IS NOT NULL) AS zoneamentos_nomes,
                    
                    array_agg(DISTINCT e.id) FILTER (WHERE e.id IS NOT NULL) AS escolas_ids,
                    array_agg(DISTINCT e.nome) FILTER (WHERE e.id IS NOT NULL) AS escolas_nomes

                FROM rotas_simples r
                LEFT JOIN rotas_pontos rp ON rp.rota_id = r.id
                LEFT JOIN pontos p ON p.id = rp.ponto_id
                LEFT JOIN pontos_zoneamentos pz ON pz.ponto_id = p.id
                LEFT JOIN zoneamentos z ON z.id = pz.zoneamento_id

                LEFT JOIN rotas_escolas re2 ON re2.rota_id = r.id
                LEFT JOIN escolas e ON e.id = re2.escola_id

                GROUP BY r.id
            )
            SELECT 
                rota_id AS id,
                identificador,
                descricao,
                area_zona,
                
                pontos_ids,
                pontos_nomes,
                zoneamentos_ids,
                zoneamentos_nomes,
                escolas_ids,
                escolas_nomes
            FROM re
            ORDER BY rota_id;
        `;

        const result = await pool.query(query);

        const data = result.rows.map((row) => {
            let pontos = [];
            let zoneamentos = [];
            let escolas = [];

            if (row.pontos_ids && row.pontos_ids.length) {
                pontos = row.pontos_ids.map((pid, idx) => ({
                    id: pid,
                    nome_ponto: row.pontos_nomes[idx]
                }));
            }

            if (row.zoneamentos_ids && row.zoneamentos_ids.length) {
                zoneamentos = row.zoneamentos_ids.map((zid, idx) => ({
                    id: zid,
                    nome: row.zoneamentos_nomes[idx]
                }));
            }

            if (row.escolas_ids && row.escolas_ids.length) {
                escolas = row.escolas_ids.map((eid, idx) => ({
                    id: eid,
                    nome: row.escolas_nomes[idx]
                }));
            }

            return {
                id: row.id,
                identificador: row.identificador,
                descricao: row.descricao,
                area_zona: row.area_zona,
                pontos,
                zoneamentos,
                escolas
            };
        });

        return res.json(data);
    } catch (err) {
        console.error('Erro ao buscar rotas detalhadas:', err);
        return res.status(500).json({
            success: false,
            message: 'Erro interno ao buscar rotas detalhadas.'
        });
    }
});

// ====================================================================================
//                              VEÍCULO POR MOTORISTA
// ====================================================================================

app.get('/api/motoristas/veiculo/:motoristaId', async (req, res) => {
    try {
        const { motoristaId } = req.params;
        const query = `
            SELECT f.*
            FROM frota f
            INNER JOIN frota_motoristas fm ON fm.frota_id = f.id
            WHERE fm.motorista_id = $1
            LIMIT 1;
        `;
        const result = await pool.query(query, [motoristaId]);
        if (result.rows.length === 0) {
            return res.json({
                success: false,
                message: 'Nenhum veículo encontrado para este motorista'
            });
        }
        return res.json({
            success: true,
            vehicle: result.rows[0]
        });
    } catch (error) {
        console.error('Erro ao buscar veículo para motorista:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro interno do servidor'
        });
    }
});

// ====================================================================================
//                              CHECKLISTS ÔNIBUS
// ====================================================================================

app.post('/api/checklists_onibus/salvar', async (req, res) => {
    try {
        const {
            motorista_id,
            frota_id,
            data_checklist,
            horario_saida,
            horario_retorno,
            quilometragem_final,
            cnh_valida,
            crlv_atualizado,
            aut_cert_escolar,
            pneus_calibragem,
            pneus_estado,
            pneu_estepe,
            fluido_oleo_motor,
            fluido_freio,
            fluido_radiador,
            fluido_parabrisa,
            freio_pe,
            freio_mao,
            farois,
            lanternas,
            setas,
            luz_freio,
            luz_re,
            iluminacao_interna,
            extintor,
            cintos,
            martelo_emergencia,
            kit_primeiros_socorros,
            lataria_pintura,
            vidros_limpos,
            retrovisores_ok,
            limpador_para_brisa,
            sinalizacao_externa,
            interior_limpo,
            combustivel_suficiente,
            triangulo_sinalizacao,
            macaco_chave_roda,
            material_limpeza,
            acessibilidade,
            obs_saida,
            combustivel_verificar,
            abastecimento,
            pneus_desgaste,
            lataria_avarias,
            interior_limpeza_retorno,
            extintor_retorno,
            cintos_retorno,
            kit_primeiros_socorros_retorno,
            equip_obrigatorio_retorno,
            equip_acessorio_retorno,
            problemas_mecanicos,
            incidentes,
            problema_portas_janelas,
            manutencao_preventiva,
            pronto_prox_dia,
            obs_retorno
        } = req.body;

        const selectQuery = `
            SELECT id FROM checklists_onibus 
            WHERE motorista_id=$1 AND frota_id=$2 AND data_checklist=$3
            LIMIT 1
        `;
        const selectResult = await pool.query(selectQuery, [
            motorista_id,
            frota_id,
            data_checklist
        ]);

        if (selectResult.rows.length > 0) {
            const checklistId = selectResult.rows[0].id;
            const updateQuery = `
                UPDATE checklists_onibus
                SET
                    horario_saida = $1,
                    horario_retorno = $2,
                    quilometragem_final = $3,
                    cnh_valida = $4,
                    crlv_atualizado = $5,
                    aut_cert_escolar = $6,
                    pneus_calibragem = $7,
                    pneus_estado = $8,
                    pneu_estepe = $9,
                    fluido_oleo_motor = $10,
                    fluido_freio = $11,
                    fluido_radiador = $12,
                    fluido_parabrisa = $13,
                    freio_pe = $14,
                    freio_mao = $15,
                    farois = $16,
                    lanternas = $17,
                    setas = $18,
                    luz_freio = $19,
                    luz_re = $20,
                    iluminacao_interna = $21,
                    extintor = $22,
                    cintos = $23,
                    martelo_emergencia = $24,
                    kit_primeiros_socorros = $25,
                    lataria_pintura = $26,
                    vidros_limpos = $27,
                    retrovisores_ok = $28,
                    limpador_para_brisa = $29,
                    sinalizacao_externa = $30,
                    interior_limpo = $31,
                    combustivel_suficiente = $32,
                    triangulo_sinalizacao = $33,
                    macaco_chave_roda = $34,
                    material_limpeza = $35,
                    acessibilidade = $36,
                    obs_saida = $37,
                    combustivel_verificar = $38,
                    abastecimento = $39,
                    pneus_desgaste = $40,
                    lataria_avarias = $41,
                    interior_limpeza_retorno = $42,
                    extintor_retorno = $43,
                    cintos_retorno = $44,
                    kit_primeiros_socorros_retorno = $45,
                    equip_obrigatorio_retorno = $46,
                    equip_acessorio_retorno = $47,
                    problemas_mecanicos = $48,
                    incidentes = $49,
                    problema_portas_janelas = $50,
                    manutencao_preventiva = $51,
                    pronto_prox_dia = $52,
                    obs_retorno = $53
                WHERE id=$54
            `;
            const updateValues = [
                horario_saida || null,
                horario_retorno || null,
                quilometragem_final ? parseInt(quilometragem_final, 10) : null,

                cnh_valida === 'true',
                crlv_atualizado === 'true',
                aut_cert_escolar === 'true',

                pneus_calibragem === 'true',
                pneus_estado === 'true',
                pneu_estepe === 'true',

                fluido_oleo_motor === 'true',
                fluido_freio === 'true',
                fluido_radiador === 'true',
                fluido_parabrisa === 'true',

                freio_pe === 'true',
                freio_mao === 'true',

                farois === 'true',
                lanternas === 'true',
                setas === 'true',
                luz_freio === 'true',
                luz_re === 'true',
                iluminacao_interna === 'true',

                extintor === 'true',
                cintos === 'true',
                martelo_emergencia === 'true',
                kit_primeiros_socorros === 'true',

                lataria_pintura === 'true',
                vidros_limpos === 'true',
                retrovisores_ok === 'true',
                limpador_para_brisa === 'true',
                sinalizacao_externa === 'true',
                interior_limpo === 'true',

                combustivel_suficiente === 'true',
                triangulo_sinalizacao === 'true',
                macaco_chave_roda === 'true',
                material_limpeza === 'true',
                acessibilidade === 'true',

                obs_saida || null,

                combustivel_verificar === 'true',
                abastecimento === 'true',
                pneus_desgaste === 'true',
                lataria_avarias === 'true',
                interior_limpeza_retorno === 'true',
                extintor_retorno === 'true',
                cintos_retorno === 'true',
                kit_primeiros_socorros_retorno === 'true',
                equip_obrigatorio_retorno === 'true',
                equip_acessorio_retorno === 'true',
                problemas_mecanicos === 'true',
                incidentes === 'true',
                problema_portas_janelas === 'true',
                manutencao_preventiva === 'true',
                pronto_prox_dia === 'true',
                obs_retorno || null,

                checklistId
            ];

            await pool.query(updateQuery, updateValues);
            return res.json({ success: true, message: 'Checklist atualizado com sucesso!' });
        } else {
            const insertQuery = `
                INSERT INTO checklists_onibus (
                    motorista_id, frota_id, data_checklist,
                    horario_saida, horario_retorno, quilometragem_final,
                    cnh_valida, crlv_atualizado, aut_cert_escolar,
                    pneus_calibragem, pneus_estado, pneu_estepe,
                    fluido_oleo_motor, fluido_freio, fluido_radiador, fluido_parabrisa,
                    freio_pe, freio_mao,
                    farois, lanternas, setas, luz_freio, luz_re, iluminacao_interna,
                    extintor, cintos, martelo_emergencia, kit_primeiros_socorros,
                    lataria_pintura, vidros_limpos, retrovisores_ok, limpador_para_brisa,
                    sinalizacao_externa, interior_limpo,
                    combustivel_suficiente, triangulo_sinalizacao, macaco_chave_roda,
                    material_limpeza, acessibilidade, obs_saida,
                    combustivel_verificar, abastecimento, pneus_desgaste, lataria_avarias,
                    interior_limpeza_retorno, extintor_retorno, cintos_retorno, kit_primeiros_socorros_retorno,
                    equip_obrigatorio_retorno, equip_acessorio_retorno,
                    problemas_mecanicos, incidentes, problema_portas_janelas,
                    manutencao_preventiva, pronto_prox_dia, obs_retorno
                ) VALUES (
                    $1, $2, $3,
                    $4, $5, $6,
                    $7, $8, $9,
                    $10, $11, $12,
                    $13, $14, $15, $16,
                    $17, $18,
                    $19, $20, $21, $22, $23, $24,
                    $25, $26, $27, $28,
                    $29, $30, $31, $32,
                    $33, $34,
                    $35, $36, $37,
                    $38, $39, $40,
                    $41, $42, $43, $44,
                    $45, $46, $47, $48,
                    $49, $50,
                    $51, $52, $53,
                    $54, $55, $56
                )
                RETURNING id
            `;
            const insertValues = [
                motorista_id,
                frota_id,
                data_checklist,
                horario_saida || null,
                horario_retorno || null,
                quilometragem_final ? parseInt(quilometragem_final, 10) : null,

                cnh_valida === 'true',
                crlv_atualizado === 'true',
                aut_cert_escolar === 'true',
                pneus_calibragem === 'true',
                pneus_estado === 'true',
                pneu_estepe === 'true',

                fluido_oleo_motor === 'true',
                fluido_freio === 'true',
                fluido_radiador === 'true',
                fluido_parabrisa === 'true',

                freio_pe === 'true',
                freio_mao === 'true',

                farois === 'true',
                lanternas === 'true',
                setas === 'true',
                luz_freio === 'true',
                luz_re === 'true',
                iluminacao_interna === 'true',

                extintor === 'true',
                cintos === 'true',
                martelo_emergencia === 'true',
                kit_primeiros_socorros === 'true',

                lataria_pintura === 'true',
                vidros_limpos === 'true',
                retrovisores_ok === 'true',
                limpador_para_brisa === 'true',

                sinalizacao_externa === 'true',
                interior_limpo === 'true',

                combustivel_suficiente === 'true',
                triangulo_sinalizacao === 'true',
                macaco_chave_roda === 'true',
                material_limpeza === 'true',
                acessibilidade === 'true',
                obs_saida || null,

                combustivel_verificar === 'true',
                abastecimento === 'true',
                pneus_desgaste === 'true',
                lataria_avarias === 'true',
                interior_limpeza_retorno === 'true',
                extintor_retorno === 'true',
                cintos_retorno === 'true',
                kit_primeiros_socorros_retorno === 'true',

                equip_obrigatorio_retorno === 'true',
                equip_acessorio_retorno === 'true',

                problemas_mecanicos === 'true',
                incidentes === 'true',
                problema_portas_janelas === 'true',

                manutencao_preventiva === 'true',
                pronto_prox_dia === 'true',
                obs_retorno || null
            ];
            const result = await pool.query(insertQuery, insertValues);
            if (result.rows.length > 0) {
                return res.json({
                    success: true,
                    message: 'Checklist cadastrado com sucesso!',
                    id: result.rows[0].id
                });
            } else {
                return res.status(500).json({
                    success: false,
                    message: 'Não foi possível inserir o checklist.'
                });
            }
        }
    } catch (error) {
        console.error('Erro ao salvar checklist_onibus:', error);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

app.get('/api/checklists_onibus', async (req, res) => {
    try {
        const { motorista_id, frota_id, data_checklist } = req.query;
        if (!motorista_id || !frota_id || !data_checklist) {
            return res.status(400).json({
                success: false,
                message: 'Parâmetros motorista_id, frota_id e data_checklist são obrigatórios.'
            });
        }
        const query = `
            SELECT *
            FROM checklists_onibus
            WHERE motorista_id=$1
              AND frota_id=$2
              AND data_checklist=$3
            LIMIT 1
        `;
        const values = [motorista_id, frota_id, data_checklist];
        const result = await pool.query(query, values);
        if (result.rows.length === 0) {
            return res.json({
                success: false,
                message: 'Nenhum checklist encontrado para esse dia.'
            });
        }
        return res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Erro ao buscar checklist_onibus:', error);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

// ====================================================================================
//                              COCESSAO_ROTA (ALUNOS)
// ====================================================================================

app.get('/api/cocessao-rota', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM cocessao_rota');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post(
    '/api/enviar-solicitacao',
    upload.fields([
        { name: 'laudo_deficiencia', maxCount: 1 },
        { name: 'comprovante_endereco', maxCount: 1 },
    ]),
    async (req, res) => {
        try {
            const {
                nome_responsavel,
                cpf_responsavel,
                celular_responsavel,
                id_matricula_aluno,
                escola_id,
                cep,
                numero,
                endereco,
                zoneamento,
                deficiencia,
                latitude,
                longitude,
                observacoes,
                criterio_direito
            } = req.body;

            let laudoDeficienciaPath = null;
            let comprovanteEnderecoPath = null;

            if (req.files['laudo_deficiencia'] && req.files['laudo_deficiencia'].length > 0) {
                laudoDeficienciaPath = `uploads/${req.files['laudo_deficiencia'][0].filename}`;
            }
            if (req.files['comprovante_endereco'] && req.files['comprovante_endereco'].length > 0) {
                comprovanteEnderecoPath = `uploads/${req.files['comprovante_endereco'][0].filename}`;
            }

            const zoneamentoBool = zoneamento === 'sim';
            const deficienciaBool = deficiencia === 'sim';

            const insertQuery = `
                INSERT INTO cocessao_rota (
                    nome_responsavel,
                    cpf_responsavel,
                    celular_responsavel,
                    id_matricula_aluno,
                    escola_id,
                    cep,
                    numero,
                    endereco,
                    zoneamento,
                    deficiencia,
                    laudo_deficiencia_path,
                    comprovante_endereco_path,
                    latitude,
                    longitude,
                    observacoes,
                    criterio_direito
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING id
            `;
            const values = [
                nome_responsavel,
                cpf_responsavel,
                celular_responsavel,
                id_matricula_aluno,
                parseInt(escola_id, 10) || null,
                cep,
                numero,
                endereco || null,
                zoneamentoBool,
                deficienciaBool,
                laudoDeficienciaPath,
                comprovanteEnderecoPath,
                latitude ? parseFloat(latitude) : null,
                longitude ? parseFloat(longitude) : null,
                observacoes || null,
                criterio_direito || null,
            ];
            const result = await pool.query(insertQuery, values);

            if (result.rows.length > 0) {
                return res.json({
                    success: true,
                    message: 'Solicitação salva com sucesso na tabela cocessao_rota!',
                    id: result.rows[0].id,
                });
            } else {
                return res.status(500).json({
                    success: false,
                    message: 'Erro ao inserir registro na tabela cocessao_rota.',
                });
            }
        } catch (error) {
            console.error('Erro ao salvar solicitação na tabela cocessao_rota:', error);
            return res.status(500).json({
                success: false,
                message: 'Erro interno do servidor ao salvar solicitação.',
            });
        }
    }
);

// =====================
// ENDPOINT NODE.JS: Excluir Rota
// =====================

app.delete('/api/rotas-simples/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteQuery = 'DELETE FROM rotas_simples WHERE id = $1 RETURNING id';
        const result = await pool.query(deleteQuery, [id]);

        if (result.rowCount > 0) {
            return res.json({ success: true, message: 'Rota excluída com sucesso!' });
        } else {
            return res.status(404).json({ success: false, message: 'Rota não encontrada.' });
        }
    } catch (error) {
        console.error('Erro ao excluir rota:', error);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});


// ====================================================================================
// EDITAR SOLICITAÇÃO (PUT /api/cocessao-rota/:id)
// ====================================================================================
app.put('/api/cocessao-rota/:id', upload.fields([
    { name: 'laudo_deficiencia', maxCount: 1 },
    { name: 'comprovante_endereco', maxCount: 1 },
]), async (req, res) => {
    try {
        const { id } = req.params;

        const {
            nome_responsavel,
            cpf_responsavel,
            celular_responsavel,
            id_matricula_aluno,
            escola_id,
            cep,
            numero,
            endereco: endStr,
            zoneamento,
            deficiencia,
            latitude,
            longitude,
            observacoes,
            criterio_direito,
        } = req.body;

        let laudoDeficienciaPath = null;
        let comprovanteEnderecoPath = null;
        if (req.files['laudo_deficiencia'] && req.files['laudo_deficiencia'].length > 0) {
            laudoDeficienciaPath = `uploads/${req.files['laudo_deficiencia'][0].filename}`;
        }
        if (req.files['comprovante_endereco'] && req.files['comprovante_endereco'].length > 0) {
            comprovanteEnderecoPath = `uploads/${req.files['comprovante_endereco'][0].filename}`;
        }

        const oldRowRes = await pool.query('SELECT laudo_deficiencia_path, comprovante_endereco_path FROM cocessao_rota WHERE id=$1', [id]);
        if (oldRowRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Solicitação não encontrada.' });
        }
        const oldRow = oldRowRes.rows[0];

        if (!laudoDeficienciaPath) laudoDeficienciaPath = oldRow.laudo_deficiencia_path;
        if (!comprovanteEnderecoPath) comprovanteEnderecoPath = oldRow.comprovante_endereco_path;

        const zoneamentoBool = (zoneamento === 'sim');
        const deficienciaBool = (deficiencia === 'sim');

        const updateQuery = `
            UPDATE cocessao_rota
            SET
                nome_responsavel = $1,
                cpf_responsavel = $2,
                celular_responsavel = $3,
                id_matricula_aluno = $4,
                escola_id = $5,
                cep = $6,
                numero = $7,
                endereco = $8,
                zoneamento = $9,
                deficiencia = $10,
                laudo_deficiencia_path = $11,
                comprovante_endereco_path = $12,
                latitude = $13,
                longitude = $14,
                observacoes = $15,
                criterio_direito = $16
            WHERE id = $17
        `;
        const values = [
            nome_responsavel,
            cpf_responsavel,
            celular_responsavel,
            id_matricula_aluno,
            escola_id ? parseInt(escola_id, 10) : null,
            cep,
            numero,
            endStr || null,
            zoneamentoBool,
            deficienciaBool,
            laudoDeficienciaPath,
            comprovanteEnderecoPath,
            latitude ? parseFloat(latitude) : null,
            longitude ? parseFloat(longitude) : null,
            observacoes || null,
            criterio_direito || null,
            parseInt(id, 10),
        ];

        await pool.query(updateQuery, values);
        return res.json({ success: true, message: 'Solicitação atualizada com sucesso!' });
    } catch (error) {
        console.error('Erro ao atualizar solicitação:', error);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

// ====================================================================================
// EXCLUIR SOLICITAÇÃO (DELETE /api/cocessao-rota/:id)
// ====================================================================================
app.delete('/api/cocessao-rota/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleteQuery = 'DELETE FROM cocessao_rota WHERE id = $1';
        const result = await pool.query(deleteQuery, [id]);
        if (result.rowCount > 0) {
            return res.json({ success: true, message: 'Solicitação excluída com sucesso!' });
        } else {
            return res.status(404).json({ success: false, message: 'Solicitação não encontrada.' });
        }
    } catch (error) {
        console.error('Erro ao excluir solicitação:', error);
        return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

// ====================================================================================
//                              MEMORANDOS
// ====================================================================================

app.get('/api/memorandos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM memorandos ORDER BY data_criacao DESC');
        return res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar memorandos:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro ao buscar memorandos.',
        });
    }
});

// =======================================
// ENDPOINT: CRIAR MEMORANDO (ATUALIZADO)
// =======================================
app.post('/api/memorandos/cadastrar', memorandoUpload.none(), async (req, res) => {
    const { tipo_memorando, destinatario, corpo } = req.body;

    if (!tipo_memorando || !destinatario || !corpo) {
        return res.status(400).json({
            success: false,
            message: 'Campos obrigatórios não fornecidos (tipo_memorando, destinatario, corpo).',
        });
    }

    const data_criacao = moment().format('YYYY-MM-DD');

    try {
        const insertQuery = `
            INSERT INTO memorandos
            (tipo_memorando, destinatario, corpo, data_criacao)
            VALUES ($1, $2, $3, $4)
            RETURNING id;
        `;
        const values = [tipo_memorando, destinatario, corpo, data_criacao];
        const result = await pool.query(insertQuery, values);

        const newId = result.rows[0].id;

        return res.json({
            success: true,
            memorando: {
                id: newId,
                tipo_memorando,
                destinatario,
                corpo,
                data_criacao,
            },
        });
    } catch (error) {
        console.error('Erro ao cadastrar memorando:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro ao cadastrar memorando.',
        });
    }
});


app.get('/api/memorandos/:id/gerar-docx', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('SELECT * FROM memorandos WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Memorando não encontrado.',
            });
        }

        const memorando = result.rows[0];

        // Carrega imagens se existirem
        const fs = require('fs');
        const path = require('path');
        let logoMemorando1Buffer = null;
        let memorandoSeparadorBuffer = null;
        let logoMemorando2Buffer = null;
        let assinaturaBuffer = null;

        const logoMemorando1Path = path.join(__dirname, 'public', 'assets', 'img', 'logo_memorando1.png');
        const memorandoSeparadorPath = path.join(__dirname, 'public', 'assets', 'img', 'memorando_separador.png');
        const logoMemorando2Path = path.join(__dirname, 'public', 'assets', 'img', 'memorando_logo2.png');
        const assinaturaPath = path.join(__dirname, 'public', 'assets', 'img', 'assinatura.png');

        if (fs.existsSync(logoMemorando1Path)) {
            logoMemorando1Buffer = fs.readFileSync(logoMemorando1Path);
        }
        if (fs.existsSync(memorandoSeparadorPath)) {
            memorandoSeparadorBuffer = fs.readFileSync(memorandoSeparadorPath);
        }
        if (fs.existsSync(logoMemorando2Path)) {
            logoMemorando2Buffer = fs.readFileSync(logoMemorando2Path);
        }
        if (fs.existsSync(assinaturaPath)) {
            assinaturaBuffer = fs.readFileSync(assinaturaPath);
        }

        // docx
        const { Document, Packer, Paragraph, TextRun, Header, Footer, Table, TableRow, TableCell, ImageRun } = require('docx');

        // HEADER: Tabela com (logo_esquerda | texto_direita) + separador centralizado
        const headerChildren = [];

        // Tabela com logo à esquerda e texto à direita
        headerChildren.push(
            new Table({
                rows: [
                    new TableRow({
                        children: [
                            new TableCell({
                                children: [
                                    logoMemorando1Buffer
                                        ? new Paragraph({
                                            children: [
                                                new ImageRun({
                                                    data: logoMemorando1Buffer,
                                                    transformation: { width: 60, height: 60 },
                                                }),
                                            ],
                                        })
                                        : new Paragraph("")
                                ],
                                width: { size: 50 },
                            }),
                            new TableCell({
                                children: [
                                    new Paragraph({
                                        children: [
                                            new TextRun({
                                                text: "ESTADO DO PARÁ\nPREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\nSECRETARIA MUNICIPAL DE EDUCAÇÃO",
                                                bold: true,
                                            }),
                                        ],
                                    }),
                                ],
                                width: { size: 9000 },
                            }),
                        ],
                    }),
                ],
                width: {
                    size: 100,
                    type: "pct",
                },
            })
        );

        // Separador no header (caso exista)
        if (memorandoSeparadorBuffer) {
            headerChildren.push(
                new Paragraph({
                    children: [
                        new ImageRun({
                            data: memorandoSeparadorBuffer,
                            transformation: { width: 510, height: 10 },
                        }),
                    ],
                })
            );
        }

        // FOOTER: separador + logo2 + texto rodapé
        const footerChildren = [];

        // Separador no rodapé (caso exista)
        if (memorandoSeparadorBuffer) {
            footerChildren.push(
                new Paragraph({
                    children: [
                        new ImageRun({
                            data: memorandoSeparadorBuffer,
                            transformation: { width: 510, height: 10 },
                        }),
                    ],
                })
            );
        }

        // Logo2 centralizado no rodapé (caso exista)
        if (logoMemorando2Buffer) {
            footerChildren.push(
                new Paragraph({
                    children: [
                        new ImageRun({
                            data: logoMemorando2Buffer,
                            transformation: { width: 160, height: 50 },
                        }),
                    ],
                    alignment: "CENTER",
                })
            );
        }

        // Texto rodapé
        footerChildren.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: "SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED",
                    }),
                ],
                alignment: "CENTER",
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "Rua Itamarati s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA",
                    }),
                ],
                alignment: "CENTER",
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "Telefone: (94) 99293-4500",
                    }),
                ],
                alignment: "CENTER",
            })
        );

        // Corpo principal do memorando
        const bodyParagraphs = [
            // Título
            new Paragraph({
                children: [
                    new TextRun({
                        text: `MEMORANDO N.º ${memorando.id}/2025 - SECRETARIA DE EDUCACAO`,
                        bold: true,
                    }),
                ],
                alignment: "JUSTIFIED",
            }),
            new Paragraph({ text: "" }),
            // A: ...
            new Paragraph({
                children: [
                    new TextRun({ text: `A: ${memorando.destinatario}` }),
                ],
                alignment: "JUSTIFIED",
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: `Assunto: ${memorando.tipo_memorando}` }),
                ],
                alignment: "JUSTIFIED",
            }),
            new Paragraph({ text: "" }),
            // Prezados(as)...
            new Paragraph({
                children: [
                    new TextRun("Prezados(as),"),
                ],
                alignment: "JUSTIFIED",
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
                children: [
                    new TextRun(memorando.corpo),
                ],
                alignment: "JUSTIFIED",
            }),
            new Paragraph({ text: "" }),
            new Paragraph({
                children: [
                    new TextRun("Atenciosamente,"),
                ],
                alignment: "JUSTIFIED",
            }),
            new Paragraph({ text: "" }),
            // Assinatura se existir
            ...(assinaturaBuffer
                ? [
                    new Paragraph({
                        children: [
                            new ImageRun({
                                data: assinaturaBuffer,
                                transformation: { width: 150, height: 50 },
                            }),
                        ],
                        alignment: "CENTER",
                    }),
                ]
                : []
            ),
            // Nome e cargo
            new Paragraph({
                children: [new TextRun("DANILO DE MORAIS GUSTAVO")],
                alignment: "CENTER",
            }),
            new Paragraph({
                children: [new TextRun("Gestor de Transporte Escolar")],
                alignment: "CENTER",
            }),
            new Paragraph({
                children: [new TextRun("Portaria 118/2023 - GP")],
                alignment: "CENTER",
            }),
        ];

        const doc = new Document({
            sections: [
                {
                    headers: {
                        default: new Header({
                            children: headerChildren,
                        }),
                    },
                    footers: {
                        default: new Footer({
                            children: footerChildren,
                        }),
                    },
                    children: bodyParagraphs,
                },
            ],
        });
        const buffer = await Packer.toBuffer(doc);

        res.setHeader('Content-Disposition', `attachment; filename=memorando_${id}.docx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        return res.send(buffer);
    } catch (error) {
        console.error('Erro ao gerar documento .docx:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro ao gerar documento .docx.',
        });
    }
});

// ==========================================
// ENDPOINT: OBTER MEMORANDO (VISUALIZAR)
// ==========================================
app.get('/api/memorandos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM memorandos WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Memorando não encontrado.'
            });
        }

        // Retorna o memorando em JSON para exibir no front-end
        return res.json({
            success: true,
            memorando: result.rows[0]
        });
    } catch (error) {
        console.error('Erro ao buscar memorando:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro interno do servidor.'
        });
    }
});


app.delete('/api/memorandos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM memorandos WHERE id = $1 RETURNING *', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Memorando não encontrado.',
            });
        }
        return res.json({
            success: true,
            message: 'Memorando excluído com sucesso.',
        });
    } catch (error) {
        console.error('Erro ao excluir memorando:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro ao excluir memorando.',
        });
    }
});

app.get('/api/memorandos/:id/gerar-pdf', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM memorandos WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Memorando não encontrado.' });
        }
        const memorando = result.rows[0];

        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ size: 'A4', margin: 50 });

        res.setHeader('Content-Disposition', `inline; filename=memorando_${id}.pdf`);
        res.setHeader('Content-Type', 'application/pdf');
        doc.pipe(res);

        // ----------------------------
        // 1) SALVA POSIÇÃO INICIAL
        // ----------------------------
        doc.save();

        // ----------------------------
        // 2) LOGO À ESQUERDA (absoluto)
        // ----------------------------
        const logoPath = path.join(__dirname, 'public', 'assets', 'img', 'logo_memorando1.png');
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 50, 20, { width: 60 });
        }

        // ----------------------------
        // 3) TEXTO À DIREITA (absoluto)
        // ----------------------------
        doc.fontSize(11)
            .font('Helvetica-Bold')
            .text(
                'ESTADO DO PARÁ\n' +
                'PREFEITURA MUNICIPAL DE CANAÃ DOS CARAJÁS\n' +
                'SECRETARIA MUNICIPAL DE EDUCAÇÃO',
                250,
                20,
                { width: 300, align: 'right' }
            );

        // ----------------------------
        // 4) SEPARADOR CENTRALIZADO (TOPO)
        // ----------------------------
        const separadorPath = path.join(__dirname, 'public', 'assets', 'img', 'memorando_separador.png');
        if (fs.existsSync(separadorPath)) {
            const separadorX = (doc.page.width - 510) / 2;
            const separadorY = 90;
            doc.image(separadorPath, separadorX, separadorY, {
                width: 510
            });
        }

        // ----------------------------
        // 5) RESTAURA POSIÇÃO CURSOR
        // ----------------------------
        doc.restore();
        doc.y = 130;
        doc.x = 50;

        // ----------------------------
        // 6) TÍTULO MEMORANDO
        // ----------------------------
        doc.fontSize(12)
            .font('Helvetica-Bold')
            .text(`MEMORANDO N.º ${memorando.id}/2025 - SECRETARIA DE EDUCACAO`, {
                align: 'justify'
            })
            .moveDown();

        // ----------------------------
        // 7) CORPO DO TEXTO
        // ----------------------------
        doc.fontSize(12)
            .font('Helvetica')
            .text(`A: ${memorando.destinatario}`, { align: 'justify' })
            .text(`Assunto: ${memorando.tipo_memorando}`, { align: 'justify' })
            .moveDown()
            .text('Prezados(as),', { align: 'justify' })
            .moveDown()
            .text(memorando.corpo, { align: 'justify' })
            .moveDown();

        // ----------------------------
        // VERIFICA SE ESPAÇO É SUFICIENTE P/ ASSINATURA
        // ----------------------------
        const spaceNeededForSignature = 100;
        if (doc.y + spaceNeededForSignature > doc.page.height - 160) {
            doc.addPage();
        }

        // ----------------------------
        // 8) ASSINATURA FIXA A ~1CM ACIMA DO RODAPÉ
        // ----------------------------
        const signatureY = doc.page.height - 270;
        doc.y = signatureY;
        doc.x = 50;
        doc.fontSize(12)
            .font('Helvetica')
            .text('Atenciosamente,', { align: 'justify' })
            .moveDown(2)
            .text('DANILO DE MORAIS GUSTAVO', { align: 'center' })
            .text('Gestor de Transporte Escolar', { align: 'center' })
            .text('Portaria 118/2023 - GP', { align: 'center' });

        // ========================================
        // 9) RODAPÉ
        // ========================================
        const footerSepX = (doc.page.width - 510) / 2;
        const footerSepY = doc.page.height - 160;

        if (fs.existsSync(separadorPath)) {
            doc.image(separadorPath, footerSepX, footerSepY, { width: 510 });
        }

        const logo2Path = path.join(__dirname, 'public', 'assets', 'img', 'memorando_logo2.png');
        if (fs.existsSync(logo2Path)) {
            const logo2X = (doc.page.width - 160) / 2;
            const logo2Y = doc.page.height - 150;
            doc.image(logo2Path, logo2X, logo2Y, { width: 160 });
        }

        doc.fontSize(10)
            .font('Helvetica')
            .text(
                'SECRETARIA MUNICIPAL DE EDUCAÇÃO - SEMED',
                50,
                doc.page.height - 85,
                { width: doc.page.width - 100, align: 'center' }
            )
            .text(
                'Rua Itamarati s/n - Bairro Novo Horizonte - CEP: 68.356-103 - Canaã dos Carajás - PA',
                { align: 'center' }
            )
            .text(
                'Telefone: (94) 99293-4500',
                { align: 'center' }
            );

        doc.end();
    } catch (error) {
        console.error('Erro ao gerar PDF:', error);
        return res.status(500).json({
            success: false,
            message: 'Erro ao gerar PDF.'
        });
    }
});


// Exemplo de rota de importação (Node + Express + pg)
app.post('/api/import-alunos-ativos', async (req, res) => {
    try {
        const { alunos, escolaId } = req.body;
        if (!alunos || !Array.isArray(alunos)) {
            return res.json({ success: false, message: 'Dados inválidos.' });
        }

        // Caso precise validar se a escola existe:
        if (!escolaId) {
            return res.json({ success: false, message: 'É necessário informar uma escola.' });
        }
        const buscaEscola = await pool.query(`SELECT id FROM escolas WHERE id = $1`, [escolaId]);
        if (buscaEscola.rows.length === 0) {
            return res.json({ success: false, message: 'Escola não encontrada.' });
        }

        for (const aluno of alunos) {
            const {
                id_matricula,
                UNIDADE_ENSINO,
                ANO,
                MODALIDADE,
                FORMATO_LETIVO,
                TURMA,
                pessoa_nome,
                cpf,
                transporte_escolar_poder_publico,
                cep,
                bairro,
                filiacao_1,
                numero_telefone,
                filiacao_2,
                RESPONSAVEL,
                deficiencia
            } = aluno;

            let defArray = [];
            try {
                if (typeof deficiencia === 'string') {
                    defArray = JSON.parse(deficiencia);
                    if (!Array.isArray(defArray)) defArray = [];
                }
            } catch (e) {
                defArray = [];
            }

            await pool.query(
                `INSERT INTO alunos_ativos(
            id_matricula, escola_id, ano, modalidade, formato_letivo, turma, pessoa_nome, cpf,
            transporte_escolar_poder_publico, cep, bairro, filiacao_1, numero_telefone, filiacao_2,
            responsavel, deficiencia
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
                [
                    id_matricula || null,
                    escolaId,  // <<< associando todos os alunos à mesma escola
                    ANO || null,
                    MODALIDADE || null,
                    FORMATO_LETIVO || null,
                    TURMA || null,
                    pessoa_nome || null,
                    cpf || null,
                    transporte_escolar_poder_publico || null,
                    cep || null,
                    bairro || null,
                    filiacao_1 || null,
                    numero_telefone || null,
                    filiacao_2 || null,
                    RESPONSAVEL || null,
                    defArray
                ]
            );
        }

        return res.json({ success: true, message: 'Alunos importados com sucesso!' });
    } catch (err) {
        console.error(err);
        return res.json({ success: false, message: 'Erro ao importar os alunos.' });
    }
});


app.get('/api/alunos-ativos', async (req, res) => {
    try {
        const query = `
        SELECT a.*,
               e.nome AS escola_nome
        FROM alunos_ativos a
        LEFT JOIN escolas e 
          ON e.id = a.escola_id
        ORDER BY a.id DESC
      `;
        const result = await pool.query(query);
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Erro ao buscar alunos.' });
    }
});


// ====================================================================================
//                              LISTEN (FINAL)
// ====================================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
