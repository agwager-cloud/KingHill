import { io } from "socket.io-client";

export const socket = io("http://192.168.68.68:3001");

socket.on("connect", () => {
  console.log("Connected to server:", socket.id);
});
