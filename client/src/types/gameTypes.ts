export type SummitZone = "nw" | "ne" | "sw" | "se";
export type PlayerStatus = "idle" | "battle";
export type GameStatus = "playing" | "finished";

export type TileData = {
  row: number;
  col: number;
  level: number;
  x: number;
  y: number;
  zone?: SummitZone;
};

export type ServerPlayer = {
  id: string;
  name: string;
  level: number;
  status: PlayerStatus;
  score: number;
  shield: boolean;
  doublePointsUntil: number;
  speedBoostUntil: number;
  freezeTrapUntil: number;
  frozenUntil: number;
  tile: {
    row: number;
    col: number;
    level: number;
    zone?: SummitZone;
  };
};

export type GameState = {
  players: ServerPlayer[];
  secondsLeft: number;
  gameStatus: GameStatus;
};
