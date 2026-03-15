import { Hono } from 'hono'

type Bindings = {
  MQTT_BROKER_WSS: string
  MQTT_USER: string
  MQTT_PASSWORD: string
  CONE_LOCATIONS: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

// GET /api/cones — list all cone locations
app.get('/api/cones', async (c) => {
  const list = await c.env.CONE_LOCATIONS.list({ prefix: 'cone:' });
  const cones = await Promise.all(
    list.keys.map(async (key) => {
      const value = await c.env.CONE_LOCATIONS.get(key.name, 'json');
      return value;
    })
  );
  return c.json(cones.filter(Boolean));
});

// POST /api/cones — create/update a cone location
app.post('/api/cones', async (c) => {
  const body = await c.req.json();
  const { cone_id, lat, lng, label } = body;
  if (!cone_id || lat == null || lng == null) {
    return c.json({ error: 'cone_id, lat, lng required' }, 400);
  }
  const cone = {
    cone_id,
    lat: Number(lat),
    lng: Number(lng),
    label: label || '',
    placed_at: new Date().toISOString(),
  };
  await c.env.CONE_LOCATIONS.put(`cone:${cone_id}`, JSON.stringify(cone));
  return c.json(cone, 201);
});

// DELETE /api/cones/:id — remove a cone
app.delete('/api/cones/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.CONE_LOCATIONS.delete(`cone:${id}`);
  return c.json({ deleted: id });
});

// GET /api/hazards — JSON hazard zones derived from cone positions
app.get('/api/hazards', async (c) => {
  const list = await c.env.CONE_LOCATIONS.list({ prefix: 'cone:' });
  const cones = (await Promise.all(
    list.keys.map(async (key) => {
      const value = await c.env.CONE_LOCATIONS.get(key.name, 'json');
      return value;
    })
  )).filter(Boolean) as Array<{cone_id: string; lat: number; lng: number; label: string; placed_at: string}>;

  if (cones.length < 1) {
    return c.json({ active: false, zones: [] });
  }

  // Calculate bounding box from cone positions
  const lats = cones.map(c => c.lat);
  const lngs = cones.map(c => c.lng);
  const zone = {
    type: cones.length >= 3 ? 'road_closure' : 'construction',
    severity: 'normal',
    cone_count: cones.length,
    start: { lat: Math.min(...lats), lng: Math.min(...lngs) },
    end: { lat: Math.max(...lats), lng: Math.max(...lngs) },
    center: { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 },
    cones: cones.map(c => ({ id: c.cone_id, lat: c.lat, lng: c.lng, label: c.label })),
    created_at: cones.reduce((earliest, c) => c.placed_at < earliest ? c.placed_at : earliest, cones[0].placed_at),
  };

  return c.json({ active: true, zones: [zone] });
});

// GET /api/feed/cifs.xml — Waze-compatible CIFS XML feed
app.get('/api/feed/cifs.xml', async (c) => {
  const list = await c.env.CONE_LOCATIONS.list({ prefix: 'cone:' });
  const cones = (await Promise.all(
    list.keys.map(async (key) => {
      const value = await c.env.CONE_LOCATIONS.get(key.name, 'json');
      return value;
    })
  )).filter(Boolean) as Array<{cone_id: string; lat: number; lng: number; label: string; placed_at: string}>;

  const now = new Date().toISOString();
  let incidents = '';

  if (cones.length >= 1) {
    const lats = cones.map(c => c.lat);
    const lngs = cones.map(c => c.lng);
    const centerLat = ((Math.min(...lats) + Math.max(...lats)) / 2).toFixed(6);
    const centerLng = ((Math.min(...lngs) + Math.max(...lngs)) / 2).toFixed(6);
    const type = cones.length >= 3 ? 'ROAD_CLOSED' : 'CONSTRUCTION';
    const polyline = cones.map(c => `${c.lat.toFixed(6)} ${c.lng.toFixed(6)}`).join(' ');

    incidents = `
    <incident id="smartcone-zone-1">
      <type>${type}</type>
      <subtype>${type === 'ROAD_CLOSED' ? 'ROAD_CLOSED_EVENT' : 'ROAD_CONSTRUCTION'}</subtype>
      <description>Smart Cone monitored work zone - ${cones.length} cones deployed</description>
      <direction>BOTH_DIRECTIONS</direction>
      <polyline>${polyline}</polyline>
      <location>
        <latitude>${centerLat}</latitude>
        <longitude>${centerLng}</longitude>
      </location>
      <starttime>${cones[0].placed_at}</starttime>
      <updatetime>${now}</updatetime>
      <severity>Minor</severity>
      <creationtime>${cones[0].placed_at}</creationtime>
    </incident>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<incidents timestamp="${now}">
  <feed_info>
    <feed_id>smartcone-feed</feed_id>
    <feed_name>Smart Cone Traffic Hazards</feed_name>
    <update_frequency>60</update_frequency>
  </feed_info>${incidents}
</incidents>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
});

app.get('/api/config', (c) => {
  return c.json({
    broker: c.env.MQTT_BROKER_WSS,
    username: c.env.MQTT_USER,
    password: c.env.MQTT_PASSWORD,
  })
})

export default app
