const test = require('node:test');
const assert = require('node:assert/strict');
const { calcVehicleLoad } = require('./vehicleCapacity');

test('走私载具装载同时受槽位和重量限制', () => {
  const rescueTool = { weight: 3, boxCount: 38 };
  assert.deepEqual(
    calcVehicleLoad({ block: 11, weight: 1200 }, rescueTool),
    { actualSlots: 11, totalItems: 400 }
  );
  assert.deepEqual(
    calcVehicleLoad({ block: 9, weight: 2000 }, rescueTool),
    { actualSlots: 9, totalItems: 342 }
  );
});
