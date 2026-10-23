// Public API for procedural vehicles. See model.js (hero cars) and traffic.js (instanced AI traffic).
export { VEHICLE_SPECS, pickTrafficType } from './specs.js';
export { createVehicleModel, getModelForPhysics, getTypeAssets } from './model.js';
export { TrafficRenderer } from './traffic.js';
export { vehicleTime } from './material.js';
