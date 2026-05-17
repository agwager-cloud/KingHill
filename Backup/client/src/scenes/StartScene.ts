import Phaser from "phaser";
import { socket } from "../network/socket";
import type { GameState } from "../types/gameTypes";

export default class StartScene extends Phaser.Scene {
  private nameInput?: HTMLInputElement;
  private codeInput?: HTMLInputElement;
  private playerListText?: Phaser.GameObjects.Text;
  private lobbyRoomCode = "";
  private isHost = false;
  private latestLobbyState?: GameState;
  private resizeTimer?: Phaser.Time.TimerEvent;
  private inputLayoutFrozen = false;

  constructor() {
    super("StartScene");
  }

  preload() {
    this.load.image("bg", "assets/backgrounds/background.webp");
  }

  create() {
    this.buildStartScreen();

    this.scale.off("resize", this.handleResize, this);
    this.scale.on("resize", this.handleResize, this);

    socket.off("roomCreated");
    socket.off("joinSuccess");
    socket.off("joinError");
    socket.off("gameState");
    socket.off("powerupCollected");

    socket.on("powerupCollected", () => {
      this.sound.play("powerup", { volume: 0.65 });
    });

    socket.on("roomCreated", ({ roomCode }: { roomCode: string }) => {
      this.isHost = true;
      this.lobbyRoomCode = roomCode;
      this.removeInputs();

      this.scene.start("HostLobbyScene", { roomCode });
    });

    socket.on("joinSuccess", ({ roomCode }: { roomCode: string }) => {
      this.isHost = false;
      this.lobbyRoomCode = roomCode;
      socket.emit("requestRoomState");

      this.removeInputs();
      this.children.removeAll();
      this.buildLobbyScreen(roomCode);
    });

    socket.on("joinError", (msg: string) => {
      alert(msg);
    });

    socket.on("gameState", (state: GameState) => {
      if (!this.lobbyRoomCode) return;

      this.latestLobbyState = state;
      this.updatePlayerList(state);

      if (state.gameStatus === "playing") {
        this.removeInputs();

        this.scene.start("GameScene", {
          initialState: state,
          roomCode: this.lobbyRoomCode,
        });
      }
    });

    this.events.once("shutdown", () => {
      this.scale.off("resize", this.handleResize, this);
      this.resizeTimer?.remove(false);
      this.removeInputs();
    });
  }

  private handleResize(gameSize: Phaser.Structs.Size) {
    this.resizeTimer?.remove(false);

    const isTyping =
      document.activeElement === this.nameInput ||
      document.activeElement === this.codeInput ||
      this.inputLayoutFrozen;

    this.cameras.main.setSize(gameSize.width, gameSize.height);

    if (isTyping) {
      this.repositionInputs();
      return;
    }

    this.resizeTimer = this.time.delayedCall(120, () => {
      this.children.removeAll();

      if (this.lobbyRoomCode) {
        this.buildLobbyScreen(this.lobbyRoomCode);
        if (this.latestLobbyState) {
          this.updatePlayerList(this.latestLobbyState);
        }
      } else {
        this.buildStartScreen(false);
      }

      this.repositionInputs();
    });
  }

  private addBackground() {
    const w = this.scale.width;
    const h = this.scale.height;

    this.add.rectangle(0, 0, w, h, 0x111111).setOrigin(0).setDepth(-20);

    const bg = this.add.image(w / 2, h / 2, "bg");
    const scale = Math.max(w / bg.width, h / bg.height);
    bg.setScale(scale).setDepth(-10);

    this.add.rectangle(0, 0, w, h, 0x000000, 0.45).setOrigin(0).setDepth(-5);
  }

  private getInputMetrics() {
    const w = this.scale.width;
    const h = this.scale.height;
    const isLandscape = w > h;

    return {
      inputWidth: Math.max(140, Math.min(isLandscape ? 260 : 220, w * 0.28)),
      inputHeight: Math.max(42, Math.min(62, h * 0.07)),
      inputFontSize: Math.max(20, Math.min(34, w * 0.045)),
      nameY: isLandscape ? 0.43 : 0.41,
      codeY: isLandscape ? 0.61 : 0.58,
    };
  }

