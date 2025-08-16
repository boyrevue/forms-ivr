# 1) Inspect current state (you should see status: complete)
curl -s http://localhost:3000/dialog/state | jq

# 2) Make the form incomplete by clearing one field (example: is_vehicle_modified)
curl -s -X POST http://localhost:3000/dialog/reset \
  -H 'Content-Type: application/json' \
  -d '{"clear":["is_vehicle_modified"]}' | jq

# 3) Check state again — now you should see next = is_vehicle_modified
curl -s http://localhost:3000/dialog/state | jq

# 4) Answer the next question (send the value for the CURRENT next slot)
# Booleans are often modelled as strings in slot plans; both can work depending on your handler.
curl -s -X POST http://localhost:3000/dialog/step \
  -H 'Content-Type: application/json' \
  -d '{"value":"false"}' | jq
# or
curl -s -X POST http://localhost:3000/dialog/step \
  -H 'Content-Type: application/json' \
  -d '{"value": false }' | jq

# 5) Repeat 3–4 until status becomes complete again
curl -s http://localhost:3000/dialog/state | jq

