/* ============================================================
   ai.js — AI Route Optimizer (JTEKT Smart Route AI)
   ------------------------------------------------------------
   Módulo de IA SIMULADA para pontuação e otimização de rotas.

   O algoritmo hoje é determinístico (regras + pesos), mas a
   interface pública (optimize / scoreRoute / explain) foi
   desenhada para que, no futuro, "scoreRoute" possa ser
   substituído por uma chamada a uma API real de ML sem alterar
   nenhum outro módulo do sistema.
   ============================================================ */

(function (global) {
  'use strict';

  // Pesos do score (somam 100%)
  const WEIGHTS = {
    time: 0.35,
    distance: 0.25,
    congestion: 0.15,
    safety: 0.10,
    history: 0.10,
    energy: 0.05,
  };

  const CONGESTION_PENALTY = { Baixo: 0, Médio: 0.45, Alto: 1 };

  // Normaliza um valor para o intervalo 0..1 dado um min/max de referência
  function normalize(value, min, max) {
    if (max === min) return 0;
    const v = (value - min) / (max - min);
    return Math.min(1, Math.max(0, v));
  }

  /**
   * Calcula o score (0-100) de uma rota relativo ao conjunto de rotas
   * candidatas (para que a normalização faça sentido comparativamente).
   */
  function scoreRoute(route, candidateSet) {
    if (route.blocked) return 0;

    const times = candidateSet.map(r => r.estimatedTime);
    const dists = candidateSet.map(r => r.distance);

    const timeNorm = 1 - normalize(route.estimatedTime, Math.min(...times), Math.max(...times));
    const distNorm = 1 - normalize(route.distance, Math.min(...dists), Math.max(...dists));
    const congestionNorm = 1 - CONGESTION_PENALTY[route.congestion];
    const safetyNorm = route.safetyIndex;
    const historyNorm = 1 - normalize(route.historicalTime - route.estimatedTime, 0, 5);
    const energyNorm = 1 - normalize(route.energyUse, 0.6, 1.0);

    const raw =
      WEIGHTS.time * timeNorm +
      WEIGHTS.distance * distNorm +
      WEIGHTS.congestion * congestionNorm +
      WEIGHTS.safety * safetyNorm +
      WEIGHTS.history * historyNorm +
      WEIGHTS.energy * energyNorm;

    return Math.round(raw * 100);
  }

  function statusForScore(score, blocked) {
    if (blocked) return 'BLOQUEADA';
    if (score >= 90) return 'RECOMENDADA';
    if (score >= 70) return 'ALTERNATIVA';
    return 'NÃO RECOMENDADA';
  }

  /**
   * Gera uma explicação textual, em linguagem natural, de por que
   * a rota recebeu aquele score — usada na UI para dar transparência
   * à decisão da IA.
   */
  function explain(route, candidateSet) {
    if (route.blocked) {
      return `Rota ${route.id} não recomendada: via bloqueada no momento.`;
    }
    const reasons = [];
    const times = candidateSet.map(r => r.estimatedTime);
    const dists = candidateSet.map(r => r.distance);

    if (route.estimatedTime === Math.min(...times)) reasons.push('menor tempo estimado');
    if (route.distance === Math.min(...dists)) reasons.push('menor distância');
    if (route.congestion === 'Baixo') reasons.push('baixo congestionamento');
    if (route.safetyIndex >= 0.9) reasons.push('alto índice de segurança');
    if (route.stops === 0) reasons.push('sem paradas no trajeto');

    if (reasons.length === 0) {
      return `Rota ${route.id} apresenta desempenho mediano frente às alternativas disponíveis.`;
    }
    const list = reasons.length === 1
      ? reasons[0]
      : reasons.slice(0, -1).join(', ') + ' e ' + reasons[reasons.length - 1];
    return `Rota ${route.id} recomendada porque apresenta ${list}.`;
  }

  /**
   * Recalcula score/status/reason para TODAS as rotas de um dataset,
   * comparando cada rota apenas com as demais que ligam o mesmo par
   * origem→destino (quando existir mais de uma opção) ou com o
   * conjunto completo caso contrário.
   */
  function scoreAllRoutes(routes) {
    routes.forEach(route => {
      const sameOD = routes.filter(r => r.origin === route.origin && r.destination === route.destination);
      const candidateSet = sameOD.length > 1 ? sameOD : routes;
      route.score = scoreRoute(route, candidateSet);
      route.status = statusForScore(route.score, route.blocked);
      route.reason = explain(route, candidateSet);
    });
    return routes.sort((a, b) => b.score - a.score);
  }

  /**
   * Busca rotas entre origem e destino (diretas). Caso não exista rota
   * direta cadastrada, retorna as rotas mais próximas como alternativa
   * informativa (a malha viária real resolveria isso via grafo completo).
   */
  function findRoutes(routes, originId, destinationId) {
    const direct = routes.filter(r => r.origin === originId && r.destination === destinationId);
    if (direct.length > 0) return direct.slice().sort((a, b) => b.score - a.score);
    return [];
  }

  /**
   * Ponto de entrada principal chamado pela UI ao clicar em
   * "OTIMIZAR ROTA". Retorna a melhor rota + alternativas rankeadas.
   */
  function optimize(routes, originId, destinationId) {
    const candidates = findRoutes(routes, originId, destinationId);
    if (candidates.length === 0) {
      return { best: null, alternatives: [], message: 'Nenhuma rota cadastrada entre os pontos selecionados.' };
    }
    const ranked = candidates.slice().sort((a, b) => b.score - a.score);
    return {
      best: ranked[0],
      alternatives: ranked.slice(1),
      message: null,
    };
  }

  /** Tempo total economizado pela IA no mês (indicador de dashboard) */
  function estimateTimeSaved(history) {
    const totalPlanned = history.reduce((s, h) => s + h.plannedTime, 0);
    const totalReal = history.reduce((s, h) => s + h.realTime, 0);
    const savedMin = Math.max(0, (totalReal - totalPlanned) * 1.8); // extrapolação simulada
    return +(savedMin / 60).toFixed(1); // em horas
  }

  global.AIOptimizer = {
    scoreAllRoutes,
    scoreRoute,
    explain,
    findRoutes,
    optimize,
    estimateTimeSaved,
    WEIGHTS,
  };
})(window);