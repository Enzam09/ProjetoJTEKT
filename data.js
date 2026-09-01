/* ============================================================
   data.js — JTEKT Smart Route AI
   Camada de dados. Toda a informação simulada da fábrica vive
   aqui. Nenhum outro módulo deve conter dados "hardcoded" —
   isso garante que, no futuro, esta camada possa ser trocada
   por chamadas reais (API REST, MQTT, OPC-UA, banco de dados)
   sem tocar em app.js / map.js / ai.js.
   ============================================================ */

(function (global) {
  'use strict';

  // --------------------------------------------------------
  // Utilitários de geração
  // --------------------------------------------------------
  function rand(min, max) { return Math.random() * (max - min) + min; }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function choice(arr) { return arr[randInt(0, arr.length - 1)]; }
  function pad(n, len) { return String(n).padStart(len, '0'); }

  // Sistema de coordenadas: planta baixa da fábrica em uma grade
  // de 0..1000 (x) por 0..600 (y), usada tanto pelo mapa (CRS.Simple)
  // quanto pelos cálculos de distância da IA.
  const FLOOR = { width: 1000, height: 600 };

  // --------------------------------------------------------
  // Estações (pontos fixos de origem/destino)
  // --------------------------------------------------------
  const STATIONS = [
    { id: 'EST-A', name: 'Estação A — Recebimento', x: 60, y: 500 },
    { id: 'EST-B', name: 'Estação B — Linha de Usinagem', x: 380, y: 500 },
    { id: 'EST-C', name: 'Estação C — Montagem', x: 620, y: 320 },
    { id: 'EST-D', name: 'Estação D — Pintura', x: 860, y: 500 },
    { id: 'EST-E', name: 'Estação E — Expedição', x: 900, y: 90 },
    { id: 'EST-F', name: 'Estação F — Armazém Central', x: 460, y: 90 },
  ];

  // --------------------------------------------------------
  // Corredores / grafo de percurso (usado pela IA para achar
  // caminhos entre estações via nós intermediários)
  // --------------------------------------------------------
  const NODES = [
    ...STATIONS.map(s => ({ id: s.id, x: s.x, y: s.y })),
    { id: 'N-01', x: 220, y: 500 },
    { id: 'N-02', x: 220, y: 320 },
    { id: 'N-03', x: 460, y: 320 },
    { id: 'N-04', x: 460, y: 500 },
    { id: 'N-05', x: 740, y: 500 },
    { id: 'N-06', x: 740, y: 320 },
    { id: 'N-07', x: 740, y: 90 },
    { id: 'N-08', x: 220, y: 90 },
  ];

  function nodeById(id) { return NODES.find(n => n.id === id); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // --------------------------------------------------------
  // Obstáculos e áreas bloqueadas
  // --------------------------------------------------------
  const OBSTACLE_TYPES = ['Pallet fora de posição', 'Manutenção em andamento', 'Empilhadeira manual', 'Material bloqueando via', 'Área interditada (segurança)'];
  const OBSTACLES = Array.from({ length: 10 }, (_, i) => ({
    id: `OBS-${pad(i + 1, 3)}`,
    type: choice(OBSTACLE_TYPES),
    x: rand(100, 940),
    y: rand(60, 540),
    active: Math.random() > 0.55,
    detectedAt: new Date(Date.now() - randInt(1, 240) * 60000).toISOString(),
  }));

  // --------------------------------------------------------
  // Pontos de interesse (coleta / entrega / carregamento)
  // --------------------------------------------------------
  const POI_TYPES = ['Coleta', 'Entrega', 'Ponto de Carregamento', 'Buffer', 'Checkpoint'];
  const POINTS_OF_INTEREST = Array.from({ length: 20 }, (_, i) => ({
    id: `POI-${pad(i + 1, 3)}`,
    type: choice(POI_TYPES),
    x: rand(80, 950),
    y: rand(60, 550),
  }));

  // --------------------------------------------------------
  // Sensores
  // --------------------------------------------------------
  const SENSOR_TYPES = ['Presença', 'Proximidade', 'Segurança', 'RFID', 'Posição', 'Obstáculo', 'Temperatura'];
  const SENSOR_STATUS = ['ONLINE', 'ONLINE', 'ONLINE', 'ONLINE', 'ALERTA', 'OFFLINE'];
  const SENSORS = Array.from({ length: 30 }, (_, i) => {
    const node = choice(NODES);
    return {
      id: `SENSOR-${pad(i + 1, 3)}`,
      type: choice(SENSOR_TYPES),
      x: node.x + rand(-40, 40),
      y: node.y + rand(-40, 40),
      status: choice(SENSOR_STATUS),
      lastTrigger: new Date(Date.now() - randInt(1, 600) * 1000).toISOString(),
      lastDetected: Math.random() > 0.3 ? choice(['AGV', 'AMR']) + '-' + pad(randInt(1, 10), 3) : '—',
    };
  });

  // --------------------------------------------------------
  // Rotas — cada rota liga duas estações através de uma
  // sequência de nós do grafo. Métricas base são geradas e
  // depois refinadas pelo ai.js (score, recomendação etc.)
  // --------------------------------------------------------
  const ROUTE_PATHS = [
    ['EST-A', 'N-01', 'EST-B'],
    ['EST-A', 'N-01', 'N-02', 'N-08', 'EST-F'],
    ['EST-B', 'N-04', 'N-03', 'EST-C'],
    ['EST-B', 'N-01', 'N-02', 'N-03', 'EST-C'],
    ['EST-C', 'N-06', 'N-05', 'EST-D'],
    ['EST-C', 'N-06', 'N-07', 'EST-E'],
    ['EST-D', 'N-05', 'N-04', 'EST-B'],
    ['EST-A', 'N-01', 'N-04', 'N-05', 'EST-D'],
    ['EST-F', 'N-08', 'N-02', 'N-03', 'EST-C'],
    ['EST-F', 'N-03', 'N-06', 'EST-C'],
    ['EST-E', 'N-07', 'N-06', 'EST-C'],
    ['EST-A', 'N-01', 'N-04', 'EST-B'],
    ['EST-D', 'N-05', 'N-06', 'EST-C'],
    ['EST-F', 'N-08', 'N-02', 'EST-A'],
    ['EST-E', 'N-07', 'N-06', 'N-05', 'EST-D'],
  ];

  const CONGESTION_LEVELS = ['Baixo', 'Médio', 'Alto'];

  function buildRoutes() {
    return ROUTE_PATHS.map((path, i) => {
      const points = path.map(nodeById);
      let distance = 0;
      for (let k = 0; k < points.length - 1; k++) distance += dist(points[k], points[k + 1]);
      const speedMps = 0.9; // velocidade média de referência (m/s equivalente em unidades de planta)
      const baseTimeMin = distance / speedMps / 60 * 3.6; // fator de escala para minutos "realistas"
      const congestion = choice(CONGESTION_LEVELS);
      const stops = randInt(0, 3);
      const sensorsOnPath = randInt(2, 8);
      const historicalFactor = rand(1.05, 1.6);

      return {
        id: `R-${pad(i + 1, 3)}`,
        origin: path[0],
        destination: path[path.length - 1],
        path,
        points,
        distance: Math.round(distance),
        estimatedTime: +baseTimeMin.toFixed(1),
        historicalTime: +(baseTimeMin * historicalFactor).toFixed(1),
        minTime: +(baseTimeMin * 0.9).toFixed(1),
        maxTime: +(baseTimeMin * (historicalFactor + 0.8)).toFixed(1),
        stops,
        sensorCount: sensorsOnPath,
        congestion,
        blocked: Math.random() < 0.07,
        energyUse: +rand(0.6, 1.0).toFixed(2), // 1.0 = referência de consumo
        safetyIndex: +rand(0.75, 1.0).toFixed(2),
        usageCount: randInt(20, 400),
        // score / status / reason são preenchidos pelo ai.js
        score: null,
        status: null,
        reason: null,
      };
    });
  }

  // --------------------------------------------------------
  // AGVs e AMRs
  // --------------------------------------------------------
  const EQUIPMENT_STATUS = ['ONLINE', 'EM MISSÃO', 'PARADO', 'CARREGANDO', 'MANUTENÇÃO', 'ALERTA'];
  const CARGO_TYPES = ['Vazio', 'Peças usinadas', 'Componentes de montagem', 'Tambor de tinta', 'Kit de expedição', 'Pallet padrão'];

  function buildFleet(prefix, count, routes) {
    return Array.from({ length: count }, (_, i) => {
      const route = choice(routes);
      const posIdx = randInt(0, route.points.length - 1);
      const pos = route.points[posIdx];
      const status = choice(EQUIPMENT_STATUS);
      return {
        id: `${prefix}-${pad(i + 1, 3)}`,
        kind: prefix,
        status,
        battery: randInt(12, 100),
        speed: status === 'EM MISSÃO' ? +rand(0.4, 1.4).toFixed(2) : 0,
        x: pos.x,
        y: pos.y,
        routeId: route.id,
        segmentIndex: posIdx,
        progress: 0,
        direction: 1,
        mission: status === 'EM MISSÃO' ? `MSN-${pad(randInt(1000, 9999), 4)}` : '—',
        destination: route.destination,
        eta: status === 'EM MISSÃO' ? `${randInt(1, 8)}m ${randInt(0, 59)}s` : '—',
        cargo: choice(CARGO_TYPES),
        lastSensor: choice(SENSORS).id,
      };
    });
  }

  // --------------------------------------------------------
  // Histórico de missões
  // --------------------------------------------------------
  function buildHistory(fleet, routes, count) {
    return Array.from({ length: count }, (_, i) => {
      const eq = choice(fleet);
      const route = choice(routes);
      const planned = route.estimatedTime;
      const real = +(planned * rand(0.85, 1.5)).toFixed(1);
      const daysAgo = randInt(0, 20);
      const d = new Date(Date.now() - daysAgo * 86400000 - randInt(0, 86400000));
      return {
        id: `MSN-${pad(randInt(1000, 9999), 4)}-${i}`,
        equipment: eq.id,
        origin: route.origin,
        destination: route.destination,
        routeId: route.id,
        plannedTime: planned,
        realTime: real,
        distance: route.distance,
        efficiency: Math.min(100, Math.round((planned / real) * 100)),
        date: d.toISOString().slice(0, 10),
        time: d.toTimeString().slice(0, 5),
        status: real <= planned * 1.15 ? 'CONCLUÍDA' : 'CONCLUÍDA COM ATRASO',
      };
    }).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
  }

  // --------------------------------------------------------
  // Montagem final do dataset
  // --------------------------------------------------------
  function generate() {
    const routes = buildRoutes();
    const agvs = buildFleet('AGV', 10, routes);
    const amrs = buildFleet('AMR', 8, routes);
    const fleet = [...agvs, ...amrs];
    const history = buildHistory(fleet, routes, 60);

    return {
      floor: FLOOR,
      stations: STATIONS,
      nodes: NODES,
      obstacles: OBSTACLES,
      pois: POINTS_OF_INTEREST,
      sensors: SENSORS,
      routes,
      agvs,
      amrs,
      fleet,
      history,
    };
  }

  global.FactoryData = {
    generate,
    nodeById,
    dist,
    utils: { rand, randInt, choice, pad },
  };
})(window);