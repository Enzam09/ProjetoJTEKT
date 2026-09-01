/* ============================================================
   app.js — JTEKT Smart Route AI
   Controlador principal: navegação entre telas, popula a UI a
   partir de data.js, orquestra ai.js e map.js, e roda a
   simulação de tempo real (movimentação de AGVs/AMRs).
   ============================================================ */

(function () {
  'use strict';

  // --------------------------------------------------------
  // Estado global da aplicação
  // --------------------------------------------------------
  const DB = window.FactoryData.generate();
  AIOptimizer.scoreAllRoutes(DB.routes);

  let map = null;
  let alerts = [];
  let simTimer = null;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const stationName = id => (DB.stations.find(s => s.id === id) || {}).name || id;

  // --------------------------------------------------------
  // Navegação entre telas
  // --------------------------------------------------------
  function goToView(viewId) {
    $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === viewId));
    $$('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + viewId));
    const titles = {
      dashboard: ['Dashboard', 'Visão geral da operação em tempo real'],
      mapa: ['Mapa de Percursos', 'Planta digital da fábrica com rotas, frota e sensores'],
      agvs: ['AGVs', 'Frota de veículos guiados automaticamente'],
      amrs: ['AMRs', 'Frota de robôs móveis autônomos'],
      sensores: ['Sensores', 'Rede de sensores de piso de fábrica'],
      rotas: ['Rotas', 'Malha de percursos cadastrados'],
      ia: ['Inteligência Artificial', 'AI Route Optimizer — otimização inteligente de trajetos'],
      historico: ['Histórico', 'Missões concluídas'],
      indicadores: ['Indicadores', 'KPIs operacionais'],
      alertas: ['Alertas', 'Eventos e notificações do sistema'],
      config: ['Configurações', 'Preferências do sistema'],
    };
    const [t, sub] = titles[viewId] || ['JTEKT Smart Route AI', ''];
    $('#viewTitle').textContent = t;
    $('#viewSubtitle').textContent = sub;
    document.body.classList.remove('sidebar-open');

    if (viewId === 'mapa' && map) setTimeout(() => map.map.invalidateSize(), 60);
  }

  function wireNav() {
    $$('.nav-item').forEach(el => {
      el.addEventListener('click', () => goToView(el.dataset.view));
    });
    $('#menuToggle').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  }

  // --------------------------------------------------------
  // Relógio + status topo
  // --------------------------------------------------------
  function tickClock() {
    const now = new Date();
    $('#clockTime').textContent = now.toLocaleTimeString('pt-BR');
    $('#clockDate').textContent = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
  }

  function updateTopbarCounts() {
    const onlineAgv = DB.agvs.filter(a => a.status !== 'MANUTENÇÃO' && a.status !== 'PARADO').length;
    const onlineAmr = DB.amrs.filter(a => a.status !== 'MANUTENÇÃO' && a.status !== 'PARADO').length;
    const onlineSensors = DB.sensors.filter(s => s.status === 'ONLINE').length;
    $('#topAgvCount').textContent = `${onlineAgv}/${DB.agvs.length}`;
    $('#topAmrCount').textContent = `${onlineAmr}/${DB.amrs.length}`;
    $('#topSensorCount').textContent = `${onlineSensors}/${DB.sensors.length}`;
  }

  // --------------------------------------------------------
  // DASHBOARD
  // --------------------------------------------------------
  function renderSparkline(containerId, values, max) {
    const el = $(containerId);
    if (!el) return;
    const m = max || Math.max(...values, 1);
    el.innerHTML = values.map(v => `<div class="bar" style="height:${Math.max(4, (v / m) * 100)}%"></div>`).join('');
  }

  function renderDashboard() {
    const onlineAgv = DB.agvs.filter(a => a.status !== 'MANUTENÇÃO').length;
    const onlineAmr = DB.amrs.filter(a => a.status !== 'MANUTENÇÃO').length;
    const onlineSensors = DB.sensors.filter(s => s.status === 'ONLINE').length;
    const activeMissions = DB.fleet.filter(f => f.status === 'EM MISSÃO').length;
    const activeRoutes = DB.routes.filter(r => !r.blocked).length;
    const optimizedRoutes = DB.routes.filter(r => r.status === 'RECOMENDADA').length;
    const avgTime = (DB.routes.reduce((s, r) => s + r.estimatedTime, 0) / DB.routes.length).toFixed(1);
    const avgEff = Math.round(DB.routes.reduce((s, r) => s + r.score, 0) / DB.routes.length);
    const activeAlerts = alerts.filter(a => a.level === 'crit' || a.level === 'warn').length;

    const kpis = [
      { label: 'AGVs Online', value: `${onlineAgv}/${DB.agvs.length}`, cls: 'ok', sub: 'Operando normalmente' },
      { label: 'AMRs Online', value: `${onlineAmr}/${DB.amrs.length}`, cls: 'ok', sub: 'Operando normalmente' },
      { label: 'Sensores Online', value: `${onlineSensors}/${DB.sensors.length}`, cls: onlineSensors / DB.sensors.length > 0.85 ? 'ok' : 'warn', sub: 'Rede de sensoriamento' },
      { label: 'Missões Ativas', value: activeMissions, cls: 'info', sub: 'Em execução agora' },
      { label: 'Rotas Ativas', value: `${activeRoutes}/${DB.routes.length}`, cls: 'ok', sub: `${DB.routes.length - activeRoutes} bloqueada(s)` },
      { label: 'Rotas Otimizadas p/ IA', value: optimizedRoutes, cls: 'info', sub: 'Score ≥ 90' },
      { label: 'Tempo Médio de Percurso', value: avgTime, unit: 'min', cls: 'info', sub: 'Média da malha atual' },
      { label: 'Eficiência das Rotas', value: avgEff, unit: '%', cls: avgEff >= 85 ? 'ok' : 'warn', sub: 'Score médio da IA' },
      { label: 'Alertas Ativos', value: activeAlerts, cls: activeAlerts > 0 ? 'crit' : 'ok', sub: activeAlerts > 0 ? 'Requer atenção' : 'Tudo normal' },
    ];

    $('#dashKpis').innerHTML = kpis.map(k => `
      <div class="kpi-card ${k.cls}">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${k.value}${k.unit ? `<span class="unit">${k.unit}</span>` : ''}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    `).join('');

    renderSparkline('#sparkMissions', DB.history.slice(0, 14).map(h => h.plannedTime).reverse());
    renderSparkline('#sparkCongestion', DB.routes.map(r => r.congestion === 'Alto' ? 3 : r.congestion === 'Médio' ? 2 : 1));
    renderSparkline('#sparkEfficiency', DB.routes.map(r => r.score));

    renderTimeSaved();
    renderTopRoutesMini();
    renderAlertsMini();
  }

  function renderTimeSaved() {
    const hours = AIOptimizer.estimateTimeSaved(DB.history);
    $('#timeSavedValue').textContent = hours;
  }

  function renderTopRoutesMini() {
    const top3 = DB.routes.slice(0, 3);
    $('#dashTopRoutes').innerHTML = top3.map(r => routeCardHtml(r, false)).join('');
  }

  function renderAlertsMini() {
    const list = alerts.slice(0, 5);
    $('#dashAlerts').innerHTML = list.length
      ? list.map(alertHtml).join('')
      : `<div class="kpi-sub">Nenhum alerta no momento.</div>`;
  }

  // --------------------------------------------------------
  // MAPA
  // --------------------------------------------------------
  function initMap() {
    map = new FactoryMap('factoryMap', DB);
    $('#zoomIn').addEventListener('click', () => map.zoomIn());
    $('#zoomOut').addEventListener('click', () => map.zoomOut());
    $('#zoomCenter').addEventListener('click', () => map.center());
    $('#zoomSat').addEventListener('click', () => map.toggleSatellite());

    $$('#layerToggles input').forEach(input => {
      input.addEventListener('change', () => map.toggleLayer(input.value, input.checked));
    });
  }

  // --------------------------------------------------------
  // TABELAS: AGVs / AMRs
  // --------------------------------------------------------
  function statusPillClass(status) {
    if (['ONLINE', 'EM MISSÃO', 'CONCLUÍDA'].includes(status)) return 'ok';
    if (['CARREGANDO', 'PARADO'].includes(status)) return 'info';
    if (['ALERTA', 'CONCLUÍDA COM ATRASO'].includes(status)) return 'warn';
    if (['MANUTENÇÃO'].includes(status)) return 'crit';
    return 'info';
  }

  function batteryColor(pct) {
    if (pct < 20) return 'var(--red)';
    if (pct < 45) return 'var(--yellow)';
    return 'var(--green)';
  }

  function renderFleetTable(containerId, fleet) {
    $(containerId).innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th class="mono">ID</th><th>Status</th><th>Bateria</th><th>Velocidade</th>
          <th>Missão</th><th>Rota</th><th>Destino</th><th>ETA</th><th>Carga</th><th>Último sensor</th>
        </tr></thead>
        <tbody>
          ${fleet.map(eq => `
            <tr>
              <td class="mono">${eq.id}</td>
              <td><span class="status-pill ${statusPillClass(eq.status)}"><span class="dot"></span>${eq.status}</span></td>
              <td><span class="battery-bar"><span style="width:${eq.battery}%;background:${batteryColor(eq.battery)}"></span></span>${eq.battery}%</td>
              <td class="mono">${eq.speed} m/s</td>
              <td class="mono">${eq.mission}</td>
              <td class="mono">${eq.routeId}</td>
              <td>${stationName(eq.destination)}</td>
              <td class="mono">${eq.eta}</td>
              <td>${eq.cargo}</td>
              <td class="mono">${eq.lastSensor}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // --------------------------------------------------------
  // TABELA: Sensores
  // --------------------------------------------------------
  function renderSensorsTable() {
    $('#sensorsTable').innerHTML = `
      <table class="data-table">
        <thead><tr><th class="mono">ID</th><th>Tipo</th><th>Status</th><th>Último acionamento</th><th>Equipamento detectado</th></tr></thead>
        <tbody>
          ${DB.sensors.map(s => `
            <tr>
              <td class="mono">${s.id}</td>
              <td>${s.type}</td>
              <td><span class="status-pill ${s.status === 'ONLINE' ? 'ok' : s.status === 'ALERTA' ? 'warn' : 'crit'}"><span class="dot"></span>${s.status}</span></td>
              <td class="mono">${new Date(s.lastTrigger).toLocaleTimeString('pt-BR')}</td>
              <td class="mono">${s.lastDetected}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // --------------------------------------------------------
  // ROTAS (tabela + cards de ranking IA)
  // --------------------------------------------------------
  function scoreClass(score) { return score >= 90 ? 'high' : score >= 70 ? 'mid' : 'low'; }
  function medal(i) { return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`; }

  function routeCardHtml(r, withReason) {
    return `
      <div class="route-card ${r === DB.routes[0] ? '' : ''}">
        <div class="route-medal">${r.blocked ? '⛔' : r.status === 'RECOMENDADA' ? '🟢' : r.status === 'ALTERNATIVA' ? '🟡' : '🔴'}</div>
        <div class="route-info">
          <div class="route-id">${r.id} <span style="color:var(--text-lo);font-weight:400">— ${stationName(r.origin)} → ${stationName(r.destination)}</span></div>
          <div class="route-path">Congestionamento: ${r.congestion} · ${r.stops} parada(s) · ${r.sensorCount} sensores</div>
        </div>
        <div class="route-score ${scoreClass(r.score)}">${r.score}</div>
        ${withReason ? `<div class="route-reason">${r.reason}</div>` : ''}
      </div>
    `;
  }

  function renderRoutesView() {
    $('#routesRanked').innerHTML = DB.routes.slice().sort((a, b) => b.score - a.score)
      .map(r => routeCardHtml(r, true)).join('');

    $('#routesTable').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th class="mono">ID</th><th>Origem</th><th>Destino</th><th>Distância</th><th>Tempo est.</th>
          <th>Tempo médio</th><th>Sensores</th><th>Paradas</th><th>Congest.</th><th>Eficiência</th><th>Score IA</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${DB.routes.map(r => `
            <tr>
              <td class="mono">${r.id}</td>
              <td>${stationName(r.origin)}</td>
              <td>${stationName(r.destination)}</td>
              <td class="mono">${r.distance} m</td>
              <td class="mono">${r.estimatedTime} min</td>
              <td class="mono">${r.historicalTime} min</td>
              <td class="mono">${r.sensorCount}</td>
              <td class="mono">${r.stops}</td>
              <td>${r.congestion}</td>
              <td class="mono">${r.score}%</td>
              <td class="mono">${r.score}</td>
              <td><span class="status-pill ${r.blocked ? 'crit' : r.status === 'RECOMENDADA' ? 'ok' : r.status === 'ALTERNATIVA' ? 'warn' : 'crit'}"><span class="dot"></span>${r.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // --------------------------------------------------------
  // IA — otimização sob demanda
  // --------------------------------------------------------
  function populateOptimizerSelects() {
    const opts = DB.stations.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    $('#optOrigin').innerHTML = opts;
    $('#optDestination').innerHTML = opts;
    $('#optDestination').selectedIndex = 1;
    $('#optEquip').innerHTML = DB.fleet.map(f => `<option value="${f.id}">${f.id} (${f.kind})</option>`).join('');
  }

  function runOptimization() {
    const origin = $('#optOrigin').value;
    const destination = $('#optDestination').value;
    const equipId = $('#optEquip').value;
    const result = AIOptimizer.optimize(DB.routes, origin, destination);

    if (!result.best) {
      $('#optimizerResult').innerHTML = `<div class="panel"><p class="kpi-sub">${result.message} Tente outra combinação de origem/destino, ou cadastre uma nova rota.</p></div>`;
      if (map) map.clearHighlight();
      return;
    }

    const cards = [result.best, ...result.alternatives].map((r, i) => `
      <div class="route-card ${i === 0 ? 'rank-1' : ''}">
        <div class="route-medal">${medal(i)}</div>
        <div class="route-info">
          <div class="route-id">${r.id} <span style="color:var(--text-lo);font-weight:400">— ${equipId}</span></div>
          <div class="route-path">Tempo: ${r.estimatedTime} min · Distância: ${r.distance} m · Congest.: ${r.congestion}</div>
        </div>
        <div class="route-score ${scoreClass(r.score)}">${r.score}</div>
        <div class="route-reason">${r.reason}</div>
      </div>
    `).join('');

    $('#optimizerResult').innerHTML = `
      <div class="panel-title">Resultado da Otimização <small>${result.alternatives.length + 1} rota(s) candidata(s)</small></div>
      <div class="route-cards">${cards}</div>
    `;

    if (map) {
      map.highlightRoute(result.best);
      goToView('mapa');
    }
    pushAlert('ok', `Rota ${result.best.id} otimizada pela IA para ${equipId}`, new Date());
  }

  // --------------------------------------------------------
  // HISTÓRICO
  // --------------------------------------------------------
  function renderHistoryTable(filterEquip, filterStatus) {
    let rows = DB.history;
    if (filterEquip) rows = rows.filter(h => h.equipment === filterEquip);
    if (filterStatus) rows = rows.filter(h => h.status === filterStatus);

    $('#historyTable').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th class="mono">Missão</th><th>Equip.</th><th>Origem</th><th>Destino</th><th class="mono">Rota</th>
          <th>Planejado</th><th>Real</th><th>Distância</th><th>Eficiência</th><th>Data</th><th>Hora</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${rows.map(h => `
            <tr>
              <td class="mono">${h.id}</td>
              <td class="mono">${h.equipment}</td>
              <td>${stationName(h.origin)}</td>
              <td>${stationName(h.destination)}</td>
              <td class="mono">${h.routeId}</td>
              <td class="mono">${h.plannedTime} min</td>
              <td class="mono">${h.realTime} min</td>
              <td class="mono">${h.distance} m</td>
              <td class="mono">${h.efficiency}%</td>
              <td class="mono">${h.date}</td>
              <td class="mono">${h.time}</td>
              <td><span class="status-pill ${h.status === 'CONCLUÍDA' ? 'ok' : 'warn'}"><span class="dot"></span>${h.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function wireHistoryFilters() {
    $('#histEquipFilter').innerHTML = `<option value="">Todos os equipamentos</option>` + DB.fleet.map(f => `<option value="${f.id}">${f.id}</option>`).join('');
    $('#histStatusFilter').innerHTML = `<option value="">Todos os status</option><option value="CONCLUÍDA">Concluída</option><option value="CONCLUÍDA COM ATRASO">Concluída com atraso</option>`;
    const apply = () => renderHistoryTable($('#histEquipFilter').value, $('#histStatusFilter').value);
    $('#histEquipFilter').addEventListener('change', apply);
    $('#histStatusFilter').addEventListener('change', apply);
  }

  // --------------------------------------------------------
  // INDICADORES
  // --------------------------------------------------------
  function renderIndicators() {
    const mostEfficient = DB.routes.slice().sort((a, b) => b.score - a.score)[0];
    const mostUsed = DB.routes.slice().sort((a, b) => b.usageCount - a.usageCount)[0];
    const optimizedPct = Math.round((DB.routes.filter(r => r.status === 'RECOMENDADA').length / DB.routes.length) * 100);
    const highCongestion = DB.routes.filter(r => r.congestion === 'Alto').length;

    $('#indicatorsGrid').innerHTML = `
      <div class="kpi-card ok">
        <div class="kpi-label">Rota Mais Eficiente</div>
        <div class="kpi-value mono" style="font-size:20px">${mostEfficient.id}</div>
        <div class="kpi-sub">Score IA ${mostEfficient.score}/100</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-label">Rota Mais Utilizada</div>
        <div class="kpi-value mono" style="font-size:20px">${mostUsed.id}</div>
        <div class="kpi-sub">${mostUsed.usageCount} missões no período</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-label">% Rotas Otimizadas pela IA</div>
        <div class="kpi-value">${optimizedPct}<span class="unit">%</span></div>
        <div class="kpi-sub">Score ≥ 90 sobre o total</div>
      </div>
      <div class="kpi-card ${highCongestion > 2 ? 'warn' : 'ok'}">
        <div class="kpi-label">Rotas com Congestionamento Alto</div>
        <div class="kpi-value">${highCongestion}</div>
        <div class="kpi-sub">De ${DB.routes.length} rotas cadastradas</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-label">Tempo Economizado pela IA</div>
        <div class="kpi-value">${AIOptimizer.estimateTimeSaved(DB.history)}<span class="unit">h/mês</span></div>
        <div class="kpi-sub">Extrapolação sobre o histórico</div>
      </div>
      <div class="kpi-card ok">
        <div class="kpi-label">Eficiência Média das Rotas</div>
        <div class="kpi-value">${Math.round(DB.routes.reduce((s, r) => s + r.score, 0) / DB.routes.length)}<span class="unit">%</span></div>
        <div class="kpi-sub">Score médio da malha</div>
      </div>
    `;

    renderSparkline('#indTimePerRoute', DB.routes.map(r => r.estimatedTime), Math.max(...DB.routes.map(r => r.maxTime)));
    renderSparkline('#indMissionsPerDay', groupHistoryByDay());
  }

  function groupHistoryByDay() {
    const map7 = {};
    DB.history.forEach(h => { map7[h.date] = (map7[h.date] || 0) + 1; });
    const days = Object.keys(map7).sort().slice(-10);
    return days.map(d => map7[d]);
  }

  // --------------------------------------------------------
  // ALERTAS
  // --------------------------------------------------------
  function alertHtml(a) {
    const icon = a.level === 'crit' ? '🔴' : a.level === 'warn' ? '⚠' : '🟢';
    return `
      <div class="alert-item ${a.level}">
        <div class="alert-icon">${icon}</div>
        <div class="alert-text"><b>${a.title}</b>${a.detail || ''}</div>
        <div class="alert-time mono">${a.time.toLocaleTimeString('pt-BR')}</div>
      </div>
    `;
  }

  function pushAlert(level, title, time, detail) {
    alerts.unshift({ level, title, time, detail });
    alerts = alerts.slice(0, 40);
    renderAlertsView();
    renderAlertsMini();
    updateAlertBadge();
  }

  function renderAlertsView() {
    const el = $('#alertsList');
    if (!el) return;
    el.innerHTML = alerts.length ? alerts.map(alertHtml).join('') : `<div class="kpi-sub">Nenhum alerta registrado.</div>`;
  }

  function updateAlertBadge() {
    const count = alerts.filter(a => a.level === 'crit' || a.level === 'warn').length;
    const badge = $('#alertBadge');
    if (badge) badge.textContent = count > 0 ? count : '';
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }

  function seedInitialAlerts() {
    DB.fleet.filter(f => f.battery < 20).forEach(f => pushAlert('warn', `${f.id} com bateria abaixo de 20%`, new Date(Date.now() - Math.random() * 600000)));
    DB.routes.filter(r => r.congestion === 'Alto').slice(0, 3).forEach(r => pushAlert('warn', `Rota ${r.id} congestionada`, new Date(Date.now() - Math.random() * 600000)));
    DB.sensors.filter(s => s.status === 'OFFLINE').slice(0, 3).forEach(s => pushAlert('crit', `Sensor ${s.id} sem comunicação`, new Date(Date.now() - Math.random() * 600000)));
    DB.routes.filter(r => r.blocked).forEach(r => pushAlert('crit', `Obstáculo detectado na rota ${r.id}`, new Date(Date.now() - Math.random() * 600000)));
    const best = DB.routes[0];
    pushAlert('ok', `Rota ${best.id} otimizada pela IA`, new Date());
    alerts.sort((a, b) => b.time - a.time);
  }

  // --------------------------------------------------------
  // SIMULAÇÃO EM TEMPO REAL
  // --------------------------------------------------------
  function stepFleet() {
    DB.fleet.forEach(eq => {
      if (eq.status !== 'EM MISSÃO') return;
      const route = DB.routes.find(r => r.id === eq.routeId);
      if (!route || route.points.length < 2) return;

      const a = route.points[eq.segmentIndex];
      const b = route.points[Math.min(eq.segmentIndex + eq.direction, route.points.length - 1)];
      const segLen = FactoryData.dist(a, b) || 1;
      eq.progress += (eq.speed * 6) / segLen;

      if (eq.progress >= 1) {
        eq.progress = 0;
        eq.segmentIndex += eq.direction;
        if (eq.segmentIndex >= route.points.length - 1 || eq.segmentIndex <= 0) {
          eq.direction *= -1;
          eq.segmentIndex = Math.max(0, Math.min(route.points.length - 1, eq.segmentIndex));
        }
      }
      const p1 = route.points[eq.segmentIndex];
      const p2 = route.points[Math.min(Math.max(eq.segmentIndex + eq.direction, 0), route.points.length - 1)];
      eq.x = p1.x + (p2.x - p1.x) * eq.progress;
      eq.y = p1.y + (p2.y - p1.y) * eq.progress;

      eq.battery = Math.max(3, eq.battery - 0.02);
      if (eq.battery < 20 && Math.random() < 0.002) {
        pushAlert('warn', `${eq.id} com bateria abaixo de 20%`, new Date());
      }
    });
  }

  function simulationTick() {
    stepFleet();
    if (map) map.updateFleetPositions();

    const dashActive = $('#view-dashboard').classList.contains('active');
    const agvActive = $('#view-agvs').classList.contains('active');
    const amrActive = $('#view-amrs').classList.contains('active');
    if (dashActive) updateTopbarCounts();
    if (agvActive) renderFleetTable('#agvTable', DB.agvs);
    if (amrActive) renderFleetTable('#amrTable', DB.amrs);
  }

  function startSimulation() {
    simTimer = setInterval(simulationTick, 1200);
  }

  // --------------------------------------------------------
  // TEMA CLARO/ESCURO
  // --------------------------------------------------------
  function wireTheme() {
    const btn = $('#themeToggle');
    btn.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      document.documentElement.setAttribute('data-theme', isLight ? 'dark' : 'light');
      btn.textContent = isLight ? '🌙' : '☀';
    });
  }

  // --------------------------------------------------------
  // INICIALIZAÇÃO
  // --------------------------------------------------------
  function init() {
    wireNav();
    wireTheme();
    tickClock();
    setInterval(tickClock, 1000);

    initMap();
    renderDashboard();
    renderFleetTable('#agvTable', DB.agvs);
    renderFleetTable('#amrTable', DB.amrs);
    renderSensorsTable();
    renderRoutesView();
    populateOptimizerSelects();
    wireHistoryFilters();
    renderHistoryTable();
    renderIndicators();
    seedInitialAlerts();
    updateTopbarCounts();

    $('#optimizeBtn').addEventListener('click', runOptimization);
    $('#clearHighlightBtn').addEventListener('click', () => map && map.clearHighlight());

    startSimulation();
  }

  document.addEventListener('DOMContentLoaded', init);
})();