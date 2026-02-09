31st -2,2
24th -2,2
17th -2,2,1.5,3
10th -0
3rd  -0

=16.5// plugin/turbine-map.js
(function () {
  var MAPBOX_JS  = "https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.js";
  var MAPBOX_CSS = "https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.css";

  function ensureLink(href) {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) if (links[i].href === href) return Promise.resolve();
    return new Promise(function (res) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = res;
      document.head.appendChild(link);
    });
  }

  function ensureScript(src) {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) if (scripts[i].src === src) return Promise.resolve();
    return new Promise(function (res) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = res;
      document.head.appendChild(s);
    });
  }

  function once(emitter, eventName) {
    return new Promise(function (res) { emitter.once(eventName, res); });
  }

  var TurbineMap = (function (_super) {
    function TurbineMap() {
      var _this = _super.call(this) || this;
      _this.attachShadow({ mode: 'open' });
      var root = document.createElement('div');
      root.className = 'map-holder';
      root.innerHTML =
        '<style>' +
        ':host{display:block}' +
        '.map-holder{border:1px solid #999;background:#fff;}' +
        '.map-container{width:100%;min-height:300px;position:relative;height:100%;}' +
        '.msg{position:absolute;left:8px;top:8px;z-index:2;background:#0008;color:#fff;padding:6px 8px;border-radius:4px;font:12px/1.3 system-ui,Segoe UI,Roboto,Arial,sans-serif}' +
        '#map{width:100%;height:100%;}' +
        '</style>' +
        '<div class="map-container"><div class="msg" id="msg">Loading…</div><div id="map"></div></div>';
      _this.shadowRoot.appendChild(root);
      _this._map = null;
      return _this;
    }

    TurbineMap.observedAttributes = [
      'mapbox-token','width','height','centre',
      'coordinates-url','model-url','model-url2',
      'scale','rotation-x','rotation-y','rotation-z',
      'style-url','z-offset'
    ];

    TurbineMap.prototype.attribute = function (name, fallback) {
      var v = this.getAttribute(name);
      return (v === null || v === undefined || v === '') ? fallback : v;
    };

    TurbineMap.prototype.connectedCallback = function () {
      var _this = this;
      (function () { return Promise.resolve().then(function () { return _this._init(); }); })()
      .catch(function (err) {
        console.error(err);
        var msg = _this.shadowRoot.getElementById('msg');
        if (msg) msg.textContent = 'Error: ' + err.message;
      });
    };

    TurbineMap.prototype.disconnectedCallback = function () {
      if (this._map) {
        this._map.remove();
        this._map = null;
      }
    };

    TurbineMap.prototype._init = async function () {
      // 1) Apply size
      this.style.width  = this.attribute('width',  '100%');
      this.style.height = this.attribute('height', '600px');
      this.shadowRoot.querySelector('.map-container').style.height = '100%';

      // 2) Ensure Mapbox GL v3 CSS + JS
      await ensureLink(MAPBOX_CSS);
      if (!window.mapboxgl) await ensureScript(MAPBOX_JS);

      // 3) Read attributes
      var token = this.attribute('mapbox-token');
      if (!token) throw new Error('Missing attribute: mapbox-token');
      mapboxgl.accessToken = token;

      var coordsUrl = this.attribute('coordinates-url');
      if (!coordsUrl) throw new Error('Missing attribute: coordinates-url');

      var modelUrl  = this.attribute('model-url');
      if (!modelUrl) throw new Error('Missing attribute: model-url');

      var modelUrl2 = this.getAttribute('model-url2'); // optional
      var scale     = Number(this.attribute('scale', '20')); // start visible; tune down later
      var rx        = Number(this.attribute('rotation-x', '90'));
      var ry        = Number(this.attribute('rotation-y', '0'));
      var rz        = Number(this.attribute('rotation-z', '0'));
      var zOffset   = Number(this.attribute('z-offset', '0'));
      var styleUrl  = this.attribute('style-url', 'mapbox://styles/mapbox/standard-satellite');

      var msg = this.shadowRoot.getElementById('msg');
      msg.textContent = 'Loading coordinates…';

      // 4) Load + parse coordinate file: type,bearing,name,lat,lon,(elev-ignored)
      var resp = await fetch(coordsUrl, { cache: 'no-cache' });
      if (!resp.ok) throw new Error('Failed to load coordinates: ' + resp.status);
      var text = await resp.text();
      text = text.replace(/^\uFEFF/, '');
      var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);

      var features = [];
      for (var i = 0; i < lines.length; i++) {
        var raw = lines[i];
        if (!raw || raw[0] === '#') continue;
        var parts = raw.split(',').map(function (s) { return s.trim(); });
        if (parts.length < 5) continue;
        var type    = parts[0];
        var bearing = Number(parts[1] || 0);
        var name    = parts[2] || ('T' + (i + 1));
        var lat     = Number(parts[3]);
        var lon     = Number(parts[4]);
        if (!isFinite(lat) || !isFinite(lon)) continue;

        features.push({
          type: 'Feature',
          id: name,
          properties: { id: name, name: name, type: String(type), bearing: bearing },
          geometry: { type: 'Point', coordinates: [lon, lat] }
        });
      }
      if (!features.length) throw new Error('No valid features found in coordinates file');

      // 5) Centre: attribute or first turbine
      var firstLngLat = features[0].geometry.coordinates.slice();
      var centreAttr = this.getAttribute('centre');
      var centre = centreAttr ? centreAttr.split(',').map(function (s) { return Number(s.trim()); }) : firstLngLat;

      // 6) Build map
      msg.textContent = 'Initializing map…';
      var mapContainer = this.shadowRoot.getElementById('map');
      this._map = new mapboxgl.Map({
        container: mapContainer,
        style: styleUrl,
        center: centre,
        zoom: 13,
        pitch: 70,
        bearing: 20,
        antialias: true
      });
      window.turbineMap = this._map; // optional: allow console access

      var self = this;
      this._map.on('style.load', async function () {
        try {
          msg.textContent = 'Adding terrain…';

          // 7) DEM + terrain (needed for queryTerrainElevation)
          self._map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14
          });
          self._map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.0 });

          // 8) Register model(s) and add GeoJSON with promoteId
          self._map.addModel('turbine0', modelUrl);
          if (modelUrl2) self._map.addModel('turbine1', modelUrl2);

          self._map.addSource('turbines', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: features },
            promoteId: 'id'
          });

          // Pre-seed feature-state z=0 to avoid null errors on first paint
          for (var j = 0; j < features.length; j++) {
            var f = features[j];
            self._map.setFeatureState({ source: 'turbines', id: f.properties.id }, { z: 0 });
          }

          function addTurbineLayer(id, typeValue, modelId) {
            var filter = (typeValue === null)
              ? ['boolean', true]
              : ['==', ['get','type'], String(typeValue)];

            self._map.addLayer({
              id: id,
              type: 'model',
              source: 'turbines',
              filter: filter,
              layout: { 'model-id': modelId },
              paint: {
                'model-rotation': [rx, ['+', ry, ['get','bearing']], rz],
                'model-translation': [0, 0, ['+', ['coalesce', ['feature-state','z'], 0], zOffset]],
                'model-scale': [scale, scale, scale]
              }
            });
          }

          if (modelUrl2) {
            addTurbineLayer('turbine-layer-type0', '0', 'turbine0');
            addTurbineLayer('turbine-layer-type1', '1', 'turbine1');
          } else {
            addTurbineLayer('turbine-layer', null, 'turbine0');
          }

          msg.textContent = 'Querying terrain elevations…';
          await once(self._map, 'idle');

          // 9) Set real Z from DEM
          var minLng =  Infinity, minLat =  Infinity, maxLng = -Infinity, maxLat = -Infinity;
          for (var k = 0; k < features.length; k++) {
            var ft = features[k];
            var lng = ft.geometry.coordinates[0];
            var lat = ft.geometry.coordinates[1];
            var z = self._map.queryTerrainElevation([lng, lat], { exaggerated: false }) || 0;
            self._map.setFeatureState({ source: 'turbines', id: ft.properties.id }, { z: z });

            if (lng < minLng) minLng = lng;
            if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng;
            if (lat > maxLat) maxLat = lat;
          }

          if (features.length > 1) {
            self._map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
              padding: 120, pitch: 70, bearing: 20, duration: 1000
            });
          }

          msg.textContent = 'Loaded ' + features.length + ' turbine(s)';
        } catch (e) {
          console.error(e);
          msg.textContent = 'Error: ' + e.message;
        }
      });
    };

    return TurbineMap;
  })(HTMLElement);

  customElements.define('turbine-map', TurbineMap);
})();
  function ensureScript(src) {
    if ([...document.scripts].some(s => s.src === src)) return Promise.resolve();
    return new Promise(res => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => res();
      document.head.appendChild(s);
    });
  }

  class TurbineMap extends HTMLElement {
    static get observedAttributes() {
      return ['mapbox-token','width','height','centre','coordinates-url','model-url','model-url2','scale','rotation-x','rotation-y','rotation-z','style-url'];
    }
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._root = document.createElement('div');
      this._root.className = 'map-holder';
      this._root.innerHTML = `
        <style>
          :host{display:block}
          .map-holder{border:1px solid #999;background:#fff;}
          .map-container{width:100%;min-height:300px;position:relative}
          .msg{position:absolute;left:8px;top:8px;z-index:2;background:#0008;color:#fff;padding:6px 8px;border-radius:4px;font:12px/1.3 system-ui,Segoe UI,Roboto,Arial,sans-serif}
        </style>
        <div class="map-container"><div class="msg" id="msg">Loading…</div><div id="map" style="width:100%;height:100%;"></div></div>
      `;
      this.shadowRoot.appendChild(this._root);
      this._map = null;
    }
    attribute(name, fallback) {
      const v = this.getAttribute(name);
      return (v === null || v === undefined || v === '') ? fallback : v;
    }
    async connectedCallback() {
      try {
        // Apply size
        const w = this.attribute('width', '100%');
        const h = this.attribute('height', '600px');
        this.style.width = w;
        this.style.height = h;
        this.shadowRoot.querySelector('.map-container').style.height = '100%';

        // Ensure Mapbox GL JS v3 is available
        await ensureLink(MAPBOX_CSS);
        await ensureScript(MAPBOX_JS);
        if (!window.mapboxgl) throw new Error('Mapbox GL JS failed to load');

        // Inputs
        const token = this.attribute('pk.eyJ1IjoiZ3JlaWdydXNzZWxsIiwiYSI6ImNtbGY0ZjduYTAwdGwzZnNmNWNkbXJ4NTkifQ.5RoqcgVSVJ1gsA6WAXa0YQ');
        if (!token) throw new Error('Missing attribute: mapbox-token');
        mapboxgl.accessToken = token;

        const coordsUrl = this.attribute('coordinates-url');
        if (!coordsUrl) throw new Error('Missing attribute: coordinates-url');

        const modelUrl = this.attribute('model-url');
        if (!modelUrl) throw new Error('Missing attribute: model-url');

        const modelUrl2 = this.getAttribute('model-url2'); // optional
        const scale = Number(this.attribute('scale', '1')); // start conservative
        const rx = Number(this.attribute('rotation-x', '90')); // make upright by default
        const ry = Number(this.attribute('rotation-y', '0'));
        const rz = Number(this.attribute('rotation-z', '0'));

        const styleUrl = this.attribute('style-url', 'mapbox://styles/mapbox/standard-satellite');

        const msg = this.shadowRoot.getElementById('msg');
        msg.textContent = 'Loading coordinates…';

        // Fetch and parse coord file: "type,bearing,name,lat,lon,elev"
        const text = await fetch(coordsUrl, { cache: 'no-cache' }).then(r => {
          if (!r.ok) throw new Error(`Failed to load coordinates: ${r.status}`);
          return r.text();
        });
        const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);

        const features = [];
        for (let i = 0; i < lines.length; i++) {
          const raw = lines[i];
          if (!raw || raw.startsWith('#')) continue;
          const parts = raw.split(',').map(s => s.trim());
          if (parts.length < 5) continue;
          const type = parts[0];                  // string/number like "0" / "1"
          const bearing = Number(parts[1] || 0);  // degrees CW from north
          const name = parts[2] || `T${i+1}`;
          const lat = Number(parts[3]);
          const lon = Number(parts[4]);
          if (!isFinite(lat) || !isFinite(lon)) continue;

          features.push({
            type: 'Feature',
            id: name,
            properties: { id: name, name, type: String(type), bearing },
            geometry: { type: 'Point', coordinates: [lon, lat] }
          });
        }
        if (!features.length) throw new Error('No valid features found in coordinates file');

        // Determine centre: first turbine lat/lon (as requested)
        const firstLngLat = features[0].geometry.coordinates.slice();
        const centreAttr = this.getAttribute('centre'); // if the user provided an explicit centre
        const centre = centreAttr ? centreAttr.split(',').map(s => Number(s.trim())) : firstLngLat;

        // Build map
        msg.textContent = 'Initializing map…';
        const mapContainer = this.shadowRoot.getElementById('map');
        this._map = new mapboxgl.Map({
          container: mapContainer,
          style: styleUrl, // v3 style suitable for model layers
          center: centre,
          zoom: 13,
          pitch: 70,
          bearing: 20,
          antialias: true
        });

        this._map.on('style.load', async () => {
          try {
            msg.textContent = 'Adding terrain…';

            // DEM terrain is required for queryTerrainElevation
            this._map.addSource('mapbox-dem', {
              type: 'raster-dem',
              url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
              tileSize: 512,
              maxzoom: 14
            });
            this._map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.0 });

            // Register one or two models
            this._map.addModel('turbine0', modelUrl);
            if (modelUrl2) this._map.addModel('turbine1', modelUrl2);

            // One GeoJSON source with all turbines
            this._map.addSource('turbines', {
              type: 'geojson',
              data: { type: 'FeatureCollection', features },
              promoteId: 'id'
            });

            // If two models provided, we’ll split with two layers filtered by ["==", ["get","type"], "0"/"1"].
            const addTurbineLayer = (id, typeValue, modelId) => {
              const filter = typeValue === null ? ['boolean', true] : ['==', ['get','type'], String(typeValue)];
              this._map.addLayer({
                id,
                type: 'model',
                source: 'turbines',
                filter,
                layout: {
                  'model-id': modelId
                },
                paint: {
                  // Base rotation (rx,rz) + data-driven bearing (applied on Y)
                  'model-rotation': [
                    'literal', [rx, 0, rz]
                  ],
                  // We'll add bearing by overriding via model-overrides expression below (v3 supports per-node overrides),
                  // but to keep it simple and compatible, just add bearing into Y with an expression:
                  // [rx, ry + bearing, rz]
                  // Achieve this by separate property that v3 accepts as array:
                  // We can't put expression inside 'literal', so compute full triple:
                  // Note: v3 supports expressions per component:
                  // We'll build [rx, (ry + bearing), rz] as: [rx, ["+", ry, ["get","bearing"]], rz]
                  'model-rotation': [
                    'literal',
                    [rx, 0, rz] // placeholder, replaced below after addLayer due to expression constraints in some builds
                  ],
                  'model-translation': [0, 0, ['feature-state', 'z']],
                  'model-scale': [scale, scale, scale]
                }
              });
              // Set the rotation with expression now (avoid some bundlers mangling nested arrays):
              this._map.setPaintProperty(id, 'model-rotation', [rx, ['+', ry, ['get','bearing']], rz]);
            };

            if (modelUrl2) {
              addTurbineLayer('turbine-layer-type0', '0', 'turbine0');
              addTurbineLayer('turbine-layer-type1', '1', 'turbine1');
            } else {
              addTurbineLayer('turbine-layer', null, 'turbine0');
            }

            msg.textContent = 'Querying terrain elevations…';
            // Wait for terrain tiles, then set z for each feature via feature-state
            await new Promise(res => this._map.once('idle', res));

            for (const f of features) {
              const [lng, lat] = f.geometry.coordinates;
              const z = this._map.queryTerrainElevation([lng, lat], { exaggerated: false }) || 0;
              this._map.setFeatureState({ source: 'turbines', id: f.properties.id }, { z });
            }

            msg.textContent = `Loaded ${features.length} turbine(s)`;

          } catch (e) {
            console.error(e);
            msg.textContent = `Error: ${e.message}`;
          }
        });

      } catch (err) {
        console.error(err);
        const msg = this.shadowRoot.getElementById('msg');
        if (msg) msg.textContent = `Error: ${err.message}`;
      }
    }
    disconnectedCallback() {
      if (this._map) {
        this._map.remove();
        this._map = null;
      }
    }
  }

  customElements.define('turbine-map', TurbineMap);
})();

