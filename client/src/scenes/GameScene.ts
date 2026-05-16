import Phaser from "phaser";
import { socket } from "../network/socket";
import type { GameState, ServerPlayer, TileData } from "../types/gameTypes";

type PowerUpData = {
  id: string;
  tile: TileData;
  type: "promote" | "demote" | "shield" | "doublePoints" | "speed" | "freeze";
};

export default class GameScene extends Phaser.Scene {
  private tiles: TileData[] = [];
  private playerObjects = new Map<string, Phaser.GameObjects.Container>();
  private powerUpObjects = new Map<string, Phaser.GameObjects.Container>();
  private hudContainer?: Phaser.GameObjects.Container;
  private latestGameState?: GameState;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private controlsGroup?: Phaser.GameObjects.Container;
  private battleOverlay?: Phaser.GameObjects.Container;
  private inBattle = false;
  private battleStatusText?: Phaser.GameObjects.Text;
  private battleCountdownText?: Phaser.GameObjects.Text;
  private battleCountdownTimer?: Phaser.Time.TimerEvent;
  private battleCountdownEndAt = 0;
  private hasChosenRps = false;

  private muteButton?: Phaser.GameObjects.Text;
  private isMuted = false;
  private victorySoundPlayed = false;

  private roomCode = "";

  private heldDirection: "up" | "down" | "left" | "right" | null = null;
  private nextTouchMoveAt = 0;

  private endGameOverlay?: Phaser.GameObjects.Container;
  private initialStateFromStart?: GameState;

  private endGameShown = false;
  private battleResultTimer?: Phaser.Time.TimerEvent;
  private rpsInputLockedUntil = 0;

  constructor() {
    super("GameScene");
  }

  preload() {
    this.load.audio("bgmusic", "assets/sounds/bgmusic.mp3");
    this.load.audio("promoted", "assets/sounds/promoted.mp3");
    this.load.audio("demoted", "assets/sounds/demoted.mp3");
    this.load.audio("powerup", "assets/sounds/powerup.mp3");
    this.load.audio("victory", "assets/sounds/victory.mp3");
  }

  init(data: { initialState?: GameState; roomCode?: string }) {
    this.initialStateFromStart = data.initialState;
    this.roomCode = data.roomCode ?? "";
  }

