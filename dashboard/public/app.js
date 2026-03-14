// Smart Cone Dashboard v2 — Fleet Map + MQTT

(async function () {
  const MAX_LOG_ROWS = 50;

  // DOM elements
  const connectionDot = document.getElementById('connection-dot');
  const connectionText = document.getElementById('connection-text');
  const coneState = document.getElementById('cone-state');
  const coneId = document.getElementById('cone-id');
  const lastUpdate = document.getElementById('last-update');
  const deviceStatus = document.getElementById('device-status');
  const eventTbody = document.getElementById('event-tbody');
  const noEvents = document.getElementById('no-events');
  const btnSetupMode = document.getElementById('btn-setup-mode');
  const btnSimulator = document.getElementById('btn-simulator');
  const setupPanel = document.getElementById('setup-panel');
  const btnPlaceCone = document.getElementById('btn-place-cone');
  const newConeIdInput = document.getElementById('new-cone-id');
  const newConeLabelInput = document.getElementById('new-cone-label');
  const gpsStatus = document.getElementById('gps-status');
  const statTotal = document.getElementById('stat-total');
  const statOnline = document.getElementById('stat-online');
  const statAlerts = document.getElementById('stat-alerts');
  const statLastIncident = document.getElementById('stat-last-incident');

  // State
  let setupMode = false;
  let simulatorRunning = false;
  let simulatorInterval = null;
  let alertsToday = 0;
  let lastIncidentTime = null;
  const coneStates = {}; // { cone_id: { state, online, marker, lat, lng, label } }

  // --- Map Setup ---
  let userLat = 3.139, userLng = 101.6869; // Fallback: KL
  const map = L.map('map').setView([userLat, userLng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  // Auto-pan to user's GPS location
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      // Only pan if no cones loaded yet (otherwise fitBounds handles it)
      if (Object.keys(coneStates).length === 0) {
        map.setView([userLat, userLng], 16);
      }
    },
    () => {}, // Silently fall back to default
    { enableHighAccuracy: true, timeout: 15000 }
  );

  // Marker colors based on state
  function markerIcon(state, online) {
    if (!online) return grayIcon;
    if (state === 'KNOCKED_OVER') return redIcon;
    if (state === 'IMPACT_ALERT') return orangeIcon;
    return greenIcon;
  }

  // Create colored circle markers
  function createIcon(color) {
    return L.divIcon({
      className: 'cone-marker',
      html: `<div style="background:${color};width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }

  const greenIcon = createIcon('#22c55e');
  const redIcon = createIcon('#ef4444');
  const orangeIcon = createIcon('#f59e0b');
  const grayIcon = createIcon('#6b7280');

  // --- Load existing cones from API ---
  async function loadCones() {
    try {
      const res = await fetch('/api/cones');
      const cones = await res.json();
      cones.forEach(cone => {
        addConeToMap(cone.cone_id, cone.lat, cone.lng, cone.label);
      });
      updateStats();
      if (cones.length > 0) {
        const group = L.featureGroup(Object.values(coneStates).map(c => c.marker).filter(Boolean));
        map.fitBounds(group.getBounds().pad(0.2));
      }
    } catch (err) {
      console.error('Failed to load cones:', err);
    }
  }

  function addConeToMap(id, lat, lng, label) {
    if (coneStates[id] && coneStates[id].marker) {
      coneStates[id].marker.setLatLng([lat, lng]);
    } else {
      const marker = L.marker([lat, lng], { icon: greenIcon }).addTo(map);
      marker.bindPopup(`<strong>${id}</strong><br>${label || ''}<br>State: UPRIGHT`);
      coneStates[id] = { state: 'UPRIGHT', online: false, marker, lat, lng, label };
    }
  }

  function updateMarker(id) {
    const cone = coneStates[id];
    if (!cone || !cone.marker) return;
    cone.marker.setIcon(markerIcon(cone.state, cone.online));
    cone.marker.setPopupContent(
      `<strong>${id}</strong><br>${cone.label || ''}<br>State: ${cone.state}<br>${cone.online ? '🟢 Online' : '⚫ Offline'}`
    );
  }

  // --- Stats ---
  function updateStats() {
    const ids = Object.keys(coneStates);
    statTotal.textContent = ids.length;
    statOnline.textContent = ids.filter(id => coneStates[id].online).length;
    statAlerts.textContent = alertsToday;
    if (lastIncidentTime) {
      const ago = Math.round((Date.now() - lastIncidentTime) / 1000);
      if (ago < 60) statLastIncident.textContent = `${ago}s ago`;
      else if (ago < 3600) statLastIncident.textContent = `${Math.round(ago / 60)}m ago`;
      else statLastIncident.textContent = `${Math.round(ago / 3600)}h ago`;
    }
  }

  // Update "last incident" display every second
  setInterval(updateStats, 1000);

  // --- Connection State ---
  function setConnectionState(state) {
    connectionDot.className = 'dot ' + state;
    if (state === 'connected') connectionText.textContent = 'Connected';
    else if (state === 'connecting') connectionText.textContent = 'Connecting...';
    else connectionText.textContent = 'Disconnected';
  }

  // --- Cone Status Card ---
  const STATE_MAP = { UPRIGHT: 'upright', IMPACT_ALERT: 'impact_alert', KNOCKED_OVER: 'knocked_over' };

  function updateConeStatus(state, id, timestamp) {
    const cls = STATE_MAP[state] || 'upright';
    coneState.className = 'state ' + cls;
    coneState.textContent = state;
    if (id) coneId.textContent = id;
    if (timestamp) lastUpdate.textContent = formatTime(timestamp);
  }

  function setDeviceOnline(online) {
    deviceStatus.className = online ? 'online' : 'offline';
    deviceStatus.textContent = online ? 'Online' : 'Offline';
  }

  function eventToState(event) {
    if (event === 'impact') return 'IMPACT_ALERT';
    if (event === 'knockover') return 'KNOCKED_OVER';
    if (event === 'recovery') return 'UPRIGHT';
    return null;
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // --- Event Log ---
  function addEventRow(time, eventType, accelG, tiltDeg, id) {
    noEvents.style.display = 'none';
    const row = document.createElement('tr');

    const tdTime = document.createElement('td');
    tdTime.textContent = formatTime(time);

    const tdEvent = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'event-badge ' + (eventType === 'impact' ? 'impact' : eventType === 'knockover' ? 'knocked_over' : 'default');
    badge.textContent = eventType;
    tdEvent.appendChild(badge);

    const tdAccel = document.createElement('td');
    tdAccel.textContent = accelG != null ? Number(accelG).toFixed(2) : '--';

    const tdTilt = document.createElement('td');
    tdTilt.textContent = tiltDeg != null ? Number(tiltDeg).toFixed(1) : '--';

    const tdId = document.createElement('td');
    tdId.textContent = id || '--';

    row.append(tdTime, tdEvent, tdAccel, tdTilt, tdId);

    if (eventTbody.firstChild) {
      eventTbody.insertBefore(row, eventTbody.firstChild);
    } else {
      eventTbody.appendChild(row);
    }

    while (eventTbody.children.length > MAX_LOG_ROWS) {
      eventTbody.removeChild(eventTbody.lastChild);
    }
  }

  // --- Setup Mode ---
  btnSetupMode.addEventListener('click', () => {
    setupMode = !setupMode;
    btnSetupMode.classList.toggle('active', setupMode);
    btnSetupMode.textContent = setupMode ? 'Exit Setup' : 'Setup Mode';
    setupPanel.classList.toggle('hidden', !setupMode);
  });

  btnPlaceCone.addEventListener('click', () => {
    const id = newConeIdInput.value.trim();
    if (!id) {
      gpsStatus.textContent = 'Please enter a Cone ID.';
      return;
    }
    gpsStatus.textContent = 'Getting GPS location...';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const label = newConeLabelInput.value.trim();
        gpsStatus.textContent = `Got location: ${lat.toFixed(6)}, ${lng.toFixed(6)}. Saving...`;
        try {
          await fetch('/api/cones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cone_id: id, lat, lng, label }),
          });
          addConeToMap(id, lat, lng, label);
          updateStats();
          map.setView([lat, lng], 17);
          gpsStatus.textContent = `Cone "${id}" placed successfully!`;
          newConeIdInput.value = '';
          newConeLabelInput.value = '';
        } catch (err) {
          gpsStatus.textContent = 'Failed to save cone location.';
        }
      },
      (err) => {
        gpsStatus.textContent = `GPS error: ${err.message}`;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // --- Cone Simulator ---
  // Generate sim cones relative to a base position (real cone or user GPS)
  function generateSimCones(baseLat, baseLng) {
    return [
      { cone_id: 'sim-001', lat: baseLat + 0.0003, lng: baseLng + 0.0006, label: 'Zone A - Entry' },
      { cone_id: 'sim-002', lat: baseLat - 0.0004, lng: baseLng - 0.0007, label: 'Zone A - Mid' },
      { cone_id: 'sim-003', lat: baseLat - 0.0008, lng: baseLng + 0.0002, label: 'Zone B - South' },
      { cone_id: 'sim-004', lat: baseLat + 0.0008, lng: baseLng - 0.0010, label: 'Zone B - North' },
    ];
  }

  btnSimulator.addEventListener('click', async () => {
    if (simulatorRunning) {
      clearInterval(simulatorInterval);
      simulatorRunning = false;
      btnSimulator.textContent = 'Start Simulator';
      btnSimulator.classList.remove('active');
      return;
    }

    simulatorRunning = true;
    btnSimulator.textContent = 'Stop Simulator';
    btnSimulator.classList.add('active');

    // Determine base position: use real cone if placed, otherwise user GPS
    const realCone = coneStates['cone-001'];
    const baseLat = realCone ? realCone.lat : userLat;
    const baseLng = realCone ? realCone.lng : userLng;

    // If real cone not on map yet, place it at base position
    if (!realCone) {
      const rc = { cone_id: 'cone-001', lat: baseLat, lng: baseLng, label: 'Zone A - Main Gate' };
      try {
        await fetch('/api/cones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rc),
        });
        addConeToMap(rc.cone_id, rc.lat, rc.lng, rc.label);
        coneStates[rc.cone_id].online = true;
        updateMarker(rc.cone_id);
      } catch (err) {
        console.error('Failed to place real cone:', err);
      }
    }

    // Generate sim cones near the real cone / user position
    const simCones = generateSimCones(baseLat, baseLng);

    // Place simulated cones on map via API
    for (const sim of simCones) {
      try {
        await fetch('/api/cones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sim),
        });
        addConeToMap(sim.cone_id, sim.lat, sim.lng, sim.label);
        // Set them online
        coneStates[sim.cone_id].online = true;
        updateMarker(sim.cone_id);
      } catch (err) {
        console.error('Failed to place sim cone:', err);
      }
    }
    updateStats();

    // Fit map to show all cones
    const allMarkers = Object.values(coneStates).map(c => c.marker).filter(Boolean);
    if (allMarkers.length) {
      map.fitBounds(L.featureGroup(allMarkers).getBounds().pad(0.2));
    }

    // Randomly trigger events
    simulatorInterval = setInterval(() => {
      const sim = simCones[Math.floor(Math.random() * simCones.length)];
      const events = ['impact', 'knockover'];
      const event = events[Math.floor(Math.random() * events.length)];
      const accelG = (Math.random() * 5 + 2).toFixed(2);
      const tiltDeg = (Math.random() * 60 + 20).toFixed(1);
      const now = new Date();

      // Update map marker
      const state = eventToState(event);
      if (coneStates[sim.cone_id]) {
        coneStates[sim.cone_id].state = state;
        updateMarker(sim.cone_id);

        // Auto-recover after 5 seconds
        setTimeout(() => {
          if (coneStates[sim.cone_id]) {
            coneStates[sim.cone_id].state = 'UPRIGHT';
            updateMarker(sim.cone_id);
            addEventRow(new Date(), 'recovery', null, null, sim.cone_id);
          }
        }, 5000);
      }

      // Update stats
      alertsToday++;
      lastIncidentTime = Date.now();
      updateStats();

      // Add to event log
      addEventRow(now, event, accelG, tiltDeg, sim.cone_id);
    }, 4000); // Event every 4 seconds
  });

  // --- Load cones and start MQTT ---
  await loadCones();

  let config;
  try {
    const res = await fetch('/api/config');
    config = await res.json();
  } catch (err) {
    console.error('Failed to fetch MQTT config:', err);
    connectionText.textContent = 'Config error';
    return;
  }

  const client = mqtt.connect(config.broker, {
    username: config.username,
    password: config.password,
    protocol: 'wss',
    reconnectPeriod: 5000,
  });

  client.on('connect', function () {
    console.log('MQTT connected');
    setConnectionState('connected');
    client.subscribe('smartcones/+/event');
    client.subscribe('smartcones/+/status');
  });

  client.on('reconnect', function () {
    setConnectionState('connecting');
  });

  client.on('close', function () {
    setConnectionState('disconnected');
  });

  client.on('offline', function () {
    setConnectionState('disconnected');
  });

  client.on('error', function (err) {
    console.error('MQTT error:', err);
    setConnectionState('disconnected');
  });

  client.on('message', function (topic, message) {
    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch (e) {
      console.warn('Invalid JSON on', topic, message.toString());
      return;
    }

    const now = new Date();
    const parts = topic.split('/');
    const topicConeId = parts[1];
    const topicType = parts[2];

    if (topicType === 'event') {
      const eventConeId = payload.cone_id || topicConeId;
      const eventType = payload.event || 'unknown';
      const accelG = payload.accel_g;
      const tiltDeg = payload.tilt_deg;

      // Update status card (shows last active cone)
      const derivedState = eventToState(eventType);
      if (derivedState) {
        updateConeStatus(derivedState, eventConeId, now);
      }

      // Update map marker
      if (coneStates[eventConeId]) {
        coneStates[eventConeId].state = derivedState || 'UPRIGHT';
        coneStates[eventConeId].online = true;
        updateMarker(eventConeId);
      }

      // Update stats
      alertsToday++;
      lastIncidentTime = Date.now();
      updateStats();

      // Add to event log
      addEventRow(now, eventType, accelG, tiltDeg, eventConeId);

    } else if (topicType === 'status') {
      const online = payload.status === 'online';
      const statusConeId = payload.cone_id || topicConeId;

      setDeviceOnline(online);
      if (statusConeId) coneId.textContent = statusConeId;
      lastUpdate.textContent = formatTime(now);

      // Update map marker
      if (coneStates[statusConeId]) {
        coneStates[statusConeId].online = online;
        if (!online) coneStates[statusConeId].state = 'UPRIGHT';
        updateMarker(statusConeId);
      }
      updateStats();
    }
  });
})();
