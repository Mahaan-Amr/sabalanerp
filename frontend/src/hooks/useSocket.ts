'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/contexts/AuthContext';

export const useSocket = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const { user, isAuthenticated } = useAuth();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (isAuthenticated && user) {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:5000');
      const socketUrl = apiUrl.startsWith('/')
        ? window.location.origin
        : apiUrl.replace(/\/api\/?$/, '');

      // Initialize socket connection
      const newSocket = io(socketUrl, { withCredentials: true });

      newSocket.on('connect', () => {
        console.log('Socket connected:', newSocket.id);
        setConnected(true);
        
      });

      newSocket.on('disconnect', () => {
        console.log('Socket disconnected');
        setConnected(false);
      });

      newSocket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        setConnected(false);
      });

      socketRef.current = newSocket;
      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
        socketRef.current = null;
        setSocket(null);
        setConnected(false);
      };
    }
  }, [isAuthenticated, user]);

  const emit = (event: string, data?: any) => {
    if (socketRef.current) {
      socketRef.current.emit(event, data);
    }
  };

  const on = (event: string, callback: (...args: any[]) => void) => {
    if (socketRef.current) {
      socketRef.current.on(event, callback);
    }
  };

  const off = (event: string, callback?: (...args: any[]) => void) => {
    if (socketRef.current) {
      socketRef.current.off(event, callback);
    }
  };

  return {
    socket,
    connected,
    emit,
    on,
    off,
  };
};
