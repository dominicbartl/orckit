/**
 * IPC Connection Hook
 *
 * Connects to the orchestrator's IPC server and manages real-time updates
 */

import { useEffect, useRef } from 'react';
import { connect, type Socket } from 'node:net';
import type {
  IPCMessage,
  StatusUpdateMessage,
  LogMessage,
  LogBatchMessage,
  BufferSyncMessage,
} from '@/types';
import type { AppAction } from '../context/AppContext.js';

export interface IPCConnectionOptions {
  socketPath: string;
  onMessage: (action: AppAction) => void;
  onConnected: () => void;
  onDisconnected: () => void;
}

export function useIPCConnection(options: IPCConnectionOptions) {
  const socketRef = useRef<Socket | null>(null);
  const bufferRef = useRef<string>('');
  const { socketPath, onMessage, onConnected, onDisconnected } = options;

  useEffect(() => {
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isConnected = false;
    let connectAttempts = 0;
    const maxConnectAttempts = 10;

    function connectToServer() {
      const socket = connect(socketPath);
      socketRef.current = socket;

      socket.on('connect', () => {
        isConnected = true;
        connectAttempts = 0; // Reset on successful connection
        onConnected();

        // Send initial buffer requests for all processes
        // (The app will request buffers for each process on demand)
      });

      socket.on('data', (data: Buffer) => {
        bufferRef.current += data.toString();

        // Process complete messages (newline-delimited JSON)
        let newlineIndex: number;
        while ((newlineIndex = bufferRef.current.indexOf('\n')) !== -1) {
          const line = bufferRef.current.slice(0, newlineIndex);
          bufferRef.current = bufferRef.current.slice(newlineIndex + 1);

          try {
            const message = JSON.parse(line) as IPCMessage;
            handleMessage(message);
          } catch (error) {
            console.error('Failed to parse IPC message:', error);
          }
        }
      });

      socket.on('close', () => {
        if (isConnected) {
          isConnected = false;
          onDisconnected();

          // Attempt to reconnect after 1 second
          reconnectTimer = setTimeout(() => {
            connectToServer();
          }, 1000);
        }
      });

      socket.on('error', (error: NodeJS.ErrnoException) => {
        // Handle connection refused (socket doesn't exist yet)
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') {
          connectAttempts++;

          // Destroy the failed socket
          try {
            socket.destroy();
          } catch {
            // Already destroyed
          }

          if (connectAttempts < maxConnectAttempts) {
            // Socket not ready yet, retry after a short delay
            reconnectTimer = setTimeout(() => {
              connectToServer();
            }, 500);
          } else {
            console.error('Failed to connect to IPC server after multiple attempts:', error);
          }
        } else {
          // Other errors
          console.error('IPC socket error:', error);
        }
      });
    }

    function handleMessage(message: IPCMessage) {
      switch (message.type) {
        case 'status_update': {
          const msg = message as StatusUpdateMessage;
          onMessage({
            type: 'PROCESS_UPDATE',
            processes: msg.processes,
          });
          break;
        }

        case 'log': {
          const msg = message as LogMessage;
          onMessage({
            type: 'LOG_APPEND',
            processName: msg.processName,
            line: msg.content,
          });
          break;
        }

        case 'log_batch': {
          const msg = message as LogBatchMessage;
          for (const log of msg.logs) {
            onMessage({
              type: 'LOG_APPEND',
              processName: log.processName,
              line: log.content,
            });
          }
          break;
        }

        case 'buffer_sync': {
          const msg = message as BufferSyncMessage;
          onMessage({
            type: 'BUFFER_SYNC',
            processName: msg.processName,
            lines: msg.lines.map((l) => l.content),
          });
          break;
        }

        case 'command_response':
          // Handle command responses (e.g., restart, stop confirmations)
          // For now, we just log them
          break;

        default:
          // Unknown message type
          break;
      }
    }

    connectToServer();

    // Cleanup on unmount
    return () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socketRef.current) {
        socketRef.current.destroy();
      }
    };
  }, [socketPath, onMessage, onConnected, onDisconnected]);

  // Send command to server
  const sendCommand = (action: string, processName: string) => {
    if (!socketRef.current) {
      return;
    }

    const message = {
      type: 'command',
      action,
      processName,
    };

    try {
      socketRef.current.write(JSON.stringify(message) + '\n');
    } catch (error) {
      console.error('Failed to send command:', error);
    }
  };

  // Request buffer for a process
  const requestBuffer = (processName: string) => {
    if (!socketRef.current) {
      return;
    }

    const message = {
      type: 'buffer_request',
      processName,
    };

    try {
      socketRef.current.write(JSON.stringify(message) + '\n');
    } catch (error) {
      console.error('Failed to request buffer:', error);
    }
  };

  return { sendCommand, requestBuffer };
}
