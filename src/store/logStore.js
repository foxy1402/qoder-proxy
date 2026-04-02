const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const MAX = () => config.LOG_MAX_ENTRIES || 500;
const MAX_BYTES = () => config.LOG_BODY_MAX_BYTES || 8192;

const requestLog = [];
const systemLog  = [];

const truncate = (val) => {
  if (val == null) return null;
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  if (str.length > MAX_BYTES()) return str.slice(0, MAX_BYTES()) + '…[truncated]';
  return typeof val === 'string' ? val : val;
};

const addRequest = (entry) => {
  if (requestLog.length >= MAX()) requestLog.shift();
  requestLog.push({
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    ...entry,
    requestPayload:  truncate(entry.requestPayload),
    responsePayload: truncate(entry.responsePayload),
  });
};

const addSystem = (message, level = 'info', source = 'server') => {
  if (systemLog.length >= MAX()) systemLog.shift();
  systemLog.push({ id: uuidv4(), timestamp: new Date().toISOString(), level, source, message });
  // Mirror to console
  const tag = level === 'error' ? '✖' : level === 'warn' ? '⚠' : '·';
  console.log(`[${source}] ${tag} ${message}`);
};

const getRequests   = () => [...requestLog].reverse();
const getSystem     = () => [...systemLog].reverse();
const clearRequests = () => { requestLog.length = 0; };
const clearSystem   = () => { systemLog.length  = 0; };

module.exports = { addRequest, addSystem, getRequests, getSystem, clearRequests, clearSystem };
