import net from 'node:net';

const port = Number(process.env.DB_PORT ?? 5433);

const server = net.createServer((socket) => {
  socket.on('error', () => {});
  socket.end();
});

server.listen(port, () => {
  console.log(`db listening on tcp://localhost:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