  create() {
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.input.setTopOnly(false);

    this.isMuted = localStorage.getItem("koth-muted") === "true";

    this.sound.mute = this.isMuted;

    this.ensureBgMusicPlaying();
    socket.off("gameState");
    socket.off("battleStart");
    socket.off("rpsResult");

    this.drawGrid();
    this.createMuteButton();

    if (this.sys.game.device.input.touch) {
      this.createTouchControls();
    }

    if (this.initialStateFromStart) {
      const state = this.initialStateFromStart as GameState & {
        powerUps?: PowerUpData[];
      };

      this.latestGameState = state;
      this.drawPowerUps(state.powerUps ?? []);
      this.drawPlayers(state.players);
      this.drawHud(state);
      this.syncBattleUiWithState(state);
    }

    socket.on(
      "gameState",
      (state: GameState & { powerUps?: PowerUpData[] }) => {
        this.latestGameState = state;
        this.drawPowerUps(state.powerUps ?? []);
        this.drawPlayers(state.players);
        this.drawHud(state);
        this.syncBattleUiWithState(state);

        const gameIsFinished =
          state.gameStatus === "finished" || state.secondsLeft <= 0;

        if (gameIsFinished) {
          this.heldDirection = null;
          this.inBattle = false;

          if (!this.endGameShown) {
            this.endGameShown = true;
            this.showEndGamePanel(state);
          }

          return;
        }

        this.endGameShown = false;
        this.victorySoundPlayed = false;
        this.endGameOverlay?.destroy();
        this.endGameOverlay = undefined;

        this.ensureBgMusicPlaying();
      },
    );

    socket.on("battleStart", () => {
      this.inBattle = true;
      this.hasChosenRps = false;
      this.rpsInputLockedUntil = 0;
      this.showBattleUI();

      if (this.battleOverlay) {
        this.battleOverlay.setVisible(true);
        this.children.bringToTop(this.battleOverlay);
      }
    });

    socket.on(
      "rpsResult",
      (data: {
        yourChoice: string;
        opponentChoice: string;
        result: "win" | "lose" | "draw" | "cancel";
        promotion?: "moved" | "blocked" | "alreadySummit";
        reason?: "timeout";
      }) => {
        if (data.result === "win") {
          this.sound.play("promoted", { volume: 0.6 });
        }

        if (data.result === "lose") {
          this.sound.play("demoted", { volume: 1.0 });
        }
        this.showRpsResult(data);
      },
    );

    this.time.delayedCall(150, () => {
      socket.emit("requestRoomState");
    });

    let resizeTimer: Phaser.Time.TimerEvent | undefined;

    const scheduleRelayout = () => {
      resizeTimer?.remove(false);

      this.heldDirection = null;

      resizeTimer = this.time.delayedCall(350, () => {
        this.relayoutScene();

        this.time.delayedCall(900, () => {
          this.relayoutScene();
        });
      });
    };

    this.scale.on("resize", scheduleRelayout);

    window.addEventListener("orientationchange", scheduleRelayout);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", scheduleRelayout);
      window.removeEventListener("orientationchange", scheduleRelayout);
      this.stopBattleCountdown();
      this.battleResultTimer?.remove(false);
      this.battleResultTimer = undefined;
    });
  }

  private relayoutScene() {
    this.heldDirection = null;

    const canvasParent = this.game.canvas.parentElement;

    const width =
      canvasParent?.clientWidth ||
      document.documentElement.clientWidth ||
      window.innerWidth;

    const height =
      canvasParent?.clientHeight ||
      document.documentElement.clientHeight ||
      window.innerHeight;

    const newWidth = Math.round(width);
    const newHeight = Math.round(height);

    if (
      this.scale.gameSize.width !== newWidth ||
      this.scale.gameSize.height !== newHeight
    ) {
      this.scale.resize(newWidth, newHeight);
    }

    const wasInBattle = this.inBattle;
    const hadChosenRps = this.hasChosenRps;

    this.children.removeAll();

    this.playerObjects.clear();
    this.powerUpObjects.clear();

    this.hudContainer = undefined;
    this.controlsGroup = undefined;
    this.battleOverlay = undefined;
    this.stopBattleCountdown();
    this.battleStatusText = undefined;
    this.endGameOverlay = undefined;

    this.inBattle = wasInBattle;
    this.hasChosenRps = hadChosenRps;

    this.drawGrid();
    this.createMuteButton();

    if (this.sys.game.device.input.touch) {
      this.createTouchControls();
    }

    if (this.latestGameState) {
      const state = this.latestGameState as GameState & {
        powerUps?: PowerUpData[];
      };

      this.drawPowerUps(state.powerUps ?? []);
      this.drawPlayers(state.players);
      this.drawHud(state);
    }

    const gameIsFinished =
      this.latestGameState?.gameStatus === "finished" ||
      (this.latestGameState?.secondsLeft ?? 1) <= 0;

    if (gameIsFinished && this.latestGameState) {
      this.showEndGamePanel(this.latestGameState);
      return;
    }
    if (this.inBattle && !this.hasChosenRps) {
      this.showBattleUI();
    }
  }

  private createMuteButton() {
    this.muteButton?.destroy();

    const screenWidth = this.scale.gameSize.width;
    const screenHeight = this.scale.gameSize.height;

    this.muteButton = this.add
      .text(screenWidth - 18, screenHeight - 18, this.isMuted ? "🔇" : "🔊", {
        fontSize: "26px",
        fontFamily: "Arial",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 4,
        backgroundColor: "rgba(0,0,0,0.35)",
        padding: {
          left: 6,
          right: 6,
          top: 4,
          bottom: 4,
        },
      })
      .setOrigin(1, 1)
      .setDepth(5000)
      .setInteractive({ useHandCursor: true });

    this.muteButton.on("pointerdown", () => {
      this.isMuted = !this.isMuted;

      this.sound.mute = this.isMuted;

      localStorage.setItem("koth-muted", String(this.isMuted));

      this.muteButton?.setText(this.isMuted ? "🔇" : "🔊");
    });
  }
  update(time: number) {
    if (!this.cursors) return;

    if (!this.inBattle) {
      if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) {
        socket.emit("moveRequest", "left");
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) {
        socket.emit("moveRequest", "right");
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
        socket.emit("moveRequest", "up");
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
        socket.emit("moveRequest", "down");
      }
    }

    if (this.inBattle) return;
    if (this.latestGameState?.gameStatus === "finished") return;
    if ((this.latestGameState?.secondsLeft ?? 1) <= 0) return;
    if (this.heldDirection && time >= this.nextTouchMoveAt) {
      socket.emit("moveRequest", this.heldDirection);

      this.nextTouchMoveAt = time + 170;
    }
  }

  syncBattleUiWithState(state: GameState) {
    const me = state.players.find((player) => player.id === socket.id);

    if (me?.status === "battle" && state.gameStatus === "playing") {
      this.inBattle = true;

      if (!this.battleOverlay) {
        this.showBattleUI();
      }

      if (this.battleOverlay) {
        this.battleOverlay.setVisible(true);
        this.children.bringToTop(this.battleOverlay);
      }

      return;
    }

    if (me?.status !== "battle" && this.inBattle) {
      // If a win/lose/draw result is currently being shown,
      // let showRpsResult() finish its delay before destroying the UI.
      if (this.battleResultTimer) {
        return;
      }

      this.inBattle = false;
      this.hasChosenRps = false;

      this.stopBattleCountdown();
      this.stopBattleCountdown();
      this.battleOverlay?.destroy();
      this.battleOverlay = undefined;
      this.battleStatusText = undefined;
    }
  }

  drawGrid() {
    this.tiles = [];

    const size = 9;
    const screenWidth = this.scale.gameSize.width;
    const screenHeight = this.scale.gameSize.height;

    const isTouch = this.sys.game.device.input.touch;
    const isLandscape = screenWidth > screenHeight;

    const maxGridWidth = isTouch
      ? isLandscape
        ? screenWidth * 0.66
        : screenWidth * 0.94
      : screenWidth * 0.8;

    const maxGridHeight = isTouch
      ? isLandscape
        ? screenHeight * 0.68
        : screenHeight * 0.72
      : screenHeight * 0.8;

    const tileSize = Math.floor(Math.min(maxGridWidth, maxGridHeight) / size);

    const gridWidth = tileSize * size;
    const gridHeight = tileSize * size;

    const startX = (screenWidth - gridWidth) / 2;
    const startY = (screenHeight - gridHeight) / 2;

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const x = startX + col * tileSize;
        const y = startY + row * tileSize;

        const level = this.getRingLevel(row, col);

        if (level !== -1) {
          this.add
            .rectangle(x, y, tileSize - 2, tileSize - 2, this.getColor(level))
            .setOrigin(0);

          if (level === 5) {
            const graphics = this.add.graphics();

            // Match grid line style
            graphics.lineStyle(2, 0x000000, 1);

            // Vertical line
            graphics.beginPath();
            graphics.moveTo(x + tileSize / 2, y);
            graphics.lineTo(x + tileSize / 2, y + tileSize);
            graphics.strokePath();

            // Horizontal line
            graphics.beginPath();
            graphics.moveTo(x, y + tileSize / 2);
            graphics.lineTo(x + tileSize, y + tileSize / 2);
            graphics.strokePath();
          }

          this.tiles.push({
            row,
            col,
            level,
            x: x + tileSize / 2,
            y: y + tileSize / 2,
          });
        }
      }
    }
  }

  getRingLevel(row: number, col: number): number {
    const min = Math.min(row, col, 8 - row, 8 - col);

    if (min === 0) return 1;
    if (min === 1) return 2;
    if (min === 2) return 3;
    if (min === 3) return 4;
    if (min === 4) return 5;

    return -1;
  }

  getColor(level: number): number {
    switch (level) {
      case 1:
        return 0x1abc9c;
      case 2:
        return 0x3498db;
      case 3:
        return 0xf1c40f;
      case 4:
        return 0xe67e22;
      case 5:
        return 0xe74c3c;
      default:
        return 0xffffff;
    }
  }

  getDisplayPosition(tile: TileData) {
    const baseTile = this.tiles.find(
      (t) => t.row === tile.row && t.col === tile.col && t.level === tile.level,
    );

    if (!baseTile) return { x: tile.x, y: tile.y };

    if (tile.level !== 5 || !tile.zone) {
      return { x: baseTile.x, y: baseTile.y };
    }

    const offset = 16;

    switch (tile.zone) {
      case "nw":
        return { x: baseTile.x - offset, y: baseTile.y - offset };
      case "ne":
        return { x: baseTile.x + offset, y: baseTile.y - offset };
      case "sw":
        return { x: baseTile.x - offset, y: baseTile.y + offset };
      case "se":
        return { x: baseTile.x + offset, y: baseTile.y + offset };
    }
  }

  drawPowerUps(powerUps: PowerUpData[]) {
    this.powerUpObjects.forEach((obj) => obj.destroy());
    this.powerUpObjects.clear();

    powerUps.forEach((powerUp) => {
      const tile = this.tiles.find(
        (t) =>
          t.row === powerUp.tile.row &&
          t.col === powerUp.tile.col &&
          t.level === powerUp.tile.level,
      );

      if (!tile) return;

      const displayPos = this.getDisplayPosition({
        ...tile,
        zone: powerUp.tile.zone,
      });

      const isPromote = powerUp.type === "promote";
      const isDemote = powerUp.type === "demote";
      const isDoublePoints = powerUp.type === "doublePoints";
      const isSpeed = powerUp.type === "speed";
      const isFreeze = powerUp.type === "freeze";

      const iconText = isPromote
        ? "↑"
        : isDemote
          ? "↓"
          : isDoublePoints
            ? "⭐"
            : isSpeed
              ? "⚡"
              : isFreeze
                ? "❄️"
                : "🛡️";

      const container = this.add.container(displayPos.x, displayPos.y);
      container.setDepth(80);

      const glow = this.add.circle(0, 0, 22, 0x000000, 0.65);

      const icon = this.add
        .text(0, 0, iconText, {
          fontSize: "26px",
          color: "#ffffff",
          fontFamily: "Arial",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 6,
        })
        .setOrigin(0.5);

      container.add([glow, icon]);

      this.tweens.add({
        targets: container,
        scale: 1.15,
        duration: 450,
        yoyo: true,
        repeat: -1,
      });

      this.powerUpObjects.set(powerUp.id, container);
    });
  }

  drawPlayers(players: ServerPlayer[]) {
    this.playerObjects.forEach((obj) => obj.destroy());
    this.playerObjects.clear();

    players.forEach((player) => {
      const tile = this.tiles.find(
        (t) =>
          t.row === player.tile.row &&
          t.col === player.tile.col &&
          t.level === player.tile.level,
      );

      if (!tile) return;

      const displayPos = this.getDisplayPosition({
        ...tile,
        zone: player.tile.zone,
      });

      const isMe = player.id === socket.id;
      const isBot = player.id.startsWith("bot-");
      const isBattling = player.status === "battle";
      const isFrozen = Date.now() < (player.frozenUntil ?? 0);

      const circle = this.add.circle(
        displayPos.x,
        displayPos.y,
        isBattling ? 20 : 17,
        isFrozen ? 0x87ceeb : isMe ? 0xffffff : isBot ? 0x6c5ce7 : 0x111111,
      );

      circle.setStrokeStyle(
        isBattling ? 6 : 4,
        isBattling
          ? 0xffff00
          : isFrozen
            ? 0x87ceeb
            : isMe
              ? 0x000000
              : 0xffffff,
      );

      if (isBattling) {
        this.tweens.add({
          targets: circle,
          scale: 1.18,
          duration: 350,
          yoyo: true,
          repeat: -1,
        });
      }

      const scoreText = this.add
        .text(displayPos.x, displayPos.y, String(player.score ?? 0), {
          fontSize: "14px",
          color: isMe ? "#000000" : "#ffffff",
          fontFamily: "Arial",
          fontStyle: "bold",
          stroke: isMe ? "#ffffff" : "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5);

      const label = this.add
        .text(
          displayPos.x,
          displayPos.y - 31,
          isBattling
            ? "VS"
            : isMe
              ? "YOU"
              : isBot
                ? "BOT"
                : player.name.slice(0, 3),
          {
            fontSize: isBattling ? "16px" : "14px",
            color: isBattling ? "#ffff00" : "#ffffff",
            fontFamily: "Arial",
            fontStyle: isBattling ? "bold" : "normal",
            stroke: "#000000",
            strokeThickness: 3,
          },
        )
        .setOrigin(0.5);

      const containerChildren: Phaser.GameObjects.GameObject[] = [];

      if (player.shield) {
        const shieldRing = this.add.circle(
          displayPos.x,
          displayPos.y,
          isBattling ? 28 : 25,
          0x3399ff,
          0.18,
        );

        shieldRing.setStrokeStyle(4, 0x66ccff, 0.9);

        this.tweens.add({
          targets: shieldRing,
          scale: 1.15,
          duration: 500,
          yoyo: true,
          repeat: -1,
        });

        const shieldIcon = this.add
          .text(displayPos.x + 18, displayPos.y - 18, "🛡️", {
            fontSize: "16px",
            fontFamily: "Arial",
            stroke: "#000000",
            strokeThickness: 3,
          })
          .setOrigin(0.5);

        containerChildren.push(shieldRing, shieldIcon);
      }

      let timerOffsetY = 31;

      const addStatusText = (text: string) => {
        const statusText = this.add
          .text(displayPos.x, displayPos.y + timerOffsetY, text, {
            fontSize: "15px",
            color: "#ffffff",
            fontFamily: "Arial",
            fontStyle: "bold",
            stroke: "#000000",
            strokeThickness: 4,
          })
          .setOrigin(0.5);

        containerChildren.push(statusText);
        timerOffsetY += 16;
      };

      const doublePointsSecondsLeft = Math.ceil(
        ((player.doublePointsUntil ?? 0) - Date.now()) / 1000,
      );

      if (doublePointsSecondsLeft > 0) {
        addStatusText(`⭐ x2 ${doublePointsSecondsLeft}`);
      }

      const speedSecondsLeft = Math.ceil(
        ((player.speedBoostUntil ?? 0) - Date.now()) / 1000,
      );

      if (speedSecondsLeft > 0) {
        addStatusText(`⚡ ${speedSecondsLeft}`);
      }

      const freezeTrapSecondsLeft = Math.ceil(
        ((player.freezeTrapUntil ?? 0) - Date.now()) / 1000,
      );

      if (freezeTrapSecondsLeft > 0) {
        addStatusText(`❄️ Trap ${freezeTrapSecondsLeft}`);
      }

      const frozenSecondsLeft = Math.ceil(
        ((player.frozenUntil ?? 0) - Date.now()) / 1000,
      );

      if (frozenSecondsLeft > 0) {
        addStatusText(`Frozen ${frozenSecondsLeft}`);
      }

      containerChildren.push(circle, scoreText, label);

      const container = this.add.container(0, 0, containerChildren);

      if (isMe) {
        container.setDepth(isBattling ? 250 : 220);
      } else if (isBattling) {
        container.setDepth(180);
      } else if (isBot) {
        container.setDepth(100);
      } else {
        container.setDepth(140);
      }

      this.playerObjects.set(player.id, container);
    });
  }

  drawHud(state: GameState) {
    this.hudContainer?.destroy();
    const screenHeight = this.scale.gameSize.height;

    const screenWidth = this.scale.gameSize.width;

    const isTouch = this.sys.game.device.input.touch;

    const isLandscape = screenWidth > this.scale.gameSize.height;

    const topY = isTouch
      ? isLandscape
        ? Math.max(70, screenHeight * 0.08)
        : Math.max(45, screenHeight * 0.05)
      : 16;
    const fontSize = isTouch ? 18 : 20;
    const timerSize = isTouch ? 24 : 24;

    const sortedPlayers = [...state.players].sort((a, b) => b.score - a.score);
    const leader = sortedPlayers[0];

    const minutes = Math.floor(state.secondsLeft / 60);
    const seconds = state.secondsLeft % 60;
    const timerText = `${minutes}:${seconds.toString().padStart(2, "0")}`;

    this.hudContainer = this.add.container(0, 0).setDepth(1200);

    const roomCodeText = this.add
      .text(
        screenWidth / 2,
        topY,
        this.roomCode ? `ROOM: ${this.roomCode}` : "",
        {
          fontSize: `${fontSize}px`,
          color: "#ffff00",
          fontFamily: "Arial",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 5,
        },
      )
      .setOrigin(0.5, 0);

    const leaderText = this.add.text(
      14,
      topY,
      leader && leader.score > 0
        ? `KING: ${leader.name} — ${leader.score}`
        : "KING: Nobody",
      {
        fontSize: `${fontSize}px`,
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      },
    );

    const timer = this.add
      .text(screenWidth - 14, topY, timerText, {
        fontSize: `${timerSize}px`,
        color: state.secondsLeft <= 10 ? "#ff4444" : "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(1, 0);

    this.hudContainer.add([leaderText, roomCodeText, timer]);
  }

  isAtSummit() {
    return (
      this.latestGameState?.players.find((p) => p.id === socket.id)?.level === 5
    );
  }

  private ensureBgMusicPlaying() {
    this.sound.stopByKey("victory");

    const existingMusic = this.sound.get("bgmusic");

    if (existingMusic) {
      if (!existingMusic.isPlaying) {
        existingMusic.play({
          loop: true,
          volume: 0.35,
          seek: 0,
        });
      }

      return;
    }

    this.sound.play("bgmusic", {
      loop: true,
      volume: 0.35,
    });
  }

  createTouchControls() {
    this.controlsGroup?.destroy();

    this.heldDirection = null;
    this.nextTouchMoveAt = 0;

    const screenWidth = this.scale.gameSize.width;
    const screenHeight = this.scale.gameSize.height;
    const isLandscape = screenWidth > screenHeight;

    const size = isLandscape ? 78 : 82;
    const gap = 8;

    const centerX = isLandscape ? 125 : 105;
    const centerY = isLandscape ? screenHeight - 125 : screenHeight - 155;

    this.controlsGroup = this.add.container(0, 0).setDepth(900);

    const makeButton = (
      x: number,
      y: number,
      label: string,
      direction: "up" | "down" | "left" | "right",
    ) => {
      const button = this.add
        .rectangle(x, y, size, size, 0xffffff, 0.12)
        .setStrokeStyle(3, 0xffffff, 0.45)
        .setInteractive({ useHandCursor: true });

      const text = this.add
        .text(x, y, label, {
          fontSize: "34px",
          color: "#ffffff",
          fontFamily: "Arial",
          fontStyle: "bold",
          stroke: "#000000",
          strokeThickness: 4,
        })
        .setOrigin(0.5);

      const startHold = () => {
        if (this.inBattle) return;

        this.heldDirection = direction;
        this.nextTouchMoveAt = this.time.now;
        button.setFillStyle(0xffffff, 0.28);
      };

      const stopHold = () => {
        if (this.heldDirection === direction) {
          this.heldDirection = null;
        }

        button.setFillStyle(0xffffff, 0.12);
      };

      button.on("pointerdown", startHold);
      button.on("pointerup", stopHold);
      button.on("pointerout", stopHold);
      button.on("pointerupoutside", stopHold);

      this.controlsGroup?.add([button, text]);
    };

    makeButton(centerX, centerY - size - gap, "▲", "up");
    makeButton(centerX, centerY + size + gap, "▼", "down");
    makeButton(centerX - size - gap, centerY, "◀", "left");
    makeButton(centerX + size + gap, centerY, "▶", "right");
  }

  private stopBattleCountdown() {
    this.battleCountdownTimer?.remove(false);
    this.battleCountdownTimer = undefined;
    this.battleCountdownText = undefined;
    this.battleCountdownEndAt = 0;
  }

  private startBattleCountdown(seconds = 5) {
    this.battleCountdownTimer?.remove(false);

    this.battleCountdownEndAt = this.time.now + seconds * 1000;

    const updateCountdown = () => {
      if (!this.battleCountdownText) return;

      const msLeft = Math.max(0, this.battleCountdownEndAt - this.time.now);
      const secondsLeft = Math.ceil(msLeft / 1000);

      this.battleCountdownText.setText(`Time: ${secondsLeft}`);

      if (secondsLeft <= 2) {
        this.battleCountdownText.setColor("#ff4444");
      } else {
        this.battleCountdownText.setColor("#ffff00");
      }
    };

    updateCountdown();

    this.battleCountdownTimer = this.time.addEvent({
      delay: 100,
      loop: true,
      callback: updateCountdown,
    });
  }

  showBattleUI() {
    this.heldDirection = null;

    if (this.battleOverlay && this.hasChosenRps) {
      this.battleStatusText?.setText("Waiting for opponent...");
      return;
    }

    this.stopBattleCountdown();
    this.battleOverlay?.destroy();

    if (!this.hasChosenRps) {
      this.hasChosenRps = false;
    }

    const screenWidth = this.scale.gameSize.width;
    const screenHeight = this.scale.gameSize.height;

    const panelWidth = Math.min(screenWidth * 0.9, 560);
    const panelHeight = Math.min(screenHeight * 0.55, 320);

    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    const titleSize = Math.max(22, Math.min(34, screenWidth * 0.045));
    const subtitleSize = Math.max(16, Math.min(22, screenWidth * 0.03));
    const buttonWidth = Math.min(145, panelWidth * 0.28);
    const buttonHeight = Math.min(72, panelHeight * 0.24);
    const buttonTextSize = Math.max(16, Math.min(24, screenWidth * 0.028));

    this.battleOverlay = this.add.container(0, 0);
    this.battleOverlay.setDepth(1000);

    const dim = this.add
      .rectangle(0, 0, screenWidth, screenHeight, 0x000000, 0.65)
      .setOrigin(0);

    const panel = this.add
      .rectangle(centerX, centerY, panelWidth, panelHeight, 0x222222, 0.95)
      .setStrokeStyle(4, 0xffffff);

    const title = this.add
      .text(centerX, centerY - panelHeight * 0.33, "ROCK PAPER SCISSORS", {
        fontSize: `${titleSize}px`,
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5);

    this.battleStatusText = this.add
      .text(centerX, centerY - panelHeight * 0.18, "Choose your move!", {
        fontSize: `${subtitleSize}px`,
        color: "#ffffff",
        fontFamily: "Arial",
      })
      .setOrigin(0.5);

    this.battleCountdownText = this.add
      .text(centerX, centerY - panelHeight * 0.04, "Time: 5", {
        fontSize: `${Math.max(20, subtitleSize + 4)}px`,
        color: "#ffff00",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    this.battleOverlay.add([
      dim,
      panel,
      title,
      this.battleStatusText,
      this.battleCountdownText,
    ]);

    this.startBattleCountdown(5);

    let hasChosen = this.hasChosenRps;

    const makeChoiceButton = (
      x: number,
      label: string,
      choice: "rock" | "paper" | "scissors",
    ) => {
      const button = this.add
        .rectangle(
          x,
          centerY + panelHeight * 0.22,
          buttonWidth,
          buttonHeight,
          0xffffff,
          0.22,
        )
        .setStrokeStyle(3, 0xffffff)
        .setInteractive({ useHandCursor: true });

      const text = this.add
        .text(x, centerY + panelHeight * 0.22, label, {
          fontSize: `${buttonTextSize}px`,
          color: "#ffffff",
          fontFamily: "Arial",
          stroke: "#000000",
          strokeThickness: 4,
        })
        .setOrigin(0.5);

      button.on("pointerdown", () => {
        if (hasChosen) return;
        if (this.time.now < this.rpsInputLockedUntil) return;

        hasChosen = true;
        this.hasChosenRps = true;

        socket.emit("rpsChoice", choice);

        text.setText("✓");
        button.disableInteractive();
        this.battleStatusText?.setText("Waiting for opponent...");
      });
      this.battleOverlay?.add([button, text]);
    };

    const spacing = panelWidth * 0.31;

    makeChoiceButton(centerX - spacing, "🪨 Rock", "rock");
    makeChoiceButton(centerX, "📄 Paper", "paper");
    makeChoiceButton(centerX + spacing, "✂️ Scissors", "scissors");
  }

  showEndGamePanel(state: GameState) {
    const bgmusic = this.sound.get("bgmusic");

    if (bgmusic?.isPlaying) {
      bgmusic.stop();
    }

    if (!this.victorySoundPlayed) {
      this.sound.stopByKey("victory");

      this.sound.play("victory", {
        volume: 0.7,
      });

      this.victorySoundPlayed = true;
    }

    this.heldDirection = null;
    this.endGameOverlay?.destroy();
    this.endGameOverlay = undefined;

    this.inBattle = false;
    this.stopBattleCountdown();
    this.battleOverlay?.destroy();
    this.battleOverlay = undefined;

    const screenWidth = this.scale.gameSize.width;
    const screenHeight = this.scale.gameSize.height;

    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    const panelWidth = Math.min(screenWidth * 0.9, 560);
    const panelHeight = Math.min(screenHeight * 0.75, 460);

    this.endGameOverlay = this.add.container(0, 0).setDepth(1500);

    const dim = this.add
      .rectangle(0, 0, screenWidth, screenHeight, 0x000000, 0.72)
      .setOrigin(0);

    const panel = this.add
      .rectangle(centerX, centerY, panelWidth, panelHeight, 0x222222, 0.97)
      .setStrokeStyle(5, 0xffff00);

    const title = this.add
      .text(centerX, centerY - panelHeight * 0.39, "GAME OVER", {
        fontSize: "38px",
        color: "#ffff00",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    const scoredPlayers = [...state.players]
      .filter((player) => player.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const leaderboardLines =
      scoredPlayers.length > 0
        ? scoredPlayers
            .map((player, index) => {
              const label =
                player.id === socket.id
                  ? "YOU"
                  : player.id.startsWith("bot-")
                    ? player.name
                    : player.name;

              return `${index + 1}. ${label} — ${player.score} pts`;
            })
            .join("\n")
        : "Nobody reached the summit!";

    const leaderboard = this.add
      .text(centerX, centerY - panelHeight * 0.12, leaderboardLines, {
        fontSize: "24px",
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        align: "center",
        stroke: "#000000",
        strokeThickness: 4,
        lineSpacing: 10,
      })
      .setOrigin(0.5);

    const buttonY = centerY + panelHeight * 0.32;

    const playAgainButton = this.add
      .rectangle(centerX, buttonY, 220, 64, 0x27ae60, 1)
      .setStrokeStyle(4, 0xffffff)
      .setInteractive({ useHandCursor: true });

    const playAgainText = this.add
      .text(centerX, buttonY, "PLAY AGAIN", {
        fontSize: "24px",
        color: "#ffffff",
        fontFamily: "Arial",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    playAgainButton.on("pointerdown", () => {
      socket.emit("playAgain");
    });

    this.endGameOverlay.add([
      dim,
      panel,
      title,
      leaderboard,
      playAgainButton,
      playAgainText,
    ]);
  }

  showRpsResult(data: {
    yourChoice: string | null;
    opponentChoice: string | null;
    result: "win" | "lose" | "draw" | "cancel";
    promotion?: "moved" | "blocked" | "alreadySummit";
    reason?: "timeout";
  }) {
    this.battleResultTimer?.remove(false);
    this.battleResultTimer = undefined;
    this.stopBattleCountdown();

    this.inBattle = true;

    if (!this.battleOverlay || !this.battleStatusText) {
      this.showBattleUI();
    }

    if (!this.battleStatusText) return;

    if (data.result === "cancel") {
      this.battleStatusText.setText("No one chose in time — battle cancelled.");

      const cancelDelay = this.sys.game.device.input.touch ? 1200 : 900;

      this.battleResultTimer = this.time.delayedCall(cancelDelay, () => {
        this.inBattle = false;
        this.hasChosenRps = false;
        this.battleOverlay?.destroy();
        this.battleOverlay = undefined;
        this.battleStatusText = undefined;
        this.battleResultTimer = undefined;
      });

      return;
    }

    if (data.result === "draw") {
      const choiceText = data.yourChoice ?? "the same move";

      this.battleStatusText.setText(
        `Draw! Both chose ${choiceText}. Choose again.`,
      );

      this.battleResultTimer = this.time.delayedCall(1850, () => {
        this.hasChosenRps = false;
        this.rpsInputLockedUntil = this.time.now + 300;

        this.battleOverlay?.destroy();
        this.battleOverlay = undefined;
        this.battleStatusText = undefined;
        this.battleResultTimer = undefined;

        this.time.delayedCall(350, () => {
          if (this.inBattle && !this.battleOverlay) {
            this.showBattleUI();
          }
        });
      });

      return;
    }

    if (data.result === "win") {
      if (data.promotion === "alreadySummit") {
        this.battleStatusText.setText(`You win! You hold the summit!`);

        const summitDelay = this.sys.game.device.input.touch ? 1800 : 1200;

        this.battleResultTimer = this.time.delayedCall(summitDelay, () => {
          this.inBattle = false;
          this.hasChosenRps = false;
          this.stopBattleCountdown();
          this.battleOverlay?.destroy();
          this.battleOverlay = undefined;
          this.battleStatusText = undefined;
          this.battleResultTimer = undefined;
        });

        return;
      }
      if (data.promotion === "blocked") {
        this.battleStatusText.setText(
          `You win! Summit is full — holding position.`,
        );

        const blockedDelay = this.sys.game.device.input.touch ? 2300 : 1800;

        this.battleResultTimer = this.time.delayedCall(blockedDelay, () => {
          this.inBattle = false;
          this.hasChosenRps = false;
          this.stopBattleCountdown();
          this.battleOverlay?.destroy();
          this.battleOverlay = undefined;
          this.battleStatusText = undefined;
          this.battleResultTimer = undefined;
        });

        return;
      }

      if (data.reason === "timeout") {
        this.battleStatusText.setText(
          "You win! Opponent did not choose in time.",
        );
      } else if (this.isAtSummit()) {
        this.battleStatusText.setText(`You win! You hold the summit!`);
      } else {
        this.battleStatusText.setText(`You win! Moving up!`);
      }
    } else {
      if (data.reason === "timeout") {
        this.battleStatusText.setText("You lose! You did not choose in time.");
      } else {
        this.battleStatusText.setText(
          `You lose! You chose ${data.yourChoice}, opponent chose ${data.opponentChoice}.`,
        );
      }
    }

    const resultDelay = this.sys.game.device.input.touch ? 1800 : 1200;

    this.battleResultTimer = this.time.delayedCall(resultDelay, () => {
      this.inBattle = false;
      this.hasChosenRps = false;
      this.stopBattleCountdown();
      this.stopBattleCountdown();
      this.battleOverlay?.destroy();
      this.battleOverlay = undefined;
      this.battleStatusText = undefined;
      this.battleResultTimer = undefined;
    });
  }
}