  private styleInput(
    input: HTMLInputElement,
    yRatio: number,
    width: number,
    height: number,
    fontSize: number,
  ) {
    const rect = this.game.canvas.getBoundingClientRect();

    const scaleX = rect.width / this.scale.width;
    const scaleY = rect.height / this.scale.height;

    const x = this.scale.width / 2;
    const y = this.scale.height * yRatio;

    input.style.position = "fixed";
    input.style.left = `${rect.left + x * scaleX - (width * scaleX) / 2}px`;
    input.style.top = `${rect.top + y * scaleY - (height * scaleY) / 2}px`;
    input.style.width = `${width * scaleX}px`;
    input.style.height = `${height * scaleY}px`;
    input.style.fontSize = `${fontSize * scaleY}px`;

    input.style.transform = "none";
    input.style.textAlign = "center";
    input.style.borderRadius = "14px";
    input.style.border = "4px solid white";
    input.style.background = "#111111";
    input.style.color = "#ffffff";
    input.style.fontWeight = "bold";
    input.style.outline = "none";
    input.style.zIndex = "9999";
    input.style.touchAction = "manipulation";
  }

  private repositionInputs() {
    const metrics = this.getInputMetrics();

    if (this.nameInput) {
      this.styleInput(
        this.nameInput,
        metrics.nameY,
        metrics.inputWidth,
        metrics.inputHeight,
        metrics.inputFontSize,
      );
    }

    if (this.codeInput) {
      this.styleInput(
        this.codeInput,
        metrics.codeY,
        metrics.inputWidth,
        metrics.inputHeight,
        metrics.inputFontSize,
      );
    }
  }

  private attachInputFocusGuards(input: HTMLInputElement) {
    input.addEventListener("focus", () => {
      this.inputLayoutFrozen = true;
    });

    input.addEventListener("blur", () => {
      this.time.delayedCall(250, () => {
        this.inputLayoutFrozen = false;
        this.repositionInputs();
      });
    });
  }

