import { io, type Socket } from 'socket.io-client';
import { API_URL } from './auth';

// Auto-connect stays disabled so every consumer can attach listeners first.
export const socket: Socket = io(API_URL, {
    autoConnect: false,
    withCredentials: true,
});
