// Smart Cone Dashboard — MQTT client

let accelChart = null;

function initChart() {
  const ctx = document.getElementById('accelChart').getContext('2d');
  accelChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Acceleration',
        data: [],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: false,
        tension: 0.2,
        pointRadius: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: { unit: 'second', displayFormats: { second: 'HH:mm:ss' } },
          title: { display: true, text: 'Time', color: '#94a3b8' },
          ticks: { color: '#94a3b8' },
          grid: { color: '#334155' },
        },
        y: {
          min: 0,
          suggestedMax: 5,
          title: { display: true, text: 'Acceleration (g)', color: '#94a3b8' },
          ticks: { color: '#94a3b8' },
          grid: { color: '#334155' },
        }
      },
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: {
            threshold: {
              type: 'line',
              yMin: 3,
              yMax: 3,
              borderColor: '#ef4444',
              borderWidth: 2,
              borderDash: [6, 6],
              label: {
                display: true,
                content: 'Impact Threshold (3g)',
                position: 'end',
                color: '#ef4444',
                backgroundColor: 'transparent',
              }
            }
          }
        }
      }
    }
  });
}

function updateChart(accelG) {
  if (!accelChart) return;
  const now = new Date();
  accelChart.data.datasets[0].data.push({ x: now, y: accelG });
  // Remove points older than 60 seconds
  const cutoff = new Date(now.getTime() - 60000);
  accelChart.data.datasets[0].data = accelChart.data.datasets[0].data.filter(p => p.x > cutoff);
  accelChart.update('none'); // 'none' for no animation on rapid updates
}

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

  // State-to-CSS class mapping
  const STATE_MAP = {
    UPRIGHT: 'upright',
    IMPACT_ALERT: 'impact_alert',
    KNOCKED_OVER: 'knocked_over',
  };

  // Event type to badge class
  function eventBadgeClass(event) {
    if (event === 'impact') return 'impact';
    if (event === 'knocked_over') return 'knocked_over';
    if (event === 'recovery') return 'recovery';
    return 'default';
  }

  // Derive cone state from event type
  function eventToState(event) {
    if (event === 'impact') return 'IMPACT_ALERT';
    if (event === 'knocked_over') return 'KNOCKED_OVER';
    if (event === 'recovery') return 'UPRIGHT';
    return null;
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function setConnected(connected) {
    connectionDot.className = 'dot ' + (connected ? 'connected' : 'disconnected');
    connectionText.textContent = connected ? 'Connected' : 'Disconnected';
  }

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

  function addEventRow(time, eventType, accelG, tiltDeg, id) {
    noEvents.style.display = 'none';

    const row = document.createElement('tr');

    const tdTime = document.createElement('td');
    tdTime.textContent = formatTime(time);

    const tdEvent = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'event-badge ' + eventBadgeClass(eventType);
    badge.textContent = eventType;
    tdEvent.appendChild(badge);

    const tdAccel = document.createElement('td');
    tdAccel.textContent = accelG != null ? Number(accelG).toFixed(2) : '--';

    const tdTilt = document.createElement('td');
    tdTilt.textContent = tiltDeg != null ? Number(tiltDeg).toFixed(1) : '--';

    const tdId = document.createElement('td');
    tdId.textContent = id || '--';

    row.append(tdTime, tdEvent, tdAccel, tdTilt, tdId);

    // Prepend (newest first)
    if (eventTbody.firstChild) {
      eventTbody.insertBefore(row, eventTbody.firstChild);
    } else {
      eventTbody.appendChild(row);
    }

    // Trim to max rows
    while (eventTbody.children.length > MAX_LOG_ROWS) {
      eventTbody.removeChild(eventTbody.lastChild);
    }
  }

  // Initialize the accelerometer chart
  initChart();

  // Fetch MQTT config from worker API
  let config;
  try {
    const res = await fetch('/api/config');
    config = await res.json();
  } catch (err) {
    console.error('Failed to fetch MQTT config:', err);
    connectionText.textContent = 'Config error';
    return;
  }

  // Connect to MQTT broker via WebSocket
  const client = mqtt.connect(config.broker, {
    username: config.username,
    password: config.password,
    protocol: 'wss',
    reconnectPeriod: 5000,
  });

  client.on('connect', function () {
    console.log('MQTT connected');
    setConnected(true);
    client.subscribe('smartcones/+/event');
    client.subscribe('smartcones/+/status');
  });

  client.on('close', function () {
    setConnected(false);
  });

  client.on('offline', function () {
    setConnected(false);
  });

  client.on('error', function (err) {
    console.error('MQTT error:', err);
    setConnected(false);
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
    // topic format: smartcones/<cone-id>/event or smartcones/<cone-id>/status
    const topicType = parts[2]; // 'event' or 'status'

    if (topicType === 'event') {
      const coneIdVal = payload.cone_id || parts[1];
      const eventType = payload.event || 'unknown';
      const accelG = payload.accel_g;
      const tiltDeg = payload.tilt_deg;

      // Update status card
      const derivedState = eventToState(eventType);
      if (derivedState) {
        updateConeStatus(derivedState, coneIdVal, now);
      }

      // Update accelerometer chart
      if (accelG != null) {
        updateChart(accelG);
      }

      // Add to event log
      addEventRow(now, eventType, accelG, tiltDeg, coneIdVal);
    } else if (topicType === 'status') {
      const online = payload.status === 'online';
      setDeviceOnline(online);
      if (!online) {
        // If device goes offline, reflect in state
        lastUpdate.textContent = formatTime(now);
      }
    }
  });
})();