  private buildStartScreen(recreateInputs = true) {
    if (recreateInputs) this.removeInputs();

    this.addBackground();

    const w = this.scale.width;
    const h = this.scale.height;
    const isLandscape = w > h;

    const labelSize = Math.max(16, Math.min(26, w * 0.032));
    const buttonSize = Math.max(20, Math.min(34, w * 0.038));
    const metrics = this.getInputMetrics();

    this.add
      .text(w / 2, h * (isLandscape ? 0.34 : 0.31), "ENTER INITIALS", {
        fontSize: `${labelSize}px`,
        color: "#ffff00",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    if (!this.nameInput) {
      const nameInput = document.createElement("input");
      this.nameInput = nameInput;
      nameInput.type = "text";
      nameInput.maxLength = 3;
      nameInput.placeholder = "ABC";
      nameInput.autocomplete = "off";
      nameInput.autocapitalize = "characters";
      nameInput.spellcheck = false;

      nameInput.addEventListener("input", () => {
        nameInput.value = nameInput.value
          .toUpperCase()
          .replace(/[^A-Z]/g, "")
          .slice(0, 3);
      });

      this.attachInputFocusGuards(nameInput);
      document.body.appendChild(nameInput);
    }

    this.styleInput(
      this.nameInput,
      metrics.nameY,
      metrics.inputWidth,
      metrics.inputHeight,
      metrics.inputFontSize,
    );

    this.add
      .text(w / 2, h * (isLandscape ? 0.52 : 0.5), "ROOM CODE", {
        fontSize: `${labelSize}px`,
        color: "#ffff00",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    if (!this.codeInput) {
      const codeInput = document.createElement("input");
      this.codeInput = codeInput;
      codeInput.type = "text";
      codeInput.maxLength = 4;
      codeInput.placeholder = "ROOM";
      codeInput.autocomplete = "off";
      codeInput.autocapitalize = "characters";
      codeInput.spellcheck = false;

      codeInput.addEventListener("input", () => {
        codeInput.value = codeInput.value
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 4);
      });

      this.attachInputFocusGuards(codeInput);
      document.body.appendChild(codeInput);
    }

    this.styleInput(
      this.codeInput,
      metrics.codeY,
      metrics.inputWidth,
      metrics.inputHeight,
      metrics.inputFontSize,
    );

    const getName = () => {
      const playerName = this.nameInput?.value || "???";
      localStorage.setItem("playerName", playerName);
      return playerName;
    };

    const hostButton = this.add
      .text(w / 2, h * 0.76, "HOST GAME", {
        fontSize: `${buttonSize}px`,
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        backgroundColor: "#27ae60",
        padding: { x: 24, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    hostButton.on("pointerdown", () => {
      socket.emit("createRoom", getName());
    });

    const joinButton = this.add
      .text(w / 2, h * 0.88, "JOIN GAME", {
        fontSize: `${buttonSize}px`,
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        backgroundColor: "#2980b9",
        padding: { x: 24, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    joinButton.on("pointerdown", () => {
      socket.emit("joinRoom", {
        roomCode: this.codeInput?.value || "",
        name: getName(),
      });
    });
  }

  private buildLobbyScreen(roomCode: string) {
    this.addBackground();

    const w = this.scale.width;
    const h = this.scale.height;

    const titleSize = Math.max(24, Math.min(42, w * 0.045));
    const textSize = Math.max(16, Math.min(26, w * 0.03));
    const buttonSize = Math.max(22, Math.min(34, w * 0.038));

    this.add
      .text(w / 2, h * 0.35, `ROOM CODE: ${roomCode}`, {
        fontSize: `${titleSize}px`,
        color: "#ffff00",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5);

    this.playerListText = this.add
      .text(w / 2, h * 0.55, "Waiting for players...", {
        fontSize: `${textSize}px`,
        color: "#ffffff",
        fontFamily: "Courier New",
        align: "center",
        stroke: "#000000",
        strokeThickness: 4,
        lineSpacing: 4,
      })
      .setOrigin(0.5);

    const message = this.isHost
      ? "Press START when your class is ready"
      : "Waiting for host to start...";

    this.add
      .text(w / 2, h * 0.73, message, {
        fontSize: `${Math.max(16, textSize * 0.8)}px`,
        color: "#ffffff",
        fontFamily: "Arial",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    if (!this.isHost) return;

    const startButton = this.add
      .text(w / 2, h * 0.85, "START GAME", {
        fontSize: `${buttonSize}px`,
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        backgroundColor: "#27ae60",
        padding: { x: 24, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    startButton.on("pointerdown", () => {
      socket.emit("startRoomGame");
    });
  }

  private updatePlayerList(state: GameState) {
    const realPlayers = state.players.filter(
      (player) => !player.id.startsWith("bot-"),
    );

    if (realPlayers.length === 0) {
      this.playerListText?.setText("Waiting for players...");
      return;
    }

    const maxShown = 32;
    const columns = 4;
    const rows = 8;
    const shownPlayers = realPlayers.slice(0, maxShown);
    const playerNames = shownPlayers.map((player) =>
      player.name.padEnd(4, " "),
    );

    const lines: string[] = [];

    for (let row = 0; row < rows; row++) {
      const rowNames: string[] = [];

      for (let col = 0; col < columns; col++) {
        const index = col * rows + row;
        rowNames.push(playerNames[index] ?? "    ");
      }

      lines.push(rowNames.join("   "));
    }

    this.playerListText?.setText(lines.join("\n"));
  }

  private removeInputs() {
    this.nameInput?.remove();
    this.codeInput?.remove();
    this.nameInput = undefined;
    this.codeInput = undefined;
  }
}
