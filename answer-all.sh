#!/usr/bin/env bash
set -euo pipefail

API="http://localhost:3000/dialog/step"
HDR="-H Content-Type:application/json"

echo "Answering form in one shot..."

# Q1: is_vehicle_modified (radio)
curl -s -X POST $API $HDR -d '{"value":"false"}' | jq .

# Q2: vehicleValue (numeric)
curl -s -X POST $API $HDR -d '{"value":"12000"}' | jq .

# Q3: is_purchased
curl -s -X POST $API $HDR -d '{"value":"true"}' | jq .

# Q4: registered_owner_keeper
curl -s -X POST $API $HDR -d '{"value":"true"}' | jq .

# Q5: usage_type_id (select)
curl -s -X POST $API $HDR -d '{"value":"1"}' | jq .

# Q6: personalMilesPerYear
curl -s -X POST $API $HDR -d '{"value":"8000"}' | jq .

# Q7: daytime_storage_location_id
curl -s -X POST $API $HDR -d '{"value":"1"}' | jq .

# Q8: overnight_storage_location_id
curl -s -X POST $API $HDR -d '{"value":"2"}' | jq .

# Q9: any_other_vehicles_id
curl -s -X POST $API $HDR -d '{"value":"1"}' | jq .

echo "✅ All answers submitted — form should now be complete."

