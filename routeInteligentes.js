// routeInteligentes.js
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function gerarRota(escolas) {
    // 1) Busca os pontos ativos e conta alunos vinculados
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
    // Formata os dados
    const pontos = pontosRes.rows.map(r => ({
        id: r.id,
        latitude: parseFloat(r.latitude),
        longitude: parseFloat(r.longitude),
        alunos_count: parseInt(r.alunos_count, 10)
    }));

    // 2) Escolhe veículo
    const totalAlunos = pontos.reduce((s, p) => s + p.alunos_count, 0);
    let veiculo = totalAlunos <= 15 ? 'van' : totalAlunos <= 30 ? 'microonibus' : 'onibus';

    // 3) Calcula tempo/distância máximos
    const isInfantil = await verificarEscolaNEI(escolas[0]);
    const tempoMax = isInfantil ? 75 - 45 : 75;
    const tempoParadas = pontos.length * 2;
    const tempoViagem = Math.max(0, tempoMax - tempoParadas);
    const distanciaMax = tempoViagem * 0.5;

    // 4) Algoritmo guloso de ordenação
    const ordem = [];
    let current = { latitude: pontos[0].latitude, longitude: pontos[0].longitude };
    let distTotal = 0, durTotal = 0;
    const remain = [...pontos];
    while (remain.length) {
        remain.sort((a, b) => dist(current, a) - dist(current, b));
        const next = remain.shift();
        const d = dist(current, next);
        if (distTotal + d > distanciaMax) break;
        distTotal += d;
        durTotal += d / 0.5;
        ordem.push(next.id);
        current = next;
    }
    const duracaoMin = Math.round(durTotal + tempoParadas);

    // 5) Tipo da rota
    const tipo = await determinarTipo(escolas, ordem);

    // 6) Grava no banco
    const ident = `RI-${Date.now()}`;
    const ins = await pool.query(`
    INSERT INTO rotas_inteligentes
      (identificador, tipo, escola_ids, ponto_ids, ordem_pontos, duracao_minutos, distancia_km, veiculo_sugerido)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
  `, [ident, tipo, escolas, ordem, ordem, duracaoMin, distTotal.toFixed(2), veiculo]);
    const rota = ins.rows[0];

    // 7) Anexa coordenadas completas
    rota.pontos = ordem.map(id => {
        const p = pontos.find(pt => pt.id === id);
        return { id: p.id, latitude: p.latitude, longitude: p.longitude };
    });

    return rota;
}

function dist(a, b) {
    const R = 6371;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude), lat2 = toRad(b.latitude);
    const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return R * c;
}
function toRad(d) { return d * Math.PI / 180; }

async function verificarEscolaNEI(id) {
    const r = await pool.query(`SELECT nome FROM escolas WHERE id=$1`, [id]);
    return r.rows[0].nome.toUpperCase().startsWith('NEI');
}
async function determinarTipo(escolas, ordem) {
    const r = await pool.query(`
    SELECT COUNT(*) AS c FROM alunos_ativos a
    JOIN alunos_pontos ap ON ap.aluno_id=a.id
    WHERE ap.ponto_id = ANY($1) AND a.deficiencia IS NOT NULL
  `, [ordem]);
    if (parseInt(r.rows[0].c, 10) > 0) return 'especial';
    return (await verificarEscolaNEI(escolas[0])) ? 'infantil' : 'normal';
}

router.post('/rotas-inteligentes/gerar', async (req, res) => {
    try {
        const { escolas } = req.body;
        if (!Array.isArray(escolas) || !escolas.length)
            return res.status(400).json({ error: 'Informe ao menos um ID de escola.' });
        const rota = await gerarRota(escolas);
        res.json(rota);
    } catch (err) {
        console.error('Erro ao gerar rota inteligente:', err);
        res.status(500).json({ error: 'Erro interno ao gerar rota.' });
    }
});

module.exports = router;
