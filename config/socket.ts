import { Server } from "socket.io";
import { Server as HttpServer } from "http";

let io: Server | null = null;

export const initSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        const allowedOrigins = [
          "http://localhost:3000",
          "http://127.0.0.1:3000",
          "http://[::1]:3000",
          "https://www.mscurechain.com",
          "https://mscurechain.com",
          "https://hms-frontend-green.vercel.app",
          ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",").map(url => url.trim()) : []),
        ];

        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        // Allow any local network IP origin in development
        if (process.env.NODE_ENV !== "production") {
          if (origin.startsWith("http://192.168.") || origin.startsWith("http://10.") || origin.startsWith("http://172.")) {
            return callback(null, true);
          }
        }

        console.warn(`[SOCKET CORS] Blocked origin: ${origin}`);
        return callback(new Error(`CORS: Origin ${origin} not allowed`));
      },
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
      credentials: true,
    },
  });

  console.log("📡 Socket.IO initialized");
  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initSocket first.");
  }
  return io;
};

export { io };
