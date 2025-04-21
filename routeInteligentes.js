// routeInteligentes.js
// Módulo para gerar e gerenciar rotas inteligentes

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

/**
 * Gera uma rota inteligente para um (ou dois) IDs de escola.
 * Parâmetros:
 *   escolas: array de IDs de escola (máx 2)
 */
async function gerarRota(escolas) {
    // 1. Buscar pontos ativos dos zoneamentos das escolas
    const pontosRes = await pool.query(`
    SELECT p.id, p.latitude, p.longitude,
           COUNT(a.id) AS alunos_count
    FROM pontos p
    JOIN pontos_zoneamentos pz ON pz.ponto_id = p.id
    JOIN escolas_zoneamentos ez ON ez.zoneamento_id = pz.zoneamento_id
    JOIN escolas e ON e.id = ez.escola_id
    LEFT JOIN alunos_pontos ap ON ap.ponto_id = p.id
    LEFT JOIN alunos_ativos a ON a.id = ap.aluno_id
    WHERE e.id = ANY($1) AND p.status = 'ativo'
    GROUP BY p.id
  `, [escolas]);
    const pontos = pontosRes.rows;

    // 2. Calcular total de alunos e veículo sugerido
    const totalAlunos = pontos.reduce((sum, p) => sum + parseInt(p.alunos_count, 10), 0);
    let veiculo = 'van';
    if (totalAlunos <= 15) veiculo = 'van';
    else if (totalAlunos <= 30) veiculo = 'microonibus';
    else veiculo = 'onibus';

    // 3. Definir tempo/distância disponíveis
    const isInfantil = await verificarEscolaNEI(escolas[0]);
    const tempoMax = isInfantil ? 75 - 45 : 75; // minutos
    const tempoParadas = pontos.length * 2;
    const tempoViagem = tempoMax - tempoParadas;
    const distanciaMax = (tempoViagem > 0) ? tempoViagem * 0.5 : 0; // km

    // 4. Construir sequência gulosa de pontos
    const ordem = [];
    let current = { latitude: pontos[0].latitude, longitude: pontos[0].longitude }; // ponto de partida: primeira escola
    let distanciaAcumulada = 0;
    let duracaoAcumulada = 0;

    const remain = [...pontos];
    while (remain.length) {
        // encontra o ponto mais próximo
        remain.sort((a, b) => {
            const da = dist(current, a), db = dist(current, b);
            return da - db;
        });
        const next = remain.shift();
        const d = dist(current, next);
        if (distanciaAcumulada + d > distanciaMax) break;
        distanciaAcumulada += d;
        duracaoAcumulada += d / 0.5; // em minutos
        ordem.push(next.id);
        current = next;
    }

    const duracaoTotal = duracaoAcumulada + tempoParadas;

    // 5. Inserir no banco e retornar
    const tipo = await determinarTipo(escolas, pontos);
    const ident = `RI-${Date.now()}`;
    const insertRes = await pool.query(`
    INSERT INTO rotas_inteligentes
      (identificador, tipo, escola_ids, ponto_ids, ordem_pontos,
       duracao_minutos, distancia_km, veiculo_sugerido)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
  `, [ident, tipo, escolas, ordem, ordem, Math.round(duracaoTotal), distanciaAcumulada.toFixed(2), veiculo]);

    return insertRes.rows[0];
}

// Helpers:

function dist(a, b) {
    // distância euclidiana aproximada (graus → km)
    const R = 6371; // km
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude), lat2 = toRad(b.latitude);
    const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return R * c;
}
function toRad(deg) { return deg * Math.PI / 180; }

async function verificarEscolaNEI(escolaId) {
    const res = await pool.query(`SELECT nome FROM escolas WHERE id = $1`, [escolaId]);
    return res.rows[0].nome.toUpperCase().startsWith('NEI');
}
async function determinarTipo(escolas, pontos) {
    // especial se algum aluno tem deficiência
    const defRes = await pool.query(`
    SELECT COUNT(*) AS c FROM alunos_ativos a
    JOIN alunos_pontos ap ON ap.aluno_id = a.id
    WHERE ap.ponto_id = ANY($1) AND a.deficiencia IS NOT NULL
  `, [pontos.map(p => p.id)]);
    if (parseInt(defRes.rows[0].c, 10) > 0) return 'especial';
    return (await verificarEscolaNEI(escolas[0])) ? 'infantil' : 'normal';
}

// Rota REST para disparar geração
router.post('/rotas-inteligentes/gerar', async (req, res) => {
    try {
        const { escolas } = req.body; // [id1] ou [id1,id2]
        if (!Array.isArray(escolas) || escolas.length === 0) {
            return res.status(400).json({ error: 'Informe ao menos um ID de escola.' });
        }
        const rota = await gerarRota(escolas);
        res.json(rota);
    } catch (err) {
        console.error('Erro ao gerar rota inteligente:', err);
        res.status(500).json({ error: 'Erro interno ao gerar rota.' });
    }
});

module.exports = router;
