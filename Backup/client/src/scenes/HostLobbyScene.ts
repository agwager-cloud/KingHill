import Phaser from "phaser";
import { socket } from "../network/socket";

type LobbyPlayer = {
  id: string;
  name: string;
};

type LobbyState = {
  players: LobbyPlayer[];
  botCount?: 0 | 6 | 12;
  gameStatus?: "lobby" | "playing";
};

export default class HostLobbyScene extends Phaser.Scene {
  private roomCode = "";
  private latestState?: LobbyState;
  private uiObjects: Phaser.GameObjects.GameObject[] = [];
  private backgroundObjects: Phaser.GameObjects.GameObject[] = [];
  private confirmObjects: Phaser.GameObjects.GameObject[] = [];
  private resizeTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super("HostLobbyScene");
  }

  preload() {
    this.load.image("bg", "assets/backgrounds/background.webp");
  }

  init(data: { roomCode?: string }) {
    this.roomCode = data.roomCode ?? "";
  }

  create() {
    socket.off("gameState");

    this.game.canvas.style.width = "100vw";
    this.game.canvas.style.height = "100vh";
    this.game.canvas.style.display = "block";

    this.addBackground();

    socket.on("gameState", (state: LobbyState) => {
      this.latestState = state;

      if (state.gameStatus === "playing") {
        this.scene.start("GameScene", {
          initialState: state,
          roomCode: this.roomCode,
        });
        return;
      }

      this.renderLobby();
    });

    window.addEventListener("resize", this.handleWindowResize);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("resize", this.handleWindowResize);
      socket.off("gameState");
      this.resizeTimer?.remove(false);
    });

    socket.emit("requestRoomState");
    this.renderLobby();
  }
  private handleWindowResize = () => {
    this.resizeTimer?.remove(false);

    this.resizeTimer = this.time.delayedCall(120, () => {
      this.scale.resize(window.innerWidth, window.innerHeight);
      this.cameras.main.setSize(window.innerWidth, window.innerHeight);
      this.addBackground();
      this.renderLobby();
    });
  };

  private getSize() {
    return {
      w: window.innerWidth,
      h: window.innerHeight,
    };
  }

  private addBackground() {
    this.backgroundObjects.forEach((obj) => obj.destroy());
    this.backgroundObjects = [];

    const { w, h } = this.getSize();

    const base = this.add
      .rectangle(0, 0, w, h, 0x111111)
      .setOrigin(0)
      .setDepth(-20);

    const bg = this.add.image(w / 2, h / 2, "bg");
    const scale = Math.min(w / bg.width, h / bg.height);
    bg.setScale(scale).setDepth(-10);

    const overlay = this.add
      .rectangle(0, 0, w, h, 0x000000, 0.28)
      .setOrigin(0)
      .setDepth(-5);

    this.backgroundObjects.push(base, bg, overlay);
  }

  private clearUi() {
    this.uiObjects.forEach((obj) => obj.destroy());
    this.uiObjects = [];
    this.clearConfirm();
  }

  private clearConfirm() {
    this.confirmObjects.forEach((obj) => obj.destroy());
    this.confirmObjects = [];
  }

  private addText(
    x: number,
    y: number,
    text: string,
    fontSize: number,
    color = "#ffffff",
    style: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {},
  ) {
    const obj = this.add
      .text(x, y, text, {
        fontSize: `${fontSize}px`,
        color,
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
        ...style,
      })
      .setOrigin(0.5);

    this.uiObjects.push(obj);
    return obj;
  }

  private addButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    color: number,
    onClick: () => void,
  ) {
    const rect = this.add
      .rectangle(x, y, width, height, color, 0.92)
      .setStrokeStyle(2, 0xffffff)
      .setInteractive({ useHandCursor: true });

    const text = this.add
      .text(x, y, label, {
        fontSize: `${Math.max(12, Math.floor(height * 0.42))}px`,
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    rect.on("pointerdown", onClick);
    text.on("pointerdown", onClick);

    this.uiObjects.push(rect, text);
  }

  private showKickConfirm(player: LobbyPlayer) {
    this.clearConfirm();

    const { w, h } = this.getSize();

    const blocker = this.add
      .rectangle(0, 0, w, h, 0x000000, 0.55)
      .setOrigin(0)
      .setDepth(100)
      .setInteractive();

    const panel = this.add
      .rectangle(w / 2, h / 2, Math.min(420, w * 0.86), 220, 0x222222, 0.98)
      .setStrokeStyle(3, 0xffffff)
      .setDepth(101);

    const msg = this.add
      .text(w / 2, h / 2 - 60, `Kick ${player.name}?`, {
        fontSize: `${Math.max(22, Math.min(34, w * 0.04))}px`,
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(102);

    const yes = this.add
      .text(w / 2 - 90, h / 2 + 45, "YES", {
        fontSize: "24px",
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        backgroundColor: "#c0392b",
        padding: { x: 26, y: 12 },
      })
      .setOrigin(0.5)
      .setDepth(102)
      .setInteractive({ useHandCursor: true });

    const no = this.add
      .text(w / 2 + 90, h / 2 + 45, "CANCEL", {
        fontSize: "24px",
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        backgroundColor: "#555555",
        padding: { x: 22, y: 12 },
      })
      .setOrigin(0.5)
      .setDepth(102)
      .setInteractive({ useHandCursor: true });

    yes.on("pointerdown", () => {
      socket.emit("kickPlayer", player.id);
      this.clearConfirm();
    });

    no.on("pointerdown", () => this.clearConfirm());

    this.confirmObjects.push(blocker, panel, msg, yes, no);
  }

  private renderLobby() {
    this.clearUi();

    const { w, h } = this.getSize();
    const isLandscape = w > h;

    const players = this.latestState?.players ?? [];
    const humanPlayers = players.filter((p) => !p.id.startsWith("bot-"));
    const botPlayers = players.filter((p) => p.id.startsWith("bot-"));
    const botCount = this.latestState?.botCount ?? 12;

    const panelWidth = isLandscape ? Math.min(w * 0.72, 920) : w * 0.92;
    const panelHeight = isLandscape ? h * 0.68 : h * 0.76;
    const panelX = w / 2;
    const panelY = isLandscape ? h * 0.58 : h * 0.6;
    const panelTop = panelY - panelHeight / 2;
    const panelLeft = panelX - panelWidth / 2;

    const panel = this.add
      .rectangle(panelX, panelY, panelWidth, panelHeight, 0x000000, 0.58)
      .setStrokeStyle(3, 0xffffff, 0.7);

    this.uiObjects.push(panel);

    const titleSize = Math.max(22, Math.min(34, panelWidth * 0.045));
    const roomSize = Math.max(20, Math.min(32, panelWidth * 0.04));
    const normalSize = Math.max(15, Math.min(22, panelWidth * 0.032));
    const smallSize = Math.max(12, Math.min(16, panelWidth * 0.022));

    this.addText(
      panelX,
      panelTop + panelHeight * 0.09,
      "HOST LOBBY",
      titleSize,
    );

    this.addText(
      panelX,
      panelTop + panelHeight * 0.17,
      this.roomCode ? `CODE: ${this.roomCode}` : "Creating room...",
      roomSize,
      "#ffff00",
    );

    this.addText(
      panelX,
      panelTop + panelHeight * 0.245,
      `${humanPlayers.length} players     ${botPlayers.length} bots`,
      normalSize,
    );

    this.addText(
      panelX,
      panelTop + panelHeight * 0.305,
      "Tap a name to remove a player",
      smallSize,
      "#cccccc",
    );

    this.addText(panelX, panelTop + panelHeight * 0.37, "PLAYERS", normalSize);

    const listTop = panelTop + panelHeight * 0.43;
    const listBottom = panelTop + panelHeight * 0.72;
    const listHeight = listBottom - listTop;

    const columns = isLandscape ? 6 : 4;
    const maxShown = 36;
    const shownPlayers = humanPlayers.slice(0, maxShown);
    const rows = Math.ceil(Math.max(shownPlayers.length, 1) / columns);

    const rowHeight = Math.min(30, listHeight / Math.max(rows, 1));
    const colWidth = panelWidth / columns;

    shownPlayers.forEach((player, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);

      const x = panelLeft + colWidth * col + colWidth / 2;
      const y = listTop + row * rowHeight;

      const isHost = player.id === socket.id;
      const label = isHost ? `${player.name} 👑` : player.name;

      const txt = this.addText(
        x,
        y,
        label,
        Math.max(12, Math.min(normalSize, rowHeight * 0.62)),
        isHost ? "#ffff00" : "#ffffff",
      );

      if (!isHost) {
        txt.setInteractive({ useHandCursor: true });
        txt.on("pointerdown", () => this.showKickConfirm(player));
      }
    });

    if (humanPlayers.length === 0) {
      this.addText(panelX, listTop, "Waiting for players...", normalSize);
    }

    const botY = panelTop + panelHeight * 0.805;
    const botButtonWidth = Math.min(82, panelWidth * 0.12);
    const botButtonHeight = Math.max(26, Math.min(34, panelHeight * 0.055));
    const botGap = botButtonWidth + 14;

    this.addText(panelX - botGap * 2.05, botY, "Bots", smallSize, "#dddddd");

    this.addButton(
      panelX - botGap,
      botY,
      botButtonWidth,
      botButtonHeight,
      botCount === 0 ? "✓ 0" : "0",
      botCount === 0 ? 0x27ae60 : 0x444444,
      () => socket.emit("setBotCount", 0),
    );

    this.addButton(
      panelX,
      botY,
      botButtonWidth,
      botButtonHeight,
      botCount === 6 ? "✓ 6" : "6",
      botCount === 6 ? 0x27ae60 : 0x444444,
      () => socket.emit("setBotCount", 6),
    );

    this.addButton(
      panelX + botGap,
      botY,
      botButtonWidth,
      botButtonHeight,
      botCount === 12 ? "✓ 12" : "12",
      botCount === 12 ? 0x27ae60 : 0x444444,
      () => socket.emit("setBotCount", 12),
    );

    this.addButton(
      panelX,
      panelTop + panelHeight * 0.91,
      Math.min(240, panelWidth * 0.34),
      Math.max(42, Math.min(54, panelHeight * 0.08)),
      "START GAME",
      0x27ae60,
      () => socket.emit("startRoomGame"),
    );
  }
}
