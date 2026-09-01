/* ============================================================
   map.js — Mapa Digital da Fábrica (JTEKT Smart Route AI)
   ------------------------------------------------------------
   Como o ambiente é uma planta industrial fechada (não uma
   localização geográfica real), o mapa usa Leaflet com
   L.CRS.Simple: as coordenadas x/y da fábrica (definidas em
   data.js) são tratadas como um plano cartesiano puro, o que
   permite reaproveitar toda a infraestrutura de zoom, camadas
   e popups do Leaflet para uma planta baixa.
   ============================================================ */

(function (global) {
  'use strict';

  function FactoryMap(containerId, dataset) {
    this.dataset = dataset;
    this.map = null;
    this.layers = {};
    this.markers = { agv: {}, amr: {}, sensor: {}, obstacle: {}, station: {} };
    this.routeLines = {};
    this.highlightLine = null;
    this.satelliteMode = false;
    this._init(containerId);
  }

  FactoryMap.prototype._init = function (containerId) {
    const bounds = [[0, 0], [this.dataset.floor.height, this.dataset.floor.width]];

    this.map = L.map(containerId, {
      crs: L.CRS.Simple,
      minZoom: -1,
      maxZoom: 4,
      zoomControl: false,
      attributionControl: false,
    });

    this.map.fitBounds(bounds);
    this.floorBounds = bounds;

    // "Piso" da fábrica — retângulo base do chão de fábrica
    this.floorRect = L.rectangle(bounds, {
      color: 'transparent',
      weight: 0,
      fillColor: '#0d1420',
      fillOpacity: 1,
    }).addTo(this.map);

    this._drawGrid();
    this._drawCorridors();

    this.layers.routes = L.layerGroup().addTo(this.map);
    this.layers.agv = L.layerGroup().addTo(this.map);
    this.layers.amr = L.layerGroup().addTo(this.map);
    this.layers.sensors = L.layerGroup().addTo(this.map);
    this.layers.obstacles = L.layerGroup().addTo(this.map);
    this.layers.blocked = L.layerGroup().addTo(this.map);
    this.layers.stations = L.layerGroup().addTo(this.map);
    this.layers.highlight = L.layerGroup().addTo(this.map);

    this._drawStations();
    this._drawObstacles();
    this._drawSensors();
    this._drawRoutes();
    this._drawFleet();

    this.map.setView(this._toLatLng(this.dataset.floor.width / 2, this.dataset.floor.height / 2), 0);
  };

  // Converte coordenadas x,y da planta (0..width, 0..height) em
  // lat,lng do Leaflet (y é invertido: Leaflet cresce para cima).
  FactoryMap.prototype._toLatLng = function (x, y) {
    return L.latLng(this.dataset.floor.height - y, x);
  };

  FactoryMap.prototype._drawGrid = function () {
    const { width, height } = this.dataset.floor;
    const step = 50;
    const group = L.layerGroup().addTo(this.map);
    for (let gx = 0; gx <= width; gx += step) {
      L.polyline([this._toLatLng(gx, 0), this._toLatLng(gx, height)], { color: '#1a2432', weight: 1, interactive: false }).addTo(group);
    }
    for (let gy = 0; gy <= height; gy += step) {
      L.polyline([this._toLatLng(0, gy), this._toLatLng(width, gy)], { color: '#1a2432', weight: 1, interactive: false }).addTo(group);
    }
  };

  FactoryMap.prototype._drawCorridors = function () {
    const group = L.layerGroup().addTo(this.map);
    const seen = new Set();
    this.dataset.routes.forEach(route => {
      for (let i = 0; i < route.points.length - 1; i++) {
        const a = route.points[i], b = route.points[i + 1];
        const key = [a.x, a.y, b.x, b.y].join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        L.polyline([this._toLatLng(a.x, a.y), this._toLatLng(b.x, b.y)], {
          color: '#28384a', weight: 10, opacity: 0.5, interactive: false, lineCap: 'round',
        }).addTo(group);
      }
    });
  };

  FactoryMap.prototype._divIcon = function (html, size) {
    return L.divIcon({ html, className: 'factory-marker', iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
  };

  FactoryMap.prototype._drawStations = function () {
    this.dataset.stations.forEach(st => {
      const icon = this._divIcon(`<div class="marker-station"><span>${st.id.split('-')[1]}</span></div>`, [34, 34]);
      const m = L.marker(this._toLatLng(st.x, st.y), { icon }).addTo(this.layers.stations);
      m.bindPopup(`<b>${st.name}</b><br>ID: ${st.id}`);
      this.markers.station[st.id] = m;
    });
  };

  FactoryMap.prototype._drawObstacles = function () {
    this.dataset.obstacles.forEach(ob => {
      if (!ob.active) return;
      const icon = this._divIcon(`<div class="marker-obstacle">⚠</div>`, [24, 24]);
      const m = L.marker(this._toLatLng(ob.x, ob.y), { icon }).addTo(this.layers.obstacles);
      m.bindPopup(`<b>${ob.id}</b><br>${ob.type}<br><small>Detectado: ${new Date(ob.detectedAt).toLocaleTimeString('pt-BR')}</small>`);
      this.markers.obstacle[ob.id] = m;
    });
  };

  FactoryMap.prototype._sensorClass = function (status) {
    return status === 'ONLINE' ? 'ok' : status === 'ALERTA' ? 'warn' : 'off';
  };

  FactoryMap.prototype._drawSensors = function () {
    this.dataset.sensors.forEach(s => {
      const icon = this._divIcon(`<div class="marker-sensor ${this._sensorClass(s.status)}"></div>`, [12, 12]);
      const m = L.marker(this._toLatLng(s.x, s.y), { icon }).addTo(this.layers.sensors);
      m.bindPopup(() => `
        <b>${s.id}</b><br>
        Tipo: ${s.type}<br>
        Status: ${s.status}<br>
        Último acionamento: ${new Date(s.lastTrigger).toLocaleTimeString('pt-BR')}<br>
        Equipamento detectado: ${s.lastDetected}
      `);
      this.markers.sensor[s.id] = m;
    });
  };

  FactoryMap.prototype._routeColor = function (route) {
    if (route.blocked) return '#ff3d57';
    if (route.congestion === 'Alto') return '#ff8a3d';
    if (route.status === 'RECOMENDADA') return '#00e676';
    return '#ffb300';
  };

  FactoryMap.prototype._drawRoutes = function () {
    this.layers.routes.clearLayers();
    this.routeLines = {};
    this.dataset.routes.forEach(route => {
      const latlngs = route.points.map(p => this._toLatLng(p.x, p.y));
      const line = L.polyline(latlngs, {
        color: this._routeColor(route),
        weight: 4,
        opacity: 0.85,
        dashArray: route.blocked ? '6,6' : null,
      }).addTo(this.layers.routes);
      line.bindPopup(`<b>${route.id}</b><br>${route.origin} → ${route.destination}<br>Score IA: ${route.score ?? '—'}`);
      this.routeLines[route.id] = line;
    });
  };

  FactoryMap.prototype.refreshRouteColors = function () {
    this.dataset.routes.forEach(route => {
      const line = this.routeLines[route.id];
      if (line) line.setStyle({ color: this._routeColor(route), dashArray: route.blocked ? '6,6' : null });
    });
  };

  FactoryMap.prototype._equipIconHtml = function (eq) {
    const cls = eq.kind === 'AGV' ? 'agv' : 'amr';
    const alert = eq.status === 'ALERTA' || eq.battery < 20 ? ' pulse' : '';
    return `<div class="marker-equip ${cls}${alert}"><span>${eq.kind === 'AGV' ? '▲' : '●'}</span></div>`;
  };

  FactoryMap.prototype._drawFleet = function () {
    this.dataset.fleet.forEach(eq => {
      const icon = this._divIcon(this._equipIconHtml(eq), [26, 26]);
      const m = L.marker(this._toLatLng(eq.x, eq.y), { icon }).addTo(this.layers[eq.kind.toLowerCase()]);
      m.bindPopup(() => this._equipPopup(eq));
      this.markers[eq.kind.toLowerCase()][eq.id] = m;
    });
  };

  FactoryMap.prototype._equipPopup = function (eq) {
    return `
      <b>${eq.id}</b> (${eq.kind})<br>
      Status: ${eq.status}<br>
      Bateria: ${eq.battery}%<br>
      Velocidade: ${eq.speed} m/s<br>
      Missão: ${eq.mission}<br>
      Destino: ${eq.destination}<br>
      ETA: ${eq.eta}<br>
      Carga: ${eq.cargo}
    `;
  };

  FactoryMap.prototype.updateFleetPositions = function () {
    this.dataset.fleet.forEach(eq => {
      const m = this.markers[eq.kind.toLowerCase()][eq.id];
      if (!m) return;
      m.setLatLng(this._toLatLng(eq.x, eq.y));
      m.setIcon(this._divIcon(this._equipIconHtml(eq), [26, 26]));
    });
  };

  FactoryMap.prototype.updateSensors = function () {
    this.dataset.sensors.forEach(s => {
      const m = this.markers.sensor[s.id];
      if (m) m.setIcon(this._divIcon(`<div class="marker-sensor ${this._sensorClass(s.status)}"></div>`, [12, 12]));
    });
  };

  // Destaca uma rota (a recomendada pela IA) por cima de tudo,
  // com uma linha verde mais grossa e um leve efeito de "pulso".
  FactoryMap.prototype.highlightRoute = function (route) {
    this.layers.highlight.clearLayers();
    if (!route) return;
    const latlngs = route.points.map(p => this._toLatLng(p.x, p.y));
    this.highlightLine = L.polyline(latlngs, {
      color: '#00e676', weight: 8, opacity: 0.35, className: 'route-pulse',
    }).addTo(this.layers.highlight);
    L.polyline(latlngs, { color: '#00e676', weight: 3, opacity: 1 }).addTo(this.layers.highlight);
    this.map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
  };

  FactoryMap.prototype.clearHighlight = function () {
    this.layers.highlight.clearLayers();
  };

  FactoryMap.prototype.toggleLayer = function (name, visible) {
    const layer = this.layers[name];
    if (!layer) return;
    if (visible) { if (!this.map.hasLayer(layer)) this.map.addLayer(layer); }
    else { if (this.map.hasLayer(layer)) this.map.removeLayer(layer); }
  };

  FactoryMap.prototype.zoomIn = function () { this.map.zoomIn(); };
  FactoryMap.prototype.zoomOut = function () { this.map.zoomOut(); };
  FactoryMap.prototype.center = function () { this.map.fitBounds(this.floorBounds); };

  FactoryMap.prototype.toggleSatellite = function () {
    this.satelliteMode = !this.satelliteMode;
    this.floorRect.setStyle({ fillColor: this.satelliteMode ? '#05100a' : '#0d1420' });
    document.getElementById(this.map._container.id).classList.toggle('satellite-mode', this.satelliteMode);
  };

  global.FactoryMap = FactoryMap;
})(window);