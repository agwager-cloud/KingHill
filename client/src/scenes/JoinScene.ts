import Phaser from "phaser";
import { socket } from "../network/socket";

export default class JoinScene extends Phaser.Scene {
  private codeInput?: HTMLInputElement;

  constructor() {
    super("JoinScene");
  }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add
      .text(w / 2, h * 0.25, "JOIN GAME", {
        fontSize: "40px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const codeInput = document.createElement("input");
    this.codeInput = codeInput;

    codeInput.placeholder = "ROOM CODE";
    codeInput.maxLength = 4;

    codeInput.style.position = "absolute";
    codeInput.style.left = "50%";
    codeInput.style.top = "50%";
    codeInput.style.transform = "translate(-50%, -50%)";
    codeInput.style.fontSize = "28px";
    codeInput.style.textAlign = "center";
    codeInput.style.width = "140px";

    document.body.appendChild(codeInput);

    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 4);
    });

    const joinButton = this.add
      .text(w / 2, h * 0.7, "JOIN ROOM", {
        fontSize: "28px",
        color: "#ffffff",
        backgroundColor: "#2980b9",
        padding: { x: 20, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive();

    joinButton.on("pointerdown", () => {
      const playerName = localStorage.getItem("playerName") || "???";

      socket.emit("joinRoom", {
        roomCode: codeInput.value,
        name: playerName,
      });

      codeInput.remove();
    });

    // 🔥 Success → go to game
    socket.on("joinSuccess", () => {
      this.scene.start("GameScene");
    });

    // 🔥 Error handling
    socket.on("joinError", (msg) => {
      alert(msg);
    });

    this.events.once("shutdown", () => {
      this.codeInput?.remove();
    });
  }
}
