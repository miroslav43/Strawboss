// Leaflet + Leaflet.Draw map HTML served to the WebView for the geofence_maker role.
//
// Same inline-string approach as leaflet-map-content.ts to avoid cleartext
// blocking on Android 9+.
export const LEAFLET_GEOFENCE_EDITOR_HTML = String.raw`<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Geofence Editor</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  onerror="document.getElementById('offline-msg').style.display='flex'" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
  onerror="document.getElementById('offline-msg').style.display='flex';
           window.LEAFLET_FAILED=true;
           if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:'MAP_READY',offline:true}))">
</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body, #map { width: 100%; height: 100%; }
  #offline-msg {
    display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    z-index: 9999; background: #F3DED8;
    flex-direction: column; justify-content: center; align-items: center;
    font-family: -apple-system, sans-serif; color: #5D4037; gap: 12px;
  }
  #offline-msg .icon { font-size: 48px; }
  #offline-msg .title { font-size: 18px; font-weight: 700; color: #0A5C36; }
  #offline-msg .subtitle { font-size: 14px; text-align: center; padding: 0 32px; }
  .user-marker {
    width: 16px; height: 16px;
    background: #2563eb;
    border: 3px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 8px rgba(37,99,235,0.6);
  }
  .map-tooltip {
    background: #fff;
    border-radius: 8px;
    padding: 6px 12px;
    font-family: -apple-system, sans-serif;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    color: #333;
  }
  /* T1 — fixed centre pin, drawn on top of the WebView (NOT a Leaflet
     layer) so it stays pinned to the screen centre while the map pans. */
  .center-pin {
    position: absolute;
    top: 50%; left: 50%;
    width: 22px; height: 22px;
    margin: -11px 0 0 -11px;
    border-radius: 50%;
    background: #DC2626;
    border: 3px solid #ffffff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.45);
    pointer-events: none;
    z-index: 9000;
  }
  .center-pin::after {
    content: '';
    position: absolute;
    top: 50%; left: 50%;
    width: 6px; height: 6px;
    margin: -3px 0 0 -3px;
    border-radius: 50%;
    background: rgba(0,0,0,0.35);
  }
</style>
</head>
<body>
<div id="map"></div>
<div id="center-pin" class="center-pin" style="display:none"></div>
<div id="offline-msg">
  <div class="icon">&#x1F4F6;</div>
  <div class="title">Harta necesit&#259; internet</div>
  <div class="subtitle">Conecteaz&#259;-te la internet pentru a &#238;nc&#259;rca harta.</div>
</div>
<script>
setTimeout(function() {
  if (typeof L === 'undefined' && !window.LEAFLET_FAILED) {
    window.LEAFLET_FAILED = true;
    document.getElementById('offline-msg').style.display = 'flex';
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({type: 'MAP_READY', offline: true}));
    }
  }
}, 8000);
</script>
<script>
(function() {
  if (typeof L === 'undefined') return;

  var map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    tap: true,
    tapTolerance: 8,
    touchZoom: 'center',
    bounceAtZoomLimits: false
  }).setView([45.3883, 21.2311], 12);

  var placeLabelsPane = map.createPane('placeLabels');
  placeLabelsPane.style.zIndex = 550;
  placeLabelsPane.style.pointerEvents = 'none';

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: '&copy; <a href="https://www.esri.com/">Esri</a> — Maxar, Earthstar, GIS community' }
  ).addTo(map);

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { pane: 'placeLabels', maxZoom: 19 }
  ).addTo(map);

  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

  // ── Layers ───────────────────────────────────────────────────────────
  var parcelsLayer    = L.layerGroup().addTo(map);
  var depositsLayer   = L.layerGroup().addTo(map);
  var userMarkerLayer = L.layerGroup().addTo(map);
  var drawnItems      = new L.FeatureGroup().addTo(map);

  // ── Multi-touch guard: block vertex placement while pinching ─────────
  var multiTouchActive = false;
  var multiTouchEndedAt = 0;
  var container = map.getContainer();
  container.addEventListener('touchstart', function(e) {
    if (e.touches && e.touches.length > 1) {
      multiTouchActive = true;
    }
  }, { passive: true });
  container.addEventListener('touchend', function(e) {
    if (multiTouchActive) {
      multiTouchEndedAt = Date.now();
    }
    if (!e.touches || e.touches.length === 0) {
      multiTouchActive = false;
    } else if (e.touches.length < 2) {
      // Still 1 finger down — kept multi-touch flag false but mark recent end
      multiTouchEndedAt = Date.now();
    }
  }, { passive: true });
  container.addEventListener('touchcancel', function() {
    if (multiTouchActive) multiTouchEndedAt = Date.now();
    multiTouchActive = false;
  }, { passive: true });

  function isPinchInProgress() {
    return multiTouchActive || (Date.now() - multiTouchEndedAt) < 400;
  }

  // ── Active draw handler (null when not drawing) ──────────────────────
  var activeDrawHandler = null;

  var polygonDrawOptions = {
    shapeOptions: { color: '#14b8a6', weight: 3, fillOpacity: 0.25 }
  };

  map.on(L.Draw.Event.CREATED, function(e) {
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);
    activeDrawHandler = null;
    sendEvent({ type: 'POLYGON_DRAWN', geojson: e.layer.toGeoJSON().geometry });
  });

  // ── Styles ───────────────────────────────────────────────────────────
  var parcelStyle  = { color: '#d97706', weight: 2, fillColor: '#f97316', fillOpacity: 0.25 };
  var parcelHighlightStyle = { color: '#dc2626', weight: 3, fillColor: '#ef4444', fillOpacity: 0.35 };
  var depositStyle = { color: '#1565C0', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.15, dashArray: '6, 4' };

  // ── Data setters ─────────────────────────────────────────────────────
  var allBounds = [];
  var parcelLayersById = {};
  var highlightedId = null;

  function setParcels(parcels) {
    parcelsLayer.clearLayers();
    parcelLayersById = {};
    highlightedId = null;
    allBounds = [];
    parcels.forEach(function(p) {
      var geojson = typeof p.boundary === 'string' ? JSON.parse(p.boundary) : p.boundary;
      if (!geojson) return;
      var layer = L.geoJSON(geojson, { style: function() { return parcelStyle; } });
      var label = p.name ? (p.name + ' (' + p.code + ')') : p.code;
      layer.bindTooltip(label, { sticky: true, className: 'map-tooltip' });
      layer.addTo(parcelsLayer);
      parcelLayersById[p.id] = layer;
      try { allBounds.push(layer.getBounds()); } catch(e) {}
    });
  }

  function setDestinations(destinations) {
    depositsLayer.clearLayers();
    destinations.forEach(function(d) {
      if (d.boundary) {
        var geojson = typeof d.boundary === 'string' ? JSON.parse(d.boundary) : d.boundary;
        var layer = L.geoJSON(geojson, { style: function() { return depositStyle; } });
        var label = d.name ? (d.name + ' (' + d.code + ')') : d.code;
        layer.bindTooltip(label, { sticky: true, className: 'map-tooltip' });
        layer.addTo(depositsLayer);
        try { allBounds.push(layer.getBounds()); } catch(e) {}
      } else if (d.lat != null && d.lon != null) {
        var marker = L.circleMarker([d.lat, d.lon], {
          radius: 8, color: '#1565C0', fillColor: '#3b82f6', fillOpacity: 0.5, weight: 2
        });
        var label2 = d.name ? (d.name + ' (' + d.code + ')') : d.code;
        marker.bindTooltip(label2, { className: 'map-tooltip' });
        marker.addTo(depositsLayer);
      }
    });
  }

  function fitBounds() {
    if (allBounds.length === 0) return;
    var combined = allBounds[0];
    for (var i = 1; i < allBounds.length; i++) { combined = combined.extend(allBounds[i]); }
    map.fitBounds(combined, { padding: [30, 30] });
  }

  function setUserLocation(lat, lon) {
    userMarkerLayer.clearLayers();
    var icon = L.divIcon({ className: 'user-marker', iconSize: [16, 16], iconAnchor: [8, 8] });
    L.marker([lat, lon], { icon: icon, interactive: false }).addTo(userMarkerLayer);
  }

  function highlightParcel(parcelId) {
    if (highlightedId && parcelLayersById[highlightedId]) {
      parcelLayersById[highlightedId].setStyle(parcelStyle);
    }
    var layer = parcelLayersById[parcelId];
    if (!layer) return;
    layer.setStyle(parcelHighlightStyle);
    highlightedId = parcelId;
    try { map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 18 }); } catch(e) {}
  }

  function centerOn(lat, lon, zoom) {
    map.setView([lat, lon], zoom || 16);
  }

  function enableDraw() {
    if (activeDrawHandler) { activeDrawHandler.disable(); }
    drawnItems.clearLayers();
    activeDrawHandler = new L.Draw.Polygon(map, polygonDrawOptions);

    // Monkey-patch addVertex to reject taps that occur during pinch-zoom
    var origAddVertex = activeDrawHandler.addVertex.bind(activeDrawHandler);
    activeDrawHandler.addVertex = function(latlng) {
      if (isPinchInProgress()) return;
      return origAddVertex(latlng);
    };

    activeDrawHandler.enable();
  }

  function disableDraw() {
    if (activeDrawHandler) {
      activeDrawHandler.disable();
      activeDrawHandler = null;
    }
    drawnItems.clearLayers();
  }

  // ── Command handler ──────────────────────────────────────────────────
  window.handleCommand = function(cmd) {
    switch (cmd.type) {
      case 'SET_PARCELS':       setParcels(cmd.parcels); break;
      case 'SET_DESTINATIONS':  setDestinations(cmd.destinations); break;
      case 'FIT_BOUNDS':        fitBounds(); break;
      case 'SET_USER_LOCATION': setUserLocation(cmd.lat, cmd.lon); break;
      case 'ENABLE_DRAW':       enableDraw(); break;
      case 'DISABLE_DRAW':      disableDraw(); break;
      case 'HIGHLIGHT_PARCEL':  highlightParcel(cmd.parcelId); break;
      case 'CENTER_ON':         centerOn(cmd.lat, cmd.lon, cmd.zoom); break;
      // T1 — center-pin point picker
      case 'ENABLE_POINT_DRAW': {
        var pinOn = document.getElementById('center-pin');
        if (pinOn) pinOn.style.display = 'block';
        break;
      }
      case 'DISABLE_POINT_DRAW': {
        var pinOff = document.getElementById('center-pin');
        if (pinOff) pinOff.style.display = 'none';
        break;
      }
      case 'GET_CENTER': {
        var c = map.getCenter();
        sendEvent({ type: 'POINT_DRAWN', lat: c.lat, lon: c.lng });
        break;
      }
    }
  };

  // ── Event sender ─────────────────────────────────────────────────────
  function sendEvent(evt) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(evt));
    }
  }

  sendEvent({ type: 'MAP_READY' });
})();
</script>
</body>
</html>`;
