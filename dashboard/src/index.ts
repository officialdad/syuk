import { Hono } from 'hono'

type Bindings = {
  MQTT_BROKER_WSS: string
  MQTT_USER: string
  MQTT_PASSWORD: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api/config', (c) => {
  return c.json({
    broker: c.env.MQTT_BROKER_WSS,
    username: c.env.MQTT_USER,
    password: c.env.MQTT_PASSWORD,
  })
})

export default app
