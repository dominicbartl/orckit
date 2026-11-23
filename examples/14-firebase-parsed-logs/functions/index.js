const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');

// Logs the three shapes orckit's parsed view handles: a console.log with an
// object (re-merged from one emulator message per line, parsed into a tree),
// a structured firebase-functions `logger` line, and an error with a stack.
exports.orders = onRequest({ region: 'europe-west1' }, (req, res) => {
  const started = Date.now();
  const id = String(req.query.id ?? 'o_1');
  if (id.endsWith('7')) {
    console.error(new Error(`order ${id} not found`));
    res.status(404).json({ error: 'not found' });
    return;
  }
  console.log('OrdersController.get executed', {
    controller: 'OrdersController',
    handler: 'get',
    method: req.method,
    status: 200,
    latencyMs: Date.now() - started,
    params: { id },
    items: [{ sku: 'tea', qty: 2 }, { sku: 'cake', qty: 1 }],
  });
  logger.info('Order served', { orderId: id, total: 12.5 });
  res.json({ id });
});

exports.health = onRequest({ region: 'europe-west1' }, (_req, res) => {
  console.log('HealthController.check executed', {
    controller: 'HealthController',
    handler: 'check',
    status: 200,
  });
  res.send('ok');
});
