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

app.get('/api/config', (c) => {
  return c.json({
    broker: c.env.MQTT_BROKER_WSS,
    username: c.env.MQTT_USER,
    password: c.env.MQTT_PASSWORD,
  })
})

export default app
