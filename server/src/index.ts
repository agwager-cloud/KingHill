import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { getTilesByLevel, type ServerTile } from "./game/hillLayout";

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 3001;

type PlayerStatus = "idle" | "battle";
type RpsChoice = "rock" | "paper" | "scissors";
type GameStatus = "lobby" | "playing" | "finished";

type PlayerState = {
  id: string;
  name: string;
  tile: ServerTile;
  level: number;
  status: PlayerStatus;
  score: number;
  shield: boolean;
  doublePointsUntil: number;
  speedBoostUntil: number;
  freezeTrapUntil: number;
  frozenUntil: number;
};

type BattleState = {
  id: string;
  playerAId: string;
  playerBId: string;
  choices: Map<string, RpsChoice>;
  acceptChoicesAfter: number;
  timeout?: NodeJS.Timeout;
};

type RoomState = {
  code: string;
  hostId: string;
  players: Map<string, PlayerState>;
  battles: Map<string, BattleState>;
  powerUps: Map<string, PowerUp>;
  botCount: 0 | 6 | 12;
  secondsLeft: number;
  status: GameStatus;
};
type PowerUp = {
  id: string;
  tile: ServerTile;
  type: "promote" | "demote" | "shield" | "doublePoints" | "speed" | "freeze";
};
const rooms = new Map<string, RoomState>();
const socketToRoom = new Map<string, string>();

const BOTS_PER_LEVEL = 3;
const MAX_TEST_BOTS = 12;
const BOT_LEVELS = [1, 2, 3, 4];
const ROUND_SECONDS = 180;
const BATTLE_TIMEOUT_MS = 5000;
const DRAW_RESET_DELAY_MS = 1800;
const BOT_CHOICE_DELAY_MS = 4500;

function generateRoomCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const numbers = "23456789";

  const code =
    letters[Math.floor(Math.random() * letters.length)] +
    numbers[Math.floor(Math.random() * numbers.length)] +
    numbers[Math.floor(Math.random() * numbers.length)] +
    numbers[Math.floor(Math.random() * numbers.length)];

  return rooms.has(code) ? generateRoomCode() : code;
}

function getTileKey(tile: ServerTile): string {
  return `${tile.row},${tile.col},${tile.zone ?? "none"}`;
}

function getRoomForSocket(socketId: string): RoomState | undefined {
  const code = socketToRoom.get(socketId);
  if (!code) return undefined;
  return rooms.get(code);
}

function sendRoomState(room: RoomState) {
  io.to(room.code).emit("gameState", {
    players: [...room.players.values()],
    powerUps: [...room.powerUps.values()],
    botCount: room.botCount,
    secondsLeft: room.secondsLeft,
    gameStatus: room.status,
  });
}
function getRandomFreeTile(room: RoomState, level: number): ServerTile | null {
  const tiles = getTilesByLevel(level);

  const occupied = new Set(
    [...room.players.values()]
      .filter((player) => player.level === level)
      .map((player) => getTileKey(player.tile)),
  );

  const freeTiles = tiles.filter((tile) => !occupied.has(getTileKey(tile)));
  if (freeTiles.length === 0) return null;

  return freeTiles[Math.floor(Math.random() * freeTiles.length)];
}

function getNearbyFreeTile(
  room: RoomState,
  fromTile: ServerTile,
  targetLevel: number,
): ServerTile | null {
  const tiles = getTilesByLevel(targetLevel);

  const occupied = new Set(
    [...room.players.values()]
      .filter((player) => player.level === targetLevel)
      .map((player) => getTileKey(player.tile)),
  );

  const freeTiles = tiles.filter((tile) => !occupied.has(getTileKey(tile)));
  if (freeTiles.length === 0) return null;

  freeTiles.sort((a, b) => {
    const distanceA =
      Math.abs(a.row - fromTile.row) + Math.abs(a.col - fromTile.col);

    const distanceB =
      Math.abs(b.row - fromTile.row) + Math.abs(b.col - fromTile.col);

    return distanceA - distanceB;
  });

  const closestDistance =
    Math.abs(freeTiles[0].row - fromTile.row) +
    Math.abs(freeTiles[0].col - fromTile.col);

  const closestTiles = freeTiles.filter((tile) => {
    const distance =
      Math.abs(tile.row - fromTile.row) + Math.abs(tile.col - fromTile.col);

    return distance === closestDistance;
  });

  return closestTiles[Math.floor(Math.random() * closestTiles.length)];
}

