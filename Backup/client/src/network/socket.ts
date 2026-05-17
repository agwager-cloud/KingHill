import { io } from "socket.io-client";

export const socket = io("https://kinghill-server.onrender.com");

socket.on("connect", () => {
  console.log("Connected to server:", socket.id);
});
