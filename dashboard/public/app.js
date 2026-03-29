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

  // --- Toast Notifications ---
  const toastContainer = document.getElementById('toast-container');

  function showToast(title, message, actionText, actionCallback) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span class="toast-icon"><i class="fa-solid fa-circle-plus"></i></span>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      ${actionText ? `<button class="toast-action">${actionText}</button>` : ''}
      <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => toast.remove());

    if (actionText && actionCallback) {
      const actionBtn = toast.querySelector('.toast-action');
      actionBtn.addEventListener('click', () => {
        actionCallback();
        toast.remove();
      });
    }

    toastContainer.appendChild(toast);

    // Auto-dismiss after 15 seconds
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 15000);
  }

  // State
  let setupMode = false;
  let simulatorRunning = false;
  let simulatorInterval = null;
  let alertsToday = 0;
  let lastIncidentTime = null;
  const coneStates = {}; // { cone_id: { state, online, marker, lat, lng, label } }
  const coneEventHistory = {}; // { cone_id: [{time, event, accelG, tiltDeg}] }

  // Detail panel DOM elements (needed early for recordConeEvent)
  const detailPanel = document.getElementById('detail-panel');
  const detailClose = document.getElementById('detail-close');
  const detailConeId = document.getElementById('detail-cone-id');
  const detailState = document.getElementById('detail-state');
  const detailOnline = document.getElementById('detail-online');
  const detailLabelEl = document.getElementById('detail-label');
  const detailCoords = document.getElementById('detail-coords');
  const detailLastEvent = document.getElementById('detail-last-event');
  const detailEvents = document.getElementById('detail-events');

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
    if (state === 'DISTURBED') return orangeIcon;
    if (state === 'INTRUSION') return blueIcon;
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
  const blueIcon = createIcon('#3b82f6');

  const simIcon = L.divIcon({
    className: 'cone-marker sim-marker',
    html: `<div style="background:#6b7280;width:16px;height:16px;border-radius:3px;border:2px dashed white;box-shadow:0 2px 6px rgba(0,0,0,0.3);opacity:0.7;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

  // --- Load existing cones from API ---
  async function loadCones() {
    try {
      const res = await fetch('/api/cones');
      const cones = await res.json();
      cones.forEach(cone => {
        if (!cone.cone_id.startsWith('sim-')) {
          addConeToMap(cone.cone_id, cone.lat, cone.lng, cone.label);
        }
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
    if (cone.simulated) {
      // Sim cones keep their distinct icon
      cone.marker.setPopupContent(
        `<strong>[SIM] ${id}</strong><br>${cone.label || ''}<br>State: ${cone.state}`
      );
      return;
    }
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
  const STATE_MAP = { UPRIGHT: 'upright', IMPACT_ALERT: 'impact_alert', DISTURBED: 'disturbed', KNOCKED_OVER: 'knocked_over', INTRUSION: 'intrusion' };

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
    if (event === 'disturbed') return 'DISTURBED';
    if (event === 'intrusion') return 'INTRUSION';
    return null;
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // --- Event Log ---
  function formatDate(date) {
    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  function addEventRow(time, eventType, accelG, tiltDeg, id) {
    noEvents.style.display = 'none';
    const row = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = formatDate(time);
    tdDate.setAttribute('data-label', 'Date');

    const tdTime = document.createElement('td');
    tdTime.textContent = formatTime(time);
    tdTime.setAttribute('data-label', 'Time');

    const tdEvent = document.createElement('td');
    tdEvent.setAttribute('data-label', 'Event');
    const badge = document.createElement('span');
    badge.className = 'event-badge ' + (eventType === 'impact' ? 'impact' : eventType === 'knockover' ? 'knocked_over' : eventType === 'disturbed' ? 'disturbed' : eventType === 'recovery' ? 'recovery' : eventType === 'intrusion' ? 'intrusion' : 'default');
    let badgeIcon = '';
    if (eventType === 'impact') badgeIcon = '<i class="fa-solid fa-bolt"></i> ';
    else if (eventType === 'knockover') badgeIcon = '<i class="fa-solid fa-triangle-exclamation"></i> ';
    else if (eventType === 'disturbed') badgeIcon = '<i class="fa-solid fa-hand"></i> ';
    else if (eventType === 'recovery') badgeIcon = '<i class="fa-solid fa-check"></i> ';
    else if (eventType === 'intrusion') badgeIcon = '<i class="fa-solid fa-person-walking"></i> ';
    badge.innerHTML = badgeIcon + eventType;
    tdEvent.appendChild(badge);

    const tdAccel = document.createElement('td');
    tdAccel.textContent = accelG != null ? Number(accelG).toFixed(2) : '--';
    tdAccel.setAttribute('data-label', 'Accel (g)');

    const tdTilt = document.createElement('td');
    tdTilt.textContent = tiltDeg != null ? Number(tiltDeg).toFixed(1) : '--';
    tdTilt.setAttribute('data-label', 'Tilt (deg)');

    const tdId = document.createElement('td');
    tdId.textContent = id || '--';
    tdId.setAttribute('data-label', 'Cone ID');

    row.append(tdDate, tdTime, tdEvent, tdAccel, tdTilt, tdId);

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
    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.classList.remove('hidden');
  });

  // Close setup panel when cone is placed
  btnPlaceCone.addEventListener('click', () => {
    // Panel will be hidden after successful placement
    setTimeout(() => {
      if (gpsStatus.textContent.includes('successfully')) {
        setupPanel.classList.add('hidden');
      }
    }, 1000);
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
          coneStates[id].online = true;
          updateMarker(id);
          attachMarkerClick(id);
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
      btnSimulator.innerHTML = '<i class="fa-solid fa-play"></i> Start Simulator';
      btnSimulator.classList.remove('active');
      // Remove sim cones from map
      Object.keys(coneStates).forEach(id => {
        if (id.startsWith('sim-')) {
          if (coneStates[id].marker) map.removeLayer(coneStates[id].marker);
          delete coneStates[id];
        }
      });
      updateStats();
      return;
    }

    simulatorRunning = true;
    btnSimulator.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Simulator';
    btnSimulator.classList.add('active');

    // Determine base position: use first real (non-sim) cone, otherwise user GPS
    const realConeId = Object.keys(coneStates).find(id => !id.startsWith('sim-'));
    const realCone = realConeId ? coneStates[realConeId] : null;
    const baseLat = realCone ? realCone.lat : userLat;
    const baseLng = realCone ? realCone.lng : userLng;

    // Generate sim cones near the real cone / user position
    const simCones = generateSimCones(baseLat, baseLng);

    // Place simulated cones on map via API
    for (const sim of simCones) {
      // Sim cones are in-memory only — not persisted to KV
      const marker = L.marker([sim.lat, sim.lng], { icon: simIcon }).addTo(map);
      marker.bindPopup(`<strong>[SIM] ${sim.cone_id}</strong><br>${sim.label || ''}<br>State: UPRIGHT`);
      coneStates[sim.cone_id] = { state: 'UPRIGHT', online: true, marker, lat: sim.lat, lng: sim.lng, label: sim.label, simulated: true };
      attachMarkerClick(sim.cone_id);
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
            recordConeEvent(sim.cone_id, 'recovery', null, null);
          }
        }, 5000);
      }

      // Update stats
      alertsToday++;
      lastIncidentTime = Date.now();
      updateStats();

      // Add to event log
      addEventRow(now, event, accelG, tiltDeg, sim.cone_id);
      recordConeEvent(sim.cone_id, event, accelG, tiltDeg);
      attachMarkerClick(sim.cone_id);
    }, 4000); // Event every 4 seconds
  });

  // --- Load cones and start MQTT ---
  await loadCones();

  // Load persisted events
  try {
    const eventsRes = await fetch('/api/events?limit=50');
    const events = await eventsRes.json();
    events.reverse().forEach(evt => {
      addEventRow(new Date(evt.timestamp), evt.event, evt.accel_g, evt.tilt_deg, evt.cone_id);
      if (evt.cone_id) recordConeEvent(evt.cone_id, evt.event, evt.accel_g, evt.tilt_deg);
    });
  } catch (err) {
    console.error('Failed to load events:', err);
  }

  Object.keys(coneStates).forEach(attachMarkerClick);

  // --- Connection health: track last MQTT message received ---
  let lastMqttMessageTime = 0;
  let mqttConnected = false;

  function updateConnectionHealth() {
    if (!mqttConnected) {
      setConnectionState('disconnected');
      return;
    }
    const sinceLast = Date.now() - lastMqttMessageTime;
    if (lastMqttMessageTime === 0) {
      // Connected but no messages yet — waiting
      connectionText.textContent = 'Connected — waiting for data';
    } else if (sinceLast > 60000) {
      // No message in 60s — stale
      connectionText.textContent = 'Connected — no data for ' + Math.round(sinceLast / 1000) + 's';
      connectionDot.className = 'dot connecting'; // Amber = stale
    } else {
      connectionText.textContent = 'Connected';
      connectionDot.className = 'dot connected';
    }
  }

  setInterval(updateConnectionHealth, 5000);

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
    mqttConnected = true;
    setConnectionState('connected');
    connectionText.textContent = 'Connected — waiting for data';
    client.subscribe('smartcones/+/event');
    client.subscribe('smartcones/+/status');
    client.subscribe('smartcones/+/telemetry');
  });

  client.on('reconnect', function () {
    setConnectionState('connecting');
  });

  client.on('close', function () {
    mqttConnected = false;
    setConnectionState('disconnected');
  });

  client.on('offline', function () {
    mqttConnected = false;
    setConnectionState('disconnected');
  });

  client.on('error', function (err) {
    console.error('MQTT error:', err);
    setConnectionState('disconnected');
  });

  client.on('message', function (topic, message) {
    lastMqttMessageTime = Date.now();

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

      // Auto-discover unknown cones
      if (!coneStates[eventConeId]) {
        showToast(
          'New Cone Detected',
          `${eventConeId} is online but not placed on the map.`,
          'Place Now',
          () => {
            // Show placement form for this specific cone
            setupPanel.classList.remove('hidden');
            newConeIdInput.value = eventConeId;
            newConeIdInput.disabled = true; // Lock the ID since it's from MQTT
            // Re-enable after placement
            const enableInput = () => { newConeIdInput.disabled = false; };
            btnPlaceCone.addEventListener('click', enableInput, { once: true });
          }
        );
      }

      const eventType = payload.event || 'unknown';
      const accelG = payload.accel_g;
      const tiltDeg = payload.tilt_deg;

      // Update status card (shows last active cone)
      const derivedState = eventToState(eventType);
      if (derivedState) {
        updateConeStatus(derivedState, eventConeId, now);
      }
      setDeviceOnline(true); // Cone is clearly active if sending events

      // Update map marker
      if (coneStates[eventConeId]) {
        coneStates[eventConeId].state = derivedState || 'UPRIGHT';
        coneStates[eventConeId].online = true;
        updateMarker(eventConeId);

        // Auto-reset intrusion state after 5 seconds
        if (derivedState === 'INTRUSION') {
          setTimeout(() => {
            if (coneStates[eventConeId] && coneStates[eventConeId].state === 'INTRUSION') {
              coneStates[eventConeId].state = 'UPRIGHT';
              updateMarker(eventConeId);
            }
          }, 5000);
        }

        // Auto-reset disturbed state after 10 seconds
        if (derivedState === 'DISTURBED') {
          setTimeout(() => {
            if (coneStates[eventConeId] && coneStates[eventConeId].state === 'DISTURBED') {
              coneStates[eventConeId].state = 'UPRIGHT';
              updateMarker(eventConeId);
            }
          }, 10000);
        }
      }

      // Update stats
      alertsToday++;
      lastIncidentTime = Date.now();
      updateStats();

      // Add to event log
      addEventRow(now, eventType, accelG, tiltDeg, eventConeId);
      // Events are persisted by ESP32 directly — no duplicate POST from browser
      recordConeEvent(eventConeId, eventType, accelG, tiltDeg);
      attachMarkerClick(eventConeId);

    } else if (topicType === 'status') {
      const online = payload.status === 'online';
      const statusConeId = payload.cone_id || topicConeId;

      // Auto-discover unknown cones
      if (payload.status === 'online' && !coneStates[statusConeId]) {
        showToast(
          'New Cone Detected',
          `${statusConeId} is online but not placed on the map.`,
          'Place Now',
          () => {
            // Show placement form for this specific cone
            setupPanel.classList.remove('hidden');
            newConeIdInput.value = statusConeId;
          }
        );
      }

      // Handle cone reset — remove from dashboard
      if (payload.status === 'reset' && coneStates[statusConeId]) {
        showToast('Cone Reset', `${statusConeId} has been reset and removed from the map.`);
        // Delete from KV
        fetch(`/api/cones/${statusConeId}`, { method: 'DELETE' }).catch(() => {});
        // Remove from map
        if (coneStates[statusConeId].marker) map.removeLayer(coneStates[statusConeId].marker);
        delete coneStates[statusConeId];
        delete coneEventHistory[statusConeId];
        updateStats();
        if (!detailPanel.classList.contains('hidden') && detailConeId.textContent === statusConeId) {
          detailPanel.classList.add('hidden');
        }
        return;
      }

      setDeviceOnline(online);
      lastUpdate.textContent = formatTime(now);

      // Update map marker
      if (coneStates[statusConeId]) {
        coneStates[statusConeId].online = online;
        if (!online) coneStates[statusConeId].state = 'UPRIGHT';
        updateMarker(statusConeId);
      }
      updateStats();
    } else if (topicType === 'telemetry') {
      const telConeId = payload.cone_id || topicConeId;
      // Store telemetry data on cone state
      if (coneStates[telConeId]) {
        coneStates[telConeId].telemetry = {
          rssi: payload.rssi,
          uptime_s: payload.uptime_s,
          free_heap: payload.free_heap,
          tilt_deg: payload.tilt_deg,
          firmware: payload.firmware,
        };
      }
      // Update detail panel if showing this cone
      if (!detailPanel.classList.contains('hidden') && detailConeId.textContent === telConeId) {
        showConeDetail(telConeId);
      }
    }
  });
  // --- Detail Panel ---
  function showConeDetail(id) {
    const cone = coneStates[id];
    if (!cone) return;

    detailConeId.textContent = id;
    const stateClass = STATE_MAP[cone.state] || 'upright';
    detailState.className = 'state ' + stateClass;
    detailState.textContent = cone.state || 'UPRIGHT';
    detailOnline.textContent = cone.online ? 'Online' : 'Offline';
    detailOnline.style.color = cone.online ? '#22c55e' : '#ef4444';
    detailLabelEl.textContent = cone.label || '--';
    detailCoords.textContent = cone.lat && cone.lng ? `${cone.lat.toFixed(6)}, ${cone.lng.toFixed(6)}` : '--';

    // Show recent events for this cone
    const history = coneEventHistory[id] || [];
    detailLastEvent.textContent = history.length > 0 ? `${history[0].event} at ${history[0].time}` : '--';
    detailEvents.innerHTML = '';
    history.slice(0, 10).forEach(evt => {
      const div = document.createElement('div');
      div.className = 'detail-event-item';
      div.textContent = `${evt.time} — ${evt.event}${evt.accelG != null ? ` (${evt.accelG}g)` : ''}`;
      detailEvents.appendChild(div);
    });

    detailPanel.classList.remove('hidden');

    // Check firmware update availability
    const fwStatusText = document.getElementById('fw-status-text');
    const otaBtn = document.getElementById('detail-ota-btn');
    if (fwStatusText && otaBtn) {
      const coneFw = cone.telemetry && cone.telemetry.firmware;
      if (!coneFw) {
        fwStatusText.textContent = 'Firmware version unknown';
        fwStatusText.style.color = '#64748b';
        otaBtn.style.display = 'none';
      } else {
        fwStatusText.textContent = `Checking firmware v${coneFw}...`;
        fwStatusText.style.color = '#64748b';
        fetch('/api/firmware/version').then(r => r.json()).then(fw => {
          if (fw.version && fw.version !== coneFw && fw.url) {
            fwStatusText.innerHTML = `<i class="fa-solid fa-circle-up" style="color:#22c55e;"></i> Update available: <strong>v${coneFw}</strong> → <strong>v${fw.version}</strong>`;
            fwStatusText.style.color = '#e2e8f0';
            otaBtn.style.display = 'block';
            otaBtn.innerHTML = `<i class="fa-solid fa-download"></i> Update to v${fw.version}`;
          } else {
            fwStatusText.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#64748b;"></i> Firmware up to date <strong>v${coneFw}</strong>`;
            fwStatusText.style.color = '#64748b';
            otaBtn.style.display = 'none';
          }
        }).catch(() => {
          fwStatusText.textContent = `Firmware v${coneFw}`;
          fwStatusText.style.color = '#64748b';
          otaBtn.style.display = 'none';
        });
      }
    }
  }

  detailClose.addEventListener('click', () => {
    detailPanel.classList.add('hidden');
  });

  // Enhance detail panel with telemetry data
  const telemetryDiv = document.createElement('div');
  telemetryDiv.id = 'detail-telemetry';
  telemetryDiv.innerHTML = `
    <h4>Health</h4>
    <div class="detail-row"><span class="detail-label">WiFi Signal</span><span id="detail-rssi">--</span></div>
    <div class="detail-row"><span class="detail-label">Uptime</span><span id="detail-uptime">--</span></div>
    <div class="detail-row"><span class="detail-label">Free Memory</span><span id="detail-heap">--</span></div>
    <div class="detail-row"><span class="detail-label">Current Tilt</span><span id="detail-tilt">--</span></div>
    <div class="detail-row"><span class="detail-label">Firmware</span><span id="detail-firmware">--</span></div>
  `;
  // Insert before the "Recent Events" h4
  const recentEventsH4 = detailPanel.querySelector('.detail-panel-body h4');
  if (recentEventsH4) {
    recentEventsH4.parentNode.insertBefore(telemetryDiv, recentEventsH4);
  }

  // Add remove button to detail panel
  const removeDiv = document.createElement('div');
  removeDiv.style.cssText = 'margin-top:1.5rem;padding-top:1rem;border-top:1px solid #334155;';
  removeDiv.innerHTML = `
    <button id="detail-identify-btn" class="btn btn-outline" style="width:100%;padding:0.6rem;font-size:0.85rem;">
      <i class="fa-solid fa-eye"></i> Identify (Flash LED)
    </button>
    <div id="detail-fw-status" style="margin-top:0.75rem;padding:0.5rem 0.75rem;border-radius:0.5rem;font-size:0.8rem;text-align:center;background:#0f172a;border:1px solid #334155;">
      <span id="fw-status-text" style="color:#64748b;">Checking firmware...</span>
    </div>
    <button id="detail-ota-btn" class="btn btn-outline" style="width:100%;padding:0.6rem;font-size:0.85rem;margin-top:0.5rem;color:#a78bfa;border-color:#a78bfa;display:none;">
      <i class="fa-solid fa-download"></i> Update Firmware
    </button>
    <button id="detail-remove-btn" class="btn" style="background:#ef4444;color:white;width:100%;padding:0.6rem;font-size:0.85rem;margin-top:0.5rem;">
      <i class="fa-solid fa-trash"></i> Remove Cone
    </button>
  `;
  detailPanel.querySelector('.detail-panel-body').appendChild(removeDiv);

  // Remove cone handler
  document.getElementById('detail-remove-btn').addEventListener('click', async () => {
    const id = detailConeId.textContent;
    if (!confirm(`Remove ${id}? This will reset the device and remove it from the map.`)) return;

    // Delete from KV
    try {
      await fetch(`/api/cones/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete cone:', err);
    }

    // Send MQTT reset command (if connected)
    if (client && client.connected) {
      client.publish(`smartcones/${id}/command`, JSON.stringify({ action: 'reset' }));
    }

    // Remove from local state
    if (coneStates[id]) {
      if (coneStates[id].marker) {
        map.removeLayer(coneStates[id].marker);
      }
      delete coneStates[id];
    }

    updateStats();
    detailPanel.classList.add('hidden');
  });

  // Identify cone handler
  document.getElementById('detail-identify-btn').addEventListener('click', () => {
    const id = detailConeId.textContent;
    if (client && client.connected) {
      client.publish(`smartcones/${id}/command`, JSON.stringify({ action: 'identify' }));
    }
  });

  // OTA update handler
  document.getElementById('detail-ota-btn').addEventListener('click', async () => {
    const id = detailConeId.textContent;
    if (!confirm(`Update firmware on ${id}? The cone will reboot after update.`)) return;

    try {
      const res = await fetch('/api/firmware/version');
      const fw = await res.json();
      if (!fw.url) {
        alert('No firmware update available. Upload a new build first.');
        return;
      }
      if (client && client.connected) {
        client.publish(`smartcones/${id}/command`, JSON.stringify({ action: 'ota', url: fw.url }));
        alert(`OTA update sent to ${id}. Watch the LED for progress.`);
      }
    } catch (err) {
      console.error('Failed to get firmware version:', err);
    }
  });

  // Update telemetry fields when panel is visible
  setInterval(() => {
    if (detailPanel.classList.contains('hidden')) return;
    const id = detailConeId.textContent;
    const cone = coneStates[id];
    if (!cone || !cone.telemetry) return;
    const t = cone.telemetry;

    const rssiEl = document.getElementById('detail-rssi');
    const uptimeEl = document.getElementById('detail-uptime');
    const heapEl = document.getElementById('detail-heap');
    const tiltEl = document.getElementById('detail-tilt');

    if (rssiEl) {
      const rssi = t.rssi;
      rssiEl.textContent = `${rssi} dBm`;
      rssiEl.style.color = rssi > -50 ? '#22c55e' : rssi > -70 ? '#f59e0b' : '#ef4444';
    }
    if (uptimeEl) {
      const mins = Math.floor(t.uptime_s / 60);
      const hrs = Math.floor(mins / 60);
      uptimeEl.textContent = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
    }
    if (heapEl) {
      const kb = Math.round(t.free_heap / 1024);
      heapEl.textContent = `${kb} KB`;
    }
    if (tiltEl) {
      tiltEl.textContent = `${t.tilt_deg}°`;
    }
    const fwEl = document.getElementById('detail-firmware');
    if (fwEl && t.firmware) {
      fwEl.textContent = 'v' + t.firmware;
    }
  }, 1000);

  function attachMarkerClick(id) {
    const cone = coneStates[id];
    if (cone && cone.marker) {
      cone.marker.off('click');
      cone.marker.on('click', () => showConeDetail(id));
    }
  }

  function recordConeEvent(coneId, eventType, accelG, tiltDeg) {
    if (!coneEventHistory[coneId]) coneEventHistory[coneId] = [];
    coneEventHistory[coneId].unshift({
      time: formatTime(new Date()),
      event: eventType,
      accelG: accelG != null ? Number(accelG).toFixed(2) : null,
      tiltDeg: tiltDeg != null ? Number(tiltDeg).toFixed(1) : null,
    });
    // Keep max 20 events per cone
    if (coneEventHistory[coneId].length > 20) coneEventHistory[coneId].pop();

    // Update detail panel if it's showing this cone
    if (!detailPanel.classList.contains('hidden') && detailConeId.textContent === coneId) {
      showConeDetail(coneId);
    }
  }

  // --- Fleet List ---
  const fleetList = document.getElementById('fleet-list');
  const fleetListBody = document.getElementById('fleet-list-body');
  const fleetListClose = document.getElementById('fleet-list-close');
  const statTotalEl = document.getElementById('stat-total').closest('.stat');

  function renderFleetList() {
    fleetListBody.innerHTML = '';
    const ids = Object.keys(coneStates).sort();
    ids.forEach(id => {
      const cone = coneStates[id];
      const row = document.createElement('div');
      row.className = 'fleet-list-row';

      const name = document.createElement('span');
      name.className = 'cone-name';
      name.textContent = id;

      const location = document.createElement('span');
      location.className = 'cone-location';
      location.textContent = cone.label || '--';

      const badge = document.createElement('span');
      let badgeClass = 'upright';
      if (!cone.online) badgeClass = 'offline';
      else if (cone.state === 'KNOCKED_OVER') badgeClass = 'knocked_over';
      else if (cone.state === 'IMPACT_ALERT') badgeClass = 'impact_alert';
      else if (cone.state === 'DISTURBED') badgeClass = 'disturbed';
      else if (cone.state === 'INTRUSION') badgeClass = 'intrusion';
      badge.className = 'cone-state-badge ' + badgeClass;
      badge.textContent = cone.online ? (cone.state || 'UPRIGHT') : 'OFFLINE';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-outline btn-sm';
      removeBtn.style.cssText = 'padding:0.2rem 0.5rem;font-size:0.7rem;color:#ef4444;border-color:#ef4444;';
      removeBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Don't trigger row click
        if (!confirm(`Remove ${id}?`)) return;
        try { await fetch(`/api/cones/${id}`, { method: 'DELETE' }); } catch(err) {}
        if (client && client.connected) {
          client.publish(`smartcones/${id}/command`, JSON.stringify({ action: 'reset' }));
        }
        if (coneStates[id]) {
          if (coneStates[id].marker) map.removeLayer(coneStates[id].marker);
          delete coneStates[id];
        }
        updateStats();
        renderFleetList(); // Re-render list
      });
      const chevron = document.createElement('span');
      chevron.className = 'fleet-list-chevron';
      chevron.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
      row.append(name, location, badge, removeBtn, chevron);
      row.addEventListener('click', () => {
        if (cone.marker) map.setView(cone.marker.getLatLng(), 17);
        showConeDetail(id);
        fleetList.classList.add('hidden');
      });
      fleetListBody.appendChild(row);
    });
  }

  statTotalEl.style.cursor = 'pointer';
  statTotalEl.addEventListener('click', () => {
    const isVisible = !fleetList.classList.contains('hidden');
    if (isVisible) {
      fleetList.classList.add('hidden');
    } else {
      renderFleetList();
      fleetList.classList.remove('hidden');
    }
  });

  fleetListClose.addEventListener('click', () => {
    fleetList.classList.add('hidden');
  });

  // --- Setup Help Overlay ---
  const setupOverlay = document.getElementById('setup-overlay');
  const btnSetupHelp = document.getElementById('btn-setup-help');
  const overlayClose = document.getElementById('overlay-close');
  const overlayBackdrop = setupOverlay ? setupOverlay.querySelector('.overlay-backdrop') : null;

  if (btnSetupHelp && setupOverlay) {
    btnSetupHelp.addEventListener('click', () => {
      setupOverlay.classList.remove('hidden');
    });
    overlayClose.addEventListener('click', () => {
      setupOverlay.classList.add('hidden');
    });
    overlayBackdrop.addEventListener('click', () => {
      setupOverlay.classList.add('hidden');
    });
  }
})();