function getBattleForPlayer(
  room: RoomState,
  playerId: string,
): BattleState | undefined {
  return [...room.battles.values()].find(
    (battle) => battle.playerAId === playerId || battle.playerBId === playerId,
  );
}

function getRpsWinner(
  choiceA: RpsChoice,
  choiceB: RpsChoice,
): "a" | "b" | "draw" {
  if (choiceA === choiceB) return "draw";

  if (
    (choiceA === "rock" && choiceB === "scissors") ||
    (choiceA === "paper" && choiceB === "rock") ||
    (choiceA === "scissors" && choiceB === "paper")
  ) {
    return "a";
  }

  return "b";
}

function spawnPowerUps() {
  setInterval(() => {
    for (const room of rooms.values()) {
      if (room.status !== "playing") continue;

      const MAX_POWERUPS = 6;
      if (room.powerUps.size >= MAX_POWERUPS) continue;

      const occupiedPowerUpTiles = new Set(
        [...room.powerUps.values()].map((powerUp) => getTileKey(powerUp.tile)),
      );

      const hasFreezeOnBoard = [...room.powerUps.values()].some(
        (powerUp) => powerUp.type === "freeze",
      );

      const types: PowerUp["type"][] = [
        "promote",
        "demote",
        "shield",
        "doublePoints",
        "speed",
        "freeze",
      ];

      const type: PowerUp["type"] = hasFreezeOnBoard
        ? types[Math.floor(Math.random() * types.length)]
        : "freeze";

      let level: number;

      if (type === "doublePoints") {
        level = Math.random() < 0.65 ? 4 : 3;
      } else {
        level = Math.floor(Math.random() * 4) + 1;
      }

      const possibleTiles = getTilesByLevel(level).filter(
        (tile) => !occupiedPowerUpTiles.has(getTileKey(tile)),
      );

      if (possibleTiles.length === 0) continue;

      const tile =
        possibleTiles[Math.floor(Math.random() * possibleTiles.length)];

      const id = `pu-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

      room.powerUps.set(id, { id, tile, type });
    }
  }, 4000);
}

function promotePlayer(
  room: RoomState,
  playerId: string,
): "moved" | "blocked" | "alreadySummit" {
  const player = room.players.get(playerId);
  if (!player) return "blocked";

  const nextLevel = Math.min(player.level + 1, 5);

  if (nextLevel === player.level) return "alreadySummit";

  const tile = getNearbyFreeTile(room, player.tile, nextLevel);

  if (!tile) return "blocked";

  player.level = nextLevel;
  player.tile = tile;

  return "moved";
}

function demotePlayer(room: RoomState, playerId: string) {
  const player = room.players.get(playerId);
  if (!player) return;

  const nextLevel = Math.max(player.level - 1, 1);

  if (nextLevel === player.level) return;

  const tile = getNearbyFreeTile(room, player.tile, nextLevel);

  if (!tile) return;

  player.level = nextLevel;
  player.tile = tile;
}

function getTotalBotCount(room: RoomState): number {
  return [...room.players.values()].filter((player) =>
    player.id.startsWith("bot-"),
  ).length;
}

function trimExtraBots(room: RoomState) {
  const bots = [...room.players.values()].filter((player) =>
    player.id.startsWith("bot-"),
  );

  const extraBots = bots.length - MAX_TEST_BOTS;
  if (extraBots <= 0) return;

  for (let i = 0; i < extraBots; i++) {
    room.players.delete(bots[i].id);
  }
}

function addTestBots(room: RoomState) {
  if (room.botCount === 0) return;

  const levels =
    room.botCount === 6
      ? [1, 1, 2, 2, 3, 4]
      : [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4];

  levels.forEach((level, index) => {
    const tile = getRandomFreeTile(room, level);
    if (!tile) return;

    const botId = `bot-${room.code}-${level}-${index}`;

    room.players.set(botId, {
      id: botId,
      name: `Bot ${level}`,
      tile,
      level,
      status: "idle",
      score: 0,
      shield: false,
      doublePointsUntil: 0,
      speedBoostUntil: 0,
      freezeTrapUntil: 0,
      frozenUntil: 0,
    });
  });
}

function refillTestBots(room: RoomState) {
  trimExtraBots(room);

  // Desired distribution based on lobby setting
  const targetDistribution =
    room.botCount === 0
      ? { 1: 0, 2: 0, 3: 0, 4: 0 }
      : room.botCount === 6
        ? { 1: 2, 2: 2, 3: 1, 4: 1 }
        : { 1: 3, 2: 3, 3: 3, 4: 3 };

  for (const level of BOT_LEVELS) {
    const currentBots = [...room.players.values()].filter(
      (player) => player.id.startsWith("bot-") && player.level === level,
    ).length;

    const targetBots =
      targetDistribution[level as keyof typeof targetDistribution];

    const botsNeeded = Math.max(0, targetBots - currentBots);

    for (let i = 0; i < botsNeeded; i++) {
      if (getTotalBotCount(room) >= room.botCount) return;

      const tile = getRandomFreeTile(room, level);
      if (!tile) continue;

      const botId = `bot-${room.code}-${level}-${Date.now()}-${i}`;

      room.players.set(botId, {
        id: botId,
        name: `Bot ${level}`,
        tile,
        level,
        status: "idle",
        score: 0,
        shield: false,
        doublePointsUntil: 0,
        speedBoostUntil: 0,
        freezeTrapUntil: 0,
        frozenUntil: 0,
      });
    }
  }

  trimExtraBots(room);
}

function getBotRpsChoice(battle: BattleState, botId: string): RpsChoice {
  const choices: RpsChoice[] = ["rock", "paper", "scissors"];

  const opponentId =
    battle.playerAId === botId ? battle.playerBId : battle.playerAId;

  const opponentChoice = battle.choices.get(opponentId);

  // If the human has already chosen, avoid copying them.
  // This removes draws without making the bot always win.
  if (opponentChoice) {
    const nonDrawChoices = choices.filter(
      (choice) => choice !== opponentChoice,
    );
    return nonDrawChoices[Math.floor(Math.random() * nonDrawChoices.length)];
  }

  return choices[Math.floor(Math.random() * choices.length)];
}

function isBotId(id: string): boolean {
  return id.startsWith("bot-");
}

function sendBattleStartIfHuman(playerId: string, data: object) {
  if (!isBotId(playerId)) {
    io.to(playerId).emit("battleStart", data);
  }
}

function clearBattleTimer(battle: BattleState) {
  if (battle.timeout) {
    clearTimeout(battle.timeout);
    battle.timeout = undefined;
  }
}

function clearAllBattleTimers(room: RoomState) {
  for (const battle of room.battles.values()) {
    clearBattleTimer(battle);
  }
}

function endBattle(room: RoomState, battle: BattleState) {
  clearBattleTimer(battle);

  const playerA = room.players.get(battle.playerAId);
  const playerB = room.players.get(battle.playerBId);

  if (playerA) playerA.status = "idle";
  if (playerB) playerB.status = "idle";

  room.battles.delete(battle.id);
  sendRoomState(room);
}

function scheduleBotChoice(roomCode: string, battleId: string, botId: string) {
  setTimeout(() => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== "playing") return;

    const battle = room.battles.get(battleId);
    if (!battle) return;

    if (Date.now() < battle.acceptChoicesAfter) return;
    if (battle.choices.has(botId)) return;

    battle.choices.set(botId, getBotRpsChoice(battle, botId));
    resolveBattleIfReady(room, battle);
  }, BOT_CHOICE_DELAY_MS);
}

function scheduleBotChoicesForBattle(room: RoomState, battle: BattleState) {
  if (isBotId(battle.playerAId)) {
    scheduleBotChoice(room.code, battle.id, battle.playerAId);
  }

  if (isBotId(battle.playerBId)) {
    scheduleBotChoice(room.code, battle.id, battle.playerBId);
  }
}

function startBattleTimer(room: RoomState, battle: BattleState) {
  clearBattleTimer(battle);

  battle.timeout = setTimeout(() => {
    const freshRoom = rooms.get(room.code);
    if (!freshRoom || freshRoom.status !== "playing") return;

    const freshBattle = freshRoom.battles.get(battle.id);
    if (!freshBattle) return;

    resolveBattleTimeout(freshRoom, freshBattle);
  }, BATTLE_TIMEOUT_MS);
}

function resolveBattleTimeout(room: RoomState, battle: BattleState) {
  const choiceA = battle.choices.get(battle.playerAId);
  const choiceB = battle.choices.get(battle.playerBId);

  // Neither player chose in time: cancel battle and keep both players where they are.
  if (!choiceA && !choiceB) {
    io.to(battle.playerAId).emit("rpsResult", {
      yourChoice: null,
      opponentChoice: null,
      result: "cancel",
      reason: "timeout",
    });

    io.to(battle.playerBId).emit("rpsResult", {
      yourChoice: null,
      opponentChoice: null,
      result: "cancel",
      reason: "timeout",
    });

    endBattle(room, battle);
    return;
  }

  // Exactly one player chose in time: that player wins.
  if (choiceA && !choiceB) {
    resolveBattleWinner(
      room,
      battle,
      battle.playerAId,
      battle.playerBId,
      choiceA,
      null,
    );
    return;
  }

  if (!choiceA && choiceB) {
    resolveBattleWinner(
      room,
      battle,
      battle.playerBId,
      battle.playerAId,
      choiceB,
      null,
    );
  }
}

function resolveBattleWinner(
  room: RoomState,
  battle: BattleState,
  winnerId: string,
  loserId: string,
  winnerChoice: RpsChoice,
  loserChoice: RpsChoice | null,
) {
  const promoteResult = promotePlayer(room, winnerId);

  const loser = room.players.get(loserId);
  const winner = room.players.get(winnerId);

  let shouldFreezeLoser = false;

  if (winner && loser && Date.now() < winner.freezeTrapUntil) {
    shouldFreezeLoser = true;
    winner.freezeTrapUntil = 0;
  }

  const shieldBlockedLoss = loser?.shield === true;

  if (shieldBlockedLoss && loser) {
    loser.shield = false;
  } else {
    demotePlayer(room, loserId);
  }

  const updatedLoser = room.players.get(loserId);

  // Shield also blocks freeze
  if (shouldFreezeLoser && updatedLoser && !shieldBlockedLoss) {
    updatedLoser.frozenUntil = Date.now() + 5000;
  }

  refillTestBots(room);

  const winnerIsA = winnerId === battle.playerAId;

  io.to(battle.playerAId).emit("rpsResult", {
    yourChoice: winnerIsA ? winnerChoice : loserChoice,
    opponentChoice: winnerIsA ? loserChoice : winnerChoice,
    result: winnerIsA ? "win" : "lose",
    promotion: winnerIsA ? promoteResult : undefined,
    reason: loserChoice === null ? "timeout" : undefined,
  });

  io.to(battle.playerBId).emit("rpsResult", {
    yourChoice: winnerIsA ? loserChoice : winnerChoice,
    opponentChoice: winnerIsA ? winnerChoice : loserChoice,
    result: winnerIsA ? "lose" : "win",
    promotion: winnerIsA ? undefined : promoteResult,
    reason: loserChoice === null ? "timeout" : undefined,
  });

  endBattle(room, battle);
}

function resolveBattleIfReady(room: RoomState, battle: BattleState) {
  if (battle.choices.size < 2) return;

  const choiceA = battle.choices.get(battle.playerAId);
  const choiceB = battle.choices.get(battle.playerBId);

  if (!choiceA || !choiceB) return;

  const result = getRpsWinner(choiceA, choiceB);

  if (result === "draw") {
    clearBattleTimer(battle);
    io.to(battle.playerAId).emit("rpsResult", {
      yourChoice: choiceA,
      opponentChoice: choiceB,
      result: "draw",
    });

    io.to(battle.playerBId).emit("rpsResult", {
      yourChoice: choiceB,
      opponentChoice: choiceA,
      result: "draw",
    });

    battle.choices.clear();
    battle.acceptChoicesAfter = Date.now() + DRAW_RESET_DELAY_MS;

    setTimeout(() => {
      const freshRoom = rooms.get(room.code);
      if (!freshRoom) return;

      const freshBattle = freshRoom.battles.get(battle.id);
      if (!freshBattle) return;

      if (Date.now() < freshBattle.acceptChoicesAfter) return;

      startBattleTimer(freshRoom, freshBattle);
      scheduleBotChoicesForBattle(freshRoom, freshBattle);
    }, DRAW_RESET_DELAY_MS + 50);

    return;
  }

  const winnerId = result === "a" ? battle.playerAId : battle.playerBId;
  const loserId = result === "a" ? battle.playerBId : battle.playerAId;
  const winnerChoice = result === "a" ? choiceA : choiceB;
  const loserChoice = result === "a" ? choiceB : choiceA;

  resolveBattleWinner(
    room,
    battle,
    winnerId,
    loserId,
    winnerChoice,
    loserChoice,
  );
}

function movePlayerInRoom(
  room: RoomState,
  playerId: string,
  direction: "up" | "down" | "left" | "right",
) {
  const player = room.players.get(playerId);
  if (!player) return;

  if (room.status !== "playing") return;
  if (player.status === "battle") return;

  if (Date.now() < player.frozenUntil) return;

  const changes = {
    up: { row: -1, col: 0 },
    down: { row: 1, col: 0 },
    left: { row: 0, col: -1 },
    right: { row: 0, col: 1 },
  };

  const change = changes[direction];

  let validTarget: ServerTile | undefined;

  if (player.level === 5 && player.tile.zone) {
    const zoneMoves: Record<
      string,
      Partial<Record<"up" | "down" | "left" | "right", string>>
    > = {
      nw: { right: "ne", down: "sw" },
      ne: { left: "nw", down: "se" },
      sw: { right: "se", up: "nw" },
      se: { left: "sw", up: "ne" },
    };

    const nextZone = zoneMoves[player.tile.zone]?.[direction];
    if (!nextZone) return;

    validTarget = getTilesByLevel(5).find((tile) => tile.zone === nextZone);
  } else {
    const targetRow = player.tile.row + change.row;
    const targetCol = player.tile.col + change.col;

    validTarget = getTilesByLevel(player.level).find(
      (tile) => tile.row === targetRow && tile.col === targetCol,
    );
  }

  if (!validTarget) return;

  const playerOnTarget = [...room.players.values()].find((otherPlayer) => {
    if (otherPlayer.id === player.id) return false;
    if (otherPlayer.level !== player.level) return false;
    if (otherPlayer.tile.row !== validTarget.row) return false;
    if (otherPlayer.tile.col !== validTarget.col) return false;

    if (player.level === 5) {
      return otherPlayer.tile.zone === validTarget.zone;
    }

    return true;
  });

  if (playerOnTarget) {
    if (playerOnTarget.status === "battle") {
      return;
    }

    const opponent = playerOnTarget;

    player.status = "battle";
    opponent.status = "battle";

    const battleId = `${player.id}-${opponent.id}-${Date.now()}`;

    room.battles.set(battleId, {
      id: battleId,
      playerAId: player.id,
      playerBId: opponent.id,
      choices: new Map(),
      acceptChoicesAfter: Date.now(),
    });

    const battle = room.battles.get(battleId);
    if (!battle) return;

    startBattleTimer(room, battle);
    sendRoomState(room);

    sendBattleStartIfHuman(player.id, {
      battleId,
      opponentId: opponent.id,
    });

    sendBattleStartIfHuman(opponent.id, {
      battleId,
      opponentId: player.id,
    });

    scheduleBotChoicesForBattle(room, battle);

    return;
  }

  player.tile = validTarget;

  const powerUp = [...room.powerUps.values()].find(
    (p) =>
      p.tile.row === validTarget.row &&
      p.tile.col === validTarget.col &&
      p.tile.level === player.level,
  );

  if (powerUp) {
    if (powerUp.type === "promote") {
      promotePlayer(room, player.id);
    } else if (powerUp.type === "demote") {
      demotePlayer(room, player.id);
    } else if (powerUp.type === "shield") {
      player.shield = true;
    } else if (powerUp.type === "doublePoints") {
      player.doublePointsUntil = Date.now() + 20000;
    } else if (powerUp.type === "speed") {
      player.speedBoostUntil = Date.now() + 10000;
    } else if (powerUp.type === "freeze") {
      player.freezeTrapUntil = Date.now() + 15000;
    }

    if (!player.id.startsWith("bot-")) {
      io.to(player.id).emit("powerupCollected", {
        type: powerUp.type,
      });
    }

    room.powerUps.delete(powerUp.id);
  }
}

function startGameLoop() {
  setInterval(() => {
    for (const room of rooms.values()) {
      if (room.status !== "playing") continue;

      room.secondsLeft--;

      for (const player of room.players.values()) {
        if (player.level === 5) {
          const hasDoublePoints = Date.now() < player.doublePointsUntil;
          player.score += hasDoublePoints ? 2 : 1;
        }
      }

      if (room.secondsLeft <= 0) {
        room.secondsLeft = 0;
        room.status = "finished";
        clearAllBattleTimers(room);
        room.battles.clear();

        for (const player of room.players.values()) {
          player.status = "idle";
        }
      }

      sendRoomState(room);
    }
  }, 1000);
}

const BLOCKED_INITIALS = new Set([
  "FUC",
  "FUK",
  "FCK",
  "FKU",
  "CNT",
  "CUM",
  "SEX",
  "ASS",
  "DIK",
  "DIC",
  "DCK",
  "COC",
  "COK",
  "GAY",
  "KKK",
  "NIG",
  "NGR",
  "WTF",
  "SHT",
  "PIS",
  "PEN",
  "VAG",
  "TIT",
  "BJS",
  "BJ",
]);

function cleanName(name: string): string {
  const cleaned = String(name || "???")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);

  if (!cleaned) return "???";

  if (BLOCKED_INITIALS.has(cleaned)) {
    return "???";
  }

  return cleaned;
}

app.get("/", (_req, res) => {
  res.send("King of the Hill server is running");
});

function movePlayerWithBoost(
  room: RoomState,
  playerId: string,
  direction: "up" | "down" | "left" | "right",
) {
  const player = room.players.get(playerId);
  if (!player) return;

  const hasSpeedBoost = Date.now() < player.speedBoostUntil;
  const steps = hasSpeedBoost ? 2 : 1;

  for (let i = 0; i < steps; i++) {
    movePlayerInRoom(room, playerId, direction);

    const updatedPlayer = room.players.get(playerId);
    if (!updatedPlayer) return;

    // Stop if a battle starts, game ends, or movement is blocked.
    if (updatedPlayer.status === "battle") return;
    if (room.status !== "playing") return;
  }
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("createRoom", (name: string) => {
    const code = generateRoomCode();

    const room: RoomState = {
      code,
      hostId: socket.id,
      players: new Map(),
      battles: new Map(),
      powerUps: new Map(),
      botCount: 12,
      secondsLeft: ROUND_SECONDS,
      status: "lobby",
    };

    rooms.set(code, room);
    socketToRoom.set(socket.id, code);
    socket.join(code);

    const spawnTile = getRandomFreeTile(room, 1);

    if (!spawnTile) {
      socket.emit("joinError", "No free spawn tiles available.");
      return;
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: cleanName(name),
      tile: spawnTile,
      level: spawnTile.level,
      status: "idle",
      score: 0,
      shield: false,
      doublePointsUntil: 0,
      speedBoostUntil: 0,
      freezeTrapUntil: 0,
      frozenUntil: 0,
    });

    addTestBots(room);

    socket.emit("roomCreated", { roomCode: code });
    sendRoomState(room);
  });

  socket.on("requestRoomState", () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    socket.emit("gameState", {
      players: [...room.players.values()],
      powerUps: [...room.powerUps.values()],
      botCount: room.botCount,
      secondsLeft: room.secondsLeft,
      gameStatus: room.status,
    });
  });

  socket.on("joinRoom", (data: { roomCode: string; name: string }) => {
    const roomCode = String(data.roomCode || "")
      .toUpperCase()
      .trim();
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit("joinError", "Room not found.");
      return;
    }

    if (room.status === "finished") {
      socket.emit("joinError", "Game has already finished.");
      return;
    }

    const spawnTile = getRandomFreeTile(room, 1);

    if (!spawnTile) {
      socket.emit("joinError", "No free spawn tiles available.");
      return;
    }

    socketToRoom.set(socket.id, room.code);
    socket.join(room.code);

    room.players.set(socket.id, {
      id: socket.id,
      name: cleanName(data.name),
      tile: spawnTile,
      level: spawnTile.level,
      status: "idle",
      score: 0,
      shield: false,
      doublePointsUntil: 0,
      speedBoostUntil: 0,
      freezeTrapUntil: 0,
      frozenUntil: 0,
    });

    socket.emit("joinSuccess", { roomCode: room.code });
    sendRoomState(room);
  });

  socket.on("startRoomGame", () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    if (room.hostId !== socket.id) return;

    room.secondsLeft = ROUND_SECONDS;
    room.status = "playing";

    for (const player of room.players.values()) {
      player.score = 0;
      player.status = "idle";
    }

    clearAllBattleTimers(room);
    room.battles.clear();
    sendRoomState(room);
  });

  socket.on("setBotCount", (count: 0 | 6 | 12) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    if (room.hostId !== socket.id) return;

    if (![0, 6, 12].includes(count)) return;

    room.botCount = count;

    // Remove existing bots
    for (const player of [...room.players.values()]) {
      if (player.id.startsWith("bot-")) {
        room.players.delete(player.id);
      }
    }

    // Re-add bots using new setting
    addTestBots(room);

    sendRoomState(room);
  });

  socket.on("kickPlayer", (playerId: string) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    if (room.hostId !== socket.id) return;
    if (playerId === room.hostId) return;

    const player = room.players.get(playerId);
    if (!player) return;

    const battle = getBattleForPlayer(room, playerId);
    if (battle) {
      endBattle(room, battle);
    }

    room.players.delete(playerId);
    socketToRoom.delete(playerId);

    const targetSocket = io.sockets.sockets.get(playerId);

    if (targetSocket) {
      targetSocket.leave(room.code);
      targetSocket.emit("joinError", "You were removed by the host.");
    }

    sendRoomState(room);
  });

  socket.on("moveRequest", (direction: "up" | "down" | "left" | "right") => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    movePlayerWithBoost(room, socket.id, direction);
    sendRoomState(room);
  });

  socket.on("rpsChoice", (choice: RpsChoice) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    if (room.status !== "playing") return;
    if (!["rock", "paper", "scissors"].includes(choice)) return;

    const battle = getBattleForPlayer(room, socket.id);
    if (!battle) return;

    if (battle.choices.has(socket.id)) return;

    if (Date.now() < battle.acceptChoicesAfter) return;

    battle.choices.set(socket.id, choice);

    // If this is human vs bot, make the bot choose AFTER the human,
    // and force it to choose something different.
    const opponentId =
      battle.playerAId === socket.id ? battle.playerBId : battle.playerAId;

    if (isBotId(opponentId) && !battle.choices.has(opponentId)) {
      battle.choices.set(opponentId, getBotRpsChoice(battle, opponentId));
    }

    resolveBattleIfReady(room, battle);
  });

  socket.on("playAgain", () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    if (room.hostId !== socket.id) return;

    room.secondsLeft = ROUND_SECONDS;
    room.status = "playing";
    clearAllBattleTimers(room);
    room.battles.clear();

    const realPlayers = [...room.players.values()].filter(
      (player) => !player.id.startsWith("bot-"),
    );

    room.players.clear();

    for (const player of realPlayers) {
      const spawnTile = getRandomFreeTile(room, 1);
      if (!spawnTile) continue;

      room.players.set(player.id, {
        id: player.id,
        name: player.name,
        tile: spawnTile,
        level: spawnTile.level,
        status: "idle",
        score: 0,
        shield: false,
        doublePointsUntil: 0,
        speedBoostUntil: 0,
        freezeTrapUntil: 0,
        frozenUntil: 0,
      });
    }

    addTestBots(room);

    for (const player of room.players.values()) {
      player.status = "idle";
    }

    sendRoomState(room);
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    const room = getRoomForSocket(socket.id);

    if (room) {
      const battle = getBattleForPlayer(room, socket.id);

      if (battle) {
        endBattle(room, battle);
      }

      room.players.delete(socket.id);
      socketToRoom.delete(socket.id);

      if (room.hostId === socket.id) {
        clearAllBattleTimers(room);
        io.to(room.code).emit("joinError", "Host disconnected.");
        rooms.delete(room.code);
      } else {
        sendRoomState(room);
      }
    }
  });
});

function startBotLoop() {
  setInterval(() => {
    const directions: Array<"up" | "down" | "left" | "right"> = [
      "up",
      "down",
      "left",
      "right",
    ];

    for (const room of rooms.values()) {
      if (room.status !== "playing") continue;

      const bots = [...room.players.values()].filter(
        (player) => player.id.startsWith("bot-") && player.status === "idle",
      );

      if (bots.length === 0) continue;

      for (const bot of bots) {
        if (Math.random() > 0.45) continue;

        const direction =
          directions[Math.floor(Math.random() * directions.length)];

        movePlayerWithBoost(room, bot.id, direction);
      }

      sendRoomState(room);
    }
  }, 900);
}

startGameLoop();
startBotLoop();
spawnPowerUps();

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
