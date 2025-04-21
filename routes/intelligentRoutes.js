const express = require('express');
const router = express.Router();
const turf = require('@turf/turf');     // npm install @turf/turf
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Parâmetros contratuais:
const VEICULOS = [
    { tipo: 'van', capacidade: 15 },
    { tipo: 'microonibus', capacidade: 30 },
    { tipo: 'onibus', capacidade: 50 }
];
const TEMPO_POR_PARADA_MIN = 2;
const VELOCIDADE_MEDIA_KMH = 30;
const DURACAO_MAX_MIN = 75;

// Helper: haversine para distância em km
function haversine(a, b) {
    const from = turf.point([a.lng, a.lat]);
    const to = turf.point([b.lng, b.lat]);
    return turf.distance(from, to, { units: 'kilometers' });
}

// 1. Geração inteligente de rota
router.post('/criar', async (req, res) => {
    try {
        const { zoneamentoId, turno } = req.body;
        // --- 1.1 buscar pontos ativos e contagem de alunos por ponto
        const ptsRes = await pool.query(`
      SELECT p.id,
             ST_X(p.geom)::FLOAT AS lng,
             ST_Y(p.geom)::FLOAT AS lat,
             COUNT(ap.aluno_id) AS alunos
        FROM pontos p
        JOIN pontos_zoneamentos pz ON p.id = pz.ponto_id
        LEFT JOIN alunos_pontos ap ON p.id = ap.ponto_id
       WHERE p.status = 'ativo' AND pz.zoneamento_id = $1
       GROUP BY p.id
    `, [zoneamentoId]);
        const pontos = ptsRes.rows;
        if (!pontos.length) {
            return res.status(400).json({ error: 'Nenhum ponto ativo encontrado.' });
        }

        // --- 1.2 buscar escolas associadas ao zoneamento
        const escRes = await pool.query(`
      SELECT e.id, e.latitude::FLOAT AS lat, e.longitude::FLOAT AS lng, e.nome
        FROM escolas e
        JOIN escolas_zoneamentos ez ON e.id = ez.escola_id
       WHERE ez.zoneamento_id = $1
    `, [zoneamentoId]);
        const escolas = escRes.rows;
        if (!escolas.length) {
            return res.status(400).json({ error: 'Nenhuma escola vinculada ao zoneamento.' });
        }
        if (escolas.length > 2) {
            return res.status(400).json({ error: 'Máximo de 2 escolas por rota.' });
        }

        // --- 1.3 definir tipo de rota
        let tipo = 'normal';
        if (escolas.some(e => e.nome.startsWith('NEI'))) tipo = 'infantil';

        const specRes = await pool.query(`
      SELECT COUNT(*) > 0 AS has_special
        FROM alunos_ativos a
        JOIN alunos_pontos ap ON a.id = ap.aluno_id
       WHERE ap.ponto_id = ANY($1) AND a.deficiencia IS NOT NULL
    `, [pontos.map(p => p.id)]);
        if (specRes.rows[0].has_special) tipo = 'especial';

        // --- 1.4 determinar veículo e quantos alunos
        const totalAlunos = pontos.reduce((s, p) => s + parseInt(p.alunos, 10), 0);
        const veiculo = VEICULOS.find(v => totalAlunos <= v.capacidade) || VEICULOS.slice(-1)[0];
        const capacidade = veiculo.capacidade;

        // --- 1.5 ordenar pontos (Nearest Neighbour)
        const start = { lat: escolas[0].lat, lng: escolas[0].lng };
        let current = start, ordered = [];
        const remaining = [...pontos];
        while (remaining.length) {
            // encontrar mais próximo
            let idxMin = 0, distMin = Infinity;
            remaining.forEach((pt, i) => {
                const d = haversine(current, pt);
                if (d < distMin) { distMin = d; idxMin = i; }
            });
            const next = remaining.splice(idxMin, 1)[0];
            ordered.push(next);
            current = { lat: next.lat, lng: next.lng };
        }
        // voltar à escola
        const backDist = haversine(current, start);

        // --- 1.6 calcular duração e distância
        let distTotal = ordered.reduce((sum, pt, i) => {
            const from = i === 0 ? start : ordered[i - 1];
            return sum + haversine(from, pt);
        }, 0) + backDist;
        const tempoViagem = distTotal / VELOCIDADE_MEDIA_KMH * 60;  // em min
        const tempoParadas = ordered.length * TEMPO_POR_PARADA_MIN;
        const duracaoMin = tempoViagem + tempoParadas;

        if (duracaoMin > DURACAO_MAX_MIN) {
            return res.status(400).json({
                error: `Rota excede ${DURACAO_MAX_MIN} min (${Math.round(duracaoMin)} min).`
            });
        }

        // --- 1.7 persistir no banco
        const insertRota = await pool.query(`
      INSERT INTO rotas_inteligentes
        (tipo, turno, veiculo_tipo, capacidade,
         duracao_estimativa, distancia_total,
         zoneamento_id, escolas_ids)
      VALUES
        ($1,$2,$3,$4, make_interval(mins=>$5), $6, $7, $8)
      RETURNING id
    `, [
            tipo, turno, veiculo.tipo, capacidade,
            Math.ceil(duracaoMin), distTotal,
            zoneamentoId, escolas.map(e => e.id)
        ]);
        const rotaId = insertRota.rows[0].id;

        // persistir sequência de pontos
        for (let i = 0; i < ordered.length; i++) {
            await pool.query(`
        INSERT INTO rotas_inteligentes_pontos
          (rota_id, ponto_id, ordem)
        VALUES ($1,$2,$3)
      `, [rotaId, ordered[i].id, i + 1]);
        }
        // vincular alunos
        for (let pt of ordered) {
            const alRes = await pool.query(`
        SELECT aluno_id FROM alunos_pontos WHERE ponto_id = $1
      `, [pt.id]);
            for (let row of alRes.rows) {
                await pool.query(`
          INSERT INTO alunos_rotas_inteligentes (aluno_id, rota_id)
          VALUES ($1,$2)
        `, [row.aluno_id, rotaId]);
            }
        }
        // vincular escolas
        for (let e of escolas) {
            await pool.query(`
        INSERT INTO rotas_inteligentes_escolas (rota_id, escola_id)
        VALUES ($1,$2)
      `, [rotaId, e.id]);
        }

        return res.json({
            success: true,
            rota: {
                id: rotaId,
                tipo, turno, veiculo: veiculo.tipo,
                capacidade, duracaoMin: Math.round(duracaoMin),
                distanciaKm: distTotal.toFixed(2)
            }
        });
    } catch (err) {
        console.error('Erro ao criar rota inteligente:', err);
        return res.status(500).json({ error: 'Erro interno ao gerar rota.' });
    }
});

// 2. Listar todas as rotas inteligentes
router.get('/', async (req, res) => {
    const result = await pool.query(`
    SELECT * FROM rotas_inteligentes ORDER BY created_at DESC
  `);
    res.json(result.rows);
});

// 3. Excluir rota
router.delete('/:id', async (req, res) => {
    await pool.query(`DELETE FROM rotas_inteligentes WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
});

module.exports = router;
